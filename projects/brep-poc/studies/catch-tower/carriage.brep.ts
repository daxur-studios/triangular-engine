import { compound, defineParams, withScope } from 'brepjs';
import { buildBodies, type Body } from './bodies.ts';
import { tower } from './dimensions.ts';

export const params = defineParams({});
export const expected = () => ({
  bounds: { xMin: -1_900, xMax: 1_900, yMin: -7_500, yMax: 7_500, zMin: -2_750, zMax: 2_750 },
  tolerancePct: 0.01,
});

/** Centre of the lab's moving carriage housing. The guide carries both arm roots. */
export function withCarriageBodies<T>(consume: (bodies: Body[]) => T) {
  return withScope(scope => {
    const { bodies, block, beam, round } = buildBodies(shape => scope.register(shape));
    const armRootX = tower.armRootX - tower.carriageX;
    const guideHalfSpan = 7_500;
    const endStopWidth = 260;
    const guideHalfRun = guideHalfSpan - endStopWidth;
    block('steelDark', [-650, 0, 0], [2_430, 6_750, 4_650]);
    for (const z of [-2_400, 2_400]) block('steel', [-650, 0, z], [2_500, 7_200, 700]);
    for (const side of [-1, 1]) {
      block('edge', [-1_380, side * tower.guideY, 0], [1_040, 1_000, 4_100]);
      block('steel', [150, side * 3_290, 0], [1_300, 580, 4_850]);
      beam('steel', [540, side * 2_810, -1_950], [1_330, side * 5_750, -350], 560);
      block('hardware', [armRootX - 50, side * (guideHalfRun + endStopWidth / 2), 0], [1_100, endStopWidth, 1_120]);
      round('hardware', [armRootX - 100, side * 2_100, -610], 490, 250);
    }
    // End stops supply the last section of the guide, including its exterior faces.
    block('steelDark', [armRootX, 0, -150], [1_000, 2 * guideHalfRun, 700]);
    block('edge', [armRootX + 380, 0, 245], [220, 2 * (guideHalfRun - 15), 120]);
    block('hardware', [640, 0, 1_640], [640, 1_540, 650]);
    return consume(bodies);
  });
}

export default () => withCarriageBodies(bodies => compound(bodies.map(body => body.shape)));
