import {
  defineParams, edgeFinder, fillet, fuse, getBounds, getSolids, isValidSolid,
  unwrap, withScope, type Shape3D,
} from 'brepjs';
import { buildTail } from './joined-cat.brep.ts';
import { joinedTail } from './joined-cat-rest.ts';
import buildRearHip, { expected as legBounds, params as legParams } from './rear-hip.brep.ts';

export const params = defineParams({
  tailFillet: { type: 'number', default: 32, min: 20, max: 40, step: 2, unit: 'mm', label: 'Tail root fillet' },
});

export const expected = () => ({
  bounds: { ...legBounds().bounds, yMax: 624, zMax: 593 },
  tolerancePct: 1,
});

/** Join the original tail profile to the approved four-leg bake. */
export default function buildFusedTail(p = params.values): Shape3D {
  return withScope(scope => {
    const body = scope.register(buildRearHip({ ...legParams.values, allLegs: true }));
    // The separate neutral tail has a 62.93 mm base and tapers to 90% at the tip.
    const tail = scope.register(buildTail(joinedTail, t => 62.93 * (.9 + .1 * (1 - t) ** .72)));
    const joined = scope.register(unwrap(fuse(body, tail)));
    const solids = getSolids(joined).map(solid => scope.register(solid));
    const [solid] = solids;
    if (solids.length !== 1 || !isValidSolid(solid)) throw new Error('The tail fuse did not form one valid solid');
    const rootEdges = edgeFinder().not(finder => finder.ofCurveType('LINE')).findAll(solid)
      .map(edge => scope.register(edge))
      .filter(edge => {
        const bounds = getBounds(edge);
        return bounds.xMin > -90 && bounds.xMax < 90 && bounds.yMin > 350
          && bounds.zMin > 55 && bounds.zMax < 270;
      });
    if (!rootEdges.length) throw new Error('The fused tail left no fillet edge at the rump');
    return unwrap(fillet(solid, rootEdges, p.tailFillet));
  });
}
