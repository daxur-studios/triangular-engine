import { Color, FloatType, NearestFilter, PerspectiveCamera, RGBAFormat, RenderTarget, Scene, Vector3 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { getEvalRenderer } from '../planet-material/gpu-eval.testing';
import { AtmosphereBackdrop } from './atmosphere-backdrop';
import { AtmosphereGpuModel } from './atmosphere-gpu-model';
import { earthAtmosphereProfile } from './atmosphere-presets';
import { AtmosphereSkyBody } from './atmosphere-sky-body';
import { AtmosphereSkyViewLut } from './atmosphere-sky-view';

const SMALL = {
  transmittanceSize: [128, 32],
  multiScatterSize: [32, 16],
  irradianceSize: [32, 8],
  multiScatterDirections: 24,
  irradianceDirections: 16,
} as const;

const SIZE = 32;

/** Renders the scene looking along `dir` with a 2 degree view and returns the centre pixel and a corner pixel. */
async function look(
  renderer: WebGPURenderer,
  scene: Scene,
  backdrop: AtmosphereBackdrop,
  dir: Vector3,
): Promise<{ centre: number[]; corner: number[] }> {
  const camera = new PerspectiveCamera(2, 1, 0.1, 100);
  camera.up.set(0, 0, 1);
  camera.lookAt(dir);
  camera.updateMatrixWorld();
  backdrop.update(renderer, camera);
  const target = new RenderTarget(SIZE, SIZE, {
    type: FloatType,
    format: RGBAFormat,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
  });
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(previous);
  const pixels = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)) as Float32Array;
  target.dispose();
  const at = (x: number, y: number) => Array.from(pixels.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3));
  return { centre: at(SIZE / 2, SIZE / 2), corner: at(1, 1) };
}

describe('AtmosphereSkyBody', () => {
  let renderer: WebGPURenderer;
  let model: AtmosphereGpuModel;
  let skyView: AtmosphereSkyViewLut;
  let backdrop: AtmosphereBackdrop;
  let body: AtmosphereSkyBody;
  let scene: Scene;

  beforeAll(async () => {
    renderer = await getEvalRenderer();
    model = new AtmosphereGpuModel(earthAtmosphereProfile(), SMALL);
    skyView = new AtmosphereSkyViewLut(model, { width: 64, height: 32, steps: 16 });
    backdrop = new AtmosphereBackdrop(model, { skyView, steps: 16, spaceScale: 0 });
    backdrop.setAltitude(2);
    backdrop.groundEnabled.value = 0;
    model.setSunDirection(0, 0.5, Math.sqrt(0.75));
    // Half the 2 degree view across, so the centre pixel is well inside and the corner well outside the disc.
    body = new AtmosphereSkyBody(backdrop, { angularRadiusDeg: 0.5, albedo: new Color(0.5, 0.5, 0.5) });
    scene = new Scene();
    scene.add(backdrop.mesh, body.mesh);
  });

  afterAll(() => {
    body.dispose();
    backdrop.dispose();
    skyView.dispose();
    model.dispose();
  });

  it('shows its sunlit face through the air and the sky alone at new moon', async () => {
    const up = new Vector3(0, 1, 0);
    body.setDirections(up, up.clone().negate());
    const full = await look(renderer, scene, backdrop, up);
    body.setDirections(up, up);
    const fresh = await look(renderer, scene, backdrop, up);
    body.mesh.visible = false;
    const sky = await look(renderer, scene, backdrop, up);
    body.mesh.visible = true;

    for (let c = 0; c < 3; c++) {
      // Unlit, the disc is the air in front of it: the sky's own colour.
      expect(fresh.centre[c]).toBeCloseTo(sky.centre[c], 3);
      // Off the disc the sky shows untouched.
      expect(full.corner[c]).toBeCloseTo(sky.corner[c], 4);
    }
    // Lit full face: albedo / pi of the sun, times exposure, times the zenith transmittance (most of it, at 2 m).
    const albedo = 0.5;
    const sunIrradiance = model.uSunIrradiance.value as unknown as Vector3;
    const reflected = full.centre[1] - fresh.centre[1];
    const unattenuated = ((albedo / Math.PI) * backdrop.exposure.value * sunIrradiance.y);
    expect(reflected / unattenuated).toBeGreaterThan(0.75);
    expect(reflected / unattenuated).toBeLessThan(1);
  }, 30_000);

  it('dims and reddens toward the horizon', async () => {
    const up = new Vector3(0, 1, 0);
    const low = new Vector3(0, Math.sin((2 * Math.PI) / 180), Math.cos((2 * Math.PI) / 180));
    const behind = new Vector3(0, 0, 0);
    const reflectedAt = async (dir: Vector3) => {
      body.setDirections(dir, behind.copy(dir).negate());
      const full = await look(renderer, scene, backdrop, dir);
      body.setDirections(dir, dir);
      const fresh = await look(renderer, scene, backdrop, dir);
      return full.centre.map((v, c) => v - fresh.centre[c]);
    };
    const high = await reflectedAt(up);
    const near = await reflectedAt(low);
    expect(near[1]).toBeLessThan(high[1] * 0.6);
    // Blue is lost faster than red along the long path.
    expect(near[2] / near[0]).toBeLessThan(high[2] / high[0]);
  }, 30_000);
});
