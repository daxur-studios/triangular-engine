import { Box3, Frustum, Matrix4, Vector3, type Camera } from 'three';
import type {
  ILatLonTerrainPatchAddress,
  ITerrainPatchBounds,
  ITerrainSurfaceSelectionRequest,
  LatLonTerrainDomain,
  TerrainSurfacePatchSelector,
} from 'triangular-engine/terrain';
import { MAP_PROJECTIONS, MapProjectionKind } from './map-projections';

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
   * Safety multiplier applied to patch radius during frustum testing (defaults to 1.35).
   * Expands the view cone slightly so terrain just outside the screen is refined before turning into it.
   */
  readonly frustumSafetyFactor?: () => number | undefined;
  /**
   * Whether to cull patches beyond the planet's horizon when in sphere mode (defaults to true).
   */
  readonly horizonCulling?: () => boolean | undefined;
  /**
   * Optional height scale / relief margin in meters to expand patch bounding spheres.
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
    const morph = options.morph();
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
    const safetyBase = options.frustumSafetyFactor?.() ?? 1.35;
    const enableHorizon = options.horizonCulling?.() ?? true;
    const heightScaleM = options.heightScaleM?.() ?? 0;
    const reliefMargin = heightScaleM * 2;

    let camDist = 0;
    let camLat = 0;
    let camLon = 0;
    let thetaHorizonMax = 0;

    if (useFrustum && camera) {
      camera.updateMatrixWorld();
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

      if (enableHorizon && morph < 0.05 && camDist >= radius - reliefMargin) {
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
      rOffset: number,
      target: Vector3,
    ) => {
      const dir = domain.getFieldPosition(address, u, v);
      const r = radius + (1 - morph) * rOffset;
      const sx = dir[0] * r;
      const sy = dir[1] * r;
      const sz = dir[2] * r;

      const proj = projection.project(u, v, mapWidth, mapHeight);
      const fx = proj.x - mapWidth * 0.5;
      const fy = mapHeight * 0.5 - proj.y;
      const fz = morph * rOffset;

      target.set(
        (1 - morph) * sx + morph * fx,
        (1 - morph) * sy + morph * fy,
        (1 - morph) * sz + fz,
      );
    };

    const populatePatchBox = (
      address: ILatLonTerrainPatchAddress,
      bounds: ITerrainPatchBounds,
      uvMargin: number,
      target: Box3,
    ) => {
      const spanU = bounds.maxU - bounds.minU;
      const spanV = bounds.maxV - bounds.minV;
      const extraU = spanU * uvMargin;
      const extraV = spanV * uvMargin;
      const minU = bounds.minU - extraU;
      const maxU = bounds.maxU + extraU;
      const minV = Math.max(-Math.PI * 0.5, bounds.minV - extraV);
      const maxV = Math.min(Math.PI * 0.5, bounds.maxV + extraV);
      const midU = (minU + maxU) * 0.5;
      const midV = (minV + maxV) * 0.5;

      target.makeEmpty();
      const uSamples = [minU, midU, maxU];
      const vSamples = [minV, midV, maxV];
      const rOffsets = reliefMargin > 0 ? [-reliefMargin, reliefMargin] : [0];

      for (let ro = 0; ro < rOffsets.length; ro += 1) {
        const rOff = rOffsets[ro];
        for (let ui = 0; ui < 3; ui += 1) {
          const uVal = uSamples[ui];
          for (let vi = 0; vi < 3; vi += 1) {
            getMorphedPoint(address, uVal, vSamples[vi], rOff, ptScratch);
            target.expandByPoint(ptScratch);
          }
        }
      }
    };

    const measure = (address: ILatLonTerrainPatchAddress): Candidate => {
      const bounds = domain.getPatchBounds(address);
      const u = (bounds.minU + bounds.maxU) * 0.5;
      const v = (bounds.minV + bounds.maxV) * 0.5;
      getMorphedPoint(address, u, v, 0, ptScratch);
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
        // 1. Horizon culling for sphere mode (morph < 0.05)
        if (
          enableHorizon &&
          morph < 0.05 &&
          thetaHorizonMax > 0
        ) {
          const clampLon = Math.max(bounds.minU, Math.min(bounds.maxU, camLon));
          const clampLat = Math.max(bounds.minV, Math.min(bounds.maxV, camLat));
          const dir = domain.getFieldPosition(address, clampLon, clampLat);
          const dot =
            camDirScratch.x * dir[0] +
            camDirScratch.y * dir[1] +
            camDirScratch.z * dir[2];
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
          populatePatchBox(address, bounds, uvMargin, patchBoxScratch);
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
