import { createProceduralRandom01, hashProceduralKey } from '../core/procedural-hash';
import { deriveProceduralSocketId } from '../core/procedural-socket';
import type { FloraSocketKind, IFloraArchetype, IFloraSocket } from './flora-archetype';
import type { IFloraSkeletonNode } from './flora-skeleton';

const IDENTITY_ORIENTATION: readonly [number, number, number, number] = [0, 0, 0, 1];

/** Margin added over the branch radius so a perch clearance sphere doesn't clip the branch itself. */
const PERCH_CLEARANCE_MARGIN_M = 0.15;
/** A branch steeper than this (from horizontal) isn't landable — a bird can't stand on it. */
const PERCH_MAX_ANGLE_FROM_HORIZONTAL_RAD = Math.PI / 4;
/** Below this fraction of trunk radius, a branch is too thin to perch on. */
const PERCH_MIN_RADIUS_FRACTION_OF_TRUNK_RADIUS = 0.15;
const NEST_CAVITY_CLEARANCE_FRACTION_OF_TRUNK_RADIUS = 0.6;
const FRUIT_SLOT_CLEARANCE_FRACTION_OF_FOLIAGE_SIZE = 0.2;
const FLOWER_HEAD_CLEARANCE_FRACTION_OF_FOLIAGE_SIZE = 0.15;
/** Where along a frond a perch sits, as a fraction of its full length from the base — matches flora-mesh.ts's FROND_WIDTH_MIDPOINT_FRACTION so the socket lands on the blade's widest point. */
const FROND_PERCH_LENGTH_FRACTION = 0.4;
const FROND_PERCH_CLEARANCE_FRACTION_OF_FROND_LENGTH = 0.15;

/**
 * A branch segment is perchable when it's close enough to horizontal and
 * thick enough to stand on — not merely "a node that happens to exist at
 * this depth". Branch depth still gates *which* generation of branches is
 * eligible (decision 14: low depths only), but depth alone says nothing
 * about a segment's orientation or size.
 */
function isPerchableBranch(node: IFloraSkeletonNode, minRadiusM: number): boolean {
  const avgRadiusM = (node.radiusStartM + node.radiusEndM) / 2;
  if (avgRadiusM < minRadiusM) return false;

  const dxM = node.endM[0] - node.startM[0];
  const dyM = node.endM[1] - node.startM[1];
  const dzM = node.endM[2] - node.startM[2];
  const lengthM = Math.hypot(dxM, dyM, dzM);
  if (lengthM === 0) return false;

  const angleFromHorizontalRad = Math.asin(Math.min(1, Math.abs(dyM) / lengthM));
  return angleFromHorizontalRad <= PERCH_MAX_ANGLE_FROM_HORIZONTAL_RAD;
}

function branchMidpointM(
  node: IFloraSkeletonNode,
): readonly [number, number, number] {
  return [
    (node.startM[0] + node.endM[0]) / 2,
    (node.startM[1] + node.endM[1]) / 2,
    (node.startM[2] + node.endM[2]) / 2,
  ];
}

/**
 * Mirrors appendFloraFrondFan's arching station math in flora-mesh.ts
 * so a frond perch socket lands exactly on the rendered arching blade.
 */
function frondPerchPositionM(
  tipNode: IFloraSkeletonNode,
  frondIndex: number,
  frondCount: number,
  frondLengthM: number,
  _baseDroopRad: number,
  tierCount: number = 3,
  _archRad: number = 0.45,
): readonly [number, number, number] {
  const numTiers = Math.max(1, tierCount);
  const tier = numTiers > 1 ? frondIndex % numTiers : 0;
  const tierIndex = Math.floor(frondIndex / numTiers);
  const frondsInTier = Math.ceil(frondCount / numTiers);

  const azimuthRad =
    (tierIndex / frondsInTier) * Math.PI * 2 +
    (tier * (Math.PI / Math.max(1, frondsInTier) + 0.35));

  const u = numTiers > 1 ? tier / (numTiers - 1) : 0.5;
  const L = frondLengthM;

  // Mid-frond perch position between stations 1 and 2
  const r1 = (0.28 + 0.10 * u) * L;
  const r2 = (0.64 + 0.16 * u - 0.08 * u * u) * L;
  const y1 = (0.26 - 0.28 * u) * L;
  const y2 = (0.44 - 0.70 * u) * L;

  const horiz = (r1 + r2) * 0.5;
  const vert = (y1 + y2) * 0.5;

  return [
    tipNode.endM[0] + Math.cos(azimuthRad) * horiz,
    tipNode.endM[1] + vert,
    tipNode.endM[2] + Math.sin(azimuthRad) * horiz,
  ];
}

/**
 * Derives typed attachment sockets from an already-generated skeleton.
 * Independent of the skeleton/mesh generators' own random stream — that
 * stream is fully consumed by the time sockets are derived and isn't
 * exposed — so socket-affecting draws (currently just the nest-cavity
 * chance) are hashed directly from identity instead, matching
 * deriveProceduralSocketId's own approach.
 *
 * Perches are only ever placed at depths the archetype's
 * `perchesPerBranchDepth` explicitly lists; keeping perches at low depths
 * (thick lower branches) is an authoring convention, not something enforced
 * here — see docs/runbook/014_procedural_sublibrary.md decision 14. Within a
 * listed depth, only branch segments that are near-horizontal and thick
 * enough (see isPerchableBranch) are actually eligible — a depth match alone
 * doesn't mean a bird can stand there.
 */
