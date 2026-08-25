import {
  ICelestialBody,
  ISurfaceSampler,
  Vec3d,
} from 'triangular-engine/celestial';
import {
  SPHERE_TERRAIN_FACES,
  SphereTerrainDomain,
  sphereFaceUvToDirection,
  sphereTerrainPatchNeighbor,
  type ISphereTerrainPatchAddress,
  type SphereTerrainFace,
  type SphereTerrainPatchEdge,
} from '../domains/sphere-terrain-domain';
import {
  CdlodMotionLookAhead,
  IResolvedMotionState,
  resolveMotionLookAhead,
} from './cdlod-motion-prediction';

export type CubeFaceId = SphereTerrainFace;
export type IPlanetPatchAddress = ISphereTerrainPatchAddress;
export type PlanetPatchEdge = SphereTerrainPatchEdge;

export const CDLOD_CUBE_FACES: readonly SphereTerrainFace[] = SPHERE_TERRAIN_FACES;

const ALL_EDGES: readonly PlanetPatchEdge[] = [
  'left',
  'right',
  'bottom',
  'top',
];

const SHARED_UNIT_SPHERE_DOMAIN = new SphereTerrainDomain(1);

export function planetPatchUvBounds(address: ISphereTerrainPatchAddress): {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
} {
  const tileCount = 2 ** address.level;
  const span = 2 / tileCount;
  return {
    minU: -1 + address.x * span,
    maxU: -1 + (address.x + 1) * span,
    minV: -1 + address.y * span,
    maxV: -1 + (address.y + 1) * span,
  };
}

export function planetPatchNeighbor(
  address: ISphereTerrainPatchAddress,
  edge: SphereTerrainPatchEdge,
): ISphereTerrainPatchAddress {
  return sphereTerrainPatchNeighbor(SHARED_UNIT_SPHERE_DOMAIN, address, edge);
}

export const faceUvToDirection = sphereFaceUvToDirection;

const MAX_BALANCE_PASS_COUNT = 64;

