import { TestBed } from '@angular/core/testing';
import { PerspectiveCamera, Scene } from 'three';
import { EngineRenderPipeline } from '../models';
import { EngineService } from './engine.service';
import { MultiViewportService } from './multi-viewport.service';

describe('MultiViewportService', () => {
  let service: MultiViewportService;
  let mockEngine: any;
  let mockRenderer: any;
  let registeredPipeline: EngineRenderPipeline | undefined;

  beforeEach(() => {
    registeredPipeline = undefined;

    mockRenderer = {
      setScissorTest: jasmine.createSpy('setScissorTest'),
      clear: jasmine.createSpy('clear'),
      setScissor: jasmine.createSpy('setScissor'),
      setViewport: jasmine.createSpy('setViewport'),
      render: jasmine.createSpy('render'),
    };

    mockEngine = {
      renderer: mockRenderer,
      scene: new Scene(),
      width: 800,
      height: 600,
      registerRenderPipeline: jasmine.createSpy('registerRenderPipeline').and.callFake(
        (pipeline: EngineRenderPipeline) => {
          registeredPipeline = pipeline;
        },
      ),
      unregisterRenderPipeline: jasmine.createSpy('unregisterRenderPipeline').and.callFake(
        (pipeline: EngineRenderPipeline) => {
          if (registeredPipeline === pipeline) {
            registeredPipeline = undefined;
          }
        },
      ),
    };

    TestBed.configureTestingModule({
      providers: [
        MultiViewportService,
        { provide: EngineService, useValue: mockEngine },
      ],
    });

    service = TestBed.inject(MultiViewportService);
  });

  it('registers cameras and auto-registers pipeline on first camera', () => {
    const cam1 = new PerspectiveCamera(60, 1, 0.1, 100);
    expect(registeredPipeline).toBeUndefined();

    service.registerViewportCamera(cam1, [0, 0, 0.5, 1]);

    expect(mockEngine.registerRenderPipeline).toHaveBeenCalledTimes(1);
    expect(registeredPipeline).toBeDefined();
    expect(service.getViewportCameras().length).toBe(1);
  });

  it('unregisters camera and auto-unregisters pipeline when camera list becomes empty', () => {
    const cam1 = new PerspectiveCamera(60, 1, 0.1, 100);
    const cam2 = new PerspectiveCamera(60, 1, 0.1, 100);

    service.registerViewportCamera(cam1, [0, 0, 0.5, 1]);
    service.registerViewportCamera(cam2, [0.5, 0, 0.5, 1]);
    expect(registeredPipeline).toBeDefined();

    service.unregisterViewportCamera(cam1);
    expect(registeredPipeline).toBeDefined();
    expect(service.getViewportCameras().length).toBe(1);

    service.unregisterViewportCamera(cam2);
    expect(mockEngine.unregisterRenderPipeline).toHaveBeenCalledTimes(1);
    expect(registeredPipeline).toBeUndefined();
    expect(service.getViewportCameras().length).toBe(0);
  });

  it('calculates WebGL pixel coordinates without inverting the Y axis', () => {
    const camTopLeft = new PerspectiveCamera(60, 1, 0.1, 100);
    const camBottomLeft = new PerspectiveCamera(60, 1, 0.1, 100);

    // Viewport: [x, y, w, h] normalized with bottom-left origin (0, 0)
    // Top-left: x=0, y=0.5, w=0.5, h=0.5
    // Bottom-left: x=0, y=0, w=0.5, h=0.5
    service.registerViewportCamera(camTopLeft, [0, 0.5, 0.5, 0.5]);
    service.registerViewportCamera(camBottomLeft, [0, 0, 0.5, 0.5]);

    expect(registeredPipeline).toBeDefined();
    registeredPipeline!.render(0.016);

    // Canvas is 800x600
    // Top-left camera in WebGL should have Y starting at 300 (height * 0.5)
    expect(mockRenderer.setViewport).toHaveBeenCalledWith(0, 300, 400, 300);
    expect(mockRenderer.setScissor).toHaveBeenCalledWith(0, 300, 400, 300);

    // Bottom-left camera in WebGL should have Y starting at 0 (height * 0)
    expect(mockRenderer.setViewport).toHaveBeenCalledWith(0, 0, 400, 300);
    expect(mockRenderer.setScissor).toHaveBeenCalledWith(0, 0, 400, 300);

    // Verify cleanup resets viewport and scissor
    expect(mockRenderer.setScissorTest).toHaveBeenCalledWith(false);
    expect(mockRenderer.setViewport).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  it('cleans up pipeline on ngOnDestroy', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    service.registerViewportCamera(cam, [0, 0, 1, 1]);
    expect(registeredPipeline).toBeDefined();

    service.ngOnDestroy();
    expect(mockEngine.unregisterRenderPipeline).toHaveBeenCalledTimes(1);
  });
});
