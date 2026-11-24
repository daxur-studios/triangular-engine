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
    const { bodies, block, plate } = buildBodies(shape => scope.register(shape));
    const back = tower.mastCenterX - 2_300;
    const front = tower.mastCenterX + 2_300;
    const halfWidth = 3_270;
    const postDepth = 900;
    const postWidth = 960;
    const sideSpan = front - back - postDepth;
    const faceSpan = 2 * halfWidth - postWidth;
    const stories = Array.from({ length: 19 }, (_, index) => 2_300 + index * 4_125);
    const braceDepth = 360;
    const bottom = 1_000;
    const crown = tower.height - 500;

    block('concrete', [0, 0, 500], [26_000, 26_000, 1_000]);
    block('concrete', [tower.mastCenterX, 0, 1_400], [7_000, 9_000, 800]);
    for (const x of [back, front]) {
      for (const y of [-halfWidth, halfWidth]) {
        block('steelDark', [x, y, (crown + bottom) / 2], [postDepth, postWidth, crown - bottom]);
        block('edge', [x, y, 2_050], [1_350, 1_400, 400]);
      }
    }
    for (const z of stories) {
      for (const y of [-halfWidth, halfWidth]) block('steel', [tower.mastCenterX, y, z], [sideSpan, 470, 520]);
      for (const x of [back, front]) block('steel', [x, 0, z], [490, faceSpan, 520]);
    }
    for (let i = 1; i < stories.length; i++) {
      const tip = stories[i] - 240;
      const point = stories[i - 1] + 410;
      for (const y of [-halfWidth, halfWidth]) {
        plate('steel', downwardBrace(sideSpan, tip, point).map(([run, z]) =>
          [tower.mastCenterX + run, y - braceDepth / 2, z]), [0, braceDepth, 0]);
      }
      for (const x of [back, front]) {
        plate('steel', downwardBrace(faceSpan, tip, point).map(([run, z]) =>
          [x - braceDepth / 2, run, z]), [braceDepth, 0, 0]);
      }
    }
    for (const side of [-1, 1]) {
      block('steelDark', [tower.guideX - 210, side * tower.guideY, 40_000], [420, 520, 77_600]);
      block('edge', [tower.guideX, side * tower.guideY, 40_000], [300, 300, 78_000]);
      for (let i = 0; i < stories.length; i += 2) {
        block('hardware', [tower.guideX - 290, side * tower.guideY, stories[i]], [500, 800, 410]);
      }
    }
    block('steelDark', [tower.mastCenterX, 0, 78_250], [5_300, 7_420, 2_500]);
    block('edge', [tower.mastCenterX, 0, 79_750], [5_750, 7_650, 500]);
    return consume(bodies);
  });
}

/** One plate for both diagonals so the meeting point has a single exterior face. */
function downwardBrace(span: number, tip: number, point: number): [number, number][] {
  const end = span / 2 + 120;
  const halfHeight = 300;
  return [
    [-end, tip + halfHeight], [0, point + halfHeight], [end, tip + halfHeight],
    [end, tip - halfHeight], [0, point - halfHeight], [-end, tip - halfHeight],
  ];
}

export default () => withTowerBodies(bodies => compound(bodies.map(body => body.shape)));