export function deriveFloraSockets(
  skeleton: readonly IFloraSkeletonNode[],
  archetype: IFloraArchetype,
  seed: number,
): IFloraSocket[] {
  const sockets: IFloraSocket[] = [];
  const ordinalByKind = new Map<FloraSocketKind, number>();

  const pushSocket = (
    kind: FloraSocketKind,
    positionM: readonly [number, number, number],
    clearanceRadiusM: number,
  ): void => {
    const ordinal = ordinalByKind.get(kind) ?? 0;
    ordinalByKind.set(kind, ordinal + 1);
    sockets.push({
      id: deriveProceduralSocketId({
        archetypeId: archetype.id,
        seed,
        schemaVersion: archetype.schemaVersion,
        kind,
        ordinal,
      }),
      kind,
      positionM,
      orientation: IDENTITY_ORIENTATION,
      clearanceRadiusM,
    });
  };

  const root = skeleton[0];
  pushSocket('root-base', [0, 0, 0], root.radiusStartM);

  const nodesByDepth = new Map<number, IFloraSkeletonNode[]>();
  for (const node of skeleton) {
    const list = nodesByDepth.get(node.depth);
    if (list) list.push(node);
    else nodesByDepth.set(node.depth, [node]);
  }
  const hasChildren = new Set<number>();
  for (const node of skeleton) {
    if (node.parentId !== -1) hasChildren.add(node.parentId);
  }
  const tipNodes = skeleton.filter((node) => !hasChildren.has(node.id));

  const perchMinRadiusM = root.radiusStartM * PERCH_MIN_RADIUS_FRACTION_OF_TRUNK_RADIUS;
  for (const [depthKey, count] of Object.entries(archetype.sockets.perchesPerBranchDepth)) {
    const nodesAtDepth = nodesByDepth.get(Number(depthKey)) ?? [];
    const candidates = nodesAtDepth.filter((node) => isPerchableBranch(node, perchMinRadiusM));
    const take = Math.min(count, candidates.length);
    if (take > 0) {
      const step = candidates.length / take;
      for (let i = 0; i < take; i++) {
        const index = Math.min(candidates.length - 1, Math.floor(i * step + step * 0.5));
        const node = candidates[index];
        const avgRadiusM = (node.radiusStartM + node.radiusEndM) / 2;
        pushSocket('perch', branchMidpointM(node), avgRadiusM + PERCH_CLEARANCE_MARGIN_M);
      }
    }
  }

  // Radial-fronds archetypes (palms) have no perchable limbs — perchesPerBranchDepth
  // above stays empty for them — so perches are placed on the fronds themselves instead.
  const radialFronds = archetype.foliage.radialFronds;
  if (archetype.foliage.style === 'radial-fronds' && archetype.sockets.frondPerches && radialFronds) {
    const frondLengthM = (radialFronds.frondLengthM[0] + radialFronds.frondLengthM[1]) / 2;
    const clearanceRadiusM = frondLengthM * FROND_PERCH_CLEARANCE_FRACTION_OF_FROND_LENGTH;
    const take = Math.min(archetype.sockets.frondPerches, radialFronds.frondCount);
    for (const tipNode of tipNodes) {
      for (let i = 0; i < take; i++) {
        pushSocket(
          'perch',
          frondPerchPositionM(
            tipNode,
            i,
            radialFronds.frondCount,
            frondLengthM,
            radialFronds.frondDroopRad,
            radialFronds.tierCount ?? (radialFronds.frondCount >= 10 ? 3 : 1),
            radialFronds.archRad ?? 0.45,
          ),
          clearanceRadiusM,
        );
      }
    }
  }

  const nestChanceRoll = createProceduralRandom01(
    hashProceduralKey(`${archetype.id}|${seed}|nest-cavity`),
  )();
  if (nestChanceRoll < archetype.sockets.nestCavityChance01) {
    const midHeightM = (root.startM[1] + root.endM[1]) / 2;
    pushSocket(
      'nest-cavity',
      [root.startM[0], midHeightM, root.startM[2]],
      root.radiusStartM * NEST_CAVITY_CLEARANCE_FRACTION_OF_TRUNK_RADIUS,
    );
  }

  const wantsFoliageSockets =
    archetype.foliage.style !== 'none' &&
    (archetype.sockets.fruitSlotsMax > 0 || archetype.sockets.flowerHeads);
  if (wantsFoliageSockets) {
    const foliageSizeM = (archetype.foliage.sizeM[0] + archetype.foliage.sizeM[1]) / 2;

    if (archetype.sockets.fruitSlotsMax > 0 && tipNodes.length > 0) {
      const take = Math.min(archetype.sockets.fruitSlotsMax, tipNodes.length);
      if (archetype.foliage.style === 'radial-fronds') {
        const tipNode = tipNodes[0];
        const count = archetype.sockets.fruitSlotsMax;
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const r = 0.24;
          pushSocket(
            'fruit-slot',
            [
              tipNode.endM[0] + Math.cos(angle) * r,
              tipNode.endM[1] - 0.22,
              tipNode.endM[2] + Math.sin(angle) * r,
            ],
            foliageSizeM * FRUIT_SLOT_CLEARANCE_FRACTION_OF_FOLIAGE_SIZE,
          );
        }
      } else {
        const step = tipNodes.length / take;
        for (let i = 0; i < take; i++) {
          const index = Math.min(tipNodes.length - 1, Math.floor(i * step + step * 0.5));
          pushSocket(
            'fruit-slot',
            tipNodes[index].endM,
            foliageSizeM * FRUIT_SLOT_CLEARANCE_FRACTION_OF_FOLIAGE_SIZE,
          );
        }
      }
    }
    if (archetype.sockets.flowerHeads) {
      for (const node of tipNodes) {
        pushSocket(
          'flower-head',
          node.endM,
          foliageSizeM * FLOWER_HEAD_CLEARANCE_FRACTION_OF_FOLIAGE_SIZE,
        );
      }
    }
  }

  return sockets;
}
