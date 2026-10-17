import { DataUtils, Vector3 } from 'three';
import { referenceOpticalDepth, type CloudAnalyticShape } from './cloud-volume-reference';
import { CloudVolume } from './cloud-volume';
import { getCloudTestRenderer } from './gpu-renderer.testing';

/** Reads a half-float atlas back as numbers, one per texel, whatever the channel count. */
async function readAtlas(renderer: any, volume: CloudVolume, which: 'light' | 'density'): Promise<(x: number, y: number, z: number) => number> {
  const target = which === 'light' ? volume.lightTarget : volume.densityTarget;
  const layout = which === 'light' ? volume.lightLayout : volume.densityLayout;
  const raw = await renderer.readRenderTargetPixelsAsync(target, 0, 0, layout.width, layout.height);
  const channels = raw.length / (layout.width * layout.height);
  const toNumber = raw instanceof Uint16Array ? (v: number) => DataUtils.fromHalfFloat(v) : (v: number) => v;
  // GL readback rows run bottom-up, so atlas row 0 is the last row of the array.
  return (x, y, z) => {
    const px = layout.pixelOf(x, y, z);
    return toNumber(raw[((layout.height - 1 - px.y) * layout.width + px.x) * channels]);
  };
}

describe('CloudVolume bakes (WebGL2 backend)', () => {
  const size = new Vector3(200, 100, 200);
  const sunLocal = new Vector3(0.6, 0.8, 0).normalize();

  async function bakedLight(shape: CloudAnalyticShape): Promise<{ read: (x: number, y: number, z: number) => number; volume: CloudVolume }> {
    const renderer = await getCloudTestRenderer();
    const volume = new CloudVolume({ size, shape, densitySize: 32, extinction: 0.02, lightSteps: 32 });
    volume.setSunDirection(sunLocal.x, sunLocal.y, sunLocal.z);
    volume.update(renderer);
    return { read: await readAtlas(renderer, volume, 'light'), volume };
  }

  function expectMatchesReference(shape: CloudAnalyticShape, read: (x: number, y: number, z: number) => number, tolerance: number): void {
    const n = 16;
    let worst = 0;
    for (const [x, y, z] of [
      [2, 2, 2],
      [8, 8, 8],
      [13, 3, 9],
      [4, 12, 6],
      [8, 1, 8],
    ]) {
      const p = [(x + 0.5) / n, (y + 0.5) / n, (z + 0.5) / n] as const;
      const expected = referenceOpticalDepth(shape, p, [sunLocal.x, sunLocal.y, sunLocal.z], [size.x, size.y, size.z], 0.02);
      const actual = read(x, y, z);
      worst = Math.max(worst, Math.abs(actual - expected) / Math.max(expected, 0.05));
    }
    expect(worst).toBeLessThan(tolerance);
  }

  it('uniform box: baked optical depth matches the analytic value', async () => {
    const { read, volume } = await bakedLight('box');
    expectMatchesReference('box', read, 0.02);
    volume.dispose();
  });

  it('Gaussian blob: baked optical depth matches the CPU integral', async () => {
    const { read, volume } = await bakedLight('blob');
    expectMatchesReference('blob', read, 0.08);
    volume.dispose();
  });

  it('rebakes light only when the sun turns past the tolerance, density only when invalidated', async () => {
    const renderer = await getCloudTestRenderer();
    const volume = new CloudVolume({ size, shape: 'box', densitySize: 16, sunToleranceDeg: 0.5 });
    volume.setSunDirection(0, 1, 0);
    volume.update(renderer);
    volume.update(renderer);
    volume.update(renderer);
    expect([volume.densityBakes, volume.lightBakes]).toEqual([1, 1]);

    const tilt = (deg: number) => volume.setSunDirection(Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180), 0);
    tilt(0.2);
    volume.update(renderer);
    expect(volume.lightBakes).toBe(1);
    tilt(5);
    volume.update(renderer);
    expect([volume.densityBakes, volume.lightBakes]).toEqual([1, 2]);
    volume.update(renderer);
    expect(volume.lightBakes).toBe(2);

    volume.invalidateDensity();
    volume.update(renderer);
    expect([volume.densityBakes, volume.lightBakes]).toEqual([2, 3]);
    volume.dispose();
  });

  it('noise density bakes to values in [0, 1] with some empty and some filled texels', async () => {
    const renderer = await getCloudTestRenderer();
    const volume = new CloudVolume({ size, shape: 'noise', densitySize: 32 });
    volume.update(renderer);
    const read = await readAtlas(renderer, volume, 'density');
    let min = Infinity;
    let max = -Infinity;
    for (let z = 0; z < 32; z += 3) for (let y = 0; y < 32; y += 3) for (let x = 0; x < 32; x += 3) {
      const v = read(x, y, z);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBe(0);
    expect(max).toBeGreaterThan(0.3);
    expect(max).toBeLessThanOrEqual(1.001);
    volume.dispose();
  });
});
