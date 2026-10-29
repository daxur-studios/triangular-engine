import { FrontSide, type Side } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, normalize, transformNormalToView, vec3, vec4 } from 'three/tsl';
import { createPlanetContext, type IPlanetContext } from './planet-context';
import {
  createPlanetMorphUniforms,
  planetMorphGraph,
  type IPlanetMorphGraphOptions,
  type IPlanetMorphGraph,
  type IPlanetMorphUniforms,
} from './planet-morph-nodes';
import { OrderedSlots } from './ordered-slots';
import { sunVisibilityLighting, type AtmosphereStage, type LightingStage } from './planet-lighting';
import {
  SURFACE_LAYER_ORDER,
  vertexColorLayer,
  type EmissiveLayer,
  type ISurfaceSample,
  type SunOcclusion,
  type SurfaceLayer,
} from './planet-surface-layers';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface IPlanetSurfaceMaterialOptions extends IPlanetMorphGraphOptions {
  /** Morph uniforms to drive; created (as TSL uniform nodes) when omitted. Read them back from `material.morph`. */
  readonly morph?: IPlanetMorphUniforms;
  /** The base vertex-colour layer's constant roughness (default 0.92). */
  readonly roughness?: number;
  /** The base vertex-colour layer's constant metalness (default 0.05). */
  readonly metalness?: number;
  readonly side?: Side;
  /** Replaces the vertex-colour base layer (e.g. `solidColorLayer`). Its id in the stack key is `base`. */
  readonly base?: SurfaceLayer;
  /** Stage 4, replaceable: runs after the PBR lighting. Default: none (plain PBR), or `sunVisibilityLighting` once an occluder exists. */
  readonly lighting?: { readonly id: string; readonly stage: LightingStage };
  /** Stage 6: runs last. Default: none (identity). */
  readonly atmosphere?: { readonly id: string; readonly stage: AtmosphereStage };
}

/**
 * Stage 1 supplied from outside the material: the shared planet context, the shading normal and the fragment mask,
 * for a mesh that is not the morph globe (the globe's stage 1 reads its `position`, `normal`, `aFlatPos` and `aFlatNorm`
 * attributes, which such a mesh does not have). Give it to {@link PlanetSurfaceMaterial.setStageOverride}.
 *
 * Everything except `id` is optional: what is omitted keeps the globe's value, so an override replaces only what it names.
 * The layer, occluder, emissive, lighting and atmosphere stacks are unchanged and read the overridden context.
 */
export interface IPlanetStageOverride {
  /**
   * Names the override in the shader cache key (`customProgramCacheKey`). Two overrides that build different graphs
   * must have different ids, or the program built for one is reused for the other.
   */
  readonly id: string;
  /**
   * Context fields to replace (position, radial direction, sphere normal, uv, lat/lon, ...). Omitted fields keep the
   * globe's. Fields are TSL nodes; vertex-stage values must be varyings, readable in the fragment stage.
   */
  readonly context?: Partial<IPlanetContext>;
  /**
   * The unit shading normal in the body frame (a node). The material turns it into view space for the PBR lighting
   * (`transformNormalToView`), as the globe does for its own. Default: the globe's.
   */
  readonly shadingNormal?: any;
  /** Fragment mask (false discards). `null` removes it; omitted keeps the globe's, which reads attributes a non-globe mesh lacks. */
  readonly maskNode?: any | null;
  /** The shadow pass's mask, without derivatives. `null` removes it; omitted keeps the globe's. */
  readonly maskShadowNode?: any | null;
}

/**
 * The cell-planet surface as one TSL node material (Plan 050).
 *
 * Stages, in order, all reading one shared {@link IPlanetContext}:
 * 1. position: sphere <-> flat morph, shading normal, seam cull (fixed, built in)
 * 2. surface layers: an ordered stack, vertex colour first (`addSurfaceLayer`)
 * 3. sun occlusion: occluders multiply into `sunVisibility` (`addSunOcclusion`); wired into lighting in Phase 4
 * 4. lighting: standard PBR for now (the replaceable lighting stage is Phase 4)
 * 5. emissive: an additive stack (`addEmissive`)
 * 6. atmosphere: identity until Plan 049 fills it
 *
 * Layers are pure functions of the context, ordered by `order`. The ids, in run order, are the shader
 * cache key (`stackKey`): changing a uniform value never recompiles, adding or removing a layer does,
 * so edit the stacks at setup and warm up with `renderer.compileAsync`.
 */
