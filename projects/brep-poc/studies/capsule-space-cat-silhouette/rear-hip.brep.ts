import {
  defineParams, edgeFinder, fillet, fuse, getBounds, getSolids, isValidSolid,
  translate, unwrap, withScope, type Shape3D, type Vec3,
} from 'brepjs';
import buildLeg, { params as legParams, expected as legBounds } from '../../src/app/part/capsule-space-cat-leg.brep.ts';
import buildTube, { expected as tubeBounds } from '../../src/app/part/capsule-space-cat-tube.brep.ts';

export const params = defineParams({
  hipFillet: { type: 'number', default: 55, min: 20, max: 65, step: 5, unit: 'mm', label: 'Rear hip fillet' },
});

// Default 900 mm tube and camera-facing hind paw, in torso-local CAD coordinates.
// The upper end of the leg reaches 55 mm below the tube axis, inside the solid.
const ankle: Vec3 = [178, 324, -395];
const leg = { ...legParams.values, legLength: 340 };
export const restPose = {
  ankle: [ankle[0] / 1000, ankle[2] / 1000, -ankle[1] / 1000] as const,
  hipHeight: 0.265,
};

export const expected = () => {
  const { bounds } = tubeBounds();
  return { bounds: { ...bounds, zMin: ankle[2] + legBounds(leg).bounds.zMin }, tolerancePct: 1 };
};

/** One continuous head, torso and hind leg, with the original neck and paw bevels. */
export default function buildRearHip(p = params.values): Shape3D {
  return withScope(scope => {
    const body = scope.register(buildTube());
    const pawAndLeg = scope.register(buildLeg(leg));
    const placedLeg = scope.register(translate(pawAndLeg, ankle));
    const joined = scope.register(unwrap(fuse(body, placedLeg)));
    const solids = getSolids(joined).map(solid => scope.register(solid));
    const [solid] = solids;
    if (solids.length !== 1 || !isValidSolid(solid)) throw new Error('The rear hip fuse did not form one valid solid');
    // The hip ring lies entirely between the neck and paw fillets.
    const hipEdges = edgeFinder()
      .not(finder => finder.ofCurveType('LINE'))
      .findAll(solid)
      .map(edge => scope.register(edge))
      .filter(edge => {
        const bounds = getBounds(edge);
        return bounds.xMin > 0 && bounds.yMin > 205 && bounds.yMax < 445
          && bounds.zMin > -300 && bounds.zMax < -100;
      });
    if (!hipEdges.length) throw new Error('The rear hip fuse did not leave a fillet edge');
    return unwrap(fillet(solid, hipEdges, p.hipFillet));
  });
}
