import { CustomBlending, OneMinusSrcAlphaFactor, PerspectiveCamera, Vector2, Vector3 } from 'three';
import { getEvalRenderer } from '../planet-material/gpu-eval.testing';
import { AtmosphereBackdrop } from './atmosphere-backdrop';
import { DEFAULT_MIN_ANGULAR_RADIUS, screenRectCoverage } from './atmosphere-backdrop-bounds';
import { AtmosphereGpuModel } from './atmosphere-gpu-model';
import { AtmosphereSkyViewLut } from './atmosphere-sky-view';
import { earthAtmosphereProfile } from './atmosphere-presets';

/* eslint-disable @typescript-eslint/no-explicit-any */

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

describe('AtmosphereBackdrop bounded space mode', () => {
  function setup(options: { spaceScale?: number } = {}) {
    const model = new AtmosphereGpuModel(earthAtmosphereProfile(), SMALL);
    const backdrop = new AtmosphereBackdrop(model, { steps: 8, spaceScale: 0.5, ...options });
    const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
    // The planet's air shell is one world unit around the origin; the backdrop's altitude is set apart from the camera's pose.
    backdrop.setShell(new Vector3(0, 0, 0), 1);
    backdrop.setAltitude(model.uTopAltitude.value * 3);
    const place = (x: number, y: number, z: number): void => {
      camera.position.set(x, y, z);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
    };
    return { model, backdrop, camera, place };
  }

  it('draws a premultiplied-alpha quad in the opaque pass', () => {
    const { model, backdrop } = setup();
    const m = backdrop.material;
    expect(m.transparent).toBeFalse();
    expect(m.blending).toBe(CustomBlending);
    expect(m.blendDst).toBe(OneMinusSrcAlphaFactor);
    expect(m.depthTest).toBeFalse();
    backdrop.dispose();
    model.dispose();
  });

  it('stays a full-screen opaque quad by default, owning the sky at any distance', async () => {
    const renderer = await getEvalRenderer();
    const { model, backdrop, camera, place } = setup();
    expect(backdrop.ownsSky).toBeTrue();
    place(0, 0, 500);
    backdrop.update(renderer, camera);
    expect(backdrop.coverage).toBe('full');
    expect(backdrop.screenBounds).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
    expect(backdrop.mesh.renderOrder).toBe(-1000);
    expect(backdrop.apparentAngularRadius).toBeCloseTo(Math.asin(1 / 500), 9);
    backdrop.dispose();
    model.dispose();
  });

  it('covers only the shell bounds for a non-owner in space, and draws after the owner', async () => {
    const renderer = await getEvalRenderer();
    const { model, backdrop, camera, place } = setup();
    backdrop.ownsSky = false;
    place(0, 0, 10);
    backdrop.update(renderer, camera);
    expect(backdrop.coverage).toBe('bounded');
    expect(backdrop.apparentAngularRadius).toBeCloseTo(Math.asin(0.1), 9);
    const near = screenRectCoverage(backdrop.screenBounds);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(0.1);
    expect(backdrop.mesh.renderOrder).toBeGreaterThan(-1000);
    expect(backdrop.mesh.visible).toBeTrue();
    backdrop.dispose();
    model.dispose();
  });

  it('covers fewer pixels, and marches fewer, the farther the atmosphere is', async () => {
    const renderer = await getEvalRenderer();
    const { model, backdrop, camera, place } = setup();
    backdrop.ownsSky = false;
    const scissorArea = (): number => {
      const target = (backdrop as any).spaceTarget;
      return target.scissor.z * target.scissor.w;
    };
    place(0, 0, 4);
    backdrop.update(renderer, camera);
    const closeCoverage = screenRectCoverage(backdrop.screenBounds);
    const closeArea = scissorArea();
    expect((backdrop as any).spaceTarget.scissorTest).toBeTrue();

    place(0, 0, 40);
    backdrop.update(renderer, camera);
    expect(backdrop.coverage).toBe('bounded');
    expect(screenRectCoverage(backdrop.screenBounds)).toBeLessThan(closeCoverage / 10);
    expect(scissorArea()).toBeLessThan(closeArea / 10);
    backdrop.dispose();
    model.dispose();
  });

  it('is dropped, with no space march, below the minimum apparent size, and comes back without help', async () => {
    const renderer = await getEvalRenderer();
    const { model, backdrop, camera, place } = setup();
    backdrop.ownsSky = false;
    expect(backdrop.minAngularRadius).toBe(DEFAULT_MIN_ANGULAR_RADIUS);

    // asin(1/d) < 0.25 degrees from d = 230.
    place(0, 0, 400);
    backdrop.update(renderer, camera);
    expect(backdrop.coverage).toBe('culled');
    expect(backdrop.mesh.visible).toBeFalse();
    expect(backdrop.spaceRenderCount).toBe(0);

    place(0, 0, 100);
    backdrop.update(renderer, camera);
    expect(backdrop.coverage).toBe('bounded');
    expect(backdrop.mesh.visible).toBeTrue();
    expect(backdrop.spaceRenderCount).toBe(1);

    // A consumer's own threshold wins.
    backdrop.minAngularRadius = (30 * Math.PI) / 180;
    place(0, 0, 10);
    backdrop.update(renderer, camera);
    expect(backdrop.coverage).toBe('culled');
    backdrop.minAngularRadius = 0;
    place(0, 0, 400);
    backdrop.update(renderer, camera);
    expect(backdrop.coverage).toBe('bounded');
    backdrop.dispose();
    model.dispose();
  });

  it('is dropped when the shell is off screen or behind the camera', async () => {
    const renderer = await getEvalRenderer();
    const { model, backdrop, camera, place } = setup();
    backdrop.ownsSky = false;
    place(0, 0, 10);
    camera.lookAt(0, 100, 10);
    camera.updateMatrixWorld();
    backdrop.update(renderer, camera);
    expect(backdrop.coverage).toBe('culled');
    camera.lookAt(0, 0, 100);
    camera.updateMatrixWorld();
    backdrop.update(renderer, camera);
    expect(backdrop.coverage).toBe('culled');
    camera.lookAt(100, 0, 10);
    camera.updateMatrixWorld();
    backdrop.update(renderer, camera);
    expect(backdrop.coverage).toBe('culled');
    backdrop.dispose();
    model.dispose();
  });

  it('keeps the full-screen opaque quad when the camera is inside the air, owner or not', async () => {
    const renderer = await getEvalRenderer();
    const { model, backdrop, camera, place } = setup();
    backdrop.ownsSky = false;
    backdrop.setAltitude(2);
    place(0, 0, 1.0001);
    backdrop.update(renderer, camera);
    expect(backdrop.coverage).toBe('full');
    expect(backdrop.screenBounds).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
    expect(backdrop.mesh.renderOrder).toBe(-1000);
    backdrop.dispose();
    model.dispose();
  });

  it('covers the full screen without a shell or a perspective camera', async () => {
    const renderer = await getEvalRenderer();
    const model = new AtmosphereGpuModel(earthAtmosphereProfile(), SMALL);
    const backdrop = new AtmosphereBackdrop(model, { steps: 8, spaceScale: 0, ownsSky: false });
    backdrop.setAltitude(model.uTopAltitude.value * 3);
    const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld();
    backdrop.update(renderer, camera);
    expect(backdrop.coverage).toBe('full');
    expect(Number.isNaN(backdrop.apparentAngularRadius)).toBeTrue();
    backdrop.dispose();
    model.dispose();
  });
});
