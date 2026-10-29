import { asin, atan, clamp, float, normalize, transformNormalToView, vec2 } from 'three/tsl';
import type { LodSurfaceNodes, LodSurfaceNodesConsumer } from 'triangular-engine/lod-surface/core';
import {
  PlanetSurfaceMaterial,
  cellAtlasUv,
  solidColorLayer,
  type IPlanetContext,
  type IPlanetSurfaceMaterialOptions,
} from 'triangular-engine/planet-material';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * `PlanetSurfaceMaterial` for `<planetTerrain [material]>` (Plan 059 G3 spike; preview, may change).
 *
 * The planet material was built for the morph globe: its stage 1 reads the globe's `position`, `normal`, `aFlatPos` and
 * `aFlatNorm` attributes to build the shared planet context (radial direction, sphere normal, body-fixed position, lat/lon).
 * The terrain mesh has none of them, so this subclass keeps the material's layer, occluder, emissive, lighting and
 * atmosphere stacks and replaces stage 1: when the mesh binds its vertex nodes, the context is rebuilt from them.
 *
 * | Context field | From the terrain |
 * |---|---|
 * | `radialDirection`, `latLon` | `nodes.up`, the unit direction of the vertex's base point (exact, no height in it) |
 * | `sphereNormal` | `nodes.normal`, the height-gradient shading normal (tilts with relief, as the field's doc says) |
 * | `bodyFixedLocal`, `morphedBatchedLocal`, `morphedPosition` | `nodes.position`, relative to the camera: lift it through `modelWorldMatrix` as the macro layer does (the mesh must sit at the camera, as `LodTerrainBody` keeps it) |
 * | `uv` | the cell atlas's longitude/latitude uv of `radialDirection` |
 * | `morph`, `projectedLon`, `seamCull` | constants: the terrain is always the globe (morph 0) |
 *
 * The normal and the fragment mask are also replaced (the globe's would read the missing attributes). The default base
 * layer is a solid colour, not the vertex colour (the terrain has no `color` attribute): pass `base`, or add a layer such
 * as `cellLookupLayer` on top. It is lit by the scene's lights (standard PBR), so the scene needs a directional light.
 *
 * ```ts
 * const material = new TerrainPlanetMaterial();
 * const cells = cellLookupLayer();
 * material.addSurfaceLayer({ id: 'cellLookup', order: SURFACE_LAYER_ORDER.cellLookup, layer: cells.layer });
 * // <planetTerrain [radius]="r" [heights]="h" [material]="material" />
 * ```
 */
export class TerrainPlanetMaterial extends PlanetSurfaceMaterial implements LodSurfaceNodesConsumer {
  constructor(options: IPlanetSurfaceMaterialOptions = {}) {
    super({ base: solidColorLayer({ color: '#6f8a4e' }).layer, ...options });
    // The globe's fragment mask reads attributes the terrain lacks; the terrain never crosses a map seam.
    this.maskNode = null;
    this.maskShadowNode = null;
  }

  /** Called by the terrain mesh when it is built (and again if the same material is given to a rebuilt mesh). */
  bindLodSurfaceNodes(nodes: LodSurfaceNodes): void {
    const radial = normalize(nodes.up);
    const context: IPlanetContext = {
      ...this.context,
      sphereNormal: nodes.normal,
      radialDirection: radial,
      morphedPosition: nodes.position,
      latLon: vec2(asin(clamp((radial as any).y, -1, 1)), atan((radial as any).x, (radial as any).z)),
      bodyFixedLocal: nodes.position,
      morphedBatchedLocal: nodes.position,
      uv: cellAtlasUv(radial),
      projectedLon: float(0),
      seamCull: float(0),
    };
    // `context` is readonly on the base class and every layer reads it at rebuild time. Spike shortcut: G3 should give
    // the base class a supported way to take a context (see the runbook), instead of this cast.
    (this as unknown as { context: IPlanetContext }).context = context;
    this.normalNode = transformNormalToView(normalize(nodes.normal));
    (this as unknown as { rebuild(): void }).rebuild();
  }

  override customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}|lodTerrain`;
  }
}
