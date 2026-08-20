import { Vec3d } from '../../math/vec3';
import { ISurfaceSampler } from '../surface-sampler';
import {
  CdlodMotionLookAhead,
  IResolvedMotionState,
  resolveMotionLookAhead,
} from './cdlod-motion-prediction';
import { ICdlodEdgeMorph } from './cdlod-quadtree';

export interface IPlanePatchAddress {
  readonly level: number;
  readonly x: number;
  readonly y: number;
}

export type PlanePatchEdge = 'left' | 'right' | 'bottom' | 'top';

const ALL_PLANE_EDGES: readonly PlanePatchEdge[] = [
  'left',
  'right',
  'bottom',
  'top',
];

export function planePatchBounds(
  address: IPlanePatchAddress,
  rootPatchSizeM: number,
): { minX: number; maxX: number; minZ: number; maxZ: number; spanM: number } {
  const spanM = rootPatchSizeM / 2 ** address.level;
  const minX = address.x * spanM;
  const maxX = minX + spanM;
  const minZ = address.y * spanM;
  const maxZ = minZ + spanM;
  return { minX, maxX, minZ, maxZ, spanM };
}

export function planePatchNeighbor(
  address: IPlanePatchAddress,
  edge: PlanePatchEdge,
): IPlanePatchAddress {
  let { x, y } = address;
  if (edge === 'left') x -= 1;
  else if (edge === 'right') x += 1;
  else if (edge === 'bottom') y -= 1;
  else if (edge === 'top') y += 1;
  return { level: address.level, x, y };
}

export function planePatchAddressKey(
  addr: IPlanePatchAddress,
  resolution = 32,
): string {
  return `plane:${addr.level}:${addr.x}:${addr.y}:${resolution}`;
}

export interface ICdlodPlanePatch {
  readonly address: IPlanePatchAddress;
  readonly id: string;
  readonly centerM: Vec3d;
  readonly resolution: number;
  readonly morphFactor: number;
  readonly edgeMorph: ICdlodEdgeMorph;
  readonly roughnessM: number;
  readonly distanceM: number;
  readonly minElevationM: number;
  readonly maxElevationM: number;
}

export interface ICdlodPlaneSelectionOptions {
  rootPatchSizeM: number;
  streamingRadiusTiles: number;
  maxLevel: number;
  baseResolution: number;
  splitErrorPx: number;
  mergeErrorPx: number;
  screenSpaceFactorPx: number;
  morphRangeRatio: number;
  featureAdaptive: boolean;
}

export interface ICdlodPlaneNeededPatch {
  id: string;
  address: IPlanePatchAddress;
  resolution: number;
  centerM: Vec3d;
}

export interface ICdlodPlaneSelectionInput {
  sampler: ISurfaceSampler;
  cameraPositionM: Vec3d;
  cameraForwardDir?: Vec3d;
  options: ICdlodPlaneSelectionOptions;
  previouslySplitAddresses?: ReadonlySet<string>;
  cachedGeometries?: ReadonlySet<string>;
  motionLookAhead?: CdlodMotionLookAhead | IResolvedMotionState | null;
}

interface ICdlodPlaneNode {
  address: IPlanePatchAddress;
  centerM: Vec3d;
  minElevationM: number;
  maxElevationM: number;
  roughnessM: number;
  distanceM: number;
  morphFactor: number;
  resolution: number;
  isOutsideFrustum?: boolean;
  children?: ICdlodPlaneNode[];
}

type PlaneCoverageResult =
  | { kind: 'leaf'; node: ICdlodPlaneNode }
  | { kind: 'finer' };

function childPlaneAddress(
  parent: IPlanePatchAddress,
  dx: 0 | 1,
  dy: 0 | 1,
): IPlanePatchAddress {
  return {
    level: parent.level + 1,
    x: parent.x * 2 + dx,
    y: parent.y * 2 + dy,
  };
}

