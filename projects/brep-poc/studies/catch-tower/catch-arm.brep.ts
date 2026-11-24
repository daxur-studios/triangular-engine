import { compound, defineParams, mirror, withScope } from 'brepjs';
import { buildBodies, type Body } from './bodies.ts';
import { tower } from './dimensions.ts';

export const params = defineParams({
  length: { type: 'number', default: 15_100, min: 15_100, max: 17_800, step: 50, unit: 'mm', label: 'Boom length' },
  thickness: { type: 'number', default: 1_400, min: 1_100, max: 1_950, step: 50, unit: 'mm', label: 'Boom depth' },
  padLength: { type: 'number', default: tower.padLength, min: 9_000, max: tower.padLength, step: 50, unit: 'mm', label: 'Rail pad length' },
  padWidth: { type: 'number', default: tower.padWidth, min: 800, max: 1_200, step: 25, unit: 'mm', label: 'Rail pad width' },
});

export const armProfiles = {
  stock: params.values,
  slim: { ...params.values, thickness: 1_100, padLength: 9_000, padWidth: 800 },
  deep: { ...params.values, length: 17_800, thickness: 1_950, padWidth: 1_200 },
};

type Values = typeof params.values;
const boomStart = -250;
const crown = 450;
const padCenterX = tower.padCenterX - tower.armRootX;

export const expected = (p: Values = params.values) => ({
  bounds: {
    xMin: -700, xMax: boomStart + p.length,
    yMin: -tower.padInset - p.padWidth / 2, yMax: 700,
    zMin: crown - p.thickness, zMax: tower.padTop,
  },
  tolerancePct: 0.01,
});

/** Mount origin at the centre of the hinge pin and slider shoe. The rail sits inboard. */
export function withArmBodies<T>(p: Values, side: 1 | -1, consume: (bodies: Body[]) => T) {
  return withScope(scope => {
    const { bodies, block, round, beam, plate } = buildBodies(shape => scope.register(shape));
    const end = boomStart + p.length;
    const bottom = crown - p.thickness;
    const bays = [1_050, 3_450, 6_300, 9_050, 11_800, end - 410];
    const lowerZ = (x: number) => bottom + 125 + Math.max(0, (x - 6_300) / (end - 6_300)) * (p.thickness - 755);

    block('steelDark', [0, 0, (bottom - 120) / 2], [1_400, 1_400, -120 - bottom]);
    round('hardware', [0, 0, -120], 520, 530);
    round('steel', [0, 0, 410], 290, 160);
    block('steel', [775, 0, (bottom + crown) / 2], [550, 1_160, p.thickness]);

    for (const y of [-430, 430]) {
      const edgeY = y - 120;
      plate('steel', [
        [650, edgeY, 210], [end - 230, edgeY, 210], [end, edgeY, 310],
        [end, edgeY, crown], [650, edgeY, crown],
      ], [0, 240, 0]);
      for (let i = 0; i < bays.length - 1; i++) {
        const x = bays[i], nextX = bays[i + 1];
        beam('steelDark', [x, y, lowerZ(x)], [nextX, y, lowerZ(nextX)], 230, 170);
        beam('steel', [x, y, i % 2 ? lowerZ(x) : 300],
          [nextX, y, i % 2 ? 300 : lowerZ(nextX)], 170, 165);
      }
      for (const x of bays) {
        block('edge', [x, y, (lowerZ(x) + 215) / 2], [155, 200, 215 - lowerZ(x)]);
      }
    }
    for (const x of bays) {
      block('steelDark', [x, 0, lowerZ(x)], [240, 1_040, 180]);
      block('steel', [x, 0, 290], [280, 1_080, 270]);
    }
    block('steelDark', [end - 120, 0, 120], [240, 1_120, 560]);

    // The top face is the game contact plane. Width and length grow about the fixed centre.
    block('rail', [padCenterX, -tower.padInset, 600], [p.padLength, p.padWidth, 300]);
    for (const x of bays.filter(x => Math.abs(x - padCenterX) < p.padLength / 2 - 250)) {
      block('hardware', [x, -425, 402], [430, 850, 96]);
    }

    return consume(side === 1 ? bodies : bodies.map(({ surface, shape }) => ({
      surface, shape: scope.register(mirror(shape, { normal: [0, 1, 0] })),
    })));
  });
}

export default (p = params.values) => withArmBodies(p, 1, bodies => compound(bodies.map(body => body.shape)));
