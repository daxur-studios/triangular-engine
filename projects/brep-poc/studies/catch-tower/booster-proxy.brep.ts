import { compound, defineParams, withScope } from 'brepjs';
import { buildBodies, type Body } from './bodies.ts';
import { booster } from './dimensions.ts';

export const params = defineParams({});
export const expected = () => ({
  bounds: { xMin: -550, xMax: 550, yMin: -booster.pinSpan / 2, yMax: booster.pinSpan / 2, zMin: -2_750, zMax: 820 },
  tolerancePct: 0.01,
});

/** Origin on the pin underside. The profile reproduces the stock bracket's flat mating face. */
export function withBoosterBodies<T>(consume: (bodies: Body[]) => T) {
  return withScope(scope => {
    const { bodies, round, plate } = buildBodies(shape => scope.register(shape));
    const radius = booster.diameter / 2;
    round('steel', [0, 0, -booster.tankLength], radius, booster.tankLength + 420);
    round('edge', [0, 0, 410], 395, 270);
    round('steel', [0, 0, 679], 255, 141);
    round('edge', [0, 0, -1_510], 515, 120);
    round('steelDark', [0, 0, -2_550], 390, 1_050);
    round('hardware', [0, 0, -2_750], 550, 220);
    const x = -booster.pinWidth / 2;
    for (const side of [-1, 1]) {
      const root = side * radius;
      const tip = side * booster.pinSpan / 2;
      plate('rail', [[x, root, 0], [x, tip, 0], [x, tip, booster.pinHeight * 0.35],
        [x, root, booster.pinHeight]], [booster.pinWidth, 0, 0]);
    }
    return consume(bodies);
  });
}

export default () => withBoosterBodies(bodies => compound(bodies.map(body => body.shape)));
