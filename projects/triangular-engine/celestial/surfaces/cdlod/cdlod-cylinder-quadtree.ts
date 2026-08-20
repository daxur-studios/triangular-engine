import { Vec3d } from '../../math/vec3';
import { ISurfaceSampler } from '../surface-sampler';
import {
  CdlodMotionLookAhead,
  IResolvedMotionState,
  resolveMotionLookAhead,
} from './cdlod-motion-prediction';

export interface ICylinderPatchAddress {
  /** Quadtree depth level (0 = coarsest root patch). */
  readonly level: number;
  /** Circumferential sector index at this level (wraps around [0, 2pi)). */
  readonly sector: number;
  /** Axial index along the cylinder's longitudinal Z-axis. */
  readonly zIndex: number;
}

export interface ICylinderEdgeMorph {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
}

export interface ICdlodCylinderPatch {
  readonly address: ICylinderPatchAddress;
  readonly id: string;
  readonly centerM: Vec3d;
  readonly minElevationM: number;
  readonly maxElevationM: number;
  readonly roughnessM: number;
  readonly distanceM: number;
  readonly morphFactor: number;
  readonly resolution: number;
  readonly edgeMorph: ICylinderEdgeMorph;
  readonly isOutsideFrustum?: boolean;
}

export interface ICdlodCylinderSelectionOptions {
  /** Cylinder nominal radius in meters (e.g. 4000m for an 8km diameter habitat). */
  readonly radiusM: number;
  /** Number of root circumferential sectors around 2*pi (default: 8). */
  readonly rootSectors?: number;
  /** Root axial patch length in meters along Z (default: matches sector arc length). */
  readonly rootPatchLengthM?: number;
  /** Number of axial root patches in each direction along Z from camera (default: 3). */
  readonly axialStreamingRadius?: number;
  /** Maximum quadtree subdivision level (default: 6). */
  readonly maxLevel: number;
  /** Base grid resolution per patch (e.g. 32 quads). */
  readonly baseResolution: number;
  /** Pixel screen-space error threshold to trigger subdivision. */
  readonly splitErrorPx: number;
  /** Pixel screen-space error threshold to trigger patch merging. */
  readonly mergeErrorPx: number;
  /** Screen space scaling factor (viewport height * cot(fov / 2) / 2). */
  readonly screenSpaceFactorPx: number;
  /** Fraction of split distance over which GPU geomorphing transitions (e.g. 0.25). */
  readonly morphRangeRatio: number;
  /** Enable roughness/feature adaptive LOD decimation. */
  readonly featureAdaptive?: boolean;
}

export interface ICdlodCylinderSelectionResult {
  readonly patches: readonly ICdlodCylinderPatch[];
  readonly splitAddresses: ReadonlySet<string>;
  readonly neededPatches?: readonly ICdlodCylinderPatch[];
}

export function cylinderPatchAddressKey(
  address: ICylinderPatchAddress,
  resolution = 32,
): string {
  return `cylinder:${address.level}:${address.sector}:${address.zIndex}:${resolution}`;
}

export interface ICylinderPatchBounds {
  readonly thetaMin: number;
  readonly thetaMax: number;
  readonly thetaSpan: number;
  readonly zMin: number;
  readonly zMax: number;
  readonly zSpan: number;
  readonly arcLengthM: number;
}

/**
 * Computes angular and axial bounds for a cylinder patch at the given address.
 */
export function cylinderPatchBounds(
  address: ICylinderPatchAddress,
  radiusM: number,
  rootSectors = 8,
  rootPatchLengthM?: number,
): ICylinderPatchBounds {
  const levelFactor = 2 ** address.level;
  const numSectors = rootSectors * levelFactor;
  const thetaSpan = (2 * Math.PI) / numSectors;

  // Normalized sector in [0, numSectors - 1]
  const normalizedSector =
    ((address.sector % numSectors) + numSectors) % numSectors;
  const thetaMin = normalizedSector * thetaSpan;
  const thetaMax = thetaMin + thetaSpan;

  const actualRootZLength =
    rootPatchLengthM ?? (2 * Math.PI * radiusM) / rootSectors;
  const zSpan = actualRootZLength / levelFactor;
  const zMin = address.zIndex * zSpan;
  const zMax = zMin + zSpan;

  const arcLengthM = thetaSpan * radiusM;

  return {
    thetaMin,
    thetaMax,
    thetaSpan,
    zMin,
    zMax,
    zSpan,
    arcLengthM,
  };
}

/**
 * Evaluates minimum Euclidean distance from camera to the interior cylinder patch volume.
 */
