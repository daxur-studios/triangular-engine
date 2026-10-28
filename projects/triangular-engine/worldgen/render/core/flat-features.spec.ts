/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ILatLonTerrainPatchAddress } from 'triangular-engine/terrain/core';
import { CellPlanetWorldCache, handleCellPlanetMeshWorkerRequest } from './cell-planet-worker-pipeline';
import {
  FlatFeatureSet,
  flatFeatureFrame,
  flatFeatureOffset,
  flatFeaturePageBounds,
  flatFeatureSignedDistanceM,
  type FlatFeature,
  type FlatFeatureVec3,
} from './flat-features';

const R = 600_000;
const centre: FlatFeatureVec3 = [0, 0, 1];
const frame = flatFeatureFrame(centre, 0.4);
/** Direction `a` metres along and `b` metres across the frame at `centre`. */
const at = (a: number, b: number): FlatFeatureVec3 => flatFeatureOffset(centre, frame, a, b, R);
const dot = (p: FlatFeatureVec3, q: FlatFeatureVec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

const runway: FlatFeature = {
  kind: 'rectangle',
  id: 'runway',
  centre,
  headingRad: 0.4,
  lengthM: 2000,
  widthM: 45,
  heightM: 100,
  apronM: 120,
  shoulderM: 1400,
  priority: 10,
  markings: 'runway',
};

describe('flat features: frames and SDF', () => {
  it('builds an orthonormal tangent frame, also at a pole', () => {
    for (const c of [centre, [0, 1, 0] as FlatFeatureVec3]) {
      const f = flatFeatureFrame(c, 1.1);
      expect(dot(f.along, c)).toBeCloseTo(0, 9);
      expect(dot(f.across, c)).toBeCloseTo(0, 9);
      expect(dot(f.along, f.across)).toBeCloseTo(0, 9);
      expect(Math.hypot(...f.along)).toBeCloseTo(1, 9);
    }
  });

  it('gives the rectangle SDF in metres (negative inside)', () => {
    const [f] = new FlatFeatureSet([runway], R).features;
    expect(flatFeatureSignedDistanceM(f, at(0, 0), R)).toBeCloseTo(-22.5, 2);
    expect(flatFeatureSignedDistanceM(f, at(0, 30), R)).toBeCloseTo(7.5, 2);
    expect(flatFeatureSignedDistanceM(f, at(1010, 0), R)).toBeCloseTo(10, 2);
    // Corner: Euclidean distance to the corner.
    expect(flatFeatureSignedDistanceM(f, at(1003, 26.5), R)).toBeCloseTo(5, 2);
  });

  it('gives a round-ended capsule SDF for a segment, exact across its great circle', () => {
    const start = at(-500, 0);
    const end = at(500, 0);
    const [f] = new FlatFeatureSet([{ kind: 'segment', start, end, widthM: 10 }], R).features;
    expect(flatFeatureSignedDistanceM(f, start, R)).toBeCloseTo(-5, 3);
    expect(flatFeatureSignedDistanceM(f, end, R)).toBeCloseTo(-5, 3);
    expect(flatFeatureSignedDistanceM(f, at(0, 12), R)).toBeCloseTo(7, 2);
    // Round end: 8 m beyond the end on the axis is 3 m outside, and so is 8 m away diagonally.
    expect(flatFeatureSignedDistanceM(f, at(508, 0), R)).toBeCloseTo(3, 1);
    expect(flatFeatureSignedDistanceM(f, at(500 + 8 * Math.SQRT1_2, 8 * Math.SQRT1_2), R)).toBeCloseTo(3, 1);
  });

  it('never reports a feature on the far hemisphere (no antipodal ghost)', () => {
    const [f] = new FlatFeatureSet([runway], R).features;
    expect(flatFeatureSignedDistanceM(f, [0, 0, -1], R)).toBe(Infinity);
  });

  it('rejects degenerate and over-long segments', () => {
    expect(() => new FlatFeatureSet([{ kind: 'segment', start: centre, end: centre, widthM: 5 }], R)).toThrowError(/no length/);
    expect(() => new FlatFeatureSet([{ kind: 'segment', start: [0, 0, 1], end: [1, 0, 0], widthM: 5 }], R)).toThrowError(/45 degrees/);
  });
});

describe('flat features: height stamp', () => {
  const set = new FlatFeatureSet([runway], R);

  it('flattens to the feature height on the feature and its apron', () => {
    expect(set.stampElevation(at(300, 5), 480)).toBeCloseTo(100, 6);
    expect(set.stampElevation(at(1000 + 119, 0), 480)).toBeCloseTo(100, 6);
  });

  it('leaves terrain beyond the shoulder untouched', () => {
    expect(set.stampElevation(at(1000 + 120 + 1400 + 10, 0), 321)).toBe(321);
    expect(set.stampElevation([0, 0, -1], 321)).toBe(321);
  });

  it('falls monotonically and continuously over the shoulder', () => {
    let previous = 100;
    for (let m = 0; m <= 1400; m += 20) {
      const h = set.stampElevation(at(1000 + 120 + m, 0), 500);
      expect(h).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(h - previous).toBeLessThan(0.08 * 400);
      previous = h;
    }
    expect(previous).toBeCloseTo(500, 6);
  });

  it('interpolates a segment height between its ends', () => {
    const road = new FlatFeatureSet([{ kind: 'segment', start: at(-1000, 0), end: at(1000, 0), widthM: 8, heightM: [50, 150] }], R);
    expect(road.stampElevation(at(-1000, 0), 0)).toBeCloseTo(50, 3);
    expect(road.stampElevation(at(0, 2), 0)).toBeCloseTo(100, 3);
    expect(road.stampElevation(at(500, 0), 0)).toBeCloseTo(125, 3);
  });

  it('paints without flattening when a feature has no height', () => {
    const paintOnly = new FlatFeatureSet([{ ...runway, heightM: undefined }], R);
    expect(paintOnly.stampElevation(at(0, 0), 480)).toBe(480);
  });

  it('is a modifyElevation hook that depends only on the direction', () => {
    const hook = set.heightStamp();
    expect(hook(at(10, 0), 480, R)).toBe(set.stampElevation(at(10, 0), 480));
  });
});

describe('flat features: crossing priority', () => {
  // A road at 140 m crosses the runway (100 m) at right angles through its centre.
  const road = (priority: number): FlatFeature => ({
    kind: 'segment',
    id: 'road',
    start: at(0, -3000),
    end: at(0, 3000),
    widthM: 8,
    heightM: 140,
    apronM: 8,
    shoulderM: 80,
    priority,
    markings: 'road',
  });

  it('holds the higher priority height where features cross, whatever the list order', () => {
    for (const features of [[runway, road(1)], [road(1), runway]]) {
      const set = new FlatFeatureSet(features, R);
      expect(set.stampElevation(at(0, 0), 300)).toBeCloseTo(100, 6);
      // Out on the road, beyond the runway's plateau and shoulder, the road holds its own height.
      expect(set.stampElevation(at(0, 2000), 300)).toBeCloseTo(140, 6);
    }
  });

  it('lets a higher priority road win over the runway', () => {
    const set = new FlatFeatureSet([runway, road(20)], R);
    expect(set.stampElevation(at(0, 0), 300)).toBeCloseTo(140, 6);
    expect(set.stampElevation(at(500, 0), 300)).toBeCloseTo(100, 6);
  });

  it('stays continuous across the crossing', () => {
    const set = new FlatFeatureSet([runway, road(1)], R);
    // Steepest legitimate step: the road shoulder, 1.5 / 80 m of a 160 m height difference per metre.
    let previous = set.stampElevation(at(0, 3500), 300);
    for (let b = 3500; b >= -3500; b -= 1) {
      const h = set.stampElevation(at(0, b), 300);
      expect(Math.abs(h - previous)).toBeLessThan(3.1);
      previous = h;
    }
  });
});

describe('flat features: clearance query', () => {
  const set = new FlatFeatureSet([{ ...runway, clearanceM: 60 }], R);

  it('reports points on the feature and within its clearance', () => {
    expect(set.isInClearance(at(0, 0))).toBeTrue();
    expect(set.isInClearance(at(0, 22.5 + 59))).toBeTrue();
    expect(set.isInClearance(at(0, 22.5 + 61))).toBeFalse();
  });

  it('adds a footprint margin', () => {
    expect(set.isInClearance(at(0, 22.5 + 61), 5)).toBeTrue();
  });

  it('defaults clearance to the apron and returns the nearest feature', () => {
    const plain = new FlatFeatureSet([runway], R);
    expect(plain.isInClearance(at(0, 22.5 + 119))).toBeTrue();
    expect(plain.isInClearance(at(0, 22.5 + 121))).toBeFalse();
    expect(plain.nearest(at(0, 30))?.feature.source.id).toBe('runway');
    expect(plain.nearest([0, 0, -1])).toBeNull();
  });
});

describe('flat features: page selection', () => {
  /** Grid page holding a direction at a level. */
  const pageOf = (d: FlatFeatureVec3, level: number) => {
    const lon = Math.atan2(d[0], d[2]);
    const lat = Math.asin(d[1]);
    return flatFeaturePageBounds(
      level,
      Math.floor(((lon + Math.PI) / (2 * Math.PI)) * 2 ** (level + 1)),
      Math.floor(((lat + Math.PI / 2) / Math.PI) * 2 ** level),
    );
  };

  it('bounds every point of a page inside its cap', () => {
    for (const [level, x, y] of [[3, 5, 7], [10, 100, 1000], [6, 0, 0], [4, 31, 8]]) {
      const page = flatFeaturePageBounds(level, x, y);
      const columns = 2 ** (level + 1);
      const rows = 2 ** level;
      for (let i = 0; i <= 4; i += 1) {
        for (let j = 0; j <= 4; j += 1) {
          const lon = -Math.PI + ((x + i / 4) / columns) * 2 * Math.PI;
          const lat = -Math.PI / 2 + ((y + j / 4) / rows) * Math.PI;
          const d: FlatFeatureVec3 = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
          expect(Math.acos(Math.min(1, dot(d, page.centre)))).toBeLessThanOrEqual(page.radiusRad);
        }
      }
    }
  });

  it('selects the features overlapping a page and none from far away or the antipode', () => {
    const far: FlatFeature = { ...runway, id: 'far', centre: flatFeatureOffset(centre, frame, 50_000, 0, R) };
    const antipode: FlatFeature = { ...runway, id: 'antipode', centre: [0, 0, -1] };
    const set = new FlatFeatureSet([runway, far, antipode], R);
    const level = 11; // ~920 m pages at this radius
    const hit = set.selectForPage(pageOf(at(900, 0), level), 8);
    expect(hit.indices).toEqual([0]);
    const empty = set.selectForPage(pageOf(at(0, 2000), level), 8);
    expect(empty.indices).toEqual([]);
  });

  it('catches a feature that only clips the page edge (conservative)', () => {
    const level = 11;
    const page = pageOf(at(0, 0), level);
    // Every direction the shader can put in this page must find the runway listed if the runway covers it.
    const set = new FlatFeatureSet([runway], R);
    for (let a = -1000; a <= 1000; a += 50) {
      for (const b of [-22, 0, 22]) {
        const p = pageOf(at(a, b), level);
        expect(set.selectForPage(p, 8).indices).toContain(0);
      }
    }
    expect(page.level).toBe(level);
  });

  it('keeps the highest priorities when the list is full, and counts the rest', () => {
    const page = flatFeaturePageBounds(10, 700, 300);
    const pageFrame = flatFeatureFrame(page.centre, 0);
    const near = (a: number, b: number) => flatFeatureOffset(page.centre, pageFrame, a, b, R);
    const many: FlatFeature[] = Array.from({ length: 12 }, (_, i) => ({
      kind: 'segment',
      id: `road${i}`,
      start: near(-400, -100 + i * 15),
      end: near(400, -100 + i * 15),
      widthM: 6,
      priority: i,
    }));
    const set = new FlatFeatureSet(many, R);
    const selection = set.selectForPage(page, 8);
    expect(selection.indices.length).toBe(8);
    expect(selection.dropped).toBe(4);
    expect(selection.indices).toEqual([11, 10, 9, 8, 7, 6, 5, 4]);
  });
});

describe('flat features: height continuity across terrain LODs (CPU, mesh pipeline)', () => {
  const radiusM = 100_000;

  /** Directions and radii of every vertex of a patch built with the stamp. */
  async function patch(address: ILatLonTerrainPatchAddress, set: FlatFeatureSet, cache: CellPlanetWorldCache) {
    const { response } = await handleCellPlanetMeshWorkerRequest(
      { id: 1, address, resolution: 16, radiusM, heightScaleM: 160, worldProfile: 'terran', seed: 3 },
      cache,
      { modifyElevation: set.heightStamp() },
    );
    const pos = (response.patch!.surface.attributes as any)['aSpherePos'] as Float32Array;
    const out: { dir: FlatFeatureVec3; r: number }[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const r = Math.hypot(pos[i], pos[i + 1], pos[i + 2]);
      out.push({ dir: [pos[i] / r, pos[i + 1] / r, pos[i + 2] / r], r });
    }
    return out;
  }

  it('gives a parent patch and its children the same height at shared directions, and the plateau height on it', async () => {
    const cache = new CellPlanetWorldCache({ defaultCellCount: 60, defaultRelaxationIterations: 1 });
    const empty = new FlatFeatureSet([], radiusM);
    const probe = await patch({ level: 0, x: 1, y: 0 }, empty, cache);
    // Put a big rectangle (sized for this small radius) on the parent's middle vertex.
    const site = probe[Math.floor(probe.length / 2)].dir;
    const set = new FlatFeatureSet(
      [{ kind: 'rectangle', centre: site, headingRad: 0.3, lengthM: 30_000, widthM: 8_000, heightM: 250, apronM: 6_000, shoulderM: 20_000 }],
      radiusM,
    );
    const parent = await patch({ level: 0, x: 1, y: 0 }, set, cache);
    const children = (
      await Promise.all([0, 1].flatMap((x) => [0, 1].map((y) => patch({ level: 1, x: 2 + x, y }, set, cache))))
    ).flat();

    let shared = 0;
    let onPlateau = 0;
    for (const v of children) {
      const match = parent.find((p) => dot(p.dir, v.dir) > 1 - 1e-12);
      if (match) {
        shared += 1;
        expect(Math.abs(match.r - v.r)).toBeLessThan(0.05);
      }
      if (flatFeatureSignedDistanceM(set.features[0], v.dir, radiusM) < 6_000) {
        onPlateau += 1;
        expect(Math.abs(v.r - (radiusM + 250))).toBeLessThan(0.05);
      }
    }
    expect(shared).toBeGreaterThan(100);
    expect(onPlateau).toBeGreaterThan(4);
  });
});
