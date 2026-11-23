import {
  defineParams, edgeFinder, ellipse, fillet, fuse, getBounds, getSolids, isValidSolid, loft,
  unwrap, wireLoop, withScope, type Bounds3D, type Shape3D, type Vec3,
} from 'brepjs';
import { CubicBezierCurve3, Vector3 } from 'three';
import buildTube, { expected as tubeBounds, params as tubeParams } from '../../src/app/part/capsule-space-cat-tube.brep.ts';
import { conceptBodyLength, joinedCatRest, joinedTail, type Point } from './joined-cat-rest.ts';

export const params = defineParams({
  compact: { type: 'boolean', default: false, label: 'Compact concept proportions' },
  frontFillet: { type: 'number', default: 44, min: 28, max: 50, step: 2, unit: 'mm', label: 'Shoulder fillet' },
  rearFillet: { type: 'number', default: 55, min: 35, max: 60, step: 5, unit: 'mm', label: 'Hip fillet' },
  tailFillet: { type: 'number', default: 34, min: 20, max: 42, step: 2, unit: 'mm', label: 'Tail root fillet' },
});

const CAD = ([x, y, z]: Point): Vec3 => [1000 * x, -1000 * z, 1000 * y];
const TOE_RADIUS = 45;
const UPPER_RADIUS = 57;
const TAIL_RADIUS = 43;
const TAIL_TIP_RADIUS = 34;
const CAP = [.995, .97, .90, .79, .63, .43, .2];

export const expected = (p = params.values) => {
  const { bounds } = tubeBounds();
  return {
    bounds: { ...bounds, yMax: p.compact ? 658 : 601, zMin: p.compact ? -385 : -420, zMax: p.compact ? 470 : 570 },
    tolerancePct: 1,
  };
};

function roundLoft(sections: readonly { at: Vec3; axis: Vec3; radius: number }[], startPoint: Vec3, endPoint: Vec3) {
  return withScope(scope => {
    const wires = sections.map(({ at, axis, radius }) => {
      const loop = scope.register(unwrap(ellipse(radius, radius * .9995, { at, axis, xDir: [1, 0, 0] })));
      return scope.register(unwrap(wireLoop([loop])));
    });
    return unwrap(loft(wires, { startPoint, endPoint, ruled: false }));
  });
}

function buildLeg([x, y, z]: Vec3): Shape3D {
  const axis: Vec3 = [0, 0, 1];
  const rings = CAP.map(t => ({ z: z - TOE_RADIUS * t, radius: TOE_RADIUS * Math.sqrt(1 - t * t) }));
  for (let i = 0; i <= 12; i += 1) {
    const t = i / 12;
    rings.push({ z: z + (-85 - z) * t, radius: TOE_RADIUS + (UPPER_RADIUS - TOE_RADIUS) * t });
  }
  for (const t of [.2, .43, .63, .79, .90, .97, .995]) {
    rings.push({ z: -85 + UPPER_RADIUS * t, radius: UPPER_RADIUS * Math.sqrt(1 - t * t) });
  }
  return roundLoft(
    rings.map(ring => ({ at: [x, y, ring.z], axis, radius: ring.radius })),
    [x, y, z - TOE_RADIUS], [x, y, -85 + UPPER_RADIUS],
  );
}

function buildTail(rest: typeof joinedTail): Shape3D {
  const [base, control1, control2, tip] = rest.map(point => new Vector3(...CAD(point)));
  const centerline = new CubicBezierCurve3(base, control1, control2, tip);
  const tipTangent = centerline.getTangent(1);
  const rings = Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    return {
      at: centerline.getPoint(t).toArray(),
      axis: centerline.getTangent(t).toArray(),
      radius: TAIL_RADIUS * (1 - t) + TAIL_TIP_RADIUS * t,
    };
  });
  for (const t of [...CAP].reverse()) {
    rings.push({
      at: tip.clone().addScaledVector(tipTangent, TAIL_TIP_RADIUS * t).toArray(),
      axis: tipTangent.toArray(),
      radius: TAIL_TIP_RADIUS * Math.sqrt(1 - t * t),
    });
  }
  return roundLoft(rings, base.toArray(), tip.clone().addScaledVector(tipTangent, TAIL_TIP_RADIUS).toArray());
}

function join(body: Shape3D, limb: Shape3D, radius: number, atJoin: (bounds: Bounds3D) => boolean, label: string) {
  return withScope(scope => {
    const union = scope.register(unwrap(fuse(body, limb)));
    const solids = getSolids(union).map(solid => scope.register(solid));
    const [solid] = solids;
    if (solids.length !== 1 || !isValidSolid(solid)) throw new Error(`Invalid ${label} union`);
    const edges = edgeFinder().not(finder => finder.ofCurveType('LINE')).findAll(solid)
      .map(edge => scope.register(edge))
      .filter(edge => atJoin(getBounds(edge)));
    if (!edges.length) throw new Error(`No fillet edge at ${label}`);
    try {
      return unwrap(fillet(solid, edges, radius));
    } catch (cause) {
      throw new Error(`Could not round ${label} (${edges.length} edges)`, { cause });
    }
  });
}

/** One connected default tube, four rounded legs and the curled tail. */
export default function buildJoinedCat(p = params.values): Shape3D {
  return withScope(scope => {
    const rest = joinedCatRest(p.compact);
    let body = scope.register(buildTube(p.compact ? { ...tubeParams.values, bodyLength: conceptBodyLength } : undefined));
    for (const leg of rest.legs) {
      const ankle = CAD(leg.ankle);
      const [x, y] = ankle;
      const limb = scope.register(buildLeg(ankle));
      const front = y < 0;
      body = scope.register(join(body, limb, front ? p.frontFillet : p.rearFillet, edge =>
        (x > 0 ? edge.xMin > 90 : edge.xMax < -90) &&
        edge.yMin > y - 80 && edge.yMax < y + 80 &&
        edge.zMin > -310 && edge.zMax < -70, leg.name));
    }
    const tail = scope.register(buildTail(rest.tail));
    return join(body, tail, p.tailFillet, edge =>
      edge.xMin > -70 && edge.xMax < 70 && edge.yMin > (p.compact ? 235 : 350)
        && edge.zMin > 55 && edge.zMax < 240,
    'tail root');
  });
}
