import { Vector3 } from 'three';
import { asin, atan, clamp, float, mix, normalize, select, vec2 } from 'three/tsl';
import {
  buildCellPlanetLookup,
  resolveCellPlanetWorld,
  type CellPlanetLookupOptions,
  type CellPlanetSource,
  type LodSurfaceNodes,
  type LodSurfaceNodesConsumer,
  type LodSurfaceSunConsumer,
  type Vec3,
} from 'triangular-engine/lod-surface/core';
import {
  PlanetSurfaceMaterial,
  SURFACE_LAYER_ORDER,
  cellAtlasUv,
  cellVoronoiLayer,
  createPlanetDayNightUniforms,
  seamProjectedLon,
  solidColorLayer,
  type ICellVoronoiLayer,
  type IPlanetContext,
  type IPlanetDayNightUniforms,
  type IPlanetMorphUniforms,
  type IPlanetSurfaceMaterialOptions,
} from 'triangular-engine/planet-material';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Options of {@link TerrainPlanetMaterial}. */
export interface TerrainPlanetMaterialOptions extends IPlanetSurfaceMaterialOptions {
  /**
   * Paint the ground with the colours of a cell planet: the built world the heights come from (`buildCellPlanetWorld`), or
   * the description given to `cellPlanetHeights` (`seed`, `cellCount`, `relaxationIterations`), from which the world is
   * built on the calling thread. Land and ice take their biome colour and the sea the ocean colour, as on the globe. Cell
   * edges are exact at any zoom (see `cellVoronoiLayer`). Omitted: a solid base colour, to which you add your own layers.
   */
  readonly cellPlanet?: CellPlanetSource;
  /** Atlas size and colour overrides of the cell lookup; used only with {@link cellPlanet}. */
  readonly cellLookup?: CellPlanetLookupOptions;
  /**
   * The planet's shared morph uniforms (`<planet>`'s `morphUniforms`), for a terrain that follows the globe-to-map morph
   * (Plan 059 G6e). With them the material reads `morph` and the projected longitude from these uniforms, bends its shading
   * normal with the ground and turns direct shadows off while morph is above 0. Give the same set to the terrain body's
   * `setMorph` so the drawn surface and the shading agree. Omitted: the terrain is the globe (morph 0), as before.
   *
   * With the mesh's globe fields (`globePosition`, `globeNormal`, built with its morph option) the cells stay on the sphere:
   * `bodyFixedLocal` is the unbent position, so cells do not move with the map. The shading normal blends from the globe's
   * relief normal at morph 0 to the bent ground's up at morph 1, so relief fades out as the map flattens (a known simplification).
   */
  readonly morphUniforms?: IPlanetMorphUniforms;
}

/**
 * `PlanetSurfaceMaterial` for `<planetTerrain [material]>` (Plan 059 G3; preview, may change).
 *
 * The planet material was built for the morph globe: its stage 1 reads the globe's `position`, `normal`, `aFlatPos` and
 * `aFlatNorm` attributes to build the shared planet context. The terrain mesh has none of them, so when the mesh binds its
 * vertex nodes ({@link LodSurfaceNodesConsumer}) this material supplies stage 1 itself through
 * {@link PlanetSurfaceMaterial.setStageOverride}, and keeps the layer, occluder, emissive, lighting and atmosphere stacks.
 *
 * | Context field | From the terrain |
 * |---|---|
 * | `radialDirection`, `latLon` | `nodes.up`, the unit direction of the vertex's base point (exact, no height in it) |
 * | `sphereNormal` | `nodes.normal`, the height-gradient shading normal (tilts with relief, as the field's doc says) |
 * | `bodyFixedLocal` | `nodes.globePosition` (unbent) with `morphUniforms` and the mesh's globe fields, else `nodes.position`; relative to the camera: lift it through `modelWorldMatrix` as the macro layer does (the mesh must sit at the camera, as `LodTerrainBody` keeps it) |
 * | `morphedBatchedLocal`, `morphedPosition` | `nodes.position`, the drawn (bent above morph 0) position, lifted the same way |
 * | `uv` | the cell atlas's longitude/latitude uv of `radialDirection` |
 * | `morph`, `projectedLon` | constants (morph 0, longitude 0) without `morphUniforms`; with it, the shared `uMorph` and the longitude of `radialDirection` in the projection frame |
 * | `seamCull` | constant 0: the mesh's own fragment mask cuts the map's seam, so the terrain has no per-triangle test |
 *
 * The default base layer is a solid colour, not the vertex colour (the terrain has no `color` attribute). It is lit by the
 * scene's lights (standard PBR), so the scene needs a directional light; see {@link setSunDirection} for the sun a parent
 * will drive. You dispose the material; that also disposes the cell lookup it made.
 *
 * ```ts
 * // The ground in the globe's colours, from the same world the heights come from:
 * const material = new TerrainPlanetMaterial({ cellPlanet: world });
 * // <planetTerrain [radius]="r" [heights]="h" [material]="material" />
 * ```
 *
 * Without `cellPlanet`, add layers yourself: `material.addSurfaceLayer({ id, order: SURFACE_LAYER_ORDER.game, layer })`.
 * Layers that read a vertex attribute (the vertex-colour base, the macro layer's land mask, streamed tiles) still need that
 * attribute and do not work here.
 */
