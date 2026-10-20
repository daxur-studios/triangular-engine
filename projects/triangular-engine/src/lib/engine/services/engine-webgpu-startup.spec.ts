import { TestBed } from '@angular/core/testing';
import { Vector2, WebGLRenderer } from 'three';
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
    renderer.getDrawingBufferSize = (target: Vector2) => target.set(300, 150);
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

  describe('zero-size drawing buffer', () => {
    function useSizedRenderer(proto: object, size: { width: number; height: number }) {
      const renderer = Object.create(proto);
      Object.defineProperty(renderer, 'initialized', { value: true, configurable: true });
      renderer.info = { reset: jasmine.createSpy('reset') };
      renderer.render = jasmine.createSpy('render');
      renderer.resolveTimestampsAsync = jasmine
        .createSpy('resolveTimestampsAsync')
        .and.resolveTo(1);
      renderer.getDrawingBufferSize = (target: Vector2) => target.set(size.width, size.height);
      service.renderer = renderer;
      return renderer;
    }

    for (const [name, proto] of [
      ['WebGPU', WebGPURenderer.prototype],
      ['WebGL', WebGLRenderer.prototype],
    ] as const) {
      it(`skips ${name} render and timestamp resolve at 0x0, then resumes with a real size`, () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [provideTriangularEngine({ gpuTiming: true })],
        });
        service = TestBed.inject(EngineService);
        safeEmit = spyOn<any>(service, 'safeEmit');
        const size = { width: 0, height: 0 };
        const renderer = useSizedRenderer(proto, size);

        service.render(1, true);
        size.width = 300; // a collapsed height still leaves nothing to draw
        service.render(2, true);
        expect(renderer.render).not.toHaveBeenCalled();
        expect(renderer.resolveTimestampsAsync).not.toHaveBeenCalled();
        expect(safeEmit).not.toHaveBeenCalled();

        size.height = 150;
        service.render(3, true);
        expect(renderer.render).toHaveBeenCalledTimes(1);
        expect(renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(1);
        expect(service.fpsController.lastRenderTime).toBe(3);
      });
    }
  });
});
