import { bend, blendedProjection } from 'triangular-engine/atmosphere';
import type { LodDomain, Vec3 } from 'triangular-engine/lod-surface/core';
import {
  computeMorphFrame,
  directionOf,
  referenceVertex,
  unwrapToSide,
  type MorphFrame,
  type MorphPose,
  type MorphView,
} from './morph-frame';
import {
  DOUBLE_LIB,
  FLOAT32_LIB,
  atan2R,
  cosW,
  liftAnchor,
  naivePosition,
  p2Position,
  sinW,
  type MorphLib,
  type Num,
  type NaiveFrame,
} from './morph-math';

const STEPS = 2 ** 24;
const sphere = (radiusM: number): LodDomain => ({ kind: 'sphere', sizeM: radiusM, warp: 'equal-angle' });

function frameOf(radiusM: number, morph: number, pose: Partial<MorphPose>, centre: [number, number] = [0, 0]): MorphFrame {
  const view: MorphView = {
    radiusM, morph, centreLonDeg: centre[0], centreLatDeg: centre[1], groundHeightM: 0,
    pose: { lonDeg: 40, latDeg: 35, altitudeM: 2, headingDeg: 25, pitchDeg: -5, ...pose },
  };
  return computeMorphFrame(view, sphere(radiusM), STEPS);
}

