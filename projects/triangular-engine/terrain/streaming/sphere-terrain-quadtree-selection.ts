import type { TerrainVector3 } from '../core/terrain-math';
import {
  SPHERE_TERRAIN_FACES,
  SphereTerrainDomain,
  sphereFaceUvToDirection,
  sphereTerrainPatchNeighbor,
  type ISphereTerrainPatchAddress,
  type SphereTerrainFace,
  type SphereTerrainPatchEdge,
} from '../domains/sphere-terrain-domain';

const ALL_PATCH_EDGES: readonly SphereTerrainPatchEdge[] = [
  'left',
  'right',
  'bottom',
  'top',
];
const MAX_BALANCE_PASS_COUNT = 64;
const MIN_ERROR_DISTANCE_M = 1;

export interface ISphereTerrainQuadtreeSelectionOptions {
  readonly maxLevel: number;
  readonly patchResolution: number;
  readonly splitErrorPx: number;
  readonly mergeErrorPx: number;
  readonly screenSpaceErrorFactorPx: number;
}

export interface ISphereTerrainQuadtreeSelectionInput {
  readonly radiusM: number;
  readonly minElevationM: number;
  readonly maxElevationM: number;
  readonly cameraWorldM: TerrainVector3;
  readonly options: ISphereTerrainQuadtreeSelectionOptions;
  readonly previousLeaves?: readonly ISphereTerrainPatchAddress[];
}

interface IQuadtreeNode {
  readonly address: ISphereTerrainPatchAddress;
  children?: IQuadtreeNode[];
}

type CoverageResult = { kind: 'leaf'; node: IQuadtreeNode } | { kind: 'finer' };

function createChildren(parent: ISphereTerrainPatchAddress): IQuadtreeNode[] {
  const level = parent.level + 1;
  const x = parent.x * 2;
  const y = parent.y * 2;
  return [
    { address: { face: parent.face, level, x, y } },
    { address: { face: parent.face, level, x: x + 1, y } },
    { address: { face: parent.face, level, x, y: y + 1 } },
    { address: { face: parent.face, level, x: x + 1, y: y + 1 } },
  ];
}

function queryCoverage(
  root: IQuadtreeNode,
  level: number,
  x: number,
  y: number,
): CoverageResult {
  let node = root;
  for (;;) {
    if (!node.children) return { kind: 'leaf', node };
    if (node.address.level === level) return { kind: 'finer' };
    const shift = level - (node.address.level + 1);
    const childX = x >> shift;
    const childY = y >> shift;
    node =
      node.children[
        (childY - node.address.y * 2) * 2 + childX - node.address.x * 2
      ];
  }
}

function buildTreeFromLeaves(
  leaves: readonly ISphereTerrainPatchAddress[],
): Map<SphereTerrainFace, IQuadtreeNode> {
  const roots = new Map<SphereTerrainFace, IQuadtreeNode>();
  for (const face of SPHERE_TERRAIN_FACES) {
    roots.set(face, { address: { face, level: 0, x: 0, y: 0 } });
  }
  for (const leaf of leaves) {
    let node = roots.get(leaf.face) as IQuadtreeNode;
    for (let level = 0; level < leaf.level; level += 1) {
      if (!node.children) node.children = createChildren(node.address);
      const shift = leaf.level - (level + 1);
      const childX = leaf.x >> shift;
      const childY = leaf.y >> shift;
      node =
        node.children[
          (childY - node.address.y * 2) * 2 + childX - node.address.x * 2
        ];
    }
  }
  return roots;
}

/** Conservative patch error bound without sampling the terrain field. */
export function estimateSphereTerrainPatchGeometricErrorM(
  radiusM: number,
  minElevationM: number,
  maxElevationM: number,
  address: ISphereTerrainPatchAddress,
  patchResolution = 1,
): number {
  const domain = new SphereTerrainDomain(radiusM);
  const bounds = domain.getPatchBounds(address);
  const angularSpan =
    Math.SQRT2 * Math.max(bounds.maxU - bounds.minU, bounds.maxV - bounds.minV);
  return (
    (maxElevationM - minElevationM) / 2 ** address.level +
    (radiusM + maxElevationM) * (1 - Math.cos(angularSpan / patchResolution))
  );
}