export interface ICdlodEdgeMorph {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface ICdlodPatch {
  address: IPlanetPatchAddress;
  centerBodyFixedM: Vec3d;
  /** Resolution along each axis (e.g. 16, 32, 64) */
  resolution: number;
  /** Base morph factor k in [0, 1] for smooth geomorphing towards parent */
  morphFactor: number;
  /** Per-edge morph factor ensuring boundary alignment with coarser neighbors */
  edgeMorph: ICdlodEdgeMorph;
  /** Measured local relief residual in metres */
  roughnessM: number;
  /** Distance in metres from camera to nearest point on patch */
  distanceM: number;
  minRadiusM: number;
  maxRadiusM: number;
}

export interface ICdlodSelectionOptions {
  maxLevel: number;
  /** Base patch resolution (e.g. 16, 32, 64 quads) */
  baseResolution: number;
  /** Target screen-space error in pixels before splitting */
  splitErrorPx: number;
  mergeErrorPx: number;
  screenSpaceFactorPx: number;
  /** Fraction of the LOD distance range over which morphing occurs [0.1 .. 0.5] */
  morphRangeRatio: number;
  /** Enable feature-adaptive decimation (flat plains stay coarse, mountains subdivide deep) */
  featureAdaptive: boolean;
}

export function patchAddressKey(addr: IPlanetPatchAddress): string {
  return `${addr.face}:${addr.level}:${addr.x}:${addr.y}`;
}

export interface ICdlodNeededPatch {
  id: string;
  address: IPlanetPatchAddress;
  resolution: number;
  centerBodyFixedM: Vec3d;
}

export interface ICdlodSelectionInput {
  body: ICelestialBody;
  sampler: ISurfaceSampler;
  cameraBodyFixedM: Vec3d;
  cameraForwardDir?: Vec3d;
  altitudeM?: number;
  options: ICdlodSelectionOptions;
  previouslySplitAddresses?: ReadonlySet<string>;
  cachedGeometries?: ReadonlySet<string>;
  previousLeaves?: readonly IPlanetPatchAddress[];
  motionLookAhead?: CdlodMotionLookAhead | IResolvedMotionState | null;
}

interface ICdlodNode {
  address: IPlanetPatchAddress;
  center: Vec3d;
  minRadiusM: number;
  maxRadiusM: number;
  roughnessM: number;
  distanceM: number;
  morphFactor: number;
  resolution: number;
  isOccludedByHorizon?: boolean;
  children?: ICdlodNode[];
}

type CoverageResult = { kind: 'leaf'; node: ICdlodNode } | { kind: 'finer' };

function childAddress(
  parent: IPlanetPatchAddress,
  dx: 0 | 1,
  dy: 0 | 1,
): IPlanetPatchAddress {
  return {
    face: parent.face,
    level: parent.level + 1,
    x: parent.x * 2 + dx,
    y: parent.y * 2 + dy,
  };
}

export function computePatchCenterAndRadii(
  body: ICelestialBody,
  sampler: ISurfaceSampler,
  address: IPlanetPatchAddress,
): {
  center: Vec3d;
  minRadiusM: number;
  maxRadiusM: number;
  roughnessM: number;
} {
  const bounds = planetPatchUvBounds(address);
  const midU = (bounds.minU + bounds.maxU) * 0.5;
  const midV = (bounds.minV + bounds.maxV) * 0.5;

  const centerDir = faceUvToDirection(address.face, midU, midV);
  const sample = sampler.sample(centerDir);
  const centerRadiusM = body.radiusM + sample.elevationM;

  const center: Vec3d = [
    centerDir[0] * centerRadiusM,
    centerDir[1] * centerRadiusM,
    centerDir[2] * centerRadiusM,
  ];

  const corners = [
    faceUvToDirection(address.face, bounds.minU, bounds.minV),
    faceUvToDirection(address.face, bounds.maxU, bounds.minV),
    faceUvToDirection(address.face, bounds.minU, bounds.maxV),
    faceUvToDirection(address.face, bounds.maxU, bounds.maxV),
    faceUvToDirection(address.face, midU, bounds.minV),
    faceUvToDirection(address.face, midU, bounds.maxV),
    faceUvToDirection(address.face, bounds.minU, midV),
    faceUvToDirection(address.face, bounds.maxU, midV),
  ];

  let minElevationM = sample.elevationM;
  let maxElevationM = sample.elevationM;

  for (const dir of corners) {
    const s = sampler.sample(dir);
    if (s.elevationM < minElevationM) minElevationM = s.elevationM;
    if (s.elevationM > maxElevationM) maxElevationM = s.elevationM;
  }

  const minRadiusM = body.radiusM + minElevationM;
  const maxRadiusM = body.radiusM + maxElevationM;
  const roughnessM = maxElevationM - minElevationM;

  return { center, minRadiusM, maxRadiusM, roughnessM };
}

function evaluateDistanceAndAngleToPatch(
  center: Vec3d,
  minRadiusM: number,
  maxRadiusM: number,
  address: IPlanetPatchAddress,
  body: ICelestialBody,
  cameraBodyFixedM: Vec3d,
): { centerDir: Vec3d; distanceM: number; nearestAngle: number } {
  const centerDist = Math.hypot(...center);
  const centerDir: Vec3d = [
    center[0] / centerDist,
    center[1] / centerDist,
    center[2] / centerDist,
  ];

  const camDist = Math.hypot(...cameraBodyFixedM);
  const camDir: Vec3d = [
    cameraBodyFixedM[0] / camDist,
    cameraBodyFixedM[1] / camDist,
    cameraBodyFixedM[2] / camDist,
  ];

  const bounds = planetPatchUvBounds(address);

  const dot = Math.max(
    -1,
    Math.min(
      1,
      centerDir[0] * camDir[0] +
        centerDir[1] * camDir[1] +
        centerDir[2] * camDir[2],
    ),
  );
  const centerAngle = Math.acos(dot);

  const corners = [
    faceUvToDirection(address.face, bounds.minU, bounds.minV),
    faceUvToDirection(address.face, bounds.maxU, bounds.minV),
    faceUvToDirection(address.face, bounds.minU, bounds.maxV),
    faceUvToDirection(address.face, bounds.maxU, bounds.maxV),
  ];

  let patchAngularRadius = 0;
  for (const corner of corners) {
    const cDot = Math.max(
      -1,
      Math.min(
        1,
        centerDir[0] * corner[0] +
          centerDir[1] * corner[1] +
          centerDir[2] * corner[2],
      ),
    );
    patchAngularRadius = Math.max(patchAngularRadius, Math.acos(cDot));
  }

  const nearestAngle = Math.max(0, centerAngle - patchAngularRadius);
  const closestRadiusM = Math.max(
    minRadiusM,
    Math.min(maxRadiusM, camDist * Math.cos(nearestAngle)),
  );

  const distanceM = Math.max(
    1,
    Math.sqrt(
      Math.max(
        0,
        camDist ** 2 +
          closestRadiusM ** 2 -
          2 * camDist * closestRadiusM * Math.cos(nearestAngle),
      ),
    ),
  );

  return { centerDir, distanceM, nearestAngle };
}

function selectCdlodNode(
  address: IPlanetPatchAddress,
  body: ICelestialBody,
  sampler: ISurfaceSampler,
  cameraBodyFixedM: Vec3d,
  options: ICdlodSelectionOptions,
  cameraForwardDir?: Vec3d,
  altitudeM?: number,
  previouslySplitAddresses?: ReadonlySet<string>,
  cachedGeometries?: ReadonlySet<string>,
  neededPatches?: Map<string, ICdlodNeededPatch>,
  resolvedMotion?: IResolvedMotionState,
): ICdlodNode {
  const { center, minRadiusM, maxRadiusM, roughnessM } =
    computePatchCenterAndRadii(body, sampler, address);

  // 1. Culling is strictly based on the live camera viewing the scene right now
  const { centerDir, distanceM, nearestAngle } =
    evaluateDistanceAndAngleToPatch(
      center,
      minRadiusM,
      maxRadiusM,
      address,
      body,
      cameraBodyFixedM,
    );

  const camDist = Math.hypot(...cameraBodyFixedM);
  const horizonAngle = Math.acos(
    Math.max(-1, Math.min(1, body.radiusM / camDist)),
  );
  const isBehindHorizon = nearestAngle > horizonAngle + 0.12;

  const camToPatch: Vec3d = [
    center[0] - cameraBodyFixedM[0],
    center[1] - cameraBodyFixedM[1],
    center[2] - cameraBodyFixedM[2],
  ];
  const camToPatchDist = Math.hypot(...camToPatch) || 1;
  const viewDir: Vec3d = [
    camToPatch[0] / camToPatchDist,
    camToPatch[1] / camToPatchDist,
    camToPatch[2] / camToPatchDist,
  ];

  const bounds = planetPatchUvBounds(address);
  const angularSpan =
    Math.SQRT2 * Math.max(bounds.maxU - bounds.minU, bounds.maxV - bounds.minV);
  const patchSpanM = angularSpan * maxRadiusM;
  const patchRadiusM = patchSpanM * 0.5;

  let isOutsideViewFrustum = false;
  if (cameraForwardDir && camToPatchDist > patchRadiusM * 1.2) {
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
    // 1.28 rad ~ 73 deg half-cone (146 deg total conservative view cone)
    isOutsideViewFrustum = nearestPatchAngle > 1.28;
  }

  if (isBehindHorizon || isOutsideViewFrustum) {
    return {
      address,
      center,
      minRadiusM,
      maxRadiusM,
      roughnessM,
      distanceM,
      morphFactor: 0,
      resolution: options.baseResolution,
      isOccludedByHorizon: true,
    };
  }

  // 2. Evaluation distance: Look-ahead allows future position to split forward patches early
  let evalDistanceM = distanceM;
  if (resolvedMotion && resolvedMotion.effectiveSpeedMps > 5) {
    const velDir = resolvedMotion.velocityDirection;
    const forwardProjection = velDir
      ? velDir[0] * viewDir[0] + velDir[1] * viewDir[1] + velDir[2] * viewDir[2]
      : 1.0;

    if (forwardProjection > 0.1) {
      const futureDist = evaluateDistanceAndAngleToPatch(
        center,
        minRadiusM,
        maxRadiusM,
        address,
        body,
        resolvedMotion.evalCameraBodyFixedM,
      ).distanceM;
      evalDistanceM = Math.min(distanceM, futureDist);
    }
  }

  const cosIncidence = Math.abs(
    centerDir[0] * viewDir[0] +
      centerDir[1] * viewDir[1] +
      centerDir[2] * viewDir[2],
  );
  const silhouetteWeight = 0.5 + 0.7 * (1.0 - cosIncidence);

  let effectiveMaxLevel = options.maxLevel;
  if (resolvedMotion && resolvedMotion.effectiveSpeedMps > 10_000) {
    effectiveMaxLevel = Math.min(effectiveMaxLevel, 3);
  } else if (resolvedMotion && resolvedMotion.effectiveSpeedMps > 2_500) {
    effectiveMaxLevel = Math.min(effectiveMaxLevel, 5);
  } else if (altitudeM !== undefined) {
    if (altitudeM > 1_000_000) {
      effectiveMaxLevel = Math.min(effectiveMaxLevel, 2);
    } else if (altitudeM > 400_000) {
      effectiveMaxLevel = Math.min(effectiveMaxLevel, 3);
    } else if (altitudeM > 150_000) {
      effectiveMaxLevel = Math.min(effectiveMaxLevel, 4);
    } else if (altitudeM > 50_000) {
      effectiveMaxLevel = Math.min(effectiveMaxLevel, 5);
    } else if (altitudeM > 20_000) {
      effectiveMaxLevel = Math.min(effectiveMaxLevel, 6);
    } else if (altitudeM > 8_000) {
      effectiveMaxLevel = Math.min(effectiveMaxLevel, 7);
    } else if (altitudeM > 3_000) {
      effectiveMaxLevel = Math.min(effectiveMaxLevel, 8);
    } else if (altitudeM > 1_000) {
      effectiveMaxLevel = Math.min(effectiveMaxLevel, 9);
    } else if (altitudeM > 400) {
      effectiveMaxLevel = Math.min(effectiveMaxLevel, 10);
    } else if (altitudeM > 150) {
      effectiveMaxLevel = Math.min(effectiveMaxLevel, 11);
    }
  }

  const minElev = minRadiusM - body.radiusM;
  const maxElev = maxRadiusM - body.radiusM;
  const hasCoastlineOrLake = minElev <= 0.0 && maxElev >= 0.0;
  const hasHighRelief = roughnessM > 25.0;

  let featureWeight = 1.0;
  if (options.featureAdaptive) {
    if (hasCoastlineOrLake || hasHighRelief) {
      featureWeight = 1.0;
    } else {
      featureWeight = Math.max(0.35, roughnessM / 25.0);
    }
  }

  const lodDistanceRatio = Math.max(
    1.15,
    Math.min(
      1.65,
      (options.screenSpaceFactorPx /
        (options.splitErrorPx * options.baseResolution)) *
        0.42,
    ),
  );

  const splitDistM =
    patchSpanM * lodDistanceRatio * featureWeight * silhouetteWeight;

  const morphRangeM = splitDistM * options.morphRangeRatio;
  const morphStartM = splitDistM - morphRangeM;

  const isPreviouslySplit =
    previouslySplitAddresses?.has(patchAddressKey(address)) ?? false;
  const thresholdDistM = isPreviouslySplit ? splitDistM * 1.15 : splitDistM;

  const shouldSplit =
    address.level < effectiveMaxLevel && evalDistanceM < thresholdDistM;

  let morphFactor = 0.0;
  if (distanceM > morphStartM && morphRangeM > 0.001) {
    morphFactor = Math.min(
      1.0,
      Math.max(0.0, (distanceM - morphStartM) / morphRangeM),
    );
  }

  const resolution = options.baseResolution;

  if (!shouldSplit) {
    return {
      address,
      center,
      minRadiusM,
      maxRadiusM,
      roughnessM,
      distanceM,
      morphFactor,
      resolution,
    };
  }

  if (cachedGeometries) {
    const c00 = childAddress(address, 0, 0);
    const c10 = childAddress(address, 1, 0);
    const c01 = childAddress(address, 0, 1);
    const c11 = childAddress(address, 1, 1);

    const id00 = `${c00.face}:${c00.level}:${c00.x}:${c00.y}:${resolution}`;
    const id10 = `${c10.face}:${c10.level}:${c10.x}:${c10.y}:${resolution}`;
    const id01 = `${c01.face}:${c01.level}:${c01.x}:${c01.y}:${resolution}`;
    const id11 = `${c11.face}:${c11.level}:${c11.x}:${c11.y}:${resolution}`;

    let allChildrenReady = true;
    const checkChild = (cAddr: IPlanetPatchAddress, cId: string) => {
      if (!cachedGeometries.has(cId)) {
        allChildrenReady = false;
        if (neededPatches && !neededPatches.has(cId)) {
          const cCenter = computePatchCenterAndRadii(
            body,
            sampler,
            cAddr,
          ).center;
          neededPatches.set(cId, {
            id: cId,
            address: cAddr,
            resolution,
            centerBodyFixedM: cCenter,
          });
        }
      }
    };

    checkChild(c00, id00);
    checkChild(c10, id10);
    checkChild(c01, id01);
    checkChild(c11, id11);

    if (!allChildrenReady) {
      return {
        address,
        center,
        minRadiusM,
        maxRadiusM,
        roughnessM,
        distanceM,
        morphFactor,
        resolution,
      };
    }
  }

  const children: ICdlodNode[] = [
    selectCdlodNode(
      childAddress(address, 0, 0),
      body,
      sampler,
      cameraBodyFixedM,
      options,
      cameraForwardDir,
      altitudeM,
      previouslySplitAddresses,
      cachedGeometries,
      neededPatches,
      resolvedMotion,
    ),
    selectCdlodNode(
      childAddress(address, 1, 0),
      body,
      sampler,
      cameraBodyFixedM,
      options,
      cameraForwardDir,
      altitudeM,
      previouslySplitAddresses,
      cachedGeometries,
      neededPatches,
      resolvedMotion,
    ),
    selectCdlodNode(
      childAddress(address, 0, 1),
      body,
      sampler,
      cameraBodyFixedM,
      options,
      cameraForwardDir,
      altitudeM,
      previouslySplitAddresses,
      cachedGeometries,
      neededPatches,
      resolvedMotion,
    ),
    selectCdlodNode(
      childAddress(address, 1, 1),
      body,
      sampler,
      cameraBodyFixedM,
      options,
      cameraForwardDir,
      altitudeM,
      previouslySplitAddresses,
      cachedGeometries,
      neededPatches,
      resolvedMotion,
    ),
  ];

  return {
    address,
    center,
    minRadiusM,
    maxRadiusM,
    roughnessM,
    distanceM,
    morphFactor,
    resolution,
    children,
  };
}

function queryCoverage(
  root: ICdlodNode,
  level: number,
  x: number,
  y: number,
): CoverageResult {
  let node = root;
  for (;;) {
    if (!node.children || node.children.length === 0) {
      return { kind: 'leaf', node };
    }
    if (node.address.level === level) {
      return { kind: 'finer' };
    }
    const shift = level - 1 - node.address.level;
    const targetChildX = (x >> shift) & 1;
    const targetChildY = (y >> shift) & 1;
    const childIdx = (targetChildY << 1) | targetChildX;
    node = node.children[childIdx];
  }
}

function collectLeaves(node: ICdlodNode, out: ICdlodNode[]): void {
  if (!node.children || node.children.length === 0) {
    out.push(node);
    return;
  }
  for (const child of node.children) {
    collectLeaves(child, out);
  }
}

function balanceNeighborLevels(
  roots: Map<CubeFaceId, ICdlodNode>,
  body: ICelestialBody,
  sampler: ISurfaceSampler,
  cameraBodyFixedM: Vec3d,
  options: ICdlodSelectionOptions,
  cameraForwardDir?: Vec3d,
  altitudeM?: number,
  previouslySplitAddresses?: ReadonlySet<string>,
  cachedGeometries?: ReadonlySet<string>,
  neededPatches?: Map<string, ICdlodNeededPatch>,
  resolvedMotion?: IResolvedMotionState,
): void {
  for (let pass = 0; pass < MAX_BALANCE_PASS_COUNT; pass++) {
    const leaves: ICdlodNode[] = [];
    for (const root of roots.values()) {
      collectLeaves(root, leaves);
    }
    let didForceSplit = false;

    for (const leaf of leaves) {
      if (leaf.isOccludedByHorizon) continue;
      for (const edge of ALL_EDGES) {
        const neighborAddress = planetPatchNeighbor(leaf.address, edge);
        const neighborRoot = roots.get(neighborAddress.face);
        if (!neighborRoot) continue;

        const coverage = queryCoverage(
          neighborRoot,
          neighborAddress.level,
          neighborAddress.x,
          neighborAddress.y,
        );

        if (coverage.kind === 'leaf') {
          const neighborLeaf = coverage.node;
          if (neighborLeaf.isOccludedByHorizon) continue;
          const levelDiff = leaf.address.level - neighborLeaf.address.level;

          if (levelDiff > 1) {
            const res = options.baseResolution;
            const c00Addr = childAddress(neighborLeaf.address, 0, 0);
            const c10Addr = childAddress(neighborLeaf.address, 1, 0);
            const c01Addr = childAddress(neighborLeaf.address, 0, 1);
            const c11Addr = childAddress(neighborLeaf.address, 1, 1);

            let allChildrenReady = true;
            if (cachedGeometries) {
              const checkChild = (cAddr: IPlanetPatchAddress) => {
                const cId = `${cAddr.face}:${cAddr.level}:${cAddr.x}:${cAddr.y}:${res}`;
                if (!cachedGeometries.has(cId)) {
                  allChildrenReady = false;
                  if (neededPatches && !neededPatches.has(cId)) {
                    const cCenter = computePatchCenterAndRadii(
                      body,
                      sampler,
                      cAddr,
                    ).center;
                    neededPatches.set(cId, {
                      id: cId,
                      address: cAddr,
                      resolution: res,
                      centerBodyFixedM: cCenter,
                    });
                  }
                }
              };
              checkChild(c00Addr);
              checkChild(c10Addr);
              checkChild(c01Addr);
              checkChild(c11Addr);
            }

            if (allChildrenReady) {
              const c00 = selectCdlodNode(
                c00Addr,
                body,
                sampler,
                cameraBodyFixedM,
                options,
                cameraForwardDir,
                altitudeM,
                previouslySplitAddresses,
                cachedGeometries,
                neededPatches,
                resolvedMotion,
              );
              const c10 = selectCdlodNode(
                c10Addr,
                body,
                sampler,
                cameraBodyFixedM,
                options,
                cameraForwardDir,
                altitudeM,
                previouslySplitAddresses,
                cachedGeometries,
                neededPatches,
                resolvedMotion,
              );
              const c01 = selectCdlodNode(
                c01Addr,
                body,
                sampler,
                cameraBodyFixedM,
                options,
                cameraForwardDir,
                altitudeM,
                previouslySplitAddresses,
                cachedGeometries,
                neededPatches,
                resolvedMotion,
              );
              const c11 = selectCdlodNode(
                c11Addr,
                body,
                sampler,
                cameraBodyFixedM,
                options,
                cameraForwardDir,
                altitudeM,
                previouslySplitAddresses,
                cachedGeometries,
                neededPatches,
                resolvedMotion,
              );

              c00.children = undefined;
              c10.children = undefined;
              c01.children = undefined;
              c11.children = undefined;

              neighborLeaf.children = [c00, c10, c01, c11];
              didForceSplit = true;
            }
          }
        }
      }
    }

    if (!didForceSplit) break;
  }
}

function collectSplitAddresses(node: ICdlodNode, out: Set<string>): void {
  if (node.children && node.children.length === 4) {
    out.add(patchAddressKey(node.address));
    for (const child of node.children) {
      collectSplitAddresses(child, out);
    }
  }
}

function computeEdgeMorph(
  leaf: ICdlodNode,
  roots: Map<CubeFaceId, ICdlodNode>,
): ICdlodEdgeMorph {
  const edgeMorph: ICdlodEdgeMorph = {
    left: leaf.morphFactor,
    right: leaf.morphFactor,
    bottom: leaf.morphFactor,
    top: leaf.morphFactor,
  };

  for (const edge of ALL_EDGES) {
    const neighborAddress = planetPatchNeighbor(leaf.address, edge);
    const neighborRoot = roots.get(neighborAddress.face);
    if (!neighborRoot) continue;

    const coverage = queryCoverage(
      neighborRoot,
      neighborAddress.level,
      neighborAddress.x,
      neighborAddress.y,
    );

    if (coverage.kind === 'leaf') {
      const levelDiff = leaf.address.level - coverage.node.address.level;
      if (levelDiff > 0) {
        edgeMorph[edge] = 1.0;
      }
    }
  }

  return edgeMorph;
}

export type CdlodSelectedPatches = ICdlodPatch[] & {
  splitAddresses: Set<string>;
  neededPatches: ICdlodNeededPatch[];
};

export function selectCdlodPatches(
  input: ICdlodSelectionInput,
): CdlodSelectedPatches {
  const {
    body,
    sampler,
    cameraBodyFixedM,
    cameraForwardDir,
    altitudeM,
    options,
    previouslySplitAddresses,
    cachedGeometries,
    motionLookAhead,
  } = input;

  const resolvedMotion: IResolvedMotionState =
    motionLookAhead && 'evalCameraBodyFixedM' in motionLookAhead
      ? motionLookAhead
      : resolveMotionLookAhead(
          cameraBodyFixedM,
          cameraForwardDir,
          motionLookAhead,
        );

  const roots = new Map<CubeFaceId, ICdlodNode>();
  const neededPatches = new Map<string, ICdlodNeededPatch>();

  for (const face of CDLOD_CUBE_FACES) {
    const rootAddress: IPlanetPatchAddress = { face, level: 0, x: 0, y: 0 };
    const rootNode = selectCdlodNode(
      rootAddress,
      body,
      sampler,
      cameraBodyFixedM,
      options,
      cameraForwardDir,
      altitudeM,
      previouslySplitAddresses,
      cachedGeometries,
      neededPatches,
      resolvedMotion,
    );
    roots.set(face, rootNode);
  }

  balanceNeighborLevels(
    roots,
    body,
    sampler,
    cameraBodyFixedM,
    options,
    cameraForwardDir,
    altitudeM,
    previouslySplitAddresses,
    cachedGeometries,
    neededPatches,
    resolvedMotion,
  );

  const leaves: ICdlodNode[] = [];
  const splitAddresses = new Set<string>();
  for (const root of roots.values()) {
    collectLeaves(root, leaves);
    collectSplitAddresses(root, splitAddresses);
  }

  const visibleLeaves = leaves.filter((node) => !node.isOccludedByHorizon);

  const patches = visibleLeaves.map((node) => {
    const edgeMorph = computeEdgeMorph(node, roots);
    return {
      address: node.address,
      centerBodyFixedM: node.center,
      resolution: node.resolution,
      morphFactor: node.morphFactor,
      edgeMorph,
      roughnessM: node.roughnessM,
      distanceM: node.distanceM,
      minRadiusM: node.minRadiusM,
      maxRadiusM: node.maxRadiusM,
    };
  }) as CdlodSelectedPatches;

  patches.splitAddresses = splitAddresses;

  const evalPos = resolvedMotion.evalCameraBodyFixedM;
  const velDir = resolvedMotion.velocityDirection;
  const neededList = Array.from(neededPatches.values());

  if (velDir) {
    neededList.sort((a, b) => {
      const ax = a.centerBodyFixedM[0] - evalPos[0];
      const ay = a.centerBodyFixedM[1] - evalPos[1];
      const az = a.centerBodyFixedM[2] - evalPos[2];
      const aDist = Math.hypot(ax, ay, az) || 1;
      const aForwardScore =
        (ax * velDir[0] + ay * velDir[1] + az * velDir[2]) / aDist;

      const bx = b.centerBodyFixedM[0] - evalPos[0];
      const by = b.centerBodyFixedM[1] - evalPos[1];
      const bz = b.centerBodyFixedM[2] - evalPos[2];
      const bDist = Math.hypot(bx, by, bz) || 1;
      const bForwardScore =
        (bx * velDir[0] + by * velDir[1] + bz * velDir[2]) / bDist;

      if (Math.abs(aForwardScore - bForwardScore) > 0.15) {
        return bForwardScore - aForwardScore;
      }
      return aDist - bDist;
    });
  } else {
    neededList.sort((a, b) => {
      const aDist = Math.hypot(
        a.centerBodyFixedM[0] - evalPos[0],
        a.centerBodyFixedM[1] - evalPos[1],
        a.centerBodyFixedM[2] - evalPos[2],
      );
      const bDist = Math.hypot(
        b.centerBodyFixedM[0] - evalPos[0],
        b.centerBodyFixedM[1] - evalPos[1],
        b.centerBodyFixedM[2] - evalPos[2],
      );
      return aDist - bDist;
    });
  }

  patches.neededPatches = neededList;
  patches.sort((a, b) => a.distanceM - b.distanceM);
  return patches;
}
