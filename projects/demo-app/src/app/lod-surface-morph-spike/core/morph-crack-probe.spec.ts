import { bend } from 'triangular-engine/atmosphere';
import type { LodDomain, Vec3 } from 'triangular-engine/lod-surface/core';
import {
  BACKSTOP_VALUE,
  CRACK_DEFAULTS,
  RELIEF_KAPPA,
  cameraRig,
  classifyCracks,
  controlExpectsHoles,
  countCracks,
  createOutlineModel,
  distanceToOutside,
  expectedCoverage,
  insideOutline,
  pixelRay,
  rayHits,
  reliefLambdaCap,
  rimAnalysis,
  type CameraRig,
} from './morph-crack-probe';
import { POLE_EDGE_AHEAD_M, computeMorphFrame, poleEdgeLatitudeDeg, poseOf, polarLatticeVectors, projectionBasis, referenceVertex, outlineDistancesAt, unwrapToSide, type MorphFrame, type MorphPose, type MorphView } from './morph-frame';
import { DOUBLE_LIB, FLOAT32_LIB, liftAnchor, outlineDistances, p2Position, type MorphLib, type Num } from './morph-math';

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
  for (let bearing = 0; bearing < 8; bearing++) {
    const angle = (bearing * Math.PI) / 4 + 0.3;
    const s = metres / radiusM;
    out.push(norm([0, 1, 2].map((i) => a[i] + s * (Math.cos(angle) * t1[i] + Math.sin(angle) * t2[i]))));
  }
  return out;
}

type NumLib = MorphLib & { num(x: number): Num };

/** The vertex stage's four edge distances for a unit direction, through a library. */
function distancesAt(lib: NumLib, frame: MorphFrame, unit: Vec3, sigma: number, pole?: { is: boolean; lon: number }): number[] {
  const A = liftAnchor(lib, frame.values);
  const du = [0, 1, 2].map((i) => lib.num(unit[i] - frame.anchorDir[i])) as unknown as [Num, Num, Num];
  const p2 = p2Position(lib, A, du, lib.num(sigma), lib.num(0), pole ? { is: pole.is, lon: lib.num(pole.lon) } : undefined);
  const o = frame.outline;
  const outline = {
    right: o.right.map((x) => lib.num(x)), left: o.left.map((x) => lib.num(x)), top: lib.num(o.top), bottom: lib.num(o.bottom),
  };
  return outlineDistances(lib, A, outline, p2).map((d) => (d as Num).v);
}

describe('morph outline: edge distances in doubles', () => {
  const radiusM = 6_371_000;
  const frame = frameOf(radiusM, 0.5, { lonDeg: 179.99, latDeg: 0, altitudeM: 2, headingDeg: 90, pitchDeg: -5 });

  it('the CPU tables are the anchor distances less whole turns (a camera 1.1 km from the cut gets a small number)', () => {
    const o = frame.outline;
    const near = Math.min(...o.right.map(Math.abs));
    expect(near).toBeLessThan(2e-4);
    expect(near).toBeGreaterThan(1e-4);
  });

  it('matches the reference distances to millimetres in doubles, around the cut at 900 m to 1.3 km', () => {
    for (const metres of [900, 1100, 1112, 1200, 1300]) {
      for (const unit of directionsAround(frame, radiusM, metres)) {
        const ref = referenceVertex(frame, unit, 1, 0);
        const want = outlineDistancesAt(ref.lon, ref.lat, 0.5, radiusM);
        const got = distancesAt(DOUBLE_LIB, frame, unit, 1);
        for (let e = 0; e < 4; e++) expect(Math.abs(got[e] - want[e])).toBeLessThan(2e-3);
      }
    }
  });

  it('keeps centimetres in float32 where the absolute |x| form loses metres (emulation, not GPU numbers)', () => {
    let p2Max = 0;
    let naiveMax = 0;
    for (const metres of [1000, 1100, 1112, 1125, 1200]) {
      for (const unit of directionsAround(frame, radiusM, metres)) {
        const ref = referenceVertex(frame, unit, 1, 0);
        const want = outlineDistancesAt(ref.lon, ref.lat, 0.5, radiusM);
        const got = distancesAt(FLOAT32_LIB, frame, unit, 1);
        // Only the edge near the vertex matters for the clip (the far one is a whole map away, tens of thousands of km).
        const near = want[0] < want[1] ? 0 : 1;
        p2Max = Math.max(p2Max, Math.abs(got[near] - want[near]));
        // The absolute form: the vertex's x and the half-width as float32 numbers of the order 1e7 m.
        const f = Math.fround;
        const row = (want[0] + want[1]) / 2; // half-width
        const x = (want[1] - want[0]) / 2;
        naiveMax = Math.max(naiveMax, Math.abs(f(f(row) - f(Math.abs(x))) - want[near]));
      }
    }
    console.log(`[morph-crack-probe] edge distance at the cut, float32 emulation: P2 max error ${p2Max.toExponential(2)} m, absolute form ${naiveMax.toExponential(2)} m`);
    expect(p2Max).toBeLessThan(0.05);
    expect(naiveMax).toBeGreaterThan(p2Max);
  });
});