export function computePlanePatchCenterAndElevations(
  sampler: ISurfaceSampler,
  address: IPlanePatchAddress,
  rootPatchSizeM: number,
): {
  centerM: Vec3d;
  minElevationM: number;
  maxElevationM: number;
  roughnessM: number;
} {
  const { minX, maxX, minZ, maxZ } = planePatchBounds(address, rootPatchSizeM);
  const midX = (minX + maxX) * 0.5;
  const midZ = (minZ + maxZ) * 0.5;

  const centerSample = sampler.sample([midX, 0, midZ]);
  const centerM: Vec3d = [midX, centerSample.elevationM, midZ];

  const corners: [number, number, number][] = [
    [minX, 0, minZ],
    [maxX, 0, minZ],
    [minX, 0, maxZ],
    [maxX, 0, maxZ],
    [midX, 0, minZ],
    [midX, 0, maxZ],
    [minX, 0, midZ],
    [maxX, 0, midZ],
  ];

  let minElev = centerSample.elevationM;
  let maxElev = centerSample.elevationM;

  for (const [cx, cy, cz] of corners) {
    const s = sampler.sample([cx, cy, cz]);
    if (s.elevationM < minElev) minElev = s.elevationM;
    if (s.elevationM > maxElev) maxElev = s.elevationM;
  }

  const roughnessM = maxElev - minElev;
  return { centerM, minElevationM: minElev, maxElevationM: maxElev, roughnessM };
}

function evaluateDistanceToPlanePatch(
  centerM: Vec3d,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  minElev: number,
  maxElev: number,
  cameraPos: Vec3d,
): number {
  const closestX = Math.max(minX, Math.min(maxX, cameraPos[0]));
  const closestY = Math.max(minElev, Math.min(maxElev, cameraPos[1]));
  const closestZ = Math.max(minZ, Math.min(maxZ, cameraPos[2]));

  const dx = cameraPos[0] - closestX;
  const dy = cameraPos[1] - closestY;
  const dz = cameraPos[2] - closestZ;

  return Math.max(0.1, Math.hypot(dx, dy, dz));
}