export class PlanetSurfaceMaterial extends MeshStandardNodeMaterial {
  /** The morph uniforms (TSL uniform nodes unless supplied in the options). */
  readonly morph: IPlanetMorphUniforms;
  /** Stage 1's graph, for callers building their own material from the same pieces. */
  readonly morphGraph: IPlanetMorphGraph;

  private readonly layers = new OrderedSlots<SurfaceLayer>();
  private readonly occluders = new OrderedSlots<SunOcclusion>();
  private readonly emissives = new OrderedSlots<EmissiveLayer>();
  private sunVisibilityNode: any = float(1);
  private lightingEntry?: { readonly id: string; readonly stage: LightingStage };
  private atmosphereEntry?: { readonly id: string; readonly stage: AtmosphereStage };
  private lastSample: ISurfaceSample = { albedo: vec3(1, 1, 1), roughness: float(1), metalness: float(0) };
  private readonly morphOptionsKey: string;
  private readonly globeContext: IPlanetContext;
  private stageEntry?: { readonly override: IPlanetStageOverride; readonly context: IPlanetContext };

  constructor(options: IPlanetSurfaceMaterialOptions = {}) {
    super();
    this.side = options.side ?? FrontSide;
    this.morph = options.morph ?? createPlanetMorphUniforms();
    this.morphGraph = planetMorphGraph(this.morph, options);
    this.morphOptionsKey = `${options.sphereFromGeometry ?? true}/${options.seamCullAttributes ?? false}${
      options.lightingTurn ? '/turn' : ''
    }`;
    this.lightingEntry = options.lighting;
    this.atmosphereEntry = options.atmosphere;
    this.globeContext = createPlanetContext(this.morph, this.morphGraph);

    this.positionNode = this.morphGraph.positionNode;
    this.normalNode = this.morphGraph.normalNode;
    this.maskNode = this.morphGraph.visibleMask;
    this.maskShadowNode = this.morphGraph.visibleMaskShadow;

    this.layers.add({
      id: options.base ? 'base' : 'vertexColor',
      order: SURFACE_LAYER_ORDER.base,
      value: options.base ?? vertexColorLayer({ roughness: options.roughness, metalness: options.metalness }),
    });
    this.rebuild();
  }

  /**
   * The shared planet context, for building layers outside the material: the globe's, or the one with the
   * {@link setStageOverride} fields replaced. Read it after the override is set, since the object is replaced with it.
   */
  get context(): IPlanetContext {
    return this.stageEntry?.context ?? this.globeContext;
  }

  /** The stage-1 override in force, or `undefined` for the globe's own stage 1. */
  get stageOverride(): IPlanetStageOverride | undefined {
    return this.stageEntry?.override;
  }

  /**
   * Supplies stage 1 from outside, for a mesh that is not the morph globe (the LOD terrain: see `TerrainPlanetMaterial`
   * in `triangular-engine/lod-surface`). The context fields, the shading normal and the fragment mask named in the
   * override replace the globe's; every layer, occluder, emissive, lighting and atmosphere stage is rebuilt against
   * them. `null` restores the globe's stage 1. Without an override the material is exactly the globe material.
   *
   * Set the mesh's `positionNode` yourself: it is not part of the override. Triggers a recompile and adds the override's
   * `id` to {@link customProgramCacheKey}.
   */
  setStageOverride(override: IPlanetStageOverride | null): this {
    if (override === null) {
      this.stageEntry = undefined;
      this.normalNode = this.morphGraph.normalNode;
      this.maskNode = this.morphGraph.visibleMask;
      this.maskShadowNode = this.morphGraph.visibleMaskShadow;
    } else {
      this.stageEntry = { override, context: { ...this.globeContext, ...override.context } };
      this.normalNode = override.shadingNormal
        ? transformNormalToView(normalize(override.shadingNormal))
        : this.morphGraph.normalNode;
      this.maskNode = override.maskNode === undefined ? this.morphGraph.visibleMask : override.maskNode;
      this.maskShadowNode =
        override.maskShadowNode === undefined ? this.morphGraph.visibleMaskShadow : override.maskShadowNode;
    }
    this.rebuild();
    return this;
  }

  /** Adds a surface layer. Throws if `id` is taken. Triggers a recompile. */
  addSurfaceLayer(entry: { id: string; order: number; layer: SurfaceLayer }): this {
    this.layers.add({ id: entry.id, order: entry.order, value: entry.layer });
    this.rebuild();
    return this;
  }