export function evaluateDistanceToCylinderPatch(
  bounds: ICylinderPatchBounds,
  radiusM: number,
  minElevationM: number,
  maxElevationM: number,
  cameraPosM: Vec3d,
): number {
  const { thetaMin, thetaMax, zMin, zMax } = bounds;

  // Sample corner points and midpoints of the curved patch
  const thetas = [
    thetaMin,
    (thetaMin + thetaMax) * 0.5,
    thetaMax,
  ];
  const zs = [zMin, (zMin + zMax) * 0.5, zMax];
  const radii = [radiusM - maxElevationM, radiusM - minElevationM];

  let minDistanceSq = Infinity;

  for (const th of thetas) {
    const sinTh = Math.sin(th);
    const cosTh = Math.cos(th);
    for (const r of radii) {
      const px = r * sinTh;
      const py = -r * cosTh;
      for (const z of zs) {
        const dx = px - cameraPosM[0];
        const dy = py - cameraPosM[1];
        const dz = z - cameraPosM[2];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < minDistanceSq) {
          minDistanceSq = distSq;
        }
      }
    }
  }

  return Math.sqrt(minDistanceSq);
}

/**
 * Computes the center Cartesian position and elevation stats for a cylinder patch.
 */
export function computeCylinderPatchCenterAndElevations(
  sampler: ISurfaceSampler,
  address: ICylinderPatchAddress,
  radiusM: number,
  rootSectors = 8,
  rootPatchLengthM?: number,
): {
  centerM: Vec3d;
  minElevationM: number;
  maxElevationM: number;
  roughnessM: number;
} {
  const bounds = cylinderPatchBounds(
    address,
    radiusM,
    rootSectors,
    rootPatchLengthM,
  );
  const midTheta = (bounds.thetaMin + bounds.thetaMax) * 0.5;
  const midZ = (bounds.zMin + bounds.zMax) * 0.5;

  const midArcX = midTheta * radiusM;
  const midSample = sampler.sample([midArcX, 0, midZ]);
  const elevMid = midSample.elevationM;

  const rEffective = radiusM - elevMid;
  const centerM: Vec3d = [
    rEffective * Math.sin(midTheta),
    -rEffective * Math.cos(midTheta),
    midZ,
  ];

  // 5-point roughness evaluation
  const s0 = sampler.sample([bounds.thetaMin * radiusM, 0, bounds.zMin]).elevationM;
  const s1 = sampler.sample([bounds.thetaMax * radiusM, 0, bounds.zMin]).elevationM;
  const s2 = sampler.sample([bounds.thetaMin * radiusM, 0, bounds.zMax]).elevationM;
  const s3 = sampler.sample([bounds.thetaMax * radiusM, 0, bounds.zMax]).elevationM;

  const minElevationM = Math.min(elevMid, s0, s1, s2, s3);
  const maxElevationM = Math.max(elevMid, s0, s1, s2, s3);
  const roughnessM = maxElevationM - minElevationM;

  return {
    centerM,
    minElevationM,
    maxElevationM,
    roughnessM,
  };
}

/**
 * Recursive selection node for cylinder CDLOD quadtree.
 */
