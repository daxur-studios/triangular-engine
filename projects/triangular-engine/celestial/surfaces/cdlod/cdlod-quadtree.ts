import { ICelestialBody } from '../../bodies/celestial-body';
import { Vec3d } from '../../math/vec3';
import { ISurfaceSampler } from '../surface-sampler';
import {
  CdlodMotionLookAhead,
  IResolvedMotionState,
  resolveMotionLookAhead,
} from './cdlod-motion-prediction';

export type CubeFaceId =
  | 'positive-x'
  | 'negative-x'
  | 'positive-y'
  | 'negative-y'
  | 'positive-z'
  | 'negative-z';

export const CDLOD_CUBE_FACES: readonly CubeFaceId[] = [
  'positive-x',
  'negative-x',
  'positive-y',
  'negative-y',
  'positive-z',
  'negative-z',
];

export interface IPlanetPatchAddress {
  readonly face: CubeFaceId;
  readonly level: number;
  readonly x: number;
  readonly y: number;
}

export type PlanetPatchEdge = 'left' | 'right' | 'bottom' | 'top';

const ALL_EDGES: readonly PlanetPatchEdge[] = [
  'left',
  'right',
  'bottom',
  'top',
];

export function faceUvToDirection(
  face: CubeFaceId,
  u: number,
  v: number,
): Vec3d {
  let x = 0;
  let y = 0;
  let z = 0;
  switch (face) {
    case 'positive-x':
      x = 1;
      y = v;
      z = -u;
      break;
    case 'negative-x':
      x = -1;
      y = v;
      z = u;
      break;
    case 'positive-y':
      x = u;
      y = 1;
      z = -v;
      break;
    case 'negative-y':
      x = u;
      y = -1;
      z = v;
      break;
    case 'positive-z':
      x = u;
      y = v;
      z = 1;
      break;
    case 'negative-z':
      x = -u;
      y = v;
      z = -1;
      break;
  }
  const invLen = 1 / Math.hypot(x, y, z);
  return [x * invLen, y * invLen, z * invLen];
}

