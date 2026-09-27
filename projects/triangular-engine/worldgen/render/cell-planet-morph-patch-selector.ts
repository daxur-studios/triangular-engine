import { Box3, Frustum, Matrix4, Vector3, type Camera } from 'three';
import type {
  ILatLonTerrainPatchAddress,
  ITerrainSurfaceSelectionRequest,
  LatLonTerrainDomain,
  TerrainSurfacePatchSelector,
} from 'triangular-engine/terrain';
import { MAP_PROJECTIONS, MapProjectionKind } from './map-projections';
import {
  maximumCellPlanetPatchDirectionDot,
  populateCellPlanetMorphPatchBounds,
} from './cell-planet-morph-patch-bounds';

export interface ICellPlanetMorphSurfaceSelectorOptions {
  /**
   * All fields are read live on every `select()` call rather than captured once, so this can be
   * constructed eagerly (e.g. as an Angular field initializer) before a required `radiusM`-style
   * input has actually been bound - the getters are simply not invoked until `select()` runs.
   */
  readonly domain: () => LatLonTerrainDomain;
  readonly radiusM: () => number;
  /** The 0 (sphere) .. 1 (flat map) morph driving the material. */
  readonly morph: () => number;
  readonly projectionKind: () => MapProjectionKind;
  /**
   * Refinement distance at level 0, as a multiple of `radiusM` (halved per level below that).
   * Defaults to 4.2, the value proven in the `cell-planet-morph-streaming` demo.
   */
  readonly refinementDistanceFactor?: () => number | undefined;
  /**
   * Threshold multiplier applied to a patch that was refined last frame, so a camera sitting
   * near the split boundary does not thrash between one and four patches every frame.
   * Defaults to 1.2 (the demo's value).
   */
  readonly stickyRefinementFactor?: () => number | undefined;
  /**
   * Optional camera provider. When supplied (and frustumCulling is not false), refinement is
   * focused inside the camera view cone (frustum) and front-facing horizon instead of a 360-degree
   * radial sphere around the camera.
   */
  readonly camera?: () => Camera | undefined;
  /**
   * Enables or disables frustum culling for LOD refinement. Defaults to true when a camera is provided.
   */
  readonly frustumCulling?: () => boolean | undefined;
  /**
   * Safety multiplier for patch UV bounds during frustum testing (defaults to 1.35, minimum 1).
   * Includes nearby terrain outside the screen to buffer camera turns.
   */
  readonly frustumSafetyFactor?: () => number | undefined;
  /**
   * Whether to cull patches beyond the planet's horizon at morph=0 (defaults to true).
   */
  readonly horizonCulling?: () => boolean | undefined;
  /**
   * Terrain height scale in meters. Bounds allow elevations up to +/- twice this value.
   * Defaults to 0; supply the mesh generator's height scale for displaced terrain.
   */
  readonly heightScaleM?: () => number | undefined;
}

export interface ICellPlanetMorphSurfaceSelector {
  readonly select: TerrainSurfacePatchSelector<ILatLonTerrainPatchAddress>;
  /** Clears refinement-hysteresis state - call when the domain or radius changes. */
  readonly reset: () => void;
}

/**
 * Creates a stateful quadtree patch selector for `TerrainSurfaceComponent` that measures screen
 * relevance in the *morphed* position (blended between the sphere direction and the projected
 * flat-map position by the live `morph` value), so refinement follows what the camera can
 * actually see mid-morph instead of only the sphere's geometry. Extracted from the proven
 * `cell-planet-morph-streaming` demo page (see runbook 039's "morph-aware patch selector" gap)
 * and generalized: quality knobs, projection and radius are supplied by the caller rather than
 * hardcoded to that demo's presets.
 */