function selectCdlodCylinderNode(
  sampler: ISurfaceSampler,
  address: ICylinderPatchAddress,
  cameraPositionM: Vec3d,
  cameraForwardDir: Vec3d | null,
  options: ICdlodCylinderSelectionOptions,
  previouslySplitAddresses: ReadonlySet<string> | undefined,
  resolvedMotion: IResolvedMotionState | undefined,
  rootSectors: number,
  rootPatchLengthM: number,
  outPatches: ICdlodCylinderPatch[],
  outSplitAddresses: Set<string>,
): void {
  const bounds = cylinderPatchBounds(
    address,
    options.radiusM,
    rootSectors,
    rootPatchLengthM,
  );

  const { centerM, minElevationM, maxElevationM, roughnessM } =
    computeCylinderPatchCenterAndElevations(
      sampler,
      address,
      options.radiusM,
      rootSectors,
      rootPatchLengthM,
    );

  const distanceM = evaluateDistanceToCylinderPatch(
    bounds,
    options.radiusM,
    minElevationM,
    maxElevationM,
    cameraPositionM,
  );

  const camToPatch: Vec3d = [
    centerM[0] - cameraPositionM[0],
    centerM[1] - cameraPositionM[1],
    centerM[2] - cameraPositionM[2],
  ];
  const camToPatchDist = Math.hypot(...camToPatch) || 1;
  const viewDir: Vec3d = [
    camToPatch[0] / camToPatchDist,
    camToPatch[1] / camToPatchDist,
    camToPatch[2] / camToPatchDist,
  ];

  // Frustum culling (83 deg half cone)
  const patchRadiusM = Math.hypot(bounds.arcLengthM, bounds.zSpan) * 0.5;
  let isOutsideFrustum = false;

  if (cameraForwardDir && camToPatchDist > patchRadiusM * 1.5) {
    const fwdDot = Math.max(
      -1,
      Math.min(
        1,
        cameraForwardDir[0] * viewDir[0] +
          cameraForwardDir[1] * viewDir[1] +
          cameraForwardDir[2] * viewDir[2],
      ),
    );
    const angleFromFwd = Math.acos(fwdDot);
    const patchAngularFromCam = Math.asin(
      Math.min(1, patchRadiusM / camToPatchDist),
    );
    const nearestPatchAngle = Math.max(0, angleFromFwd - patchAngularFromCam);
    isOutsideFrustum = nearestPatchAngle > 1.45; // ~83 deg half-cone
  }

  const patchKey = cylinderPatchAddressKey(address, options.baseResolution);

  if (isOutsideFrustum) {
    outPatches.push({
      address,
      id: patchKey,
      centerM,
      minElevationM,
      maxElevationM,
      roughnessM,
      distanceM,
      morphFactor: 0,
      resolution: options.baseResolution,
      edgeMorph: { left: 0, right: 0, bottom: 0, top: 0 },
      isOutsideFrustum: true,
    });
    return;
  }

  let evalDistanceM = distanceM;
  if (resolvedMotion && resolvedMotion.effectiveSpeedMps > 5) {
    const velDir = resolvedMotion.velocityDirection;
    const forwardProj = velDir
      ? velDir[0] * viewDir[0] + velDir[1] * viewDir[1] + velDir[2] * viewDir[2]
      : 1.0;

    if (forwardProj > 0.1) {
      const futureDist = evaluateDistanceToCylinderPatch(
        bounds,
        options.radiusM,
        minElevationM,
        maxElevationM,
        resolvedMotion.evalCameraBodyFixedM,
      );
      evalDistanceM = Math.min(distanceM, futureDist);
    }
  }

  let featureWeight = 1.0;
  if (options.featureAdaptive) {
    featureWeight = Math.max(0.35, Math.min(1.0, roughnessM / 20.0));
  }

  const patchSpanM = Math.max(bounds.arcLengthM, bounds.zSpan);
  const lodDistanceRatio = Math.max(
    1.15,
    Math.min(
      1.75,
      (options.screenSpaceFactorPx /
        (options.splitErrorPx * options.baseResolution)) *
        0.42,
    ),
  );

  const splitDistM = patchSpanM * lodDistanceRatio * featureWeight;
  const morphRangeM = splitDistM * options.morphRangeRatio;
  const morphStartM = splitDistM - morphRangeM;

  const isPreviouslySplit = previouslySplitAddresses?.has(patchKey) ?? false;
  const thresholdDistM = isPreviouslySplit ? splitDistM * 1.15 : splitDistM;

  const shouldSplit =
    address.level < options.maxLevel && evalDistanceM < thresholdDistM;

  let morphFactor = 0.0;
  if (distanceM > morphStartM && morphRangeM > 0.001) {
    morphFactor = Math.min(
      1.0,
      Math.max(0.0, (distanceM - morphStartM) / morphRangeM),
    );
  }

  if (shouldSplit) {
    outSplitAddresses.add(patchKey);
    const nextLevel = address.level + 1;
    const nextSec = address.sector * 2;
    const nextZ = address.zIndex * 2;

    // 4 quadrant children
    // (sec, z), (sec+1, z), (sec, z+1), (sec+1, z+1)
    for (let dz = 0; dz < 2; dz++) {
      for (let ds = 0; ds < 2; ds++) {
        selectCdlodCylinderNode(
          sampler,
          {
            level: nextLevel,
            sector: nextSec + ds,
            zIndex: nextZ + dz,
          },
          cameraPositionM,
          cameraForwardDir,
          options,
          previouslySplitAddresses,
          resolvedMotion,
          rootSectors,
          rootPatchLengthM,
          outPatches,
          outSplitAddresses,
        );
      }
    }
  } else {
    outPatches.push({
      address,
      id: patchKey,
      centerM,
      minElevationM,
      maxElevationM,
      roughnessM,
      distanceM,
      morphFactor,
      resolution: options.baseResolution,
      edgeMorph: { left: 0, right: 0, bottom: 0, top: 0 },
    });
  }
}

/**
 * Continuous crack-free edge morph computation across cylindrical neighbors (with circumferential wrap).
 */
