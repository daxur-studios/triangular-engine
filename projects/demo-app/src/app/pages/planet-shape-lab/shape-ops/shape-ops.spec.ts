import { applyEditCpu, createTerrainFieldCpu } from '../planet-shape-field-cpu';
import { bottomAltitudeM, topAltitudeM, unitM } from '../planet-shape-field';
import { terrainEditPreset } from '../planet-shape-edits';
import { generateNoiseBytes } from '../planet-shape-noise';
import { buildShapeOpIndex } from './op-index';
import { createOpLog, hashShapeOps, parseOpLog, replayOpLog, type OpLogEntry } from './op-log';
import {
  angleBetween, compileShapeOps, shapeOpBounds, shapeOpFromTerrainEdit, shapeOpsBounds, type AltitudeBand, type ShapeBounds,
  type ShapeOp, type V3,
} from './shape-op';

type Rng = () => number;

/** Seeded PRNG (mulberry32), so every run sees the same random ops. */
function rng(seed: number): Rng {
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

function cross(a: V3, b: V3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A direction `angle` radians from unit `c`, at `phi` around it. */
function around(c: V3, angle: number, phi: number): [number, number, number] {
  const e1 = unit3(cross(c, Math.abs(c[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const e2 = cross(c, e1);
  const s = Math.sin(angle);
  const k = Math.cos(angle);
  return unit3([
    c[0] * k + (e1[0] * Math.cos(phi) + e2[0] * Math.sin(phi)) * s,
    c[1] * k + (e1[1] * Math.cos(phi) + e2[1] * Math.sin(phi)) * s,
    c[2] * k + (e1[2] * Math.cos(phi) + e2[2] * Math.sin(phi)) * s,
  ]);
}

function at(direction: V3, radiusM: number, altitudeM: number): [number, number, number] {
  const d = unit3(direction);
  const r = radiusM + altitudeM;
  return [d[0] * r, d[1] * r, d[2] * r];
}

/** Ground altitude along `direction` for a field (bisection on the sign between `low` and `high`). */
function groundAt(value: (p: V3) => number, direction: V3, radiusM: number, low: number, high: number): number {
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (value(at(direction, radiusM, mid)) <= 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function insideBounds(pieces: readonly ShapeBounds[], p: V3, radiusM: number): { cap: boolean; column: boolean } {
  const d = unit3(p);
  const altitude = Math.hypot(p[0], p[1], p[2]) - radiusM;
  let cap = false;
  let column = false;
  for (const piece of pieces) {
    if (angleBetween(d, piece.direction) <= piece.angle) {
      cap = true;
      if (altitude >= piece.bottomM && altitude <= piece.topM) column = true;
    }
  }
  return { cap, column };
}

/** A random op of any kind and blend near `centre`, sized in relief units; `grade` false leaves graded ops out. */
function randomOp(random: Rng, id: string, radiusM: number, centre: V3, unit: number, grade = true): ShapeOp {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const spread = (unit * 6) / radiusM;
  const near = (altitude: number): [number, number, number] => at(around(centre, random() * spread, random() * Math.PI * 2), radiusM, altitude);
  const size = () => unit * (1 + random() * 5);
  const height = () => unit * (random() * 6 - 3);
  const edgeM = unit * (0.3 + random() * 1.5);
  const fidelity = pick(['relaxed', 'silhouette', 'contact', 'topology'] as const);
  const kind = pick(['disc', 'cone', 'crater', 'path', 'sphere', 'tube'] as const);
  if (kind === 'sphere' || kind === 'tube') {
    const blend = { mode: pick(['union', 'subtract'] as const), smoothM: unit * random() };
    const shape = kind === 'sphere'
      ? { kind, centre: near(height()), radiusM: size() * 0.6 }
      : { kind, points: [near(height()), near(height()), near(height())], radiusM: size() * 0.3 };
    return { id, shape, blend, fidelity };
  }
  const blend = pick(([
    { mode: 'add' }, { mode: 'set' }, { mode: 'raise', smoothM: unit * random() }, { mode: 'lower', smoothM: unit * random() },
    { mode: 'scale', factor: random() * 2 - 0.3 }, { mode: 'grade', slope: 0.5 + random() * 1.5 },
  ] as const).filter((b) => grade || b.mode !== 'grade'));
  switch (kind) {
    case 'disc':
      return { id, shape: { kind, centre: near(0), radiusM: size(), edgeM, heightM: height() }, blend, fidelity };
    case 'cone':
      return { id, shape: { kind, centre: near(0), radiusM: size(), heightM: height() * 2, edgeM, sharpness: 0.5 + random() * 2 }, blend, fidelity };
    case 'crater':
      return {
        id, shape: { kind, centre: near(0), radiusM: size(), depthM: unit * random() * 3, rimHeightM: unit * random(), rimWidthM: size() * 0.5, edgeM },
        blend, fidelity,
      };
    case 'path':
      return {
        id, shape: { kind, points: [near(0), near(0), near(0)], heightsM: [height(), height(), height()], widthM: size(), edgeM, profile: pick(['flat', 'round'] as const) },
        blend, fidelity,
      };
  }
}

const RADIUS = 600_000;
const UNIT = unitM(RADIUS);
const BASE_BAND: AltitudeBand = { bottomM: bottomAltitudeM(RADIUS), topM: topAltitudeM(RADIUS) };
const ORIGIN: V3 = unit3([0.3, 0.2, 0.93]);

describe('planet shape ops: shapes', () => {
  const flat = (p: V3) => Math.hypot(p[0], p[1], p[2]) - RADIUS;

  it('replace the Phase 1 edits (flatten, soften, carve): the same ground under them', () => {
    const bytes = generateNoiseBytes();
    const base = createTerrainFieldCpu(RADIUS, bytes, []);
    const edits = terrainEditPreset('sites', RADIUS);
    const ops = compileShapeOps(edits.map((edit, i) => shapeOpFromTerrainEdit(edit, `edit-${i}`)), RADIUS);
    const viaEdits = (p: V3) => edits.reduce((value, e) => applyEditCpu(e, value, p, Math.hypot(...p) - RADIUS), base.density(p));
    const viaOps = (p: V3) => ops.apply(base.density(p), p);
    /** The outermost ground: step down from above the band to the first rock, then bisect. */
    const outermost = (value: (p: V3) => number, d: V3) => {
      const step = UNIT * 0.05;
      for (let a = BASE_BAND.topM + UNIT; a > BASE_BAND.bottomM - UNIT; a -= step) {
        if (value(at(d, RADIUS, a - step)) <= 0) return groundAt(value, d, RADIUS, a - step, a);
      }
      return Number.NaN;
    };
    const random = rng(1);
    let worst = 0;
    let moved = 0;
    for (const edit of edits) {
      const centre = unit3(edit.centre);
      for (let n = 0; n < 40; n++) {
        const reach = (edit.radiusM + edit.edgeM) * 1.3;
        const d = around(centre, (random() * reach) / RADIUS, random() * Math.PI * 2);
        const expected = outermost(viaEdits, d);
        worst = Math.max(worst, Math.abs(outermost(viaOps, d) - expected));
        if (Math.abs(expected - outermost((p) => base.density(p), d)) > UNIT * 0.1) moved++;
      }
    }
    console.log(`edits as ops: worst ground difference ${(worst / UNIT).toExponential(2)} units over the sites preset, ${moved} of 160 grounds moved by the edits`);
    // The ops measure the arc on the body sphere, the edits the distance from the vertical through the centre, which
    // grows with depth; at the ground they agree closely. Deep inside an edge they part (by altitude × angle).
    expect(worst).toBeLessThan(UNIT * 0.05);
    expect(moved).toBeGreaterThan(40);
  });

  it('make the ground the profile describes on a flat body', () => {
    const d = ORIGIN;
    const side = (metres: number) => around(d, metres / RADIUS, 0.7);
    const ground = (op: ShapeOp, direction: V3, base: (p: V3) => number = flat) => {
      const ops = compileShapeOps([op], RADIUS);
      return groundAt((p) => ops.apply(base(p), p), direction, RADIUS, -UNIT * 20, UNIT * 20);
    };
    const r = UNIT * 4;
    const cone: ShapeOp = { id: 'c', shape: { kind: 'cone', centre: at(d, RADIUS, 0), radiusM: r, heightM: UNIT * 3, edgeM: UNIT }, blend: { mode: 'add' } };
    expect(ground(cone, d)).toBeCloseTo(UNIT * 3, 3);
    expect(ground(cone, side(r * 1.01))).toBeCloseTo(0, 3);
    const crater: ShapeOp = {
      id: 'k', shape: { kind: 'crater', centre: at(d, RADIUS, 0), radiusM: r, depthM: UNIT * 2, rimHeightM: UNIT * 0.5, rimWidthM: UNIT, edgeM: UNIT },
      blend: { mode: 'add' },
    };
    expect(ground(crater, d)).toBeCloseTo(-UNIT * 2, 3);
    expect(ground(crater, side(r))).toBeCloseTo(UNIT * 0.5, 3);
    expect(ground(crater, side(r + UNIT * 2.01))).toBeCloseTo(0, 3);

    const a = around(d, (UNIT * 10) / RADIUS, 0);
    const b = around(d, (UNIT * 10) / RADIUS, Math.PI);
    const road: ShapeOp = {
      id: 'r', shape: { kind: 'path', points: [at(a, RADIUS, 0), at(b, RADIUS, 0)], heightsM: [0, UNIT * 2], widthM: UNIT, edgeM: UNIT },
      blend: { mode: 'set' }, fidelity: 'contact',
    };
    expect(ground(road, unit3([a[0] + b[0], a[1] + b[1], a[2] + b[2]]))).toBeCloseTo(UNIT, 2);
    expect(ground(road, around(d, (UNIT * 3) / RADIUS, Math.PI / 2))).toBeCloseTo(0, 3);
    const ridge: ShapeOp = {
      id: 'g', shape: { kind: 'path', points: [at(a, RADIUS, 0), at(b, RADIUS, 0)], heightsM: [UNIT * 2, UNIT * 2], widthM: UNIT, edgeM: UNIT, profile: 'round' },
      blend: { mode: 'add' },
    };
    expect(ground(ridge, d)).toBeCloseTo(UNIT * 2, 3);
    const flank = ground(ridge, around(d, (UNIT * 0.5) / RADIUS, Math.PI / 2));
    expect(flank).toBeGreaterThan(0);
    expect(flank).toBeLessThan(UNIT * 2);

    const hill = (p: V3) => flat(p) - UNIT * 2;
    const disc = (blend: ShapeOp['blend']): ShapeOp =>
      ({ id: 'd', shape: { kind: 'disc', centre: at(d, RADIUS, 0), radiusM: r, edgeM: UNIT, heightM: UNIT }, blend } as ShapeOp);
    expect(ground(disc({ mode: 'raise', smoothM: 1 }), d, hill)).toBeCloseTo(UNIT * 2, 2);
    expect(ground(disc({ mode: 'raise', smoothM: 1 }), d)).toBeCloseTo(UNIT, 2);
    expect(ground(disc({ mode: 'lower', smoothM: 1 }), d, hill)).toBeCloseTo(UNIT, 2);
    expect(ground(disc({ mode: 'lower', smoothM: 1 }), d)).toBeCloseTo(0, 2);
    expect(ground(disc({ mode: 'scale', factor: 0.25 }), d, hill)).toBeCloseTo(UNIT * 0.5, 3);
    expect(ground(disc({ mode: 'set' }), d, hill)).toBeCloseTo(UNIT, 3);
    // Graded: level inside, then 45 degree banks down to lower ground (a fill) or up to higher ground (a cutting).
    const graded = disc({ mode: 'grade' });
    expect(ground(graded, d, hill)).toBeCloseTo(UNIT, 3);
    expect(ground(graded, side(r + UNIT * 0.5), hill)).toBeCloseTo(UNIT * 1.5, 3);
    expect(ground(graded, side(r + UNIT * 0.5))).toBeCloseTo(UNIT * 0.5, 3);
    expect(ground(graded, side(r + UNIT * 2))).toBeCloseTo(0, 3);
    expect(ground(disc({ mode: 'grade', slope: 2 }), side(r + UNIT * 0.25))).toBeCloseTo(UNIT * 0.5, 3);
  });

  it('volume ops add and remove rock', () => {
    const inAir = at(ORIGIN, RADIUS, UNIT * 3);
    const inRock = at(ORIGIN, RADIUS, -UNIT * 3);
    const ball = (centre: V3, mode: 'union' | 'subtract'): ShapeOp => ({ id: 'b', shape: { kind: 'sphere', centre, radiusM: UNIT }, blend: { mode, smoothM: UNIT * 0.2 } });
    expect(compileShapeOps([ball(inAir, 'union')], RADIUS).apply(flat(inAir), inAir)).toBeCloseTo(-UNIT, 3);
    expect(compileShapeOps([ball(inRock, 'subtract')], RADIUS).apply(flat(inRock), inRock)).toBeCloseTo(UNIT, 3);
    const tunnel: ShapeOp = {
      id: 't', shape: { kind: 'tube', points: [at(around(ORIGIN, 0.0001, 0), RADIUS, -UNIT * 3), at(around(ORIGIN, 0.0001, Math.PI), RADIUS, -UNIT * 3)], radiusM: UNIT * 0.5 },
      blend: { mode: 'subtract' },
    };
    expect(compileShapeOps([tunnel], RADIUS).apply(flat(inRock), inRock)).toBeGreaterThan(0);
  });

  it('reject malformed ops with a readable error', () => {
    const good: ShapeOp = { id: 'x', shape: { kind: 'disc', centre: [0, 0, RADIUS], radiusM: 10 }, blend: { mode: 'set' } };
    expect(() => compileShapeOps([good], RADIUS)).not.toThrow();
    expect(() => compileShapeOps([{ ...good, id: '' }], RADIUS)).toThrowError(/id/);
    expect(() => compileShapeOps([{ ...good, shape: { kind: 'disc', centre: [0, 0, RADIUS], radiusM: Number.NaN } }], RADIUS)).toThrowError(/radiusM/);
    expect(() => compileShapeOps([{ ...good, blend: { mode: 'union' } } as unknown as ShapeOp], RADIUS)).toThrowError(/does not fit/);
    expect(() => compileShapeOps([{ ...good, shape: { kind: 'path', points: [[0, 0, RADIUS]], widthM: 1 } }], RADIUS)).toThrowError(/two points/);
    expect(() => compileShapeOps([{ ...good, shape: { kind: 'path', points: [[0, 0, RADIUS], [RADIUS, 0, 0]], widthM: 1 } }], RADIUS)).toThrowError(/quarter turn/);
  });
});

describe('planet shape ops: bounds and level of detail', () => {
  const bytes = generateNoiseBytes();
  const base = createTerrainFieldCpu(RADIUS, bytes, []);

  it('outside its bounds an op never changes solidity, and outside its caps not the value', () => {
    const random = rng(7);
    let checked = 0;
    let flipsInside = 0;
    for (let n = 0; n < 60; n++) {
      const op = randomOp(random, `op-${n}`, RADIUS, ORIGIN, UNIT);
      const pieces = shapeOpBounds(op, RADIUS, BASE_BAND);
      const ops = compileShapeOps([op], RADIUS);
      for (let s = 0; s < 60; s++) {
        const piece = pieces[Math.floor(random() * pieces.length)];
        const p = at(
          around(piece.direction, piece.angle * (0.6 + random() * 0.8), random() * Math.PI * 2), RADIUS,
          Math.min(piece.bottomM, BASE_BAND.bottomM) - UNIT * 2 + random() * (Math.max(piece.topM, BASE_BAND.topM) - Math.min(piece.bottomM, BASE_BAND.bottomM) + UNIT * 4),
        );
        const before = base.density(p);
        const after = ops.apply(before, p);
        const { cap, column } = insideBounds(pieces, p, RADIUS);
        if (!column) {
          expect(after <= 0).withContext(`${op.id} ${op.shape.kind}/${op.blend.mode} flipped outside its bounds`).toBe(before <= 0);
          checked++;
        } else if ((after <= 0) !== (before <= 0)) {
          flipsInside++;
        }
        if (!cap) expect(after).withContext(`${op.id} changed the value outside its cap`).toBe(before);
      }
    }
    console.log(`bounds contract: ${checked} points outside bounds kept solidity; ${flipsInside} points inside changed it`);
    expect(checked).toBeGreaterThan(1000);
    expect(flipsInside).toBeGreaterThan(20);
  });

  it('after a sequence of ops the ground stays inside the band the index gives each tile', () => {
    const random = rng(11);
    const ops = Array.from({ length: 40 }, (_, i) => randomOp(random, `op-${i}`, RADIUS, ORIGIN, UNIT));
    const index = buildShapeOpIndex(shapeOpsBounds(ops, RADIUS, BASE_BAND), BASE_BAND, 256);
    const compiled = compileShapeOps(ops, RADIUS);
    let above = 0;
    let below = 0;
    let raised = 0;
    for (let s = 0; s < 1500; s++) {
      const d = around(ORIGIN, (random() * UNIT * 14) / RADIUS, random() * Math.PI * 2);
      const band = index.bandAt(d);
      if (band.topM > BASE_BAND.topM) raised++;
      const high = at(d, RADIUS, band.topM + random() * UNIT * 3 + 1e-6);
      const low = at(d, RADIUS, band.bottomM - random() * UNIT * 3 - 1e-6);
      expect(compiled.apply(base.density(high), high)).withContext('air above the band').toBeGreaterThan(0);
      expect(compiled.apply(base.density(low), low)).withContext('rock below the band').toBeLessThanOrEqual(0);
      above++;
      below++;
    }
    expect(above + below).toBe(3000);
    expect(raised).toBeGreaterThan(100);
  });

  it('skips small relaxed ops at coarse footprints and never contact ones', () => {
    const p = at(ORIGIN, RADIUS, UNIT * 0.5);
    const disc = (fidelity: ShapeOp['fidelity']): ShapeOp =>
      ({ id: 'd', fidelity, shape: { kind: 'disc', centre: at(ORIGIN, RADIUS, 0), radiusM: UNIT * 2, edgeM: UNIT, heightM: UNIT }, blend: { mode: 'set' } });
    for (const fidelity of ['relaxed', 'silhouette', 'contact', 'topology'] as const) {
      const ops = compileShapeOps([disc(fidelity)], RADIUS);
      const value = base.density(p);
      expect(ops.apply(value, p, UNIT)).toBe(ops.apply(value, p, 0));
      const skipped = ops.apply(value, p, UNIT * 3) === value;
      expect(skipped).withContext(fidelity).toBe(fidelity === 'relaxed' || fidelity === 'silhouette');
    }
    const tiny = compileShapeOps([{ ...disc('relaxed'), minVisibleSizeM: UNIT * 10 }], RADIUS);
    expect(tiny.apply(base.density(p), p, UNIT * 3)).not.toBe(base.density(p));
  });
});

describe('planet shape ops: op log', () => {
  function randomLog(seed: number, length: number): OpLogEntry[] {
    const random = rng(seed);
    const live: string[] = [];
    const entries: OpLogEntry[] = [];
    let next = 0;
    while (entries.length < length) {
      const roll = random();
      if (live.length > 3 && roll < 0.2) {
        const id = live.splice(Math.floor(random() * live.length), 1)[0];
        entries.push({ type: 'remove', id });
      } else if (live.length > 0 && roll < 0.4) {
        const id = live[Math.floor(random() * live.length)];
        entries.push({ type: 'replace', op: randomOp(random, id, RADIUS, ORIGIN, UNIT) });
      } else {
        const id = `op-${next++}`;
        live.push(id);
        entries.push({ type: 'add', op: randomOp(random, id, RADIUS, ORIGIN, UNIT) });
      }
    }
    return entries;
  }

  it('replays deterministically, through a save, and undo restores every earlier hash', () => {
    const entries = randomLog(3, 200);
    const log = createOpLog();
    const hashes = [log.hash()];
    for (const entry of entries) {
      log.append(entry);
      hashes.push(log.hash());
    }
    expect(hashShapeOps(replayOpLog(entries))).toBe(log.hash());
    const saved = JSON.parse(JSON.stringify(log.toJSON()));
    expect(createOpLog(parseOpLog(saved)).hash()).toBe(log.hash());
    // Every entry changes the ops (an add and its later remove may return to an earlier hash, which is right).
    hashes.slice(1).forEach((hash, i) => expect(hash).withContext(`entry ${i}`).not.toBe(hashes[i]));
    for (let i = entries.length; i > 0; i--) {
      expect(log.undo()).toBe(entries[i - 1]);
      expect(log.hash()).toBe(hashes[i - 1]);
    }
    expect(log.undo()).toBeUndefined();
    expect(log.ops).toEqual([]);
  });

  it('hashes data, not key order', () => {
    const op: ShapeOp = { id: 'a', shape: { kind: 'disc', centre: [1, 2, 3], radiusM: 5, heightM: 0 }, blend: { mode: 'set' } };
    const shuffled = { blend: { mode: 'set' }, shape: { heightM: 0, radiusM: 5, centre: [1, 2, 3], kind: 'disc' }, id: 'a' } as ShapeOp;
    expect(hashShapeOps([op])).toBe(hashShapeOps([shuffled]));
    expect(hashShapeOps([op])).not.toBe(hashShapeOps([{ ...op, shape: { kind: 'disc', centre: [1, 2, 3], radiusM: 5.000001, heightM: 0 } }]));
  });

  it('refuses entries that do not fit and stays as it was', () => {
    const log = createOpLog(randomLog(5, 20));
    const hash = log.hash();
    const count = log.entries.length;
    const existing = log.ops[0];
    expect(() => log.append({ type: 'add', op: existing })).toThrowError(/already exists/);
    expect(() => log.append({ type: 'remove', id: 'missing' })).toThrowError(/no op missing/);
    expect(() => log.append({ type: 'replace', op: { ...existing, id: 'missing' } })).toThrowError(/no op missing/);
    expect(() => log.append({ type: 'add', op: { ...existing, id: 'new', shape: { kind: 'sphere', centre: [0, 0, 0], radiusM: 1 } } as ShapeOp })).toThrowError(/body centre/);
    expect(log.hash()).toBe(hash);
    expect(log.entries.length).toBe(count);
    expect(() => parseOpLog({ version: 2, entries: [] })).toThrowError(/version/);
  });
});

describe('planet shape ops: index', () => {
  it('lists every op whose cap meets a direction, in apply order, with a band containing them', () => {
    const random = rng(21);
    const caps: ShapeBounds[][] = [];
    // Caps of every size, some across face edges and corners.
    const corners: V3[] = [unit3([1, 1, 1]), unit3([1, -1, 0.2]), unit3([0, 0, 1]), unit3([-1, 0.999, -0.3])];
    for (let i = 0; i < 300; i++) {
      const centre = i < 100 ? around(corners[i % corners.length], random() * 0.05, random() * Math.PI * 2) : unit3([random() - 0.5, random() - 0.5, random() - 0.5]);
      const angle = 10 ** (-5 + random() * 4.8);
      caps.push([{ direction: centre, angle, bottomM: -random() * 100, topM: random() * 100 }]);
    }
    const index = buildShapeOpIndex(caps, { bottomM: -1, topM: 1 }, 32);
    let probes = 0;
    caps.forEach((pieces, op) => {
      const cap = pieces[0];
      for (let s = 0; s < 40; s++) {
        const d = around(cap.direction, cap.angle * (s < 20 ? 0.999 : Math.sqrt(random())), random() * Math.PI * 2);
        const list = index.opsAt(d);
        expect(list).withContext(`cap ${op}`).toContain(op);
        const band = index.bandAt(d);
        expect(band.bottomM).toBeLessThanOrEqual(cap.bottomM);
        expect(band.topM).toBeGreaterThanOrEqual(cap.topM);
        probes++;
      }
    });
    for (let t = 0; t < 50; t++) {
      const list = index.opsAt(unit3([random() - 0.5, random() - 0.5, random() - 0.5]));
      expect([...list].sort((a, b) => a - b)).toEqual([...list]);
    }
    console.log(`op index: ${probes} probes; ${index.stats.entries} tile entries over ${index.stats.tiles} tiles, at most ${index.stats.maxPerTile} per tile`);
  });

  it('gives exactly the value of applying every op, and the CPU cost per sample against the op count', () => {
    const base = createTerrainFieldCpu(RADIUS, generateNoiseBytes(), []);
    for (const count of [10, 100, 1000]) {
      const random = rng(count);
      // Spread ops over a region about 40 units across, so tiles hold a share of them. No graded ops: their caps reach
      // as far as the band under them needs, and hundreds of overlapping random scale ops (factors up to 1.7) stretch
      // that band without limit, so a graded op ends up covering the body.
      const ops = Array.from({ length: count }, (_, i) =>
        randomOp(random, `op-${i}`, RADIUS, around(ORIGIN, (random() * UNIT * 40) / RADIUS, random() * Math.PI * 2), UNIT, false));
      const bounds = shapeOpsBounds(ops, RADIUS, BASE_BAND);
      const index = buildShapeOpIndex(bounds, BASE_BAND, 512);
      const compiled = compileShapeOps(ops, RADIUS);
      const points = Array.from({ length: 300 }, () =>
        at(around(ORIGIN, (random() * UNIT * 40) / RADIUS, random() * Math.PI * 2), RADIUS, -UNIT * 10 + random() * UNIT * 20));
      const values = points.map((p) => base.density(p));
      let start = performance.now();
      const full = points.map((p, i) => compiled.apply(values[i], p));
      const fullUs = ((performance.now() - start) * 1000) / points.length;
      start = performance.now();
      const local = points.map((p, i) => compiled.apply(values[i], p, 0, index.opsAt(unit3(p))));
      const localUs = ((performance.now() - start) * 1000) / points.length;
      full.forEach((value, i) => expect(local[i]).withContext(`${count} ops, point ${i}`).toBe(value));
      console.log(`op cost, ${count} ops: all ${fullUs.toFixed(1)} µs/sample, indexed ${localUs.toFixed(1)} µs/sample, ` +
        `${index.stats.entries} entries, max ${index.stats.maxPerTile} per tile`);
    }
  });
});
