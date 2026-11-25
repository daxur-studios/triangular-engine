import {
  cut, defineParams, edgeFinder, fillet, fuse, getBounds, getSolids, interpolateCurve,
  isValidSolid, loft, unwrap, wireLoop, withScope, type Shape3D, type Vec3,
} from 'brepjs';
import { Vector3 } from 'three';
import { conceptCatEarOutline } from '../../../demo-app/src/app/pages/character-studio/experimental-space-cat-ear.ts';
import { earRestFrame } from './fused-ear-rig.ts';
import buildFusedTail, { expected as tailBounds } from './fused-tail.brep.ts';

export const params = defineParams({
  earFillet: { type: 'number', default: 10, min: 8, max: 12, step: 1, unit: 'mm', label: 'Ear root fillet' },
});

export const expected = tailBounds;

const sides = [-1, 1] as const;
const profile = conceptCatEarOutline().getPoints(5).slice(0, -1);
const profileCenterY = -.012;
const earFrames = new Map(sides.map(side => {
  const { origin, rotation } = earRestFrame(side);
  return [side, { origin, rotation, inverse: rotation.clone().invert() }];
}));

function earPoint(side: -1 | 1, x: number, y: number, depth: number): Vec3 {
  const { origin, rotation } = earFrames.get(side)!;
  const point = new Vector3(x, y, depth).applyQuaternion(rotation).add(origin);
  return [point.x * 1000, -point.z * 1000, point.y * 1000];
}

/** Locate the recessed surfaces using the ear's local triangular profile. */
export function isEarCup(x: number, y: number, z: number): boolean {
  if (Math.abs(x) < 95 || Math.abs(x) > 280 || z < 310 || y > -445) return false;
  const { origin, inverse } = earFrames.get(x > 0 ? 1 : -1)!;
  const local = new Vector3(x / 1000, z / 1000, -y / 1000).sub(origin).applyQuaternion(inverse);
  if (local.z < -.022 || local.z > .034) return false;
  const px = local.x / .735;
  const py = profileCenterY + (local.y - profileCenterY) / .735;
  let inside = false;
  for (const [i, start] of profile.entries()) {
    const end = profile[(i + 1) % profile.length];
    if ((start.y > py) !== (end.y > py) && px < start.x + (end.x - start.x) * (py - start.y) / (end.y - start.y)) {
      inside = !inside;
    }
  }
  return inside;
}

function loftEar(side: -1 | 1, sections: readonly (readonly [number, number])[], back: number): Shape3D {
  return withScope(scope => {
    const wires = sections.map(([depth, scale]) => {
      const points = profile.map(point => earPoint(side, point.x * scale,
        profileCenterY + (point.y - profileCenterY) * scale, depth));
      const ring = scope.register(unwrap(interpolateCurve(points, { periodic: true })));
      return scope.register(unwrap(wireLoop([ring])));
    });
    return unwrap(loft(wires, { ruled: false, startPoint: earPoint(side, 0, profileCenterY, back) }));
  });
}

function fuseEar(body: Shape3D, side: -1 | 1, radius: number): Shape3D {
  return withScope(scope => {
    // Stack the original triangular profile through the depth of the ear.
    // The narrower front rings roll the outside edge into the lip of the cup.
    const ear = scope.register(loftEar(side, [[-.056, .58], [-.041, .88], [-.015, 1], [.016, .95], [.027, .87], [.032, .80]], -.061));
    const cup = scope.register(loftEar(side, [[-.015, .23], [-.008, .42], [.011, .57], [.028, .67], [.048, .70]], -.019));
    // Recess the ear before attaching it so the cup can't cut into the scalp.
    const recessed = scope.register(unwrap(cut(ear, cup)));
    const joined = scope.register(unwrap(fuse(body, recessed)));
    const solids = getSolids(joined).map(solid => scope.register(solid));
    const [solid] = solids;
    if (solids.length !== 1 || !isValidSolid(solid)) throw new Error('The ear fuse did not form one valid solid');
    const root = edgeFinder().findAll(solid).map(edge => scope.register(edge)).filter(edge => {
      const { xMin, xMax, yMin, yMax, zMin, zMax } = getBounds(edge);
      const onSide = side > 0 ? xMin > 90 && xMax < 295 : xMin > -295 && xMax < -90;
      return onSide && yMin > -600 && yMax < -420 && zMin > 310 && zMax < 449;
    });
    if (!root.length) throw new Error('The fused ear left no fillet edge at the skull');
    return unwrap(fillet(solid, root, radius));
  });
}

/** Fuse the triangular ears into the head and round their outer roots. */
export default function buildFusedEars(p = params.values): Shape3D {
  return withScope(scope => {
    const body = scope.register(buildFusedTail());
    const leftEar = scope.register(fuseEar(body, -1, p.earFillet));
    return fuseEar(leftEar, 1, p.earFillet);
  });
}