export function createCellPlanetMorphSurfaceSelector(
  options: ICellPlanetMorphSurfaceSelectorOptions,
): ICellPlanetMorphSurfaceSelector {
  let previousRefinedKeys = new Set<string>();
  const frustum = new Frustum();
  const viewProjection = new Matrix4();
  const camPosScratch = new Vector3();
  const camDirScratch = new Vector3();
  const patchBoxScratch = new Box3();
  const ptScratch = new Vector3();

  interface Candidate {
    readonly address: ILatLonTerrainPatchAddress;
    readonly key: string;
    readonly distance: number;
    readonly threshold: number;
    readonly canRefine: boolean;
    readonly priority: number;
  }

  const select = (
    request: ITerrainSurfaceSelectionRequest<ILatLonTerrainPatchAddress>,
  ): readonly ILatLonTerrainPatchAddress[] => {
    const domain = options.domain();
    const radius = options.radiusM();
    const morph = Math.max(0, Math.min(1, options.morph()));
    const mapWidth = 2 * Math.PI * radius;
    const mapHeight = Math.PI * radius;
    const projection = MAP_PROJECTIONS[options.projectionKind()];
    const maxLevel = request.maxLevel;
    const refinementDistanceFactor = options.refinementDistanceFactor?.() ?? 4.2;
    const stickyRefinementFactor = options.stickyRefinementFactor?.() ?? 1.2;
    const baseRefinementDistance = radius * refinementDistanceFactor;
    const cam = request.cameraWorldM;
    const nextRefined = new Set<string>();

    const camera = options.camera?.();
    const useFrustum = (options.frustumCulling?.() ?? true) && !!camera;
    const safetyBase = Math.max(1, options.frustumSafetyFactor?.() ?? 1.35);
    const enableHorizon = options.horizonCulling?.() ?? true;
    const heightScaleM = Math.max(0, options.heightScaleM?.() ?? 0);
    const reliefMargin = heightScaleM * 2;

    let camDist = 0;
    let camLat = 0;
    let camLon = 0;
    let thetaHorizonMax = 0;

    if (useFrustum && camera) {
      camera.updateWorldMatrix(true, false);
      viewProjection.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      frustum.setFromProjectionMatrix(viewProjection);
      camPosScratch.set(cam[0], cam[1], cam[2]);
      camDist = camPosScratch.length();
      if (camDist > 1e-4) {
        camDirScratch.copy(camPosScratch).multiplyScalar(1 / camDist);
        // Coordinate system: lon=0 faces +Z, lon=+PI/2 faces +X (East), lat=+PI/2 faces +Y (North)
        camLat = Math.asin(Math.max(-1, Math.min(1, camDirScratch.y)));
        camLon = Math.atan2(camDirScratch.x, camDirScratch.z);
      }

      if (enableHorizon && morph === 0 && camDist >= radius) {
        const hc = Math.max(0, camDist - radius);
        const alphaCam = Math.acos(Math.min(1, radius / (radius + hc)));
        const alphaRelief = Math.acos(
          Math.min(1, radius / (radius + reliefMargin)),
        );
        thetaHorizonMax = alphaCam + alphaRelief + 0.05;
      }
    }

    const getMorphedPoint = (
      address: ILatLonTerrainPatchAddress,
      u: number,
      v: number,
      target: Vector3,
    ) => {
      const dir = domain.getFieldPosition(address, u, v);
      const sx = dir[0] * radius;
      const sy = dir[1] * radius;
      const sz = dir[2] * radius;

      const proj = projection.project(u, v, mapWidth, mapHeight);
      const fx = proj.x - mapWidth * 0.5;
      const fy = mapHeight * 0.5 - proj.y;

      target.set(
        (1 - morph) * sx + morph * fx,
        (1 - morph) * sy + morph * fy,
        (1 - morph) * sz,
      );
    };

    const measure = (address: ILatLonTerrainPatchAddress): Candidate => {
      const bounds = domain.getPatchBounds(address);
      const u = (bounds.minU + bounds.maxU) * 0.5;
      const v = (bounds.minV + bounds.maxV) * 0.5;
      getMorphedPoint(address, u, v, ptScratch);
      const cx = ptScratch.x;
      const cy = ptScratch.y;
      const cz = ptScratch.z;

      const distance = Math.hypot(cx - cam[0], cy - cam[1], cz - cam[2]);
      const key = request.getKey(address);
      const wasRefined = previousRefinedKeys.has(key);
      const threshold =
        (baseRefinementDistance / Math.pow(2, address.level)) *
        (wasRefined ? stickyRefinementFactor : 1);

      let visible = true;
      if (useFrustum) {
        // Spherical occlusion is only valid before any map deformation.
        if (
          enableHorizon &&
          morph === 0 &&
          thetaHorizonMax > 0
        ) {
          const dot = maximumCellPlanetPatchDirectionDot(bounds, camLon, camLat);
          const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
          if (angle > thetaHorizonMax) {
            visible = false;
          }
        }

        // 2. Frustum cone culling (active across all morph states!)
        if (visible) {
          const uvMargin = wasRefined
            ? (safetyBase - 1) * 0.5
            : (safetyBase - 1) * 0.25;
          populateCellPlanetMorphPatchBounds(
            bounds, radius, morph, options.projectionKind(), reliefMargin, uvMargin, patchBoxScratch,
          );
          if (!frustum.intersectsBox(patchBoxScratch)) {
            visible = false;
          }
        }
      }

      return {
        address,
        key,
        distance,
        threshold,
        canRefine: address.level < maxLevel && visible,
        priority: visible ? threshold / Math.max(distance, 1) : 0,
      };
    };

    const maxPatches = Math.max(
      request.roots.length,
      Math.floor(request.maxPatches ?? Number.MAX_SAFE_INTEGER),
    );

    // Start with one resident patch per root, then spend the remaining budget on the most
    // screen-relevant leaves. Replacing one leaf with four children costs three additional
    // patches, so the result always stays within maxPatches while remaining a complete cut.
    const frontier = request.roots.map(measure);
    while (frontier.length + 3 <= maxPatches) {
      let bestIndex = -1;
      let bestPriority = 0;
      for (let index = 0; index < frontier.length; index += 1) {
        const candidate = frontier[index];
        if (!candidate.canRefine || candidate.distance >= candidate.threshold) {
          continue;
        }
        if (candidate.priority > bestPriority) {
          bestIndex = index;
          bestPriority = candidate.priority;
        }
      }

      if (bestIndex < 0) break;

      const [parent] = frontier.splice(bestIndex, 1);
      nextRefined.add(parent.key);
      for (const child of domain.getChildren(parent.address)) {
        frontier.push(measure(child));
      }
    }

    previousRefinedKeys = nextRefined;
    return frontier.map((candidate) => candidate.address);
  };

  return {
    select,
    reset: () => {
      previousRefinedKeys = new Set();
    },
  };
}