function selectCdlodPlaneNode(
  address: IPlanePatchAddress,
  sampler: ISurfaceSampler,
  cameraPositionM: Vec3d,
  options: ICdlodPlaneSelectionOptions,
  cameraForwardDir?: Vec3d,
  previouslySplitAddresses?: ReadonlySet<string>,
  cachedGeometries?: ReadonlySet<string>,
  neededPatches?: Map<string, ICdlodPlaneNeededPatch>,
  resolvedMotion?: IResolvedMotionState,
): ICdlodPlaneNode {
  const { minX, maxX, minZ, maxZ, spanM } = planePatchBounds(
    address,
    options.rootPatchSizeM,
  );
  const { centerM, minElevationM, maxElevationM, roughnessM } =
    computePlanePatchCenterAndElevations(
      sampler,
      address,
      options.rootPatchSizeM,
    );

  const distanceM = evaluateDistanceToPlanePatch(
    centerM,
    minX,
    maxX,
    minZ,
    maxZ,
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

  const patchRadiusM = spanM * 0.7071; // sqrt(2)/2 * span

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
    isOutsideFrustum = nearestPatchAngle > 1.45; // ~83 deg half-cone (166 deg total field of view)
  }

  if (isOutsideFrustum) {
    return {
      address,
      centerM,
      minElevationM,
      maxElevationM,
      roughnessM,
      distanceM,
      morphFactor: 0,
      resolution: options.baseResolution,
      isOutsideFrustum: true,
    };
  }

  let evalDistanceM = distanceM;
  if (resolvedMotion && resolvedMotion.effectiveSpeedMps > 5) {
    const velDir = resolvedMotion.velocityDirection;
    const forwardProjection = velDir
      ? velDir[0] * viewDir[0] + velDir[1] * viewDir[1] + velDir[2] * viewDir[2]
      : 1.0;

    if (forwardProjection > 0.1) {
      const futureDist = evaluateDistanceToPlanePatch(
        centerM,
        minX,
        maxX,
        minZ,
        maxZ,
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

  const lodDistanceRatio = Math.max(
    1.15,
    Math.min(
      1.75,
      (options.screenSpaceFactorPx /
        (options.splitErrorPx * options.baseResolution)) *
        0.42,
    ),
  );

  const splitDistM = spanM * lodDistanceRatio * featureWeight;
  const morphRangeM = splitDistM * options.morphRangeRatio;
  const morphStartM = splitDistM - morphRangeM;

  const isPreviouslySplit =
    previouslySplitAddresses?.has(planePatchAddressKey(address)) ?? false;
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

  let resolution = options.baseResolution;
  if (options.featureAdaptive) {
    if (roughnessM < 2.0) {
      resolution = Math.max(8, Math.floor(options.baseResolution / 4));
    } else if (roughnessM < 8.0) {
      resolution = Math.max(16, Math.floor(options.baseResolution / 2));
    }
  }

  if (!shouldSplit) {
    return {
      address,
      centerM,
      minElevationM,
      maxElevationM,
      roughnessM,
      distanceM,
      morphFactor,
      resolution,
    };
  }

  if (cachedGeometries) {
    const c00 = childPlaneAddress(address, 0, 0);
    const c10 = childPlaneAddress(address, 1, 0);
    const c01 = childPlaneAddress(address, 0, 1);
    const c11 = childPlaneAddress(address, 1, 1);

    const id00 = `plane:${c00.level}:${c00.x}:${c00.y}:${resolution}`;
    const id10 = `plane:${c10.level}:${c10.x}:${c10.y}:${resolution}`;
    const id01 = `plane:${c01.level}:${c01.x}:${c01.y}:${resolution}`;
    const id11 = `plane:${c11.level}:${c11.x}:${c11.y}:${resolution}`;

    let allChildrenReady = true;
    const checkChild = (cAddr: IPlanePatchAddress, cId: string) => {
      if (!cachedGeometries.has(cId)) {
        allChildrenReady = false;
        if (neededPatches && !neededPatches.has(cId)) {
          const cCenter = computePlanePatchCenterAndElevations(
            sampler,
            cAddr,
            options.rootPatchSizeM,
          ).centerM;
          neededPatches.set(cId, {
            id: cId,
            address: cAddr,
            resolution,
            centerM: cCenter,
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
        centerM,
        minElevationM,
        maxElevationM,
        roughnessM,
        distanceM,
        morphFactor,
        resolution,
      };
    }
  }

  const children: ICdlodPlaneNode[] = [
    selectCdlodPlaneNode(
      childPlaneAddress(address, 0, 0),
      sampler,
      cameraPositionM,
      options,
      cameraForwardDir,
      previouslySplitAddresses,
      cachedGeometries,
      neededPatches,
      resolvedMotion,
    ),
    selectCdlodPlaneNode(
      childPlaneAddress(address, 1, 0),
      sampler,
      cameraPositionM,
      options,
      cameraForwardDir,
      previouslySplitAddresses,
      cachedGeometries,
      neededPatches,
      resolvedMotion,
    ),
    selectCdlodPlaneNode(
      childPlaneAddress(address, 0, 1),
      sampler,
      cameraPositionM,
      options,
      cameraForwardDir,
      previouslySplitAddresses,
      cachedGeometries,
      neededPatches,
      resolvedMotion,
    ),
    selectCdlodPlaneNode(
      childPlaneAddress(address, 1, 1),
      sampler,
      cameraPositionM,
      options,
      cameraForwardDir,
      previouslySplitAddresses,
      cachedGeometries,
      neededPatches,
      resolvedMotion,
    ),
  ];

  return {
    address,
    centerM,
    minElevationM,
    maxElevationM,
    roughnessM,
    distanceM,
    morphFactor,
    resolution,
    children,
  };
}

function findPlaneNodeAt(
  root: ICdlodPlaneNode,
  target: IPlanePatchAddress,
): PlaneCoverageResult | null {
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
  return findPlaneNodeAt(child, target);
}

function collectPlaneLeaves(
  node: ICdlodPlaneNode,
  out: ICdlodPlaneNode[],
): void {
  if (node.isOutsideFrustum) return;
  if (!node.children) {
    out.push(node);
    return;
  }
  for (const c of node.children) {
    collectPlaneLeaves(c, out);
  }
}

function collectPlaneSplitAddresses(
  node: ICdlodPlaneNode,
  out: Set<string>,
): void {
  if (node.children) {
    out.add(planePatchAddressKey(node.address));
    for (const c of node.children) {
      collectPlaneSplitAddresses(c, out);
    }
  }
}

function computePlaneEdgeMorph(
  node: ICdlodPlaneNode,
  rootNodes: ReadonlyMap<string, ICdlodPlaneNode>,
): ICdlodEdgeMorph {
  const morph: ICdlodEdgeMorph = {
    left: node.morphFactor,
    right: node.morphFactor,
    bottom: node.morphFactor,
    top: node.morphFactor,
  };

  for (const edge of ALL_PLANE_EDGES) {
    const neighborAddr = planePatchNeighbor(node.address, edge);
    // Find the root tile that contains neighborAddr
    const rootX = Math.floor(
      neighborAddr.x / 2 ** neighborAddr.level,
    );
    const rootY = Math.floor(
      neighborAddr.y / 2 ** neighborAddr.level,
    );
    const rootKey = `${rootX}:${rootY}`;
    const root = rootNodes.get(rootKey);
    if (!root) continue;

    const res = findPlaneNodeAt(root, neighborAddr);
    if (!res) continue;

    if (res.kind === 'leaf') {
      if (res.node.address.level < node.address.level) {
        morph[edge] = 1.0;
      }
    }
  }

  return morph;
}

export function selectCdlodPlanePatches(input: ICdlodPlaneSelectionInput): {
  readonly patches: readonly ICdlodPlanePatch[];
  readonly splitAddresses: ReadonlySet<string>;
  readonly neededPatches?: readonly ICdlodPlaneNeededPatch[];
} {
  const rootSize = input.options.rootPatchSizeM;
  const radius = Math.max(1, input.options.streamingRadiusTiles);

  const centerRootX = Math.floor(input.cameraPositionM[0] / rootSize);
  const centerRootY = Math.floor(input.cameraPositionM[2] / rootSize);

  const rootNodes = new Map<string, ICdlodPlaneNode>();
  const neededMap = input.cachedGeometries
    ? new Map<string, ICdlodPlaneNeededPatch>()
    : undefined;

  let resolvedMotion: IResolvedMotionState | undefined;
  if (input.motionLookAhead) {
    if ('evalCameraBodyFixedM' in input.motionLookAhead) {
      resolvedMotion = input.motionLookAhead;
    } else {
      resolvedMotion = resolveMotionLookAhead(
        input.cameraPositionM,
        input.cameraForwardDir,
        input.motionLookAhead,
      );
    }
  }

  for (let ry = centerRootY - radius; ry <= centerRootY + radius; ry++) {
    for (let rx = centerRootX - radius; rx <= centerRootX + radius; rx++) {
      const rootAddr: IPlanePatchAddress = { level: 0, x: rx, y: ry };
      const rootNode = selectCdlodPlaneNode(
        rootAddr,
        input.sampler,
        input.cameraPositionM,
        input.options,
        input.cameraForwardDir,
        input.previouslySplitAddresses,
        input.cachedGeometries,
        neededMap,
        resolvedMotion,
      );
      rootNodes.set(`${rx}:${ry}`, rootNode);
    }
  }

  const allLeaves: ICdlodPlaneNode[] = [];
  const splitSet = new Set<string>();

  for (const root of rootNodes.values()) {
    collectPlaneLeaves(root, allLeaves);
    collectPlaneSplitAddresses(root, splitSet);
  }

  const patches: ICdlodPlanePatch[] = allLeaves.map((node) => {
    const edgeMorph = computePlaneEdgeMorph(node, rootNodes);
    return {
      address: node.address,
      id: planePatchAddressKey(node.address, node.resolution),
      centerM: node.centerM,
      resolution: node.resolution,
      morphFactor: node.morphFactor,
      edgeMorph,
      roughnessM: node.roughnessM,
      distanceM: node.distanceM,
      minElevationM: node.minElevationM,
      maxElevationM: node.maxElevationM,
    };
  });

  return {
    patches,
    splitAddresses: splitSet,
    neededPatches: neededMap ? Array.from(neededMap.values()) : undefined,
  };
}