function computeCylinderEdgeMorphs(
  patches: readonly ICdlodCylinderPatch[],
  rootSectors: number,
  baseResolution = 32,
): ICdlodCylinderPatch[] {
  const patchMap = new Map<string, ICdlodCylinderPatch>();
  for (const patch of patches) {
    patchMap.set(patch.id, patch);
  }

  return patches.map((patch) => {
    if (patch.isOutsideFrustum) return patch;

    const { level, sector, zIndex } = patch.address;
    const numSectors = rootSectors * 2 ** level;

    // Circumferential wrapping for left/right
    const leftSector = ((sector - 1) % numSectors + numSectors) % numSectors;
    const rightSector = (sector + 1) % numSectors;

    const leftKey = `cylinder:${level}:${leftSector}:${zIndex}:${baseResolution}`;
    const rightKey = `cylinder:${level}:${rightSector}:${zIndex}:${baseResolution}`;
    const botKey = `cylinder:${level}:${sector}:${zIndex - 1}:${baseResolution}`;
    const topKey = `cylinder:${level}:${sector}:${zIndex + 1}:${baseResolution}`;

    const hasLeftNeighbor = patchMap.has(leftKey);
    const hasRightNeighbor = patchMap.has(rightKey);
    const hasBotNeighbor = patchMap.has(botKey);
    const hasTopNeighbor = patchMap.has(topKey);

    const edgeMorph: ICylinderEdgeMorph = {
      left: hasLeftNeighbor ? 0 : patch.morphFactor,
      right: hasRightNeighbor ? 0 : patch.morphFactor,
      bottom: hasBotNeighbor ? 0 : patch.morphFactor,
      top: hasTopNeighbor ? 0 : patch.morphFactor,
    };

    return {
      ...patch,
      edgeMorph,
    };
  });
}

/**
 * Top-level CDLOD patch selection for Interior O'Neill Cylinder.
 */
export function selectCdlodCylinderPatches(params: {
  sampler: ISurfaceSampler;
  cameraPositionM: Vec3d;
  cameraForwardDir: Vec3d | null;
  options: ICdlodCylinderSelectionOptions;
  previouslySplitAddresses?: ReadonlySet<string>;
  cachedGeometries?: ReadonlySet<string>;
  motionLookAhead?: CdlodMotionLookAhead | null;
}): ICdlodCylinderSelectionResult {
  const {
    sampler,
    cameraPositionM,
    cameraForwardDir,
    options,
    previouslySplitAddresses,
    cachedGeometries,
    motionLookAhead,
  } = params;

  const rootSectors = options.rootSectors ?? 8;
  const rootPatchLengthM =
    options.rootPatchLengthM ?? (2 * Math.PI * options.radiusM) / rootSectors;
  const axialStreamingRadius = options.axialStreamingRadius ?? 3;

  const camZ = cameraPositionM[2];
  const centerZIndex = Math.floor(camZ / rootPatchLengthM);

  const rawPatches: ICdlodCylinderPatch[] = [];
  const splitAddresses = new Set<string>();

  const resolvedMotion = motionLookAhead
    ? resolveMotionLookAhead(
        cameraPositionM,
        cameraForwardDir ?? undefined,
        motionLookAhead,
      )
    : undefined;

  // Iterate over all circumferential sectors (0 to rootSectors - 1) and axial tiles around camera
  for (
    let zIdx = centerZIndex - axialStreamingRadius;
    zIdx <= centerZIndex + axialStreamingRadius;
    zIdx++
  ) {
    for (let sector = 0; sector < rootSectors; sector++) {
      selectCdlodCylinderNode(
        sampler,
        { level: 0, sector, zIndex: zIdx },
        cameraPositionM,
        cameraForwardDir,
        options,
        previouslySplitAddresses,
        resolvedMotion,
        rootSectors,
        rootPatchLengthM,
        rawPatches,
        splitAddresses,
      );
    }
  }

  // Filter out culled patches
  const visiblePatches = rawPatches.filter((p) => !p.isOutsideFrustum);
  const patchesWithEdgeMorph = computeCylinderEdgeMorphs(
    visiblePatches,
    rootSectors,
    options.baseResolution,
  );

  // Identify needed patches for background worker streaming
  let neededPatches: ICdlodCylinderPatch[] | undefined;
  if (cachedGeometries) {
    neededPatches = patchesWithEdgeMorph.filter(
      (p) => !cachedGeometries.has(p.id),
    );
  }

  return {
    patches: patchesWithEdgeMorph,
    splitAddresses,
    neededPatches,
  };
}
