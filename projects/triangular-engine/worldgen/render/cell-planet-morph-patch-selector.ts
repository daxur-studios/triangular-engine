import { Frustum, Matrix4, Vector3, type Camera } from 'three';
import type {
  ILatLonTerrainPatchAddress,
  ITerrainPatchAttribute,
  ITerrainPatchMesh,
  ITerrainSurfacePatchVisibility,
  ITerrainSurfaceSelectionRequest,
  LatLonTerrainDomain,
  TerrainSurfacePatchSelector,
} from 'triangular-engine/terrain';
import { MAP_PROJECTIONS, MapProjectionKind } from './map-projections';
import {
  createCellPlanetMorphPatchExtents,
  maximumCellPlanetPatchDirectionDot,
  maximumCellPlanetPatchPlaneDistance,
  populateCellPlanetMorphPatchExtents,
  type ICellPlanetMorphPatchExtents,
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
   * Terrain height scale in meters. Until `reliefRangeM` or measured patches say otherwise,
   * visibility tests allow elevations up to +/- twice this value.
   * Defaults to 0; supply the mesh generator's height scale for displaced terrain.
   */
  readonly heightScaleM?: () => number | undefined;
  /**
   * Lowest and highest terrain height, in metres above `radiusM`, for visibility tests on patches
   * that aren't meshed yet. When omitted, the range is taken from the patches `patchVisibility`
   * has measured, padded by a quarter of `heightScaleM`, or +/- twice `heightScaleM` before any.
   */
  readonly reliefRangeM?: () => readonly [number, number] | undefined;
  /**
   * How far (radians) the camera can turn before `patchVisibility` hides a patch it would show.
   * Keep it above the terrain surface's `lodViewToleranceRadians`, since visibility is only
   * re-evaluated when selection runs. Defaults to 0.035 (2 degrees).
   */
  readonly drawMarginRadians?: () => number | undefined;
  /**
   * Where the patches' `centerWorldM` is measured from, relative to the planet's centre (the
   * mesh generator's body-fixed render origin). Defaults to the planet's centre.
   */
  readonly patchOriginBodyM?: () => readonly [number, number, number] | undefined;
  /**
   * Where the planet's centre is in the camera's scene, in metres. `request.cameraWorldM` and the
   * patch bounds are measured from the centre; the camera's matrices are in the scene. Set this
   * when the planet doesn't sit at the scene origin, e.g. under a floating origin. Defaults to
   * the scene origin.
   */
  readonly bodyCenterSceneM?: () => readonly [number, number, number] | undefined;
  /**
   * Splits a visible patch whenever this returns true, whatever its distance and past `maxLevel`,
   * for areas that need more detail than the camera distance gives (a flattened pad, say). These
   * splits don't count against `maxPatches`. The callback decides where the extra detail stops;
   * splitting also stops at `MAX_FORCED_LEVEL`. Rerun selection (`selectionRevision`) when its
   * answers change.
   */
  readonly forceRefine?: (address: ILatLonTerrainPatchAddress) => boolean;
}

/** The deepest level `forceRefine` can split to, so a callback that never says no still ends. */
const MAX_FORCED_LEVEL = 24;

/** A meshed patch's extents plus a bounding sphere of each shape, for draw-time culling. */
export interface ICellPlanetMorphPatchDrawBounds extends ICellPlanetMorphPatchExtents {
  readonly sphereCenter: readonly [number, number, number];
  readonly sphereBoundingRadius: number;
  readonly flatCenter: readonly [number, number, number];
  readonly flatBoundingRadius: number;
}

export interface ICellPlanetMorphSurfaceSelector {
  readonly select: TerrainSurfacePatchSelector<ILatLonTerrainPatchAddress>;
  /**
   * Draw-time culling for `TerrainSurfaceComponent.patchVisibility`, using the camera from the
   * last `select()` and each patch's measured geometry. Everything is visible when frustum
   * culling is off or no camera is supplied. Its `estimate` makes the same test before a patch is
   * meshed, so the surface can generate what the camera can see first.
   */
  readonly patchVisibility: ITerrainSurfacePatchVisibility<
    ILatLonTerrainPatchAddress,
    ICellPlanetMorphPatchDrawBounds
  >;
  /** Clears refinement-hysteresis state - call when the domain or radius changes. */
  readonly reset: () => void;
}

