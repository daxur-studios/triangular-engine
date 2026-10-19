import { TestBed } from '@angular/core/testing';
import { WebGPURenderer } from 'three/webgpu';
import { EngineService, provideTriangularEngine } from './engine.service';

describe('EngineService WebGPU startup rendering', () => {
  let service: EngineService;
  let safeEmit: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideTriangularEngine()] });
    // A real instance is needed: render() calls the private #collectGpuTiming(), which
    // a plain object cannot provide.
    service = TestBed.inject(EngineService);
    safeEmit = spyOn<any>(service, 'safeEmit');
  });

  function useRenderer(initialized: boolean) {
    // No GPU needed: stub the renderer and exercise early camera/resize render calls.
    const renderer = Object.create(WebGPURenderer.prototype);
    Object.defineProperty(renderer, 'initialized', { value: initialized, configurable: true });
    renderer.info = { reset: jasmine.createSpy('reset') };
    renderer.render = jasmine.createSpy('render');
    service.renderer = renderer;
    return renderer;
  }

  it('defers even forced resize/camera frames until the backend is initialized', () => {
    const renderer = useRenderer(false);
    service.render(1, true);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.info.reset).not.toHaveBeenCalled();
    expect(safeEmit).not.toHaveBeenCalled();
  });

  it('renders and publishes completion once initialization finishes', () => {
    const renderer = useRenderer(true);
    service.render(1, true);
    expect(renderer.render).toHaveBeenCalledWith(service.scene, service.camera);
    expect(safeEmit).toHaveBeenCalled();
    expect(service.fpsController.lastRenderTime).toBe(1);
  });
});