/** Projects a conservative geometric error to pixels at the current camera. */
export function estimateSphereTerrainPatchScreenSpaceErrorPx(
  input: Omit<
    ISphereTerrainQuadtreeSelectionInput,
    'options' | 'previousLeaves'
  >,
  address: ISphereTerrainPatchAddress,
  screenSpaceErrorFactorPx: number,
  patchResolution = 1,
): number {
  const domain = new SphereTerrainDomain(input.radiusM);
  const bounds = domain.getPatchBounds(address);
  const geometricErrorM = estimateSphereTerrainPatchGeometricErrorM(
    input.radiusM,
    input.minElevationM,
    input.maxElevationM,
    address,
    patchResolution,
  );
  const centerDirection = sphereFaceUvToDirection(
    address.face,
    (bounds.minU + bounds.maxU) / 2,
    (bounds.minV + bounds.maxV) / 2,
  );
  const cameraRadiusM = Math.hypot(...input.cameraWorldM);
  if (cameraRadiusM === 0) {
    return (
      (geometricErrorM * screenSpaceErrorFactorPx) /
      Math.max(MIN_ERROR_DISTANCE_M, input.radiusM + input.minElevationM)
    );
  }
  const cameraDirection: TerrainVector3 = [
    input.cameraWorldM[0] / cameraRadiusM,
    input.cameraWorldM[1] / cameraRadiusM,
    input.cameraWorldM[2] / cameraRadiusM,
  ];
  const dot = (a: TerrainVector3, b: TerrainVector3): number =>
    Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const centerAngle = Math.acos(dot(centerDirection, cameraDirection));
  const corners = [
    sphereFaceUvToDirection(address.face, bounds.minU, bounds.minV),
    sphereFaceUvToDirection(address.face, bounds.maxU, bounds.minV),
    sphereFaceUvToDirection(address.face, bounds.minU, bounds.maxV),
    sphereFaceUvToDirection(address.face, bounds.maxU, bounds.maxV),
  ];
  const nearestAngle = Math.max(
    0,
    centerAngle -
      Math.max(
        ...corners.map((corner) => Math.acos(dot(centerDirection, corner))),
      ),
  );
  const closestRadiusM = Math.max(
    input.radiusM + input.minElevationM,
    Math.min(
      input.radiusM + input.maxElevationM,
      cameraRadiusM * Math.cos(nearestAngle),
    ),
  );
  const distanceM = Math.max(
    MIN_ERROR_DISTANCE_M,
    Math.sqrt(
      Math.max(
        0,
        cameraRadiusM ** 2 +
          closestRadiusM ** 2 -
          2 * cameraRadiusM * closestRadiusM * Math.cos(nearestAngle),
      ),
    ),
  );
  return (geometricErrorM * screenSpaceErrorFactorPx) / distanceM;
}

function isPotentiallyVisible(
  input: Omit<
    ISphereTerrainQuadtreeSelectionInput,
    'options' | 'previousLeaves'
  >,
  address: ISphereTerrainPatchAddress,
): boolean {
  const cameraDistanceM = Math.hypot(...input.cameraWorldM);
  const maxRadiusM = input.radiusM + input.maxElevationM;
  if (cameraDistanceM <= maxRadiusM) return true;
  const domain = new SphereTerrainDomain(input.radiusM);
  const bounds = domain.getPatchBounds(address);
  const cameraDirection: TerrainVector3 = [
    input.cameraWorldM[0] / cameraDistanceM,
    input.cameraWorldM[1] / cameraDistanceM,
    input.cameraWorldM[2] / cameraDistanceM,
  ];
  const center = sphereFaceUvToDirection(
    address.face,
    (bounds.minU + bounds.maxU) / 2,
    (bounds.minV + bounds.maxV) / 2,
  );
  const dot = (a: TerrainVector3, b: TerrainVector3): number =>
    Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const corners = [
    sphereFaceUvToDirection(address.face, bounds.minU, bounds.minV),
    sphereFaceUvToDirection(address.face, bounds.maxU, bounds.minV),
    sphereFaceUvToDirection(address.face, bounds.minU, bounds.maxV),
    sphereFaceUvToDirection(address.face, bounds.maxU, bounds.maxV),
  ];
  const patchAngularRadius = Math.max(
    ...corners.map((corner) => Math.acos(dot(center, corner))),
  );
  return (
    Math.acos(dot(center, cameraDirection)) <=
    Math.acos(maxRadiusM / cameraDistanceM) + patchAngularRadius
  );
}