/** Extra angle (radians) past the horizon before terrain counts as hidden. */
const HORIZON_PAD_RADIANS = 0.02;

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
  const extentsScratch = createCellPlanetMorphPatchExtents();
  const estimateExtentsScratch = createCellPlanetMorphPatchExtents();
  const ptScratch = new Vector3();
  const bodyCenterScratch = new Matrix4();
  // Heights (m above radiusM) of every patch patchVisibility has measured.
  let observedMinHeightM = Infinity;
  let observedMaxHeightM = -Infinity;

  /** The camera as of the last select(), shared by refinement and draw-time culling. */
  const view = {
    active: false,
    morph: 0,
    cam: [0, 0, 0] as [number, number, number],
    camDist: 0,
    camLon: 0,
    camLat: 0,
    horizon: false,
    occluderRadius: 0,
    /** The frustum's six planes as nx, ny, nz, constant, measured from the planet's centre. */
    planes: new Float64Array(24),
  };

  const reliefRangeM = (): readonly [number, number] => {
    const explicit = options.reliefRangeM?.();
    if (explicit) return explicit;
    const heightScaleM = Math.max(0, options.heightScaleM?.() ?? 0);
    if (observedMinHeightM <= observedMaxHeightM) {
      // Coarse patches can miss a peak or trench, so allow some beyond what was seen.
      const pad = heightScaleM * 0.25;
      return [observedMinHeightM - pad, observedMaxHeightM + pad];
    }
    return [-2 * heightScaleM, 2 * heightScaleM];
  };

  /**
   * Whether any of the patch can be on screen. `slackAngle` keeps a patch until the camera has
   * turned that far past it; `distanceBoundM` bounds its distance from the camera.
   */
  const isInView = (
    extents: ICellPlanetMorphPatchExtents,
    slackAngle: number,
    distanceBoundM: number,
  ): boolean => {
    if (!view.active) return true;
    if (view.horizon) {
      // Terrain never dips below the occluder sphere, so it hides anything behind its horizon.
      const occluder = view.occluderRadius;
      const limit =
        Math.acos(Math.min(1, occluder / view.camDist)) +
        Math.acos(Math.min(1, occluder / Math.max(occluder, extents.maxRadius))) +
        HORIZON_PAD_RADIANS;
      const dot = maximumCellPlanetPatchDirectionDot(extents, view.camLon, view.camLat);
      if (Math.acos(Math.max(-1, Math.min(1, dot))) > limit) return false;
    }
    const slackM = distanceBoundM * Math.sin(slackAngle);
    const planes = view.planes;
    for (let i = 0; i < 24; i += 4) {
      const distance = maximumCellPlanetPatchPlaneDistance(
        extents, view.morph, planes[i], planes[i + 1], planes[i + 2], planes[i + 3],
      );
      if (distance < -slackM) return false;
    }
    return true;
  };

  interface Candidate {
    readonly address: ILatLonTerrainPatchAddress;
    readonly key: string;
    readonly distance: number;
    readonly threshold: number;
    readonly canRefine: boolean;
    readonly priority: number;
    /** `forceRefine` asked for this visible patch to be split. */
    readonly forced: boolean;
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
    const [minHeightM, maxHeightM] = reliefRangeM();
    const projectionKind = options.projectionKind();

    view.active = useFrustum;
    view.morph = morph;
    view.horizon = false;

    if (useFrustum && camera) {
      camera.updateWorldMatrix(true, false);
      viewProjection.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      const bodyCenter = options.bodyCenterSceneM?.();
      if (bodyCenter) {
        // The frustum then takes points measured from the planet's centre, like the patch bounds.
        viewProjection.multiply(
          bodyCenterScratch.makeTranslation(bodyCenter[0], bodyCenter[1], bodyCenter[2]),
        );
      }
      frustum.setFromProjectionMatrix(viewProjection);
      frustum.planes.forEach((plane, index) => {
        view.planes[index * 4] = plane.normal.x;
        view.planes[index * 4 + 1] = plane.normal.y;
        view.planes[index * 4 + 2] = plane.normal.z;
        view.planes[index * 4 + 3] = plane.constant;
      });
      camPosScratch.set(cam[0], cam[1], cam[2]);
      view.cam[0] = cam[0];
      view.cam[1] = cam[1];
      view.cam[2] = cam[2];
      view.camDist = camPosScratch.length();
      if (view.camDist > 1e-4) {
        camDirScratch.copy(camPosScratch).multiplyScalar(1 / view.camDist);
        // Coordinate system: lon=0 faces +Z, lon=+PI/2 faces +X (East), lat=+PI/2 faces +Y (North)
        view.camLat = Math.asin(Math.max(-1, Math.min(1, camDirScratch.y)));
        view.camLon = Math.atan2(camDirScratch.x, camDirScratch.z);
      }

      // Spherical occlusion is only valid before any map deformation. The lowest terrain
      // bounds a solid ball, whatever covers it.
      view.occluderRadius = radius + Math.min(0, minHeightM);
      view.horizon =
        enableHorizon && morph === 0 && view.occluderRadius > 0 &&
        view.camDist > view.occluderRadius;
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
        // The rectangle is widened (more so once refined) so detail is already there when the
        // camera turns, and a patch at the edge doesn't flip between refined and not.
        const uvMargin = wasRefined
          ? (safetyBase - 1) * 0.5
          : (safetyBase - 1) * 0.25;
        populateCellPlanetMorphPatchExtents(
          bounds, radius, projectionKind, minHeightM, maxHeightM, uvMargin, extentsScratch,
        );
        visible = isInView(extentsScratch, 0, 0);
      }

      return {
        address,
        key,
        distance,
        threshold,
        canRefine: address.level < maxLevel && visible,
        priority: visible ? threshold / Math.max(distance, 1) : 0,
        forced:
          visible &&
          address.level < MAX_FORCED_LEVEL &&
          (options.forceRefine?.(address) ?? false),
      };
    };

    const maxPatches = Math.max(
      request.roots.length,
      Math.floor(request.maxPatches ?? Number.MAX_SAFE_INTEGER),
    );

    // Patches `forceRefine` asked for, beyond the budget.
    let forcedExtraPatches = 0;
    const frontier: Candidate[] = [];
    const place = (candidate: Candidate): void => {
      if (!candidate.forced) {
        frontier.push(candidate);
        return;
      }
      nextRefined.add(candidate.key);
      const children = domain.getChildren(candidate.address);
      forcedExtraPatches += children.length - 1;
      for (const child of children) place(measure(child));
    };

    // Start with one resident patch per root, then spend the remaining budget on the most
    // screen-relevant leaves. Replacing one leaf with four children costs three additional
    // patches, so the result always stays within maxPatches (plus the forced splits) while
    // remaining a complete cut.
    for (const root of request.roots) place(measure(root));
    while (frontier.length - forcedExtraPatches + 3 <= maxPatches) {
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
        place(measure(child));
      }
    }

    previousRefinedKeys = nextRefined;
    return frontier.map((candidate) => candidate.address);
  };

  const patchVisibility: ICellPlanetMorphSurfaceSelector['patchVisibility'] = {
    measure: (address, patch) => {
      const bounds = measureCellPlanetMorphPatch(
        address,
        patch,
        options.domain(),
        options.radiusM(),
        options.projectionKind(),
        options.patchOriginBodyM?.(),
      );
      if (bounds.minRadius <= bounds.maxRadius) {
        const radius = options.radiusM();
        observedMinHeightM = Math.min(observedMinHeightM, bounds.minRadius - radius);
        observedMaxHeightM = Math.max(observedMaxHeightM, bounds.maxRadius - radius);
      }
      return bounds;
    },
    isVisible: (_address, bounds) => {
      if (!view.active) return true;
      const morph = view.morph;
      const [cx, cy, cz] = view.cam;
      const x = (1 - morph) * bounds.sphereCenter[0] + morph * bounds.flatCenter[0];
      const y = (1 - morph) * bounds.sphereCenter[1] + morph * bounds.flatCenter[1];
      const z = (1 - morph) * bounds.sphereCenter[2] + morph * bounds.flatCenter[2];
      const distanceBoundM =
        Math.hypot(x - cx, y - cy, z - cz) +
        (1 - morph) * bounds.sphereBoundingRadius + morph * bounds.flatBoundingRadius;
      const marginRadians = Math.max(0, options.drawMarginRadians?.() ?? 0.035);
      return isInView(bounds, marginRadians, distanceBoundM);
    },
    estimate: (address) => {
      if (!view.active) return true;
      const radius = options.radiusM();
      const [reliefMinM, reliefMaxM] = reliefRangeM();
      // Whatever has been measured is allowed too, so a patch isVisible would draw is never
      // estimated hidden because the relief range was narrower than its mesh.
      const minHeightM = Math.min(reliefMinM, observedMinHeightM);
      const maxHeightM = Math.max(reliefMaxM, observedMaxHeightM);
      populateCellPlanetMorphPatchExtents(
        options.domain().getPatchBounds(address), radius, options.projectionKind(),
        minHeightM, maxHeightM, 0, estimateExtentsScratch,
      );
      const extents = estimateExtentsScratch;
      // No mesh, so no measured centre: bound the distance from the planet's centre instead.
      let flatRadiusM = 0;
      for (let axis = 0; axis < 3; axis += 1) {
        flatRadiusM += Math.max(Math.abs(extents.flatMin[axis]), Math.abs(extents.flatMax[axis])) ** 2;
      }
      const morph = view.morph;
      // Doubled: isVisible bounds a measured box with a sphere, which reaches past maxRadius.
      const distanceBoundM =
        view.camDist +
        2 * ((1 - morph) * extents.maxRadius + morph * Math.sqrt(flatRadiusM));
      const marginRadians = Math.max(0, options.drawMarginRadians?.() ?? 0.035);
      return isInView(extents, marginRadians, distanceBoundM);
    },
  };

  return {
    select,
    patchVisibility,
    reset: () => {
      previousRefinedKeys = new Set();
    },
  };
}