describe('morph outline: the pole vertex longitude', () => {
  const radiusM = 6_371_000;
  const frame = frameOf(radiusM, 0.5, { lonDeg: 20, latDeg: 89.9, altitudeM: 200, headingDeg: 0, pitchDeg: -10 });

  it('takes the given longitude inside the side window and lands on the map edge at that meridian', () => {
    const pole: Vec3 = frame.basis.up;
    for (const [centreDeg, sigma] of [[45, 1], [135, 1], [-135, -1], [-45, -1], [-45, 1]] as const) {
      const lon = unwrapToSide((centreDeg * Math.PI) / 180, sigma).lon;
      const A = liftAnchor(DOUBLE_LIB, frame.values);
      const du = [0, 1, 2].map((i) => DOUBLE_LIB.num(pole[i] - frame.anchorDir[i])) as unknown as [Num, Num, Num];
      const p2 = p2Position(DOUBLE_LIB, A, du, DOUBLE_LIB.num(sigma), DOUBLE_LIB.num(0), { is: true, lon: DOUBLE_LIB.num(lon) });
      expect(Math.abs(p2.dlam0.v + frame.values.lamA + 2 * Math.PI * p2.wrapN.v - lon)).toBeLessThan(1e-9);
      const ref = referenceVertex(frame, pole, sigma, 0, lon);
      expect(Math.hypot(p2.rel[0].v - ref.rel[0], p2.rel[1].v - ref.rel[1], p2.rel[2].v - ref.rel[2])).toBeLessThan(1);
      const d = distancesAt(DOUBLE_LIB, frame, pole, sigma, { is: true, lon });
      expect(Math.abs(d[2])).toBeLessThan(1); // the top edge, to within the double-precision pole latitude
    }
  });

  it('leaves the vertex alone when the pole condition is false', () => {
    const unit = norm([0.3, 0.9, 0.2]);
    const a = distancesAt(DOUBLE_LIB, frame, unit, 1);
    const b = distancesAt(DOUBLE_LIB, frame, unit, 1, { is: false, lon: 1 });
    expect(b).toEqual(a);
  });

  it('knows the two poles as lattice vertices at the default projection centre and not at a tilted one', () => {
    const domain = sphere(radiusM);
    const [up, down] = polarLatticeVectors(projectionBasis(0, 0), domain, STEPS);
    expect(up).toBeDefined();
    expect(down).toBeDefined();
    expect(Math.abs(up![1])).toBe(STEPS);
    expect(up![1]).toBe(-down![1]);
    const tilted = polarLatticeVectors(projectionBasis(37, 22), domain, STEPS);
    expect(tilted[0]).toBeUndefined();
    expect(tilted[1]).toBeUndefined();
  });
});