const norm = (v: readonly number[]): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Unit directions at `metres` from the frame's anchor, at a few bearings. */
function directionsAround(frame: MorphFrame, radiusM: number, metres: number): Vec3[] {
  const a = frame.anchorDir;
  const helper: Vec3 = Math.abs(a[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1 = norm([a[1] * helper[2] - a[2] * helper[1], a[2] * helper[0] - a[0] * helper[2], a[0] * helper[1] - a[1] * helper[0]]);
  const t2: Vec3 = [a[1] * t1[2] - a[2] * t1[1], a[2] * t1[0] - a[0] * t1[2], a[0] * t1[1] - a[1] * t1[0]];
  const out: Vec3[] = [];
  for (let bearing = 0; bearing < 6; bearing++) {
    const angle = (bearing * Math.PI) / 3 + 0.3;
    const s = metres / radiusM;
    out.push(norm([0, 1, 2].map((i) => a[i] + s * (Math.cos(angle) * t1[i] + Math.sin(angle) * t2[i]))));
  }
  return out;
}

/** P2 for a unit direction on side `sigma`, through the given library; `du` is rounded by the library. */
function p2At(lib: MorphLib & { num(x: number): Num }, frame: MorphFrame, unit: Vec3, sigma: number, height: number) {
  const A = liftAnchor(lib, frame.values);
  const du = [0, 1, 2].map((i) => lib.num(unit[i] - frame.anchorDir[i])) as unknown as [Num, Num, Num];
  return p2Position(lib, A, du, lib.num(sigma), lib.num(height));
}

function naiveAt(lib: MorphLib & { num(x: number): Num }, frame: MorphFrame, unit: Vec3, sigma: number, height: number) {
  const f = frame.naive;
  const lifted: NaiveFrame<Num> = {
    bRight: f.bRight.map((x) => lib.num(x)) as unknown as [Num, Num, Num],
    bUp: f.bUp.map((x) => lib.num(x)) as unknown as [Num, Num, Num],
    bForward: f.bForward.map((x) => lib.num(x)) as unknown as [Num, Num, Num],
    p: lib.num(f.p), radius: lib.num(f.radius), k: lib.num(f.k), zShift: lib.num(f.zShift),
    camBody: f.camBody.map((x) => lib.num(x)) as unknown as [Num, Num, Num],
  };
  return naivePosition(lib, lifted, unit.map((x) => lib.num(x)) as unknown as [Num, Num, Num], lib.num(sigma), lib.num(height));
}

describe('morph-math: small-safe trig', () => {
  it('sinW, cosW and atan2R keep their digits for tiny angles in float32 arithmetic', () => {
    for (const x of [1e-7, 3e-6, 1e-3, 0.4, 2.5, -5.1]) {
      const n = FLOAT32_LIB.num(x);
      expect(Math.abs(sinW(FLOAT32_LIB, n).v - Math.sin(Math.fround(x)))).toBeLessThan(2e-7 * Math.abs(Math.sin(x)) + (Math.abs(x) > 1 ? 1e-6 : 1e-30));
      expect(Math.abs(cosW(FLOAT32_LIB, n).v - Math.cos(Math.fround(x)))).toBeLessThan(2e-6);
    }
    for (const angle of [1e-9, 2e-7, 1e-4, 0.3, 1.2, -2, 3]) {
      const y = FLOAT32_LIB.num(Math.sin(angle) * 0.7);
      const x = FLOAT32_LIB.num(Math.cos(angle) * 0.7);
      const got = atan2R(FLOAT32_LIB, y, x).v;
      const want = Math.atan2(y.v, x.v);
      expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * 5e-7 + 1e-12);
    }
    const zero = atan2R(DOUBLE_LIB, DOUBLE_LIB.num(0), DOUBLE_LIB.num(0)).v;
    expect(zero).toBe(0);
  });
});

describe('morph-math: P2 difference forms in doubles', () => {
  const cases: { name: string; radiusM: number; morph: number; pose: Partial<MorphPose>; centre?: [number, number] }[] = [
    { name: 'mid-latitude, morph 0.5, 6,371 km', radiusM: 6_371_000, morph: 0.5, pose: {} },
    { name: 'mid-latitude, morph 1, 600 km', radiusM: 600_000, morph: 1, pose: {} },
    { name: 'near the pole, morph 0.5', radiusM: 6_371_000, morph: 0.5, pose: { lonDeg: 20, latDeg: 89.5 } },
    { name: 'projection centre, morph 0.3', radiusM: 600_000, morph: 0.3, pose: { lonDeg: 0, latDeg: 0 } },
    { name: 'off-centre projection, morph 0.7', radiusM: 6_371_000, morph: 0.7, pose: { lonDeg: 55, latDeg: -30 }, centre: [60, 25] },
    { name: 'morph 1e-4', radiusM: 6_371_000, morph: 1e-4, pose: {} },
  ];

  for (const c of cases) {
    it(`matches blendedProjection and bend: ${c.name}`, () => {
      const frame = frameOf(c.radiusM, c.morph, c.pose, c.centre);
      const k = frame.k;
      const [xA, yA] = blendedProjection(frame.values.lamA, Math.atan2(frame.values.sA, frame.values.cA), c.morph, c.radiusM);
      const groundA = bend(xA, yA, k, 0).position;
      for (const metres of [0.5, 7, 300, 20_000, 400_000]) {
        for (const unit of directionsAround(frame, c.radiusM, metres)) {
          const sigma = unit[0] * frame.basis.right[0] + unit[1] * frame.basis.right[1] + unit[2] * frame.basis.right[2] >= 0 ? 1 : -1;
          const got = p2At(DOUBLE_LIB, frame, unit, sigma, 0);
          const ref = referenceVertex(frame, unit, sigma, 0);

          // dphi and dlam against the angles of the vertex itself.
          const phiA = Math.atan2(frame.values.sA, frame.values.cA);
          expect(Math.abs(got.dphi.v - (ref.lat - phiA))).toBeLessThan(1e-12 + 1e-9 * Math.abs(ref.lat - phiA));
          expect(Math.abs(got.dlam.v - (ref.lon - frame.values.lamA))).toBeLessThan(1e-12 + 1e-9 * Math.abs(ref.lon - frame.values.lamA));
          expect(got.wrapN.v).toBe(ref.n);

          // dx and dy against blendedProjection differences.
          const [x, y] = blendedProjection(ref.lon, ref.lat, c.morph, c.radiusM);
          expect(Math.abs(got.dx.v - (x - xA))).toBeLessThan(2e-6 + 1e-9 * Math.abs(x - xA));
          expect(Math.abs(got.dy.v - (y - yA))).toBeLessThan(2e-6 + 1e-9 * Math.abs(y - yA));

          // G - GA against the bend.
          const ground = bend(x, y, k, 0).position;
          for (let i = 0; i < 3; i++) {
            expect(Math.abs(got.dG[i].v - (ground[i] - groundA[i]))).toBeLessThan(2e-6 + 1e-9 * Math.abs(ground[i] - groundA[i]));
          }

          // The whole camera-relative position.
          for (let i = 0; i < 3; i++) {
            expect(Math.abs(got.rel[i].v - ref.rel[i])).toBeLessThan(5e-6 + 1e-9 * Math.abs(ref.rel[i]));
          }
        }
      }
    });
  }

  it('applies the height along the bend up (a 500 m offset)', () => {
    const frame = frameOf(6_371_000, 0.5, {});
    for (const unit of directionsAround(frame, 6_371_000, 40)) {
      const got = p2At(DOUBLE_LIB, frame, unit, 1, 500);
      const ref = referenceVertex(frame, unit, 1, 500);
      for (let i = 0; i < 3; i++) expect(Math.abs(got.rel[i].v - ref.rel[i])).toBeLessThan(5e-6);
    }
  });

  it('splits the cut with the side window: both sides of the camera sheet unwrap the same way', () => {
    const frame = frameOf(6_371_000, 0.5, { lonDeg: 179.9, latDeg: 20 });
    // Vertices at lon 179.95 and -179.95: the longitude continues from the anchor's (179.9), so on side +1 (window -90 to 270
    // degrees) both stay as they are; the unwrap integer counts only turns added to that continuation.
    for (const lonDeg of [179.95, -179.95, 179.0, -179.0]) {
      const unit = directionOf(frame.basis, (lonDeg * Math.PI) / 180, (20 * Math.PI) / 180);
      const got = p2At(DOUBLE_LIB, frame, unit, 1, 0);
      const ref = referenceVertex(frame, unit, 1, 0);
      expect(got.wrapN.v).toBe(0);
      expect(ref.n).toBe(0);
      expect(Math.abs(ref.lon - frame.lambdaC)).toBeLessThan(0.1);
      for (let i = 0; i < 3; i++) expect(Math.abs(got.rel[i].v - ref.rel[i])).toBeLessThan(5e-6 + 1e-9 * Math.abs(ref.rel[i]));
    }
    // On side -1 (window -270 to 90 degrees) the camera-side longitudes are on the other sheet: +179.95 goes to -180.05.
    const unit = directionOf(frame.basis, (179.95 * Math.PI) / 180, (20 * Math.PI) / 180);
    expect(p2At(DOUBLE_LIB, frame, unit, -1, 0).wrapN.v).toBe(-1);
  });

  it('is the flat map exactly at morph 1 (k = 0): dG = (dx, dy, 0) and up = z', () => {
    const frame = frameOf(6_371_000, 1, {});
    expect(frame.k).toBe(0);
    for (const metres of [0.5, 300, 40_000]) {
      for (const unit of directionsAround(frame, 6_371_000, metres)) {
        const got = p2At(DOUBLE_LIB, frame, unit, 1, 0);
        expect(got.dG[0].v).toBe(got.dx.v);
        expect(got.dG[1].v).toBe(got.dy.v);
        expect(Math.abs(got.dG[2].v)).toBe(0);
        expect(Math.abs(got.up[0].v)).toBe(0);
        expect(Math.abs(got.up[1].v)).toBe(0);
        expect(got.up[2].v).toBe(1);
      }
    }
  });

  it('unwrapToSide puts a longitude into the side window', () => {
    for (const sigma of [1, -1]) {
      for (let lon = -3.1; lon <= 3.1; lon += 0.37) {
        const w = unwrapToSide(lon, sigma);
        expect(w.lon).toBeGreaterThan(sigma * (Math.PI / 2) - Math.PI);
        expect(w.lon).toBeLessThanOrEqual(sigma * (Math.PI / 2) + Math.PI + 1e-12);
        expect(Math.abs(w.lon - lon - w.n * 2 * Math.PI)).toBeLessThan(1e-12);
      }
    }
  });
});

describe('morph-math: float32 emulation (rounded after every operation; not GPU numbers)', () => {
  const scenarios: { name: string; radiusM: number; morph: number; pose: Partial<MorphPose> }[] = [
    { name: '6,371 km morph 0.5 mid-latitude', radiusM: 6_371_000, morph: 0.5, pose: {} },
    { name: '6,371 km morph 1 mid-latitude', radiusM: 6_371_000, morph: 1, pose: {} },
    { name: '600 km morph 0.5 mid-latitude', radiusM: 600_000, morph: 0.5, pose: {} },
    { name: '6,371 km morph 0.5 near the pole', radiusM: 6_371_000, morph: 0.5, pose: { lonDeg: 20, latDeg: 89.5 } },
  ];

  for (const s of scenarios) {
    it(`P2 stays accurate where N does not: ${s.name}`, () => {
      const frame = frameOf(s.radiusM, s.morph, s.pose);
      const rows: string[] = [];
      let p2Near = 0;
      let nNear = 0;
      for (const metres of [1, 10, 100]) {
        let p2Max = 0;
        let nMax = 0;
        for (const unit of directionsAround(frame, s.radiusM, metres)) {
          const ref = referenceVertex(frame, unit, 1, 0);
          const rounded = unit.map(Math.fround) as Vec3;
          const p2 = p2At(FLOAT32_LIB, frame, unit, 1, 0);
          const n = naiveAt(FLOAT32_LIB, frame, rounded, 1, 0);
          p2Max = Math.max(p2Max, Math.hypot(p2.rel[0].v - ref.rel[0], p2.rel[1].v - ref.rel[1], p2.rel[2].v - ref.rel[2]));
          nMax = Math.max(nMax, Math.hypot(n.rel[0].v - ref.rel[0], n.rel[1].v - ref.rel[1], n.rel[2].v - ref.rel[2]));
        }
        rows.push(`${metres} m: P2 ${p2Max.toExponential(2)} m, N ${nMax.toExponential(2)} m`);
        if (metres === 10) {
          p2Near = p2Max;
          nNear = nMax;
        }
      }
      console.log(`float32 emulation, ${s.name}: ${rows.join(' | ')}`);
      expect(p2Near).toBeLessThan(nNear);
    });
  }
});

describe('morph-math: vertices at and near a pole (float32 emulation; documents a known limit)', () => {
  it('logs the position error of the pole vertex and of the first rings', () => {
    for (const pose of [{}, { lonDeg: 20, latDeg: 89.5 }] as Partial<MorphPose>[]) {
      const frame = frameOf(6_371_000, 0.5, pose);
      const b = frame.basis;
      const rows: string[] = [];
      for (const qDeg of [0, 1e-5, 1e-4, 1e-3, 1e-2, 0.1, 1]) {
        let worst = 0;
        let worstLon = 0;
        for (let bearing = 0; bearing < 8; bearing++) {
          const angle = (bearing * Math.PI) / 4 + 0.2;
          const q = (qDeg * Math.PI) / 180;
          const unit = norm([0, 1, 2].map((i) => b.up[i] * Math.cos(q) + Math.sin(q) * (Math.cos(angle) * b.forward[i] + Math.sin(angle) * b.right[i])));
          const ref = referenceVertex(frame, unit, 1, 0);
          const got = p2At(FLOAT32_LIB, frame, unit, 1, 0);
          const e = Math.hypot(got.rel[0].v - ref.rel[0], got.rel[1].v - ref.rel[1], got.rel[2].v - ref.rel[2]);
          if (e > worst) {
            worst = e;
            worstLon = got.dlam.v + frame.values.lamA - ref.lon;
          }
        }
        rows.push(`q ${qDeg} deg: ${worst.toExponential(2)} m (longitude off by ${worstLon.toExponential(2)} rad)`);
      }
      console.log(`pole, anchor lat ${pose.latDeg ?? 35}: ${rows.join(' | ')}`);
    }
    expect(true).toBe(true);
  });
});
