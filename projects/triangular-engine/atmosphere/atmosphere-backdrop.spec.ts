import { PerspectiveCamera, Vector2 } from 'three';
import { getEvalRenderer } from '../planet-material/gpu-eval.testing';
import { AtmosphereBackdrop } from './atmosphere-backdrop';
import { AtmosphereGpuModel } from './atmosphere-gpu-model';
import { AtmosphereSkyViewLut } from './atmosphere-sky-view';
import { earthAtmosphereProfile } from './atmosphere-presets';

const SMALL = {
  transmittanceSize: [128, 32],
  multiScatterSize: [32, 16],
  irradianceSize: [32, 8],
  multiScatterDirections: 24,
  irradianceDirections: 16,
} as const;

describe('AtmosphereBackdrop reduced-resolution space pass', () => {
  it('renders only above the atmosphere, at the requested fraction of the drawing buffer', async () => {
    const renderer = await getEvalRenderer();
    const model = new AtmosphereGpuModel(earthAtmosphereProfile(), SMALL);
    const skyView = new AtmosphereSkyViewLut(model, { width: 32, height: 16, steps: 8 });
    const backdrop = new AtmosphereBackdrop(model, { skyView, steps: 8, spaceScale: 0.5 });
    const camera = new PerspectiveCamera(75, 1, 0.1, 100);

    backdrop.setAltitude(2);
    backdrop.update(renderer, camera);
    expect(backdrop.spaceRenderCount).toBe(0);

    backdrop.setAltitude(model.uTopAltitude.value * 3);
    backdrop.update(renderer, camera);
    expect(backdrop.spaceRenderCount).toBe(1);
    const size = renderer.getDrawingBufferSize(new Vector2());
    expect(backdrop.spaceSize.x).toBe(Math.max(8, Math.round(size.x * 0.5)));
    expect(backdrop.spaceSize.y).toBe(Math.max(8, Math.round(size.y * 0.5)));

    backdrop.spaceLowResEnabled.value = 0;
    backdrop.update(renderer, camera);
    expect(backdrop.spaceRenderCount).toBe(1);

    backdrop.spaceLowResEnabled.value = 1;
    backdrop.update(renderer);
    expect(backdrop.spaceRenderCount).toBe(1);

    backdrop.dispose();
    skyView.dispose();
    model.dispose();
  });

  it('skips the render while nothing it depends on changed', async () => {
    const renderer = await getEvalRenderer();
    const model = new AtmosphereGpuModel(earthAtmosphereProfile(), SMALL);
    const backdrop = new AtmosphereBackdrop(model, { steps: 8, spaceScale: 0.5 });
    const camera = new PerspectiveCamera(75, 1, 0.1, 100);
    backdrop.setAltitude(model.uTopAltitude.value * 3);

    backdrop.update(renderer, camera);
    backdrop.update(renderer, camera);
    backdrop.update(renderer, camera);
    expect(backdrop.spaceRenderCount).toBe(1);

    camera.position.set(0, 1, 5);
    camera.lookAt(0, 0, 0);
    backdrop.update(renderer, camera);
    expect(backdrop.spaceRenderCount).toBe(2);
    backdrop.update(renderer, camera);
    expect(backdrop.spaceRenderCount).toBe(2);

    camera.fov = 50;
    camera.updateProjectionMatrix();
    backdrop.update(renderer, camera);
    expect(backdrop.spaceRenderCount).toBe(3);

    backdrop.setAltitude(model.uTopAltitude.value * 4);
    backdrop.update(renderer, camera);
    expect(backdrop.spaceRenderCount).toBe(4);

    model.setSunDirection(0.6, 0.8, 0);
    backdrop.update(renderer, camera);
    expect(backdrop.spaceRenderCount).toBe(5);

    model.setProfile(earthAtmosphereProfile());
    backdrop.update(renderer, camera);
    expect(backdrop.spaceRenderCount).toBe(6);
    backdrop.update(renderer, camera);
    expect(backdrop.spaceRenderCount).toBe(6);

    backdrop.dispose();
    model.dispose();
  });
});
