import { evaluateScatterDensityField, type IScatterDensityFieldDefinition } from '../core/scatter-density-field';
import {
  composeScatterPlanetInstanceId,
  measureScatterPlanetCover,
  scatterPlanetLattice,
  type IScatterPlanetLatticeResult,
  type IScatterPlanetLayerDefinition,
  type ScatterPlanetVector3,
} from './scatter-planet-lattice';

const RADIUS_M = 600_000;
const centre: ScatterPlanetVector3 = [0, 0, 1];
const field: IScatterDensityFieldDefinition = {
  octaves: [
    { cellM: 6000, weight: 0.55 },
    { cellM: 1500, weight: 0.3 },
    { cellM: 120, weight: 0.15 },
  ],
  edge: [0.45, 0.62],
  heightBandM: { rise: [5, 40], fall: [1800, 2600] },
};
const trees: IScatterPlanetLayerDefinition = {
  id: 'trees',
  generatorVersion: 1,
  seed: 1,
  cellSizeM: 12,
  sizeRange: [0.75, 1.25],
  density: ([x, y, z], heightM) => Math.min(evaluateScatterDensityField(field, x, y, z, heightM) * 1.4, 1),
};
const solid = (seed: number): IScatterPlanetLayerDefinition => ({ ...trees, seed, density: () => 1 });
const heightAt = (direction: ScatterPlanetVector3) => 150 + 40 * direction[0];