describe('morph crack probe: the outline model and the analytic mask', () => {
  it('latOfY inverts the projection row (y of lat) at morph 0, 0.5 and 1', () => {
    for (const p of [0, 0.5, 1]) {
      const model = createOutlineModel(p, 1000);
      for (let lat = -1.55; lat <= 1.55; lat += 0.1) {
        expect(Math.abs(model.latOfY(model.yOfLat(lat)) - lat)).toBeLessThan(1e-7);
      }
      expect(model.latOfY(model.halfHeight * 2)).toBeCloseTo(Math.PI / 2, 12);
      expect(model.latOfY(-model.halfHeight * 2)).toBeCloseTo(-Math.PI / 2, 12);
    }
  });

  it('insideOutline follows the row half-width and the half-height', () => {
    const model = createOutlineModel(1, 1000);
    expect(insideOutline(model, 0, 0)).toBeTrue();
    const equator = model.halfWidthAtLat(0);
    expect(insideOutline(model, equator * 0.999, 0)).toBeTrue();
    expect(insideOutline(model, equator * 1.001, 0)).toBeFalse();
    // Equal Earth is narrower at the poles: the equator's half-width is outside near the top.
    expect(insideOutline(model, equator * 0.99, model.halfHeight * 0.98)).toBeFalse();
    expect(insideOutline(model, 0, model.halfHeight * 1.001)).toBeFalse();
    const globe = createOutlineModel(0, 1000);
    expect(insideOutline(globe, Math.PI * 1000 * 0.999, globe.halfHeight * 0.999)).toBeTrue();
  });

  it('a ray down from above a point of the bent ground hits that map point (flat and bent)', () => {
    for (const p of [1, 0.5, 0.2]) {
      const model = createOutlineModel(p, 1000);
      const x = 1300;
      const y = 400;
      const ground = bend(x, y, model.k, 0);
      const above = bend(x, y, model.k, 700);
      const normal = ground.normal;
      const hits = rayHits(model, above.position, [-normal[0], -normal[1], -normal[2]]);
      expect(hits.length).toBeGreaterThan(0);
      expect(Math.abs(hits[0].x - x)).toBeLessThan(1e-6);
      expect(Math.abs(hits[0].y - y)).toBeLessThan(1e-6);
      expect(hits[0].t).toBeCloseTo(700, 6);
    }
  });

  it('the mask of a flat map seen from above covers the map and the area matches the outline in doubles', () => {
    const model = createOutlineModel(1, 1000);
    const width = 320;
    const height = 180;
    const rig: CameraRig = {
      position: [0, 0, 4200], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1], tanHalfFov: Math.tan(Math.PI / 6), aspect: width / height,
    };
    const covered = expectedCoverage(model, rig, width, height);
    let count = 0;
    for (const c of covered) count += c;
    // Footprint of the image on the ground and the outline's area by integration over latitude.
    const footprint = 2 * rig.tanHalfFov * 4200 * rig.aspect * (2 * rig.tanHalfFov * 4200);
    let area = 0;
    const steps = 20000;
    for (let i = 0; i < steps; i++) {
      const lat = -Math.PI / 2 + (Math.PI * (i + 0.5)) / steps;
      const dy = model.yOfLat(lat + Math.PI / steps / 2) - model.yOfLat(lat - Math.PI / steps / 2);
      area += 2 * model.halfWidthAtLat(lat) * dy;
    }
    expect(area).toBeLessThan(footprint);
    expect(Math.abs(count / (width * height) - area / footprint)).toBeLessThan(0.01);
    expect(covered[(height / 2) * width + width / 2]).toBe(1);
    expect(covered[0]).toBe(0);
  });

  it('classifyCracks: a drawn image equal to the mask has no holes and no leaks; a missing pixel is a hole in the right region', () => {
    const model = createOutlineModel(1, 1000);
    const width = 320;
    const height = 180;
    const rig: CameraRig = {
      position: [0, 150, 4200], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1], tanHalfFov: Math.tan(Math.PI / 6), aspect: width / height,
    };
    const covered = expectedCoverage(model, rig, width, height);
    const image = (mask: Uint8Array, flip = false): Uint8Array => {
      const rgba = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const row = flip ? height - 1 - y : y;
          const v = mask[row * width + x] ? 255 : 0;
          const o = (y * width + x) * 4;
          rgba[o] = v;
          rgba[o + 1] = v;
          rgba[o + 2] = v;
          rgba[o + 3] = 255;
        }
      }
      return rgba;
    };
    const clean = classifyCracks(image(covered), width, height, model, rig, {}, covered);
    expect(clean.holes).toBe(0);
    expect(clean.leakPx).toBe(0);
    expect(clean.agreement).toBeCloseTo(1, 12);
    expect(clean.flipY).toBeFalse();

    const flipped = classifyCracks(image(covered, true), width, height, model, rig, {}, covered);
    expect(flipped.flipY).toBeTrue();
    expect(flipped.holes).toBe(0);

    const dist = distanceToOutside(covered, width, height);
    const find = (predicate: (x: number, y: number) => boolean): number => {
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (predicate(x, y)) return y * width + x;
      throw new Error('no pixel');
    };
    // A pixel 3 px inside the left edge at the middle row (cut), one 3 px inside the top edge at the middle column (pole), one deep inside.
    const midY = Math.floor(height / 2);
    const cutPixel = find((x, y) => y === midY && dist[y * width + x] === 3);
    const poleX = Math.floor(width / 2);
    const polePixel = find((x, y) => x === poleX && dist[y * width + x] === 3);
    const deepPixel = find((x, y) => x === poleX && y === midY);
    for (const [pixel, region] of [[cutPixel, 'cut'], [polePixel, 'pole'], [deepPixel, 'elsewhere']] as const) {
      const punched = image(covered);
      punched[pixel * 4] = 0;
      const result = classifyCracks(punched, width, height, model, rig, {}, covered);
      expect(result.holes).toBe(1);
      expect(result[region]).toBe(1);
    }

    const leaky = image(covered);
    leaky[(0 * width + 0) * 4] = 255;
    leaky[(0 * width + 1) * 4] = 255;
    leaky[(1 * width + 0) * 4] = 255;
    leaky[(1 * width + 1) * 4] = 255;
    leaky[(0 * width + 2) * 4] = 255;
    leaky[(1 * width + 2) * 4] = 255;
    const leak = classifyCracks(leaky, width, height, model, rig, {}, covered);
    expect(leak.leakPx).toBeGreaterThan(0);
  });

  it('rimAnalysis: a missing strip along the top edge is a rim hole whose offset is its height; a pinhole in the ground is interior', () => {
    const w = 16;
    const h = 12;
    // The map covers rows 3 .. 11; space above. Drawn: everything covered except the first `missing` rows below the edge.
    const build = (missing: number, pinhole = false) => {
      const mask = new Uint8Array(w * h);
      const drawn = new Uint8Array(w * h);
      for (let y = 3; y < h; y++) {
        for (let x = 0; x < w; x++) {
          mask[y * w + x] = 1;
          if (y >= 3 + missing) drawn[y * w + x] = 1;
        }
      }
      if (pinhole) drawn[8 * w + 8] = 0;
      // The lab's rule on this image: a missing pixel with no uncovered pixel among its eight neighbours is a hole.
      const cracks: number[] = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (!mask[p] || drawn[p]) continue;
          let near = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && !mask[ny * w + nx]) near = true;
          }
          if (!near) cracks.push(p);
        }
      }
      return rimAnalysis(mask, drawn, cracks, w, h);
    };
    const clean = build(0);
    expect(clean).toEqual(jasmine.objectContaining({ holesRim: 0, holesInterior: 0, rimOffsetMaxPx: 0, rimOffsetP95Px: 0, rimColumns: w }));
    const strip = build(4);
    expect(strip.rimOffsetMaxPx).toBe(4);
    expect(strip.rimOffsetP95Px).toBe(4);
    expect(strip.holesInterior).toBe(0);
    expect(strip.holesRim).toBe(3 * w);
    const pin = build(0, true);
    expect(pin.holesInterior).toBe(1);
    expect(pin.holesRim).toBe(0);
    expect(pin.rimOffsetMaxPx).toBe(0);
  });

  it("the lab's counting: a backstop pixel next to the background is masked, an enclosed one is a crack", () => {
    const w = 5;
    const h = 5;
    const rgba = new Uint8Array(w * h * 4);
    const set = (x: number, y: number, v: number): void => {
      rgba[(y * w + x) * 4] = v;
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, 255);
    set(2, 2, BACKSTOP_VALUE);
    expect(countCracks(rgba, w, h)).toEqual({ cracks: 1, masked: 0, surface: 24, background: 0 });
    set(0, 0, 0);
    set(1, 1, BACKSTOP_VALUE);
    const c = countCracks(rgba, w, h);
    expect(c.cracks).toBe(1);
    expect(c.masked).toBe(1);
  });

  it('cameraRig maps the frame axes into the map frame and the view direction of the centre pixel is the forward axis', () => {
    const frame = frameOf(1000, 1, { lonDeg: 0, latDeg: 0, altitudeM: 3200, headingDeg: 0, pitchDeg: -90 });
    const rig = cameraRig(frame, 60, 16 / 9);
    expect(rig.position[2]).toBeCloseTo(3200 * 1, 6);
    expect(rig.forward[2]).toBeCloseTo(-1, 9);
    const d = pixelRay(rig, 2, 2, 0, 0, false);
    expect(Math.hypot(d[0], d[1], d[2])).toBeGreaterThan(1);
  });
});

