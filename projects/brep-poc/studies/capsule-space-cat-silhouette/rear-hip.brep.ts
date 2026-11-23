import {
  defineParams, edgeFinder, fillet, fuse, getBounds, getSolids, isValidSolid,
  translate, unwrap, withScope, type Shape3D, type Vec3,
} from 'brepjs';
import buildLeg, { params as legParams, expected as legBounds } from '../../src/app/part/capsule-space-cat-leg.brep.ts';
import buildTube, { expected as tubeBounds } from '../../src/app/part/capsule-space-cat-tube.brep.ts';
import { originalLegs, type Point } from './joined-cat-rest.ts';

export const params = defineParams({
  hipFillet: { type: 'number', default: 55, min: 20, max: 65, step: 5, unit: 'mm', label: 'Rear hip fillet' },
  allLegs: { type: 'boolean', default: false, label: 'Fuse all four legs' },
});

// Default 900 mm tube and camera-facing hind paw, in torso-local CAD coordinates.
// The upper end of the leg reaches 55 mm below the tube axis, inside the solid.
const leg = { ...legParams.values, legLength: 340 };
const [frontLeft, frontRight, rearLeft, rearRight] = originalLegs;
export const restPose = { ankle: rearRight.ankle, hipHeight: rearRight.hipHeight };

export const expected = () => {
  const { bounds } = tubeBounds();
  return { bounds: { ...bounds, zMin: restPose.ankle[1] * 1000 + legBounds(leg).bounds.zMin }, tolerancePct: 1 };
};

function fuseLeg(body: Shape3D, pawAndLeg: Shape3D, ankle: Point, radius: number): Shape3D {
  return withScope(scope => {
    const [x, y, z]: Vec3 = [ankle[0] * 1000, -ankle[2] * 1000, ankle[1] * 1000];
    const placedLeg = scope.register(translate(pawAndLeg, [x, y, z]));
    const joined = scope.register(unwrap(fuse(body, placedLeg)));
    const solids = getSolids(joined).map(solid => scope.register(solid));
    const [solid] = solids;
    if (solids.length !== 1 || !isValidSolid(solid)) throw new Error('The leg fuse did not form one valid solid');
    // The hip ring lies entirely between the neck and paw fillets.
    const hipEdges = edgeFinder()
      .not(finder => finder.ofCurveType('LINE'))
      .findAll(solid)
      .map(edge => scope.register(edge))
      .filter(edge => {
        const bounds = getBounds(edge);
        const onSide = x > 0 ? bounds.xMin > 0 : bounds.xMax < 0;
        return onSide && bounds.yMin > y - 119 && bounds.yMax < y + 121
          && bounds.zMin > -300 && bounds.zMax < -100;
      });
    if (!hipEdges.length) throw new Error(`The leg fuse left no fillet edge at CAD (${x}, ${y})`);
    return unwrap(fillet(solid, hipEdges, radius));
  });
}

/** First rear-hip bake, optionally with the other three original legs fused into the same torso. */
export default function buildRearHip(p = params.values): Shape3D {
  return withScope(scope => {
    const body = scope.register(buildTube());
    const pawAndLeg = scope.register(buildLeg(leg));
    const firstHip = fuseLeg(body, pawAndLeg, rearRight.ankle, p.hipFillet);
    if (!p.allLegs) return firstHip;

    scope.register(firstHip);
    const rear = scope.register(fuseLeg(firstHip, pawAndLeg, rearLeft.ankle, p.hipFillet));
    const left = scope.register(fuseLeg(rear, pawAndLeg, frontLeft.ankle, 44));
    return fuseLeg(left, pawAndLeg, frontRight.ankle, 44);
  });
}
