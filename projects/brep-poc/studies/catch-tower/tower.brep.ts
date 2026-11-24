import { compound, defineParams, withScope } from 'brepjs';
import { buildBodies, type Body } from './bodies.ts';
import { tower } from './dimensions.ts';

export const params = defineParams({});
export const expected = () => ({
  bounds: { xMin: -13_000, xMax: 13_000, yMin: -13_000, yMax: 13_000, zMin: 0, zMax: tower.height },
  tolerancePct: 0.01,
});

/** The base origin is on the ground plane, at the centre of the lab foundation. */
export function withTowerBodies<T>(consume: (bodies: Body[]) => T) {
  return withScope(scope => {
    const { bodies, block, beam } = buildBodies(shape => scope.register(shape));
    const back = tower.mastCenterX - 2_300;
    const front = tower.mastCenterX + 2_300;
    const halfWidth = 3_270;
    const bottom = 1_000;
    const crown = tower.height - 500;

    block('concrete', [0, 0, 500], [26_000, 26_000, 1_000]);
    block('concrete', [tower.mastCenterX, 0, 1_400], [7_000, 9_000, 800]);
    for (const x of [back, front]) {
      for (const y of [-halfWidth, halfWidth]) {
        block('steelDark', [x, y, (crown + bottom) / 2], [900, 960, crown - bottom]);
        block('edge', [x, y, 2_050], [1_350, 1_400, 400]);
      }
    }
    const stories = [2_300, 12_900, 23_500, 34_100, 44_700, 55_300, 65_900, 76_500];
    for (const z of stories) {
      for (const y of [-halfWidth, halfWidth]) beam('steel', [back, y, z], [front, y, z], 470, 590);
      for (const x of [back, front]) beam('steel', [x, -halfWidth, z], [x, halfWidth, z], 490, 590);
    }
    for (let i = 0; i < stories.length - 1; i++) {
      const low = stories[i], high = stories[i + 1];
      for (const y of [-halfWidth, halfWidth]) {
        beam('steel', [back, y, low], [front, y, high], 440);
        beam('steelDark', [front, y, low], [back, y, high], 350);
      }
      for (const x of [back, front]) {
        beam('steel', [x, -halfWidth, low], [x, halfWidth, high], 430);
        beam('steelDark', [x, halfWidth, low], [x, -halfWidth, high], 320);
      }
    }
    for (const side of [-1, 1]) {
      block('steelDark', [tower.guideX - 210, side * tower.guideY, 40_000], [420, 520, 77_600]);
      block('edge', [tower.guideX, side * tower.guideY, 40_000], [300, 300, 78_000]);
      for (const z of stories) block('hardware', [tower.guideX - 290, side * tower.guideY, z], [500, 800, 410]);
    }
    block('steelDark', [tower.mastCenterX, 0, 78_250], [5_300, 7_420, 2_500]);
    block('edge', [tower.mastCenterX, 0, 79_750], [5_750, 7_650, 500]);
    return consume(bodies);
  });
}

export default () => withTowerBodies(bodies => compound(bodies.map(body => body.shape)));