export class TerrainPlanetMaterial extends PlanetSurfaceMaterial implements LodSurfaceNodesConsumer, LodSurfaceSunConsumer {
  /**
   * The ground-colour layer built from {@link TerrainPlanetMaterialOptions.cellPlanet}, for its `opacity` and `updatePalette`
   * (recolour cells without a rebuild). Undefined without `cellPlanet`. Disposed with the material.
   */
  readonly cells: ICellVoronoiLayer | undefined;
  /** Wall time to build the cell lookup (colours, atlas, centres and neighbours) on the calling thread, ms; excludes the world build. Undefined without `cellPlanet`. */
  readonly cellLookupMs: number | undefined;
  /**
   * Day/night uniforms, with `uSunDirection` kept in step with {@link setSunDirection}. Unused by the default lighting:
   * a parent that wants the planet's day/night model passes them to `simpleDayNightLighting` and `setLightingStage`.
   */
  readonly dayNight: IPlanetDayNightUniforms = createPlanetDayNightUniforms();

  /** The shared morph uniforms when given ({@link TerrainPlanetMaterialOptions.morphUniforms}); undefined: the terrain is the globe. */
  private readonly sharedMorph: IPlanetMorphUniforms | undefined;

  constructor(options: TerrainPlanetMaterialOptions = {}) {
    const { cellPlanet, cellLookup, morphUniforms, ...materialOptions } = options;
    super({ base: solidColorLayer({ color: '#6f8a4e' }).layer, ...materialOptions, ...(morphUniforms ? { morph: morphUniforms } : {}) });
    this.sharedMorph = morphUniforms;
    // The globe's fragment mask reads attributes the terrain lacks; the terrain never crosses a map seam.
    this.maskNode = null;
    this.maskShadowNode = null;
    if (morphUniforms) {
      // Direct shadows contribute nothing above the globe: the shadow factor is 1 while morph > 0 and the shadow map's own
      // factor at morph 0. `receivedShadowNode` is three's hook for it; its argument is the factor the lights computed.
      const morph = morphUniforms.uMorph as any;
      this.receivedShadowNode = ((shadow: any) => select(morph.greaterThan(0), float(1), shadow)) as any;
    }
    if (cellPlanet) {
      const world = resolveCellPlanetWorld(cellPlanet);
      const began = performance.now();
      const lookup = buildCellPlanetLookup(world, cellLookup);
      const cells = cellVoronoiLayer();
      cells.setLookup(lookup);
      this.cellLookupMs = performance.now() - began;
      this.cells = cells;
      this.addSurfaceLayer({ id: 'cellLookup', order: SURFACE_LAYER_ORDER.cellLookup, layer: cells.layer });
    } else {
      this.cells = undefined;
      this.cellLookupMs = undefined;
    }
  }

  /** Called by the terrain mesh when it is built (and again if the same material is given to a rebuilt mesh). */
  bindLodSurfaceNodes(nodes: LodSurfaceNodes): void {
    const radial = normalize(nodes.up);
    const shared = this.sharedMorph;
    const morph = shared?.uMorph as any;
    // With the mesh's globe fields (G6e-c) the cells stay on the sphere: `bodyFixedLocal` is the unbent position, and the shading
    // normal blends the globe's relief normal (exact at morph 0) into the bent up at morph 1, so relief fades as the map flattens.
    // Without them (an older mesh, or no morphUniforms) the previous nodes are used. Without a bend in the nodes (the mesh built
    // without its morph option) the shading normal stays the normal.
    const onGlobe = shared !== undefined && nodes.globePosition !== undefined;
    const bodyFixed = onGlobe ? nodes.globePosition : nodes.position;
    const globeNormal = onGlobe ? nodes.globeNormal : nodes.normal;
    const shadingNormal =
      shared && nodes.bentUp
        ? select(morph.lessThan(1e-4), globeNormal, normalize((mix as any)(globeNormal, nodes.bentUp, clamp(morph, 0, 1))))
        : nodes.normal;
    this.setStageOverride({
      id: shared ? 'lodTerrainMorph' : 'lodTerrain',
      context: {
        sphereNormal: nodes.normal,
        radialDirection: radial,
        morphedPosition: nodes.position,
        latLon: vec2(asin(clamp((radial as any).y, -1, 1)), atan((radial as any).x, (radial as any).z)),
        bodyFixedLocal: bodyFixed,
        morphedBatchedLocal: nodes.position,
        uv: cellAtlasUv(radial),
        ...(shared
          ? {
              morph,
              projectedLon: select(
                (shared.uProjMode as any).greaterThan(0.5),
                seamProjectedLon(radial, shared.uProjForward as any, shared.uProjRight as any),
                float(0),
              ),
            }
          : { projectedLon: float(0) }),
        seamCull: float(0),
      } satisfies Partial<IPlanetContext>,
      shadingNormal,
      maskNode: null,
      maskShadowNode: null,
    });
  }

  /**
   * The unit direction to the sun in the scene frame. `<planetTerrain [sunDirection]>` calls it, and the future `<planet>`
   * parent will. It writes {@link dayNight}`.uSunDirection`, which a day/night lighting stage reads. The scene's own
   * directional light, which the PBR lighting uses, is the parent's to move to match.
   */
  setSunDirection(direction: Vec3 | readonly [number, number, number]): void {
    (this.dayNight.uSunDirection.value as Vector3).set(direction[0], direction[1], direction[2]).normalize();
  }

  override dispose(): void {
    this.cells?.dispose();
    super.dispose();
  }
}
