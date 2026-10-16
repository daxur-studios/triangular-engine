import { FrontSide, type Side } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, vec3, vec4 } from 'three/tsl';
import { createPlanetContext, type IPlanetContext } from './planet-context';
import {
  createPlanetMorphUniforms,
  planetMorphGraph,
  type IPlanetMorphGraphOptions,
  type IPlanetMorphGraph,
  type IPlanetMorphUniforms,
} from './planet-morph-nodes';
import { OrderedSlots } from './ordered-slots';
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
  /** The shared planet context, for building layers outside the material. */
  readonly context: IPlanetContext;
  /** Stage 1's graph, for callers building their own material from the same pieces. */
  readonly morphGraph: IPlanetMorphGraph;

  private readonly layers = new OrderedSlots<SurfaceLayer>();
  private readonly occluders = new OrderedSlots<SunOcclusion>();
  private readonly emissives = new OrderedSlots<EmissiveLayer>();
  private sunVisibilityNode: any = float(1);
  private readonly morphOptionsKey: string;

  constructor(options: IPlanetSurfaceMaterialOptions = {}) {
    super();
    this.side = options.side ?? FrontSide;
    this.morph = options.morph ?? createPlanetMorphUniforms();
    this.morphGraph = planetMorphGraph(this.morph, options);
    this.morphOptionsKey = `${options.sphereFromGeometry ?? true}/${options.seamCullAttributes ?? false}`;
    this.context = createPlanetContext(this.morph, this.morphGraph);

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

  /** The product of all sun occluders (1 with none). Not yet applied to lighting (Plan 050 Phase 4). */
  get sunVisibility(): any {
    return this.sunVisibilityNode;
  }

  /** Ids of the layers in run order, as `layers:a|b;occluders:c;emissives:d`. This is the shader cache key. */
  get stackKey(): string {
    return `morph:${this.morphOptionsKey};layers:${this.layers.key()};occluders:${this.occluders.key()};emissives:${this.emissives.key()}`;
  }

  override customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}|planetSurface:${this.stackKey}`;
  }

  private rebuild(): void {
    const context = this.context;

    let sample: ISurfaceSample = {
      albedo: vec3(1, 1, 1),
      roughness: float(1),
      metalness: float(0),
    };
    for (const { value } of this.layers.entries) sample = value(context, sample);

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
