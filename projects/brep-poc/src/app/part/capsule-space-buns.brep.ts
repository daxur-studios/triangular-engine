import {
  compound, cut, defineParams, mirror, Sketcher, translate,
  unwrap, vecAdd, vecScale, withScope, type Shape3D, type Vec3,
} from 'brepjs';
import { sculptLock, type LockSection } from './sculpt-lock.ts';

export const params = defineParams({
  bunSize: { type: 'number', default: 100, min: 84, max: 118, step: 1, unit: '%', label: 'Bun size' },
  rightLift: { type: 'number', default: 8, min: -14, max: 24, step: 1, unit: 'mm', label: 'Right bun placement' },
  leftLift: { type: 'number', default: 8, min: -14, max: 24, step: 1, unit: 'mm', label: 'Left bun placement' },
  lockLength: { type: 'number', default: 205, min: 158, max: 238, step: 1, unit: 'mm', label: 'Side-lock length' },
});

export type SpaceBunValues = typeof params.values;
type Surface = 'hair' | 'tie';

const capHem = 174;
const lockRootHeight = 346;
const front: Vec3 = [0, -1, 0];
const back: Vec3 = [0, 1, 0];

export const expected = (p = params.values) => ({
  bounds: { zMin: Math.min(capHem, lockRootHeight - p.lockLength) },
  tolerancePct: .25,
});

/** Use CAD millimetres, Z-up, and -Y forward. Bodies can overlap like layered locks. */
export function withSpaceBunParts<T>(
  p: SpaceBunValues, consume: (parts: readonly { shape: Shape3D; surface: Surface }[]) => T,
): T {
  return withScope(scope => {
    const scalp = scope.register(new Sketcher('XZ')
      .movePointerTo([0, 454])
      .cubicBezierCurveTo([137, 349], [77, 454], [125, 403])
      .cubicBezierCurveTo([145, 216], [148, 301], [145, 246])
      .cubicBezierCurveTo([115, capHem], [145, 187], [130, capHem])
      .lineTo([0, capHem]).close().revolve([0, 0, 1]));
    const opening = scope.register(new Sketcher('XZ', [0, -17, 0])
      .movePointerTo([-134, 155]).lineTo([134, 155]).lineTo([134, 302])
      .cubicBezierCurveTo([0, 398], [130, 341], [75, 367])
      .cubicBezierCurveTo([-134, 302], [-75, 367], [-130, 341])
      .close().extrude(183, { extrusionDirection: front }));
    const parts: { shape: Shape3D; surface: Surface }[] = [
      { shape: scope.register(unwrap(cut(scalp, opening))), surface: 'hair' },
    ];

    function pair(shape: Shape3D, surface: Surface = 'hair', liftDelta = 0) {
      const mirrored = scope.register(mirror(shape));
      const left = liftDelta
        ? scope.register(translate(mirrored, [.42 * liftDelta, 0, liftDelta]))
        : mirrored;
      parts.push({ shape, surface }, { shape: left, surface });
    }

    pair(sculptLock(scope, [1, -63, 444], [
      [[20, -89, 431], 24, 11],
      [[57, -117, 406], 30, 18],
      [[95, -112, 371], 27, 17],
      [[117, -95, 354], 14, 10],
    ], [127, -83, 350], front));

    const lockEnd = lockRootHeight - p.lockLength;
    pair(sculptLock(scope, [109, -30, 397], [
      [[130, -65, 358], 25, 14],
      [[147, -85, 332], 24, 14],
      [[154, -95, lockRootHeight - p.lockLength * .53], 19, 13],
      [[151, -104, lockEnd + 29], 10, 8],
      [[145, -112, lockEnd + 8], 4, 3],
    ], [140, -117, lockEnd], [.72, -.70, 0]));

    // Layer the rear from beneath the tie toward the centre part.
    pair(sculptLock(scope, [117, 17, 401], [
      [[130, 54, 355], 27, 15],
      [[127, 83, 286], 30, 15],
      [[105, 98, 225], 26, 14],
      [[83, 105, 195], 13, 8],
    ], [67, 107, 190], [.88, .48, 0]));
    pair(sculptLock(scope, [102, 32, 416], [
      [[105, 81, 367], 34, 14],
      [[82, 120, 300], 39, 17],
      [[53, 133, 229], 33, 15],
      [[33, 130, 194], 15, 8],
    ], [26, 125, 185], back));
    pair(sculptLock(scope, [5, 21, 451], [
      [[26, 63, 431], 27, 14],
      [[41, 104, 384], 39, 15],
      [[39, 137, 321], 34, 16],
      [[23, 145, 247], 22, 13],
      [[13, 143, 204], 12, 9],
    ], [10, 136, 191], back));

    // Keep size and placement anchored to the same tie. Lift also moves the
    // tie inward along the sloping crown so the root stays on the scalp.
    const anchor: Vec3 = [116 - p.rightLift * .42, 14, 387 + p.rightLift];
    const liftDelta = p.leftLift - p.rightLift;
    const size = p.bunSize / 100;
    const at = (x: number, y: number, z: number) => vecAdd(anchor, vecScale([x, y, z], size));
    const section = (x: number, y: number, z: number, width: number, depth: number): LockSection =>
      [at(x, y, z), width * size, depth * size];
    pair(sculptLock(scope, at(1, 0, 0), [
      section(15, 0, 14, 31, 28),
      section(32, 2, 35, 53, 48),
      section(51, 5, 57, 64, 55),
      section(65, 6, 72, 55, 47),
      section(77, 7, 85, 32, 27),
    ], at(83, 9, 93), front, .22), 'hair', liftDelta);

    pair(sculptLock(scope, at(-7, 0, -6), [
      section(0, 0, 2, 27, 23),
      section(6, 0, 7, 35, 30),
      section(12, 0, 12, 33, 30),
    ], at(21, 0, 20), front), 'tie', liftDelta);
    return consume(parts);
  });
}

export default function buildSpaceBuns(p: SpaceBunValues = params.values) {
  return withSpaceBunParts(p, parts => compound(parts.map(part => part.shape)));
}
