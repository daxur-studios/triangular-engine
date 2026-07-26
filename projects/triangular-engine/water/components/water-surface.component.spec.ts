import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { PerspectiveCamera, Scene } from 'three';
import { EngineService } from 'triangular-engine';
import { PlaneWaterDomain, SphereWaterDomain } from '../core/water-domain';
import { WaterSurfaceComponent } from './water-surface.component';

describe('WaterSurfaceComponent', () => {
  let scene: Scene;
  let beforeRender$: Subject<void>;

  beforeEach(() => {
    scene = new Scene();
    beforeRender$ = new Subject<void>();
    const camera = new PerspectiveCamera();
    camera.position.set(0, 10, 20);

    TestBed.configureTestingModule({
      imports: [WaterSurfaceComponent],
      providers: [
        {
          provide: EngineService,
          useValue: {
            scene,
            renderer: null,
            camera,
            clock: { getElapsedTime: () => 2 },
            beforeRender$,
          },
        },
      ],
    });
  });

  it('attaches, updates and disposes the shared renderer', () => {
    const fixture = TestBed.createComponent(WaterSurfaceComponent);
    fixture.detectChanges();

    expect(scene.children.length).toBe(6);
    expect(() => beforeRender$.next()).not.toThrow();

    fixture.destroy();
    expect(scene.children.length).toBe(0);
  });

  it('switches quality, motion, grid overrides and domain through inputs', () => {
    const fixture = TestBed.createComponent(WaterSurfaceComponent);
    fixture.componentRef.setInput('quality', 'performance');
    fixture.componentRef.setInput('motion', 'storm');
    fixture.componentRef.setInput('presetOverrides', {
      grid: { ringCount: 1 },
    });
    fixture.componentRef.setInput('lodDetail', 2);
    fixture.componentRef.setInput('wireframe', true);
    fixture.detectChanges();

    expect(scene.children.length).toBe(2);
    expect(
      scene.children.every(
        (child) =>
          (child as { material?: { wireframe?: boolean } }).material?.wireframe,
      ),
    ).toBeTrue();

    fixture.componentRef.setInput('domain', new SphereWaterDomain(100));
    fixture.detectChanges();
    expect(scene.children.length).toBe(3);

    fixture.componentRef.setInput('domain', new PlaneWaterDomain());
    fixture.detectChanges();
    expect(scene.children.length).toBe(2);
  });
});
