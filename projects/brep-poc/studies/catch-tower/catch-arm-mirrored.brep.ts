import { compound } from 'brepjs';
import { expected as originalExpected, params, withArmBodies } from './catch-arm.brep.ts';

export { params };

export function expected(p = params.values) {
  const { bounds, tolerancePct } = originalExpected(p);
  return { bounds: { ...bounds, yMin: -bounds.yMax, yMax: -bounds.yMin }, tolerancePct };
}

export default (p = params.values) => withArmBodies(p, -1, bodies => compound(bodies.map(body => body.shape)));
