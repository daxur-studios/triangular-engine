import { PerspectiveCamera } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { EngineService } from './engine.service';

describe('EngineService WebGPU startup rendering', () => {
  function createFixture(initialized: boolean) {
    // No GPU or Angular injection needed: exercise early camera/resize render calls.
    const renderer = Object.create(WebGPURenderer.prototype);
    Object.defineProperty(renderer, 'initialized', { value: initialized, configurable: true });
    renderer.info = { reset: jasmine.createSpy('reset') };
    renderer.render = jasmine.createSpy('render');
    const fixture = {
      renderer,
      camera: new PerspectiveCamera(),
      scene: {},
      fpsController: { lastRenderTime: 0, fpsLimitInterval: 0 },
      renderFrameId: 0,
      safeEmit: jasmine.createSpy('safeEmit'),
    };
    return fixture;
  }

  it('defers even forced resize/camera frames until the backend is initialized', () => {
    const fixture = createFixture(false);
    EngineService.prototype.render.call(fixture as unknown as EngineService, 1, true);
    expect(fixture.renderer.render).not.toHaveBeenCalled();
    expect(fixture.renderer.info.reset).not.toHaveBeenCalled();
    expect(fixture.safeEmit).not.toHaveBeenCalled();
  });

  it('renders and publishes completion once initialization finishes', () => {
    const fixture = createFixture(true);
    EngineService.prototype.render.call(fixture as unknown as EngineService, 1, true);
    expect(fixture.renderer.render).toHaveBeenCalledWith(fixture.scene, fixture.camera);
    expect(fixture.safeEmit).toHaveBeenCalled();
    expect(fixture.fpsController.lastRenderTime).toBe(1);
  });
});