export function planetPatchUvBounds(address: IPlanetPatchAddress): {
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
  address: IPlanetPatchAddress,
  edge: PlanetPatchEdge,
): IPlanetPatchAddress {
  const count = 2 ** address.level;
  let { x, y } = address;

  if (edge === 'left') x -= 1;
  else if (edge === 'right') x += 1;
  else if (edge === 'bottom') y -= 1;
  else if (edge === 'top') y += 1;

  if (x >= 0 && x < count && y >= 0 && y < count) {
    return { face: address.face, level: address.level, x, y };
  }

  // Cross-cube-face transitions
  return address;
}

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
  baseResolution: number;
  splitErrorPx: number;
  mergeErrorPx: number;
  screenSpaceFactorPx: number;
  morphRangeRatio: number;
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
    if (altitudeM > 500_000) {
      effectiveMaxLevel = Math.min(effectiveMaxLevel, 2);
    } else if (altitudeM > 100_000) {
      effectiveMaxLevel = Math.min(effectiveMaxLevel, 3);
    } else if (altitudeM > 25_000) {
      effectiveMaxLevel = Math.min(effectiveMaxLevel, 4);
    } else if (altitudeM > 5_000) {
      effectiveMaxLevel = Math.min(effectiveMaxLevel, 5);
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

  let resolution = options.baseResolution;
  if (options.featureAdaptive) {
    if (roughnessM < 2.0 && !hasCoastlineOrLake) {
      resolution = Math.max(8, Math.floor(options.baseResolution / 4));
    } else if (roughnessM < 8.0 && !hasCoastlineOrLake) {
      resolution = Math.max(16, Math.floor(options.baseResolution / 2));
    }
  }

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

function findNodeAt(
  root: ICdlodNode,
  target: IPlanetPatchAddress,
): CoverageResult | null {
  if (
    root.address.level === target.level &&
    root.address.x === target.x &&
    root.address.y === target.y
  ) {
    if (!root.children) return { kind: 'leaf', node: root };
    return { kind: 'finer' };
  }

  if (!root.children) return { kind: 'leaf', node: root };

  const shift = target.level - (root.address.level + 1);
  if (shift < 0) return { kind: 'finer' };

  const tx = target.x >> shift;
  const ty = target.y >> shift;
  const dx = (tx & 1) as 0 | 1;
  const dy = (ty & 1) as 0 | 1;
  const childIdx = dy * 2 + dx;

  const child = root.children[childIdx];
  if (!child) return null;
  return findNodeAt(child, target);
}

function collectLeaves(node: ICdlodNode, out: ICdlodNode[]): void {
  if (node.isOccludedByHorizon) return;
  if (!node.children) {
    out.push(node);
    return;
  }
  for (const c of node.children) {
    collectLeaves(c, out);
  }
}

function collectSplitAddresses(node: ICdlodNode, out: Set<string>): void {
  if (node.children) {
    out.add(patchAddressKey(node.address));
    for (const c of node.children) {
      collectSplitAddresses(c, out);
    }
  }
}

function computeEdgeMorph(
  node: ICdlodNode,
  faceRoots: ReadonlyMap<CubeFaceId, ICdlodNode>,
): ICdlodEdgeMorph {
  const morph: ICdlodEdgeMorph = {
    left: node.morphFactor,
    right: node.morphFactor,
    bottom: node.morphFactor,
    top: node.morphFactor,
  };

  if (node.address.level === 0) return morph;

  for (const edge of ALL_EDGES) {
    const neighborAddr = planetPatchNeighbor(node.address, edge);
    const root = faceRoots.get(neighborAddr.face);
    if (!root) continue;

    const res = findNodeAt(root, neighborAddr);
    if (!res) continue;

    if (res.kind === 'leaf') {
      if (res.node.address.level < node.address.level) {
        morph[edge] = 1.0;
      }
    }
  }

  return morph;
}

export function selectCdlodPatches(input: ICdlodSelectionInput): {
  readonly patches: readonly ICdlodPatch[];
  readonly splitAddresses: ReadonlySet<string>;
  readonly neededPatches?: readonly ICdlodNeededPatch[];
} {
  const faceRoots = new Map<CubeFaceId, ICdlodNode>();
  const neededMap = input.cachedGeometries
    ? new Map<string, ICdlodNeededPatch>()
    : undefined;

  let resolvedMotion: IResolvedMotionState | undefined;
  if (input.motionLookAhead) {
    if ('evalCameraBodyFixedM' in input.motionLookAhead) {
      resolvedMotion = input.motionLookAhead;
    } else {
      resolvedMotion = resolveMotionLookAhead(
        input.cameraBodyFixedM,
        input.cameraForwardDir,
        input.motionLookAhead,
      );
    }
  }

  for (const face of CDLOD_CUBE_FACES) {
    const rootAddr: IPlanetPatchAddress = { face, level: 0, x: 0, y: 0 };
    const rootNode = selectCdlodNode(
      rootAddr,
      input.body,
      input.sampler,
      input.cameraBodyFixedM,
      input.options,
      input.cameraForwardDir,
      input.altitudeM,
      input.previouslySplitAddresses,
      input.cachedGeometries,
      neededMap,
      resolvedMotion,
    );
    faceRoots.set(face, rootNode);
  }

  const allLeaves: ICdlodNode[] = [];
  const splitSet = new Set<string>();

  for (const root of faceRoots.values()) {
    collectLeaves(root, allLeaves);
    collectSplitAddresses(root, splitSet);
  }

  const patches: ICdlodPatch[] = allLeaves.map((node) => {
    const edgeMorph = computeEdgeMorph(node, faceRoots);
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
  });

  return {
    patches,
    splitAddresses: splitSet,
    neededPatches: neededMap ? Array.from(neededMap.values()) : undefined,
  };
}
