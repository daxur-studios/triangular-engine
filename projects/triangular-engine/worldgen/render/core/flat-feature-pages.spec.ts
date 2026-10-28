import { FlatFeaturePageWindow } from './flat-feature-pages';
import { FlatFeatureSet, flatFeatureFrame, flatFeatureOffset, type FlatFeature, type FlatFeatureVec3 } from './flat-features';

const R = 600_000;
const site: FlatFeatureVec3 = flatFeatureOffset([0, 0, 1], flatFeatureFrame([0, 0, 1], 0), 3_300, 2_100, R); // off the page corners at lat 0, lon 0
const frame = flatFeatureFrame(site, 0.4);
const at = (a: number, b: number) => flatFeatureOffset(site, frame, a, b, R);

const features: FlatFeature[] = [
  { kind: 'rectangle', id: 'runway', centre: site, headingRad: 0.4, lengthM: 2000, widthM: 45, priority: 10, markings: 'runway' },
  { kind: 'segment', id: 'road', start: at(0, -3000), end: at(0, 3000), widthM: 8, markings: 'road', surface: 'concrete' },
];

/** Grid column and row of a direction at the window's current level. */
function cell(window: FlatFeaturePageWindow, d: FlatFeatureVec3): [number, number] {
  const lon = Math.atan2(d[0], d[2]);
  const lat = Math.asin(d[1]);
  return [Math.floor(((lon + Math.PI) / (2 * Math.PI)) * window.columns), Math.floor(((lat + Math.PI / 2) / Math.PI) * window.rows)];
}

describe('FlatFeaturePageWindow', () => {
  it('packs the feature table: frame, half sizes and codes per column', () => {
    const set = new FlatFeatureSet(features, R);
    const window = new FlatFeaturePageWindow(set, { capacity: 16 });
    const data = window.featureTexture.image.data as Float32Array;
    const stride = 16 * 4;
    const road = set.features[1];
    expect(Array.from(data.slice(4, 8))).toEqual(Array.from(new Float32Array([...road.along, road.halfLengthM])));
    expect(data[stride + 4 + 3]).toBeCloseTo(4, 5);
    expect(Array.from(data.slice(2 * stride, 2 * stride + 4))).toEqual([0, 1, 10, 0]); // box, runway, priority, asphalt
    expect(Array.from(data.slice(2 * stride + 4, 2 * stride + 8))).toEqual([1, 3, 0, 1]); // capsule, road, priority, concrete
    window.dispose();
  });

  it('picks finer pages lower down and lists the features under the camera', () => {
    const window = new FlatFeaturePageWindow(new FlatFeatureSet(features, R));
    expect(window.enabled).toBe(0);
    window.update(site, 300);
    expect(window.enabled).toBe(1);
    const fine = window.level;
    expect(Math.PI * R / window.rows).toBeGreaterThanOrEqual(400);
    const [x, y] = cell(window, at(0, 0));
    expect(window.pageList(x, y)).toEqual([0, 1]); // the runway (priority 10) first
    const [rx, ry] = cell(window, at(0, 2500));
    expect(window.pageList(rx, ry)).toEqual([1]);

    window.update(site, 10_000);
    expect(window.level).toBeLessThan(fine);
    expect(Math.PI * R / window.rows).toBeGreaterThanOrEqual(15_000);
    window.dispose();
  });

  it('writes each page list into the page texture as featureIndex + 1', () => {
    const window = new FlatFeaturePageWindow(new FlatFeatureSet(features, R), { windowPages: 16, maxPerPage: 8 });
    window.update(site, 300);
    const [x, y] = cell(window, at(0, 0));
    const column = (y - window.originY) * 16 + ((x - window.originX + window.columns) % window.columns);
    const data = window.pageTexture.image.data as Float32Array;
    const width = 16 * 16;
    expect(Array.from(data.slice(column * 4, column * 4 + 4))).toEqual([1, 2, 0, 0]);
    expect(Array.from(data.slice((width + column) * 4, (width + column) * 4 + 4))).toEqual([0, 0, 0, 0]);
    window.dispose();
  });

  it('streams: only pages new to the window select, and small moves keep the window', () => {
    const window = new FlatFeaturePageWindow(new FlatFeatureSet(features, R), { windowPages: 16 });
    window.update(site, 300);
    const first = window.stats.pagesSelected;
    expect(first).toBe(16 * 16);
    expect(window.update(at(200, 0), 300)).toBeFalse();
    expect(window.stats.pagesSelected).toBe(first);
    // Moving several pages re-centres; pages still in the window keep their lists.
    const pageM = Math.PI * R / window.rows;
    expect(window.update(flatFeatureOffset(site, flatFeatureFrame(site, 0), pageM * 4, 0, R), 300)).toBeTrue();
    const added = window.stats.pagesSelected - first;
    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThan(16 * 16);
    window.dispose();
  });

  it('wraps columns across the antimeridian', () => {
    const east: FlatFeatureVec3 = [Math.sin(Math.PI - 1e-4), 0.01, Math.cos(Math.PI - 1e-4)];
    const set = new FlatFeatureSet([{ kind: 'rectangle', centre: east, headingRad: 0, lengthM: 3000, widthM: 60 }], R);
    const window = new FlatFeaturePageWindow(set, { windowPages: 16 });
    window.update(east, 300);
    expect(window.originX + 16).toBeGreaterThan(window.columns); // the window spans the seam
    const west: FlatFeatureVec3 = [Math.sin(-Math.PI + 1e-4), 0.01, Math.cos(-Math.PI + 1e-4)];
    const [x, y] = cell(window, west);
    expect(x).toBeLessThan(4);
    expect(window.pageList(x, y)).toEqual([0]);
    window.dispose();
  });

  it('refuses more features than its capacity and clears with null', () => {
    const set = new FlatFeatureSet(features, R);
    expect(() => new FlatFeaturePageWindow(set, { capacity: 1 })).toThrowError(/capacity/);
    const window = new FlatFeaturePageWindow(set);
    window.update(site, 300);
    window.setFeatures(null);
    expect(window.enabled).toBe(0);
    expect(window.stats.pagesWithFeatures).toBe(0);
    window.dispose();
  });
});
