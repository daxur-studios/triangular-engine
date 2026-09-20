import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import {
  InstancedMesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import { EngineService } from 'triangular-engine';
import { PlaneWaterDomain, SphereWaterDomain } from '../core/water-domain';
import { WaterService } from '../core/water.service';
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
            timer: { getElapsed: () => 2 },
            beforeRender$,
          },
        },
      ],
    });
  });

  it('attaches, updates and disposes the shared renderer', () => {
    const fixture = TestBed.createComponent(WaterSurfaceComponent);
    fixture.detectChanges();

    expect(scene.children.length).toBeGreaterThan(0);
    expect(
      scene.children.every((child) => child.name.startsWith('water-camera-lod-')),
    ).toBeTrue();
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

    const planeDetailMeshes = scene.children.filter((child) =>
      child.name.startsWith('water-camera-lod-'),
    );
    expect(planeDetailMeshes.length).toBeGreaterThan(2);
    expect(
      planeDetailMeshes.every(
        (child) =>
          (child as { material?: { wireframe?: boolean } }).material?.wireframe,
      ),
    ).toBeTrue();

    fixture.componentRef.setInput('domain', new SphereWaterDomain(100));
    fixture.detectChanges();
    expect(
      scene.children.some((child) => child.name === 'water-planetary-far-surface'),
    ).toBeTrue();
    expect(
      scene.children.filter((child) => child.name.startsWith('water-camera-lod-')),
    ).toHaveSize(planeDetailMeshes.length);

    fixture.componentRef.setInput('domain', new PlaneWaterDomain());
    fixture.detectChanges();
    expect(
      scene.children.some((child) => child.name === 'water-planetary-far-surface'),
    ).toBeFalse();
    expect(
      scene.children.filter((child) => child.name.startsWith('water-camera-lod-')),
    ).toHaveSize(planeDetailMeshes.length);
  });

  it('can render without replacing a simulation-owned water body', () => {
    const fixture = TestBed.createComponent(WaterSurfaceComponent);
    fixture.componentRef.setInput('registerBody', false);
    fixture.detectChanges();

    const water = TestBed.inject(WaterService);
    expect(water.sample(new Vector3(0, -1, 0), 0)).toBeNull();
  });

  it('uses an authoritative animation time when supplied', () => {
    const fixture = TestBed.createComponent(WaterSurfaceComponent);
    fixture.componentRef.setInput('timeSeconds', 123.5);
    fixture.detectChanges();
    beforeRender$.next();

    const material = (scene.children[0] as InstancedMesh)
      .material as ShaderMaterial;
    expect(material.uniforms['uTime'].value).toBe(123.5);
  });
});