function attributeArray(
  attribute: ITerrainPatchAttribute | Float32Array | undefined,
): ArrayLike<number> | undefined {
  if (!attribute) return undefined;
  return attribute instanceof Float32Array ? attribute : attribute.array;
}

/** A bounding sphere of an axis-aligned box. */
function boxBoundingSphere(
  min: readonly number[],
  max: readonly number[],
): [[number, number, number], number] {
  return [
    [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
  ];
}

/**
 * Bounds of a meshed patch from its `aSpherePos` and `aFlatPos` attributes (falling back to
 * `positions` and the projected rectangle), measured from the planet's centre.
 */
function measureCellPlanetMorphPatch(
  address: ILatLonTerrainPatchAddress,
  patch: ITerrainPatchMesh<ILatLonTerrainPatchAddress>,
  domain: LatLonTerrainDomain,
  radius: number,
  projectionKind: MapProjectionKind,
  patchOriginBodyM: readonly [number, number, number] | undefined,
): ICellPlanetMorphPatchDrawBounds {
  const origin = [
    patch.centerWorldM[0] + (patchOriginBodyM?.[0] ?? 0),
    patch.centerWorldM[1] + (patchOriginBodyM?.[1] ?? 0),
    patch.centerWorldM[2] + (patchOriginBodyM?.[2] ?? 0),
  ];
  const sphere =
    attributeArray(patch.surface.attributes?.['aSpherePos']) ?? patch.surface.positions;
  const flat = attributeArray(patch.surface.attributes?.['aFlatPos']);

  let minRadius = Infinity;
  let maxRadius = -Infinity;
  const sphereMin = [Infinity, Infinity, Infinity];
  const sphereMax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < sphere.length; i += 3) {
    const x = sphere[i] + origin[0];
    const y = sphere[i + 1] + origin[1];
    const z = sphere[i + 2] + origin[2];
    const r = Math.hypot(x, y, z);
    minRadius = Math.min(minRadius, r);
    maxRadius = Math.max(maxRadius, r);
    sphereMin[0] = Math.min(sphereMin[0], x);
    sphereMin[1] = Math.min(sphereMin[1], y);
    sphereMin[2] = Math.min(sphereMin[2], z);
    sphereMax[0] = Math.max(sphereMax[0], x);
    sphereMax[1] = Math.max(sphereMax[1], y);
    sphereMax[2] = Math.max(sphereMax[2], z);
  }
  const hasSphere = minRadius <= maxRadius;
  const extents = createCellPlanetMorphPatchExtents();
  populateCellPlanetMorphPatchExtents(
    domain.getPatchBounds(address), radius, projectionKind,
    hasSphere ? minRadius - radius : 0, hasSphere ? maxRadius - radius : 0, 0, extents,
  );
  if (flat && flat.length >= 3) {
    extents.flatMin.fill(Infinity);
    extents.flatMax.fill(-Infinity);
    for (let i = 0; i + 2 < flat.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = flat[i + axis] + origin[axis];
        extents.flatMin[axis] = Math.min(extents.flatMin[axis], value);
        extents.flatMax[axis] = Math.max(extents.flatMax[axis], value);
      }
    }
  }
  const [sphereCenter, sphereBoundingRadius] = hasSphere
    ? boxBoundingSphere(sphereMin, sphereMax)
    : boxBoundingSphere([0, 0, 0], [0, 0, 0]);
  const [flatCenter, flatBoundingRadius] = boxBoundingSphere(extents.flatMin, extents.flatMax);
  return { ...extents, sphereCenter, sphereBoundingRadius, flatCenter, flatBoundingRadius };
}
