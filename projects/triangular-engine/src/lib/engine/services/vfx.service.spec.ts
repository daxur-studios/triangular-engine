import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { Camera, PerspectiveCamera, Scene } from 'three';
import { EngineService } from './engine.service';
import { VfxService } from './vfx.service';

describe('VfxService', () => {
  let service: VfxService;
  let mockEngine: any;
  let tick$: BehaviorSubject<number>;

  beforeEach(() => {
    tick$ = new BehaviorSubject<number>(0);
    const testCam = new PerspectiveCamera();
    mockEngine = {
      scene: new Scene(),
      camera$: new BehaviorSubject<Camera>(testCam),
      camera: testCam,
      tick$,
    };

    TestBed.configureTestingModule({
      providers: [
        VfxService,
        { provide: EngineService, useValue: mockEngine },
      ],
    });

    service = TestBed.inject(VfxService);
  });

  it('spawns an explosion burst and attaches it to the scene', () => {
    const mesh = service.spawnExplosion([5, 10, -2], 1.5, 50);

    expect(mesh).toBeDefined();
    expect(mesh!.position.x).toBe(5);
    expect(mesh!.position.y).toBe(10);
    expect(mesh!.position.z).toBe(-2);
    expect(mockEngine.scene.children).toContain(mesh!);
  });

  it('spawns sparks along a direction', () => {
    const mesh = service.spawnSparks([0, 1, 0], [0, 1, 0], 30);

    expect(mesh).toBeDefined();
    expect(mockEngine.scene.children).toContain(mesh!);
  });

  it('advances simulation on tick and cleans up expired burst meshes', () => {
    const mesh = service.spawnBurst('sparks', {
      position: [0, 0, 0],
      burst: 20,
      lifetime: 0.1, // expires quickly
    });

    expect(mockEngine.scene.children).toContain(mesh!);

    // Advance time past lifetime
    tick$.next(0.25);

    // Mesh should have been removed from scene
    expect(mockEngine.scene.children).not.toContain(mesh!);
  });
});