function selectNode(
  address: ISphereTerrainPatchAddress,
  input: ISphereTerrainQuadtreeSelectionInput,
  previousRoot: IQuadtreeNode,
): IQuadtreeNode {
  if (!isPotentiallyVisible(input, address)) return { address };
  const errorPx = estimateSphereTerrainPatchScreenSpaceErrorPx(
    input,
    address,
    input.options.screenSpaceErrorFactorPx,
    input.options.patchResolution,
  );
  const previousCoverage = queryCoverage(
    previousRoot,
    address.level,
    address.x,
    address.y,
  );
  const threshold =
    previousCoverage.kind === 'finer'
      ? input.options.mergeErrorPx
      : input.options.splitErrorPx;
  if (address.level >= input.options.maxLevel || errorPx <= threshold)
    return { address };
  return {
    address,
    children: createChildren(address).map((child) =>
      selectNode(child.address, input, previousRoot),
    ),
  };
}

function collectLeaves(
  node: IQuadtreeNode,
  leaves: ISphereTerrainPatchAddress[],
): void {
  if (!node.children) {
    leaves.push(node.address);
    return;
  }
  for (const child of node.children) collectLeaves(child, leaves);
}

function balanceNeighborLevels(
  roots: Map<SphereTerrainFace, IQuadtreeNode>,
): void {
  const domain = new SphereTerrainDomain(1);
  for (let pass = 0; pass < MAX_BALANCE_PASS_COUNT; pass += 1) {
    const leaves: ISphereTerrainPatchAddress[] = [];
    for (const root of roots.values()) collectLeaves(root, leaves);
    let changed = false;
    for (const leaf of leaves)
      for (const edge of ALL_PATCH_EDGES) {
        const neighbor = sphereTerrainPatchNeighbor(domain, leaf, edge);
        const coverage = queryCoverage(
          roots.get(neighbor.face) as IQuadtreeNode,
          neighbor.level,
          neighbor.x,
          neighbor.y,
        );
        if (
          coverage.kind === 'leaf' &&
          leaf.level - coverage.node.address.level > 1 &&
          !coverage.node.children
        ) {
          coverage.node.children = createChildren(coverage.node.address);
          changed = true;
        }
      }
    if (!changed) return;
  }
}

/**
 * Selects a deterministic, whole-sphere cubesphere cut with BSP-compatible
 * screen-space refinement, horizon culling, hysteresis, and neighbor balance.
 */
export function selectSphereTerrainQuadtreePatches(
  input: ISphereTerrainQuadtreeSelectionInput,
): ISphereTerrainPatchAddress[] {
  const { options } = input;
  if (
    !Number.isFinite(input.radiusM) ||
    input.radiusM <= 0 ||
    !input.cameraWorldM.every(Number.isFinite) ||
    !Number.isFinite(input.minElevationM) ||
    !Number.isFinite(input.maxElevationM) ||
    input.minElevationM > input.maxElevationM
  )
    throw new RangeError('Sphere terrain quadtree input is invalid.');
  if (
    !Number.isInteger(options.maxLevel) ||
    options.maxLevel < 0 ||
    !Number.isInteger(options.patchResolution) ||
    options.patchResolution < 2 ||
    !(options.mergeErrorPx < options.splitErrorPx) ||
    !(options.screenSpaceErrorFactorPx > 0)
  )
    throw new RangeError('Sphere terrain quadtree options are invalid.');
  const previousRoots = buildTreeFromLeaves(input.previousLeaves ?? []);
  const roots = new Map<SphereTerrainFace, IQuadtreeNode>();
  for (const face of SPHERE_TERRAIN_FACES) {
    const address = { face, level: 0, x: 0, y: 0 } as const;
    roots.set(
      face,
      selectNode(address, input, previousRoots.get(face) as IQuadtreeNode),
    );
  }
  balanceNeighborLevels(roots);
  const leaves: ISphereTerrainPatchAddress[] = [];
  for (const face of SPHERE_TERRAIN_FACES)
    collectLeaves(roots.get(face) as IQuadtreeNode, leaves);
  return leaves.sort(
    (a, b) =>
      a.face.localeCompare(b.face) ||
      a.level - b.level ||
      a.x - b.x ||
      a.y - b.y,
  );
}
