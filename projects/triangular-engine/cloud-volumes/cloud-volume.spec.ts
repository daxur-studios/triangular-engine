import { DataUtils, Vector3 } from 'three';
import { referenceOpticalDepth, type CloudAnalyticShape } from './cloud-volume-reference';
import { CloudVolume } from './cloud-volume';
import { CloudVolumeBakeScheduler } from './cloud-volume-bake-scheduler';
import { CloudVolumeAtmosphereLighting, type CloudAtmosphereSource } from './cloud-volume-atmosphere-lighting';
import { getCloudTestRenderer } from './gpu-renderer.testing';

/** Reads a half-float atlas back as numbers, one per texel, whatever the channel count. */
async function readAtlas(renderer: any, volume: CloudVolume, which: 'light' | 'density'): Promise<(x: number, y: number, z: number) => number> {
  const target = which === 'light' ? volume.lightTarget : volume.densityTarget;
  const layout = which === 'light' ? volume.lightLayout : volume.densityLayout;
  const raw = await renderer.readRenderTargetPixelsAsync(target, 0, 0, layout.width, layout.height);
  const channels = raw.length / (layout.width * layout.height);
  const toNumber =
    raw instanceof Uint16Array ? (v: number) => DataUtils.fromHalfFloat(v) : raw instanceof Uint8Array ? (v: number) => v / 255 : (v: number) => v;
  // GL readback rows run bottom-up, so atlas row 0 is the last row of the array.
  return (x, y, z) => {
    const px = layout.pixelOf(x, y, z);
    return toNumber(raw[((layout.height - 1 - px.y) * layout.width + px.x) * channels + layout.slotOf(z).channel]);
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

  it('a banded bake spread over steps matches the one-shot bake', async () => {
    const renderer = await getCloudTestRenderer();
    const whole = new CloudVolume({ size, shape: 'blob', densitySize: 32, extinction: 0.02, lightSteps: 16 });
    whole.bakeBands = 1;
    const banded = new CloudVolume({ size, shape: 'blob', densitySize: 32, extinction: 0.02, lightSteps: 16 });
    banded.bakeBands = 4;
    for (const v of [whole, banded]) v.setSunDirection(sunLocal.x, sunLocal.y, sunLocal.z);
    whole.update(renderer);
    banded.prepare();
    let steps = 0;
    while (banded.bakeStep(renderer)) steps++;
    expect(steps).toBeGreaterThan(4);
    const a = await readAtlas(renderer, whole, 'light');
    const b = await readAtlas(renderer, banded, 'light');
    for (const [x, y, z] of [[2, 2, 2], [8, 8, 8], [13, 3, 9], [4, 12, 6]]) expect(b(x, y, z)).toBeCloseTo(a(x, y, z), 3);
    whole.dispose();
    banded.dispose();
  });

  it('the scheduler spends its band budget round-robin and finishes every volume', async () => {
    const renderer = await getCloudTestRenderer();
    const volumes = [0, 1, 2].map(() => new CloudVolume({ size, shape: 'box', densitySize: 16 }));
    for (const v of volumes) v.bakeBands = 2;
    const scheduler = new CloudVolumeBakeScheduler();
    scheduler.bandsPerFrame = 2;
    expect(scheduler.update(renderer, volumes)).toBe(2);
    expect(volumes.map((v) => v.hasPendingBake)).toEqual([true, true, true]);
    let frames = 1;
    while (volumes.some((v) => v.hasPendingBake) && frames < 40) {
      scheduler.update(renderer, volumes);
      frames++;
    }
    expect(volumes.map((v) => [v.densityBakes, v.lightBakes])).toEqual([[1, 1], [1, 1], [1, 1]]);
    expect(scheduler.update(renderer, volumes)).toBe(0);
    for (const v of volumes) v.dispose();
  });
});

describe('CloudVolumeAtmosphereLighting', () => {
  // A flat fake atmosphere: sun transmittance falls to orange near the horizon and 0 below it, sky light follows the sun.
  const source: CloudAtmosphereSource = {
    planetRadiusM: 1000,
    sunTransmittance: (point, sun) => {
      const r = Math.hypot(...point);
      const mu = (point[0] * sun[0] + point[1] * sun[1] + point[2] * sun[2]) / r;
      if (mu < -0.1) return [0, 0, 0];
      const t = Math.max(0, Math.min(1, mu * 4));
      return [1, 0.5 + 0.5 * t, 0.2 + 0.8 * t];
    },
    skyIrradiance: (_alt, mu) => [0.1 * Math.max(0, mu + 0.2), 0.1 * Math.max(0, mu + 0.2), 0.2 * Math.max(0, mu + 0.2)],
  };

  function lit(sunY: number): CloudVolume {
    const volume = new CloudVolume({ size: new Vector3(100, 50, 100) });
    volume.mesh.position.set(0, 1250, 0);
    volume.mesh.updateMatrixWorld();
    new CloudVolumeAtmosphereLighting(source).update([volume], new Vector3(Math.sqrt(1 - sunY * sunY), sunY, 0));
    return volume;
  }

  it('is white-ish overhead, orange near the horizon and black on the night side', () => {
    const noon = lit(1).uSunColor.value;
    const dusk = lit(0.05).uSunColor.value;
    const night = lit(-0.9).uSunColor.value;
    expect(noon.toArray()).toEqual([1, 1, 1]);
    expect(dusk.x).toBeGreaterThan(dusk.z * 1.5);
    expect(night.toArray()).toEqual([0, 0, 0]);
  });

  it('fades the sun out below the horizon instead of snapping to black', () => {
    // Like the real atmosphere: lit down to the planet's horizon seen from the volume, exactly 0 beyond it.
    const horizon: CloudAtmosphereSource = {
      ...source,
      sunTransmittance: (point, sun) => {
        const r = Math.hypot(...point);
        const mu = (point[0] * sun[0] + point[1] * sun[1] + point[2] * sun[2]) / r;
        return mu < -Math.sqrt(1 - (1000 / r) ** 2) ? [0, 0, 0] : [1, 0.4, 0.1];
      },
    };
    const sunColor = (mu: number): number => {
      const volume = new CloudVolume({ size: new Vector3(100, 50, 100) });
      volume.mesh.position.set(0, 1250, 0);
      volume.mesh.updateMatrixWorld();
      new CloudVolumeAtmosphereLighting(horizon).update([volume], new Vector3(Math.sqrt(1 - mu * mu), mu, 0));
      return volume.uSunColor.value.x;
    };
    let previous = sunColor(0);
    for (let mu = -0.01; mu >= -0.9; mu -= 0.01) {
      const now = sunColor(mu);
      expect(Math.abs(now - previous)).toBeLessThan(0.25);
      previous = now;
    }
    expect(previous).toBe(0);
  });

  it('dims the ambient on the night side', () => {
    expect(lit(-0.9).uAmbient.value.length()).toBe(0);
    expect(lit(1).uAmbient.value.length()).toBeGreaterThan(0.1);
  });
});
