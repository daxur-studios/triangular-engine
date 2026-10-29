import { Vector3 } from 'three';
import { asin, atan, clamp, float, normalize, vec2 } from 'three/tsl';
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
  solidColorLayer,
  type ICellVoronoiLayer,
  type IPlanetContext,
  type IPlanetDayNightUniforms,
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
 * | `bodyFixedLocal`, `morphedBatchedLocal`, `morphedPosition` | `nodes.position`, relative to the camera: lift it through `modelWorldMatrix` as the macro layer does (the mesh must sit at the camera, as `LodTerrainBody` keeps it) |
 * | `uv` | the cell atlas's longitude/latitude uv of `radialDirection` |
 * | `morph`, `projectedLon`, `seamCull` | constants: the terrain is always the globe (morph 0) |
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

  constructor(options: TerrainPlanetMaterialOptions = {}) {
    const { cellPlanet, cellLookup, ...materialOptions } = options;
    super({ base: solidColorLayer({ color: '#6f8a4e' }).layer, ...materialOptions });
    // The globe's fragment mask reads attributes the terrain lacks; the terrain never crosses a map seam.
    this.maskNode = null;
    this.maskShadowNode = null;
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
    this.setStageOverride({
      id: 'lodTerrain',
      context: {
        sphereNormal: nodes.normal,
        radialDirection: radial,
        morphedPosition: nodes.position,
        latLon: vec2(asin(clamp((radial as any).y, -1, 1)), atan((radial as any).x, (radial as any).z)),
        bodyFixedLocal: nodes.position,
        morphedBatchedLocal: nodes.position,
        uv: cellAtlasUv(radial),
        projectedLon: float(0),
        seamCull: float(0),
      } satisfies Partial<IPlanetContext>,
      shadingNormal: nodes.normal,
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