  removeSurfaceLayer(id: string): boolean {
    const removed = this.layers.remove(id);
    if (removed) this.rebuild();
    return removed;
  }

  /** Adds a sun occluder (e.g. an eclipse). `sunVisibility` is the product of all occluders. */
  addSunOcclusion(entry: { id: string; order?: number; occlusion: SunOcclusion }): this {
    this.occluders.add({ id: entry.id, order: entry.order ?? 0, value: entry.occlusion });
    this.rebuild();
    return this;
  }

  removeSunOcclusion(id: string): boolean {
    const removed = this.occluders.remove(id);
    if (removed) this.rebuild();
    return removed;
  }

  /** Adds an emissive contribution (city lights, lava). Emissives add. */
  addEmissive(entry: { id: string; order?: number; emissive: EmissiveLayer }): this {
    this.emissives.add({ id: entry.id, order: entry.order ?? 0, value: entry.emissive });
    this.rebuild();
    return this;
  }

  removeEmissive(id: string): boolean {
    const removed = this.emissives.remove(id);
    if (removed) this.rebuild();
    return removed;
  }

  /** Replaces the lighting stage (null restores plain PBR). Triggers a recompile. */
  setLightingStage(entry: { id: string; stage: LightingStage } | null): this {
    this.lightingEntry = entry ?? undefined;
    this.needsUpdate = true;
    return this;
  }

  /** Replaces the atmosphere stage (null restores identity). Triggers a recompile. */
  setAtmosphereStage(entry: { id: string; stage: AtmosphereStage } | null): this {
    this.atmosphereEntry = entry ?? undefined;
    this.needsUpdate = true;
    return this;
  }

  /**
   * Stages 4 and 6 run on the final lit colour: lighting (the occluders' product reaches it), then
   * atmosphere. With neither stage and no occluder the output is untouched.
   */
  override setupOutput(builder: any, outputNode: any): any {
    const lighting =
      this.lightingEntry?.stage ?? (this.occluders.size > 0 ? sunVisibilityLighting() : undefined);
    const atmosphere = this.atmosphereEntry?.stage;
    if (!lighting && !atmosphere) return super.setupOutput(builder, outputNode);

    let color: any = outputNode.rgb;
    if (lighting) {
      color = lighting(this.context, { color, sunVisibility: this.sunVisibilityNode, surface: this.lastSample, emissive: this.emissiveNode });
    }
    if (atmosphere) color = atmosphere(this.context, color);
    return super.setupOutput(builder, vec4(color, outputNode.a));
  }

  /** The product of all sun occluders (1 with none), fed to the lighting stage. */
  get sunVisibility(): any {
    return this.sunVisibilityNode;
  }

  /** Ids of the layers in run order, as `layers:a|b;occluders:c;emissives:d`. This is the shader cache key. */
  get stackKey(): string {
    const stages =
      (this.lightingEntry ? `;lighting:${this.lightingEntry.id}` : '') +
      (this.atmosphereEntry ? `;atmosphere:${this.atmosphereEntry.id}` : '');
    return `morph:${this.morphOptionsKey};layers:${this.layers.key()};occluders:${this.occluders.key()};emissives:${this.emissives.key()}${stages}`;
  }

  override customProgramCacheKey(): string {
    const stage = this.stageEntry ? `|stage:${this.stageEntry.override.id}` : '';
    return `${super.customProgramCacheKey()}|planetSurface:${this.stackKey}${stage}`;
  }

  private rebuild(): void {
    const context = this.context;

    let sample: ISurfaceSample = {
      albedo: vec3(1, 1, 1),
      roughness: float(1),
      metalness: float(0),
    };
    for (const { value } of this.layers.entries) sample = value(context, sample);

    this.lastSample = sample;
    this.colorNode = vec4(sample.albedo, 1);
    this.roughnessNode = sample.roughness;
    this.metalnessNode = sample.metalness;

    let sun: any = float(1);
    for (const { value } of this.occluders.entries) sun = sun.mul(value(context));
    this.sunVisibilityNode = sun;

    let emissive: any = null;
    for (const { value } of this.emissives.entries) {
      const contribution = value(context, sample);
      emissive = emissive ? emissive.add(contribution) : contribution;
    }
    this.emissiveNode = emissive;

    this.needsUpdate = true;
  }
}
