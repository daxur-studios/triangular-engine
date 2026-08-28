import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { PerspectiveCamera } from 'three';
import { EngineService } from './engine.service';
import { ScreenshotService } from './screenshot.service';

describe('ScreenshotService', () => {
  let service: ScreenshotService;
  let mockEngine: Partial<EngineService>;
  let mockCanvas: HTMLCanvasElement;
  let mockRenderer: any;
  let mockCamera: PerspectiveCamera;
  let mockSpeedFactor$: BehaviorSubject<number>;

  beforeEach(() => {
    mockCanvas = document.createElement('canvas');
    mockCanvas.width = 800;
    mockCanvas.height = 600;
    // Mock toBlob for canvas
    mockCanvas.toBlob = (callback: BlobCallback, type?: string, _quality?: any) => {
      const mockBlob = new Blob(['mock-image-data'], { type: type || 'image/png' });
      callback(mockBlob);
    };

    mockRenderer = {
      setSize: jasmine.createSpy('setSize'),
      setPixelRatio: jasmine.createSpy('setPixelRatio'),
    };

    mockCamera = new PerspectiveCamera(75, 800 / 600, 0.1, 1000);
    mockSpeedFactor$ = new BehaviorSubject<number>(1);

    mockEngine = {
      canvas: mockCanvas,
      renderer: mockRenderer,
      camera: mockCamera,
      width: 800,
      height: 600,
      pixelRatio: 1,
      speedFactor$: mockSpeedFactor$,
      fpsController: { lastRenderTime: 100, fpsLimitInterval: 16 } as any,
      render: jasmine.createSpy('render'),
      setSpeedFactor: jasmine.createSpy('setSpeedFactor').and.callFake((val: number) => {
        mockSpeedFactor$.next(val);
      }),
      CSS2DRenderer: {
        domElement: document.createElement('div'),
      } as any,
      CSS3DRenderer: {
        domElement: document.createElement('div'),
      } as any,
    };

    TestBed.configureTestingModule({
      providers: [
        ScreenshotService,
        { provide: EngineService, useValue: mockEngine },
      ],
    });

    service = TestBed.inject(ScreenshotService);
  });

  it('should be created and find injected engine', () => {
    expect(service).toBeTruthy();
    expect(service.engine).toBe(mockEngine as EngineService);
  });

  it('should capture single-frame native resolution screenshot and toggle overlays', async () => {
    const css2dEl = mockEngine.CSS2DRenderer!.domElement;
    css2dEl.style.display = 'block';

    const blob = await service.capture({
      format: 'image/png',
      hideOverlays: true,
    });

    expect(blob).toBeTruthy();
    expect(blob.type).toBe('image/png');
    expect(mockEngine.render).toHaveBeenCalledWith(100, true);
    expect(css2dEl.style.display).toBe('block');
  });

  it('should handle progressive multi-sample capture and report progress', async () => {
    const progressValues: number[] = [];
    const cleanupSpy = jasmine.createSpy('cleanupSpy');
    const prepareSpy = jasmine.createSpy('prepareSpy').and.resolveTo(cleanupSpy);

    const blob = await service.capture({
      multiplier: 2,
      samples: 3,
      prepare: prepareSpy,
      onProgress: (p) => progressValues.push(p),
    });

    expect(blob).toBeTruthy();
    expect(prepareSpy).toHaveBeenCalled();
    expect(cleanupSpy).toHaveBeenCalled();
    expect(progressValues.length).toBe(3);
    expect(progressValues[progressValues.length - 1]).toBe(1);
    expect(mockEngine.setSpeedFactor).toHaveBeenCalledWith(0);
    expect(mockSpeedFactor$.value).toBe(1); // restored
  });

  it('should trigger browser download helper', () => {
    const createElementSpy = spyOn(document, 'createElement').and.callThrough();
    const mockBlob = new Blob(['data'], { type: 'image/png' });

    service.download(mockBlob, 'test-capture.png');

    expect(createElementSpy).toHaveBeenCalledWith('a');
  });

  it('should throw error when no engine is available', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ScreenshotService,
        { provide: EngineService, useValue: undefined },
      ],
    });
    EngineService.activeInstance = undefined;
    const detachedService = TestBed.inject(ScreenshotService);

    await expectAsync(detachedService.capture()).toBeRejectedWithError(/No active EngineService instance found/);
  });
});