/** A unit direction `along` and `across` metres from `origin` (small offsets on the tangent plane at +z). */
function around(origin: ScatterPlanetVector3, along: number, across: number): ScatterPlanetVector3 {
  const x = origin[0] + along / RADIUS_M;
  const y = origin[1] + across / RADIUS_M;
  const z = origin[2];
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

interface IPlaced {
  readonly key: string;
  readonly point: ScatterPlanetVector3;
  readonly yaw01: number;
  readonly scale: number;
}

function placed(result: IScatterPlanetLatticeResult): IPlaced[] {
  const out: IPlaced[] = [];
  for (let i = 0; i < result.scale.length; i++) {
    out.push({
      key: `${result.cells[i * 3]},${result.cells[i * 3 + 1]},${result.cells[i * 3 + 2]}`,
      point: [
        result.offsetsM[i * 3] + result.originM[0],
        result.offsetsM[i * 3 + 1] + result.originM[1],
        result.offsetsM[i * 3 + 2] + result.originM[2],
      ],
      yaw01: result.yaw01[i],
      scale: result.scale[i],
    });
  }
  return out;
}

function arcTo(point: ScatterPlanetVector3, direction: ScatterPlanetVector3): number {
  const l = Math.hypot(point[0], point[1], point[2]);
  return RADIUS_M * Math.acos(Math.min((point[0] * direction[0] + point[1] * direction[1] + point[2] * direction[2]) / l, 1));
}

describe('scatterPlanetLattice', () => {
  const common = { radiusM: RADIUS_M, windowRadiusM: 1200, heightAt };

  it('is deterministic and places instances only where the field is dense', () => {
    const a = scatterPlanetLattice(trees, { ...common, centre });
    expect(Array.from(scatterPlanetLattice(trees, { ...common, centre }).offsetsM)).toEqual(Array.from(a.offsetsM));
    expect(a.scale.length).toBeGreaterThan(50);
    for (const p of placed(a)) {
      const h = Math.hypot(...p.point) - RADIUS_M;
      expect(evaluateScatterDensityField(field, p.point[0], p.point[1], p.point[2], h)).toBeGreaterThan(0);
      expect(p.scale).toBeGreaterThanOrEqual(0.75);
      expect(p.scale).toBeLessThanOrEqual(1.25);
    }
  });

  it('places the same instances in the overlap of two window centres', () => {
    const centreB = around(centre, 310, -170);
    const a = placed(scatterPlanetLattice(trees, { ...common, centre }));
    const b = new Map(placed(scatterPlanetLattice(trees, { ...common, centre: centreB })).map((p) => [p.key, p]));
    let checked = 0;
    for (const p of a) {
      if (arcTo(p.point, centre) > 850 || arcTo(p.point, centreB) > 850) continue;
      const q = b.get(p.key);
      expect(q).toBeDefined();
      expect(Math.hypot(p.point[0] - q!.point[0], p.point[1] - q!.point[1], p.point[2] - q!.point[2])).toBeLessThan(0.02);
      expect(q!.yaw01).toBe(p.yaw01);
      expect(q!.scale).toBe(p.scale);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
    // And nothing extra: every instance of B inside the overlap is in A.
    const inA = new Set(a.map((p) => p.key));
    for (const q of b.values()) {
      if (arcTo(q.point, centre) <= 850 && arcTo(q.point, centreB) <= 850) expect(inA.has(q.key)).toBeTrue();
    }
  });

  it('does not depend on the window size', () => {
    const small = placed(scatterPlanetLattice(trees, { ...common, centre, windowRadiusM: 600 }));
    const large = new Map(placed(scatterPlanetLattice(trees, { ...common, centre, windowRadiusM: 2000 })).map((p) => [p.key, p]));
    expect(small.length).toBeGreaterThan(20);
    for (const p of small) {
      const q = large.get(p.key);
      expect(q).toBeDefined();
      expect(q!.yaw01).toBe(p.yaw01);
      expect(q!.scale).toBe(p.scale);
    }
  });

  it('holds one candidate per cell anywhere on the sphere, inside the window', () => {
    const centres: ScatterPlanetVector3[] = [
      [0, 0, 1],
      [1, 0.2, 0.1],
      [-0.3, 0.9, 0.2],
      [0.1, -0.2, -1],
      [0.6, -0.6, 0.5],
      [-0.5, -0.5, -0.7],
    ];
    for (const c of centres) {
      const l = Math.hypot(...c);
      const centreN: ScatterPlanetVector3 = [c[0] / l, c[1] / l, c[2] / l];
      const result = scatterPlanetLattice(solid(4), { ...common, centre: centreN, windowRadiusM: 800 });
      const expected = (Math.PI * 800 ** 2) / 12 ** 2;
      expect(result.accepted).toBeGreaterThan(expected * 0.9);
      expect(result.accepted).toBeLessThan(expected * 1.1);
      const all = placed(result);
      expect(new Set(all.map((p) => p.key)).size).toBe(all.length);
      for (const p of all) expect(arcTo(p.point, centreN)).toBeLessThanOrEqual(801);
    }
  });

  it('keeps the nearest when the buffer is short, so the far edge is lost, not a row', () => {
    const all = scatterPlanetLattice(trees, { ...common, centre });
    const cut = scatterPlanetLattice(trees, { ...common, centre, maxCount: 300 });
    expect(cut.accepted).toBe(all.accepted);
    expect(cut.scale.length).toBe(300);
    const kept = new Set(placed(cut).map((p) => p.key));
    const farthestKept = Math.max(...placed(cut).map((p) => arcTo(p.point, centre)));
    const nearestDropped = Math.min(
      ...placed(all)
        .filter((p) => !kept.has(p.key))
        .map((p) => arcTo(p.point, centre)),
    );
    expect(nearestDropped).toBeGreaterThanOrEqual(farthestKept - 0.01);
  });

  it('skips ground where heightAt is null, and lets seeds draw independently', () => {
    expect(scatterPlanetLattice(trees, { ...common, centre, heightAt: () => null }).accepted).toBe(0);
    const a = placed(scatterPlanetLattice(solid(1), { ...common, centre, windowRadiusM: 200 }));
    const b = placed(scatterPlanetLattice(solid(2), { ...common, centre, windowRadiusM: 200 }));
    const key = (p: IPlaced) => p.point.map((v) => v.toFixed(2)).join();
    const pointsA = new Set(a.map(key));
    expect(b.filter((p) => pointsA.has(key(p))).length).toBe(0);
  });

  it('composes instance ids from the lattice cell', () => {
    const id = composeScatterPlanetInstanceId(trees, 7, 3, -4, 50000);
    expect(id).toBe(composeScatterPlanetInstanceId(trees, 7, 3, -4, 50000));
    expect(id).toContain('3,-4,50000');
    expect(id).not.toBe(composeScatterPlanetInstanceId({ ...trees, generatorVersion: 2 }, 7, 3, -4, 50000));
  });

  it('rejects an invalid layer', () => {
    expect(() => scatterPlanetLattice({ ...trees, cellSizeM: 0 }, { ...common, centre })).toThrowError(RangeError);
    expect(() => scatterPlanetLattice({ ...trees, seed: 1.5 }, { ...common, centre })).toThrowError(RangeError);
  });
});

describe('measureScatterPlanetCover', () => {
  it('measures the union of footprints, which is less than the sum of the discs', () => {
    // A solid stand of 12 m crowns on a 12 m lattice, sizes 0.75 to 1.25.
    const stand = scatterPlanetLattice(solid(1), { centre, radiusM: RADIUS_M, windowRadiusM: 500, heightAt: () => 100 });
    const cover = measureScatterPlanetCover(stand, { footprintRadiusM: 6, sampleRadiusM: 200 });
    expect(Math.abs(cover - 0.65)).toBeLessThan(0.03);
    expect(cover).toBeLessThan((Math.PI * 6 ** 2) / 12 ** 2);
    expect(measureScatterPlanetCover(stand, { footprintRadiusM: 0.01, sampleRadiusM: 200 })).toBeLessThan(0.01);
  });
});
