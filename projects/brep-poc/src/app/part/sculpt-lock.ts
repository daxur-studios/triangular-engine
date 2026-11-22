import {
  ellipse, interpolateCurve, loft, unwrap, vecAdd, vecCross, vecNormalize, vecScale, vecSub, wireLoop,
  type DisposalScope, type Vec3,
} from 'brepjs';

export type LockSection = readonly [center: Vec3, width: number, depth: number];

/** Width and depth are semi-axes. The guide keeps the broad side of each section facing out. */
export function sculptLock(
  scope: DisposalScope, start: Vec3, sections: readonly LockSection[], end: Vec3,
  guide: Vec3, flutes = 0,
) {
  const wires = sections.map(([center, width, depth], index) => {
    const previous = sections[index - 1]?.[0] ?? start;
    const next = sections[index + 1]?.[0] ?? end;
    const axis = vecNormalize(vecSub(next, previous));
    const across = vecNormalize(vecCross(guide, axis));
    const outward = vecCross(axis, across);
    const edge = scope.register(flutes
      ? unwrap(interpolateCurve(Array.from({ length: 40 }, (_, sample) => {
        const angle = sample / 40 * 2 * Math.PI;
        const radius = 1 - flutes * (.5 + .5 * Math.cos(5 * angle - index * .23)) ** 2;
        return vecAdd(center, vecAdd(
          vecScale(across, width * Math.cos(angle) * radius),
          vecScale(outward, depth * Math.sin(angle) * radius),
        ));
      }), { periodic: true }))
      : unwrap(ellipse(width, depth, { at: center, axis, xDir: across })));
    return scope.register(unwrap(wireLoop([edge])));
  });
  return scope.register(unwrap(loft(wires, { ruled: false, startPoint: start, endPoint: end })));
}
