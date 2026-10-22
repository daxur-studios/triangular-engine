import { MARCH_STEP_SCALE, bottomAltitudeM, topAltitudeM, unitM } from '../planet-shape-field';
import { createTerrainFieldCpu, type TerrainFieldCpu } from '../planet-shape-field-cpu';
import { shapeOpPreset, type TerrainEditPresetId } from '../planet-shape-edits';
import { generateNoiseBytes } from '../planet-shape-noise';
import { shapeOpsBounds, type ShapeOp, type V3 } from './shape-op';

/**
 * Whether the march can trust the field near the shape ops. The march steps by the field times `MARCH_STEP_SCALE`,
 * capped at the nearest union shape, and the field promises no rock within that step. Where an op makes the field
 * steeper than the march trusts, a step passes through rock: through a thin wall, or deep past the surface, which is
 * what drew bands and slivers on the first road across a canyon (a `set` edge squeezing the canyon's depth into a
 * cliff). This takes steps in random directions from air points in each op's bounds and measures the rock they cross,
 * so a cliff fails here instead of in a screenshot.
 *
 * The field alone is not perfect either: its vertically stretched noise is a little steeper than the march trusts in
 * places, and its steps cross up to about a quarter unit of rock (2026-10-22: 0.23 u at the ridge). Those land in the
 * rock with one crossing, which the march's bisection resolves. The line is set above that and well below the set road
 * (0.95 u).
 */

const RADIUS = 600_000;
const UNIT = unitM(RADIUS);
const SAMPLES_PER_OP = 1500;
/** Points checked along each step for rock. */
const CHECKS_PER_STEP = 32;
/** Most rock (units along the step) any step may cross. */
const MAX_ROCK_U = 0.3;

/** Seeded PRNG (mulberry32), so every run sees the same points. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unit3(v: V3): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** A direction `angle` radians from unit `c`, at `phi` around it. */
function around(c: V3, angle: number, phi: number): [number, number, number] {
  const helper: V3 = Math.abs(c[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit3([c[1] * helper[2] - c[2] * helper[1], c[2] * helper[0] - c[0] * helper[2], c[0] * helper[1] - c[1] * helper[0]]);
  const e2 = [c[1] * e1[2] - c[2] * e1[1], c[2] * e1[0] - c[0] * e1[2], c[0] * e1[1] - c[1] * e1[0]];
  const s = Math.sin(angle);
  const k = Math.cos(angle);
  return unit3([0, 1, 2].map((i) => c[i] * k + (e1[i] * Math.cos(phi) + e2[i] * Math.sin(phi)) * s) as unknown as V3);
}

/** A random unit vector. */
function direction(random: () => number): [number, number, number] {
  const z = random() * 2 - 1;
  const phi = random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

/** Rock (metres along the step) crossed by the march's step from air point `p` along unit `u`. */
function rockInStep(field: TerrainFieldCpu, p: V3, u: V3): number {
  const step = Math.min(field.density(p) * MARCH_STEP_SCALE, field.reach(p));
  let rock = 0;
  for (let j = 1; j <= CHECKS_PER_STEP; j++) {
    const s = (step * j) / CHECKS_PER_STEP;
    if (field.density([p[0] + u[0] * s, p[1] + u[1] * s, p[2] + u[2] * s]) <= 0) rock++;
  }
  return (rock / CHECKS_PER_STEP) * step;
}

interface OpSteps {
  readonly id: string;
  /** Steps taken from air points in the op's bounds. */
  readonly steps: number;
  /** Of those, steps that cross any rock, and the most rock one crosses (metres). */
  readonly crossing: number;
  readonly worstM: number;
  /** The same for the field without ops, from the points that are air there too. */
  readonly crossingBase: number;
  readonly worstBaseM: number;
}

const bytes = generateNoiseBytes();

/** Per op of `ops`, the march steps from air in its bounds that cross rock, with the ops and without. */
function measure(ops: readonly ShapeOp[], seed: number): OpSteps[] {
  const base = createTerrainFieldCpu(RADIUS, bytes, []);
  const field = createTerrainFieldCpu(RADIUS, bytes, []);
  field.setShapeOps(ops);
  const bounds = shapeOpsBounds(ops, RADIUS, { bottomM: bottomAltitudeM(RADIUS), topM: topAltitudeM(RADIUS) });
  const random = rng(seed);
  return ops.map((op, i) => {
    const row = { id: op.id, steps: 0, crossing: 0, worstM: 0, crossingBase: 0, worstBaseM: 0 };
    for (let n = 0; n < SAMPLES_PER_OP; n++) {
      const piece = bounds[i][Math.floor(random() * bounds[i].length)];
      const d = around(piece.direction, piece.angle * Math.sqrt(random()), random() * Math.PI * 2);
      const r = RADIUS + piece.bottomM + random() * (piece.topM - piece.bottomM);
      const p: V3 = [d[0] * r, d[1] * r, d[2] * r];
      const u = direction(random);
      if (field.density(p) <= 0) continue;
      row.steps++;
      const rock = rockInStep(field, p, u);
      if (rock > 0) row.crossing++;
      row.worstM = Math.max(row.worstM, rock);
      if (base.density(p) > 0) {
        const rockBase = rockInStep(base, p, u);
        if (rockBase > 0) row.crossingBase++;
        row.worstBaseM = Math.max(row.worstBaseM, rockBase);
      }
    }
    return row;
  });
}

function report(label: string, rows: readonly OpSteps[]): string {
  const u = (metres: number) => (metres / UNIT).toFixed(2);
  return `march steps, ${label}: ` + rows.map((r) =>
    `${r.id} ${r.crossing}/${r.steps} cross rock, worst ${u(r.worstM)} u (field alone ${r.crossingBase}, ${u(r.worstBaseM)} u)`).join('; ');
}

describe('planet shape ops: march steps', () => {
  for (const preset of ['sites', 'landforms'] as readonly TerrainEditPresetId[]) {
    it(`cross no more rock near the ${preset} preset than the field alone does`, () => {
      const rows = measure(shapeOpPreset(preset, RADIUS), 3);
      console.log(report(preset, rows));
      for (const row of rows) {
        expect(row.steps).withContext(`${row.id}: air points sampled`).toBeGreaterThan(150);
        expect(row.worstM / UNIT).withContext(`${row.id}: most rock one step crosses, units`).toBeLessThan(MAX_ROCK_U);
      }
    });
  }

  it('fail a road set across a canyon (the check has teeth)', () => {
    const ops = shapeOpPreset('landforms', RADIUS).map((op): ShapeOp =>
      op.id === 'road' ? ({ ...op, shape: { ...op.shape, edgeM: 0.6 * UNIT }, blend: { mode: 'set' } } as ShapeOp) : op);
    const rows = measure(ops, 3);
    console.log(report('landforms with the road set', rows));
    const road = rows.find((row) => row.id === 'road')!;
    expect(road.worstM / UNIT).toBeGreaterThan(MAX_ROCK_U);
  });
});