describe('morph crack probe: leaf-centred placement, poses on the map, the relief controls', () => {
  const radiusM = 6_371_000;

  it('placing a vertex within pi of its leaf centre keeps the two sides of the window seam together; the window tears them', () => {
    const frame = frameOf(radiusM, 0.5, { lonDeg: 40, latDeg: 35, altitudeM: 2, headingDeg: 25, pitchDeg: -5 });
    const direction = (lonDeg: number): Vec3 => {
      const l = (lonDeg * Math.PI) / 180;
      const b = frame.basis;
      return norm([0, 1, 2].map((i) => Math.sin(l) * b.right[i] + Math.cos(l) * b.forward[i]));
    };
    const A = liftAnchor(DOUBLE_LIB, frame.values);
    const lonOf = (unit: Vec3, sigma: number, leafLon?: number): number => {
      const du = [0, 1, 2].map((i) => DOUBLE_LIB.num(unit[i] - frame.anchorDir[i])) as unknown as [Num, Num, Num];
      const leaf = leafLon === undefined ? undefined : DOUBLE_LIB.num(leafLon);
      const p2 = p2Position(DOUBLE_LIB, A, du, DOUBLE_LIB.num(sigma), DOUBLE_LIB.num(0), undefined, leaf);
      return frame.values.lamA + p2.dlam.v;
    };
    // A leaf that straddles the -90 degree meridian, seen from the side-1 window [-90, 270] degrees: its centre at 270 degrees.
    const leafLon = (270 * Math.PI) / 180;
    const west = lonOf(direction(-91), 1, leafLon);
    const east = lonOf(direction(-89), 1, leafLon);
    expect(Math.abs(east - west)).toBeLessThan(0.05);
    const windowWest = lonOf(direction(-91), 1);
    const windowEast = lonOf(direction(-89), 1);
    expect(Math.abs(windowEast - windowWest)).toBeGreaterThan(Math.PI);
  });

  it('referenceVertex places around the leaf centre the same way (the CPU reference follows the shader)', () => {
    const frame = frameOf(radiusM, 0.5, { lonDeg: 40, latDeg: 35, altitudeM: 2, headingDeg: 25, pitchDeg: -5 });
    const l = (-89 * Math.PI) / 180;
    const unit = norm([0, 1, 2].map((i) => Math.sin(l) * frame.basis.right[i] + Math.cos(l) * frame.basis.forward[i]));
    const leafLon = (270 * Math.PI) / 180;
    const inWindowRef = referenceVertex(frame, unit, 1, 0);
    const centred = referenceVertex(frame, unit, 1, 0, undefined, leafLon);
    expect(inWindowRef.lon).toBeCloseTo(l, 6);
    expect(centred.lon).toBeCloseTo(l + 2 * Math.PI, 6);
  });

  it('poleEdgeLatitudeDeg puts the pole edge the asked distance away, nearer the equator for a flatter pole (more morph)', () => {
    for (const radius of [600_000, 6_371_000]) {
      const lats = [0, 0.5, 0.9, 1].map((morph) => {
        const lat = poleEdgeLatitudeDeg(radius, morph, POLE_EDGE_AHEAD_M);
        const model = createOutlineModel(morph, radius);
        expect(Math.abs(model.halfHeight - model.yOfLat((lat * Math.PI) / 180) - POLE_EDGE_AHEAD_M)).toBeLessThan(1e-3);
        return lat;
      });
      for (let i = 1; i < lats.length; i++) expect(lats[i]).toBeLessThan(lats[i - 1]);
      expect(lats[0]).toBeLessThan(90);
    }
  });

  it('every probe view has map in the picture at morph 0.5, 0.9 and 1, at both radii (a view that looks off the map is a bug of the pose)', () => {
    const lines: string[] = [];
    for (const radius of [600_000, 6_371_000]) {
      for (const poseId of CRACK_DEFAULTS.views) {
        for (const morph of [0.5, 0.9, 1]) {
          const view: MorphView = { radiusM: radius, morph, centreLonDeg: 0, centreLatDeg: 0, pose: poseOf(poseId, radius, morph), groundHeightM: 0 };
          const frame = computeMorphFrame(view, sphere(radius), STEPS);
          const model = createOutlineModel(morph, radius);
          const w = 128;
          const h = 72;
          const covered = expectedCoverage(model, cameraRig(frame, 60, 16 / 9), w, h);
          let n = 0;
          for (const c of covered) n += c;
          lines.push(`${radius / 1000} km ${poseId} morph ${morph}: ${((100 * n) / (w * h)).toFixed(1)} % covered`);
          expect(n).toBeGreaterThan(0.02 * w * h);
        }
      }
    }
    console.log(`[morph-crack-probe] coverage per view:\n${lines.join('\n')}`);
  });

  it('the pole view sees ground and, above it in the middle column, the pole edge (rows above the first covered one are uncovered)', () => {
    for (const radius of [600_000, 6_371_000]) {
      for (const morph of [0.5, 0.9, 1]) {
        const view: MorphView = { radiusM: radius, morph, centreLonDeg: 0, centreLatDeg: 0, pose: poseOf('pole-200m', radius, morph), groundHeightM: 0 };
        const frame = computeMorphFrame(view, sphere(radius), STEPS);
        const model = createOutlineModel(morph, radius);
        const w = 64;
        const h = 36;
        const covered = expectedCoverage(model, cameraRig(frame, 60, 16 / 9), w, h);
        let firstCovered = -1;
        for (let y = 0; y < h; y++) {
          if (covered[y * w + w / 2]) {
            firstCovered = y;
            break;
          }
        }
        expect(firstCovered).toBeGreaterThan(0);
      }
    }
  });

  it('reliefLambdaCap keeps the octave sum under the share of the altitude; controls expect holes except the relief twin', () => {
    const unitM = (radiusM * Math.PI) / 4 / STEPS;
    const cap = reliefLambdaCap(200, unitM);
    expect(2 * RELIEF_KAPPA * cap * unitM).toBeCloseTo(0.4 * 200, 9);
    expect(controlExpectsHoles(undefined)).toBeUndefined();
    expect(controlExpectsHoles('gap')).toBeTrue();
    expect(controlExpectsHoles('folding-off')).toBeTrue();
    expect(controlExpectsHoles('relief')).toBeFalse();
  });
});
