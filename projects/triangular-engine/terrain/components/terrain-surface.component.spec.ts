import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { PerspectiveCamera, Scene } from 'three';
import { EngineService } from 'triangular-engine';
import { ConstantTerrainField } from '../core/terrain-field';
import { PlaneTerrainDomain } from '../domains/plane-terrain-domain';
import {
  ITerrainSurfaceLodStats,
  TerrainSurfaceComponent,
} from './terrain-surface.component';

describe('TerrainSurfaceComponent', () => {
  let scene: Scene;
  let camera: PerspectiveCamera;
  let beforeRender$: Subject<void>;

  beforeEach(() => {
    scene = new Scene();
    camera = new PerspectiveCamera();
    beforeRender$ = new Subject<void>();
    TestBed.configureTestingModule({
      imports: [TerrainSurfaceComponent],
      providers: [
        {
          provide: EngineService,
          useValue: { scene, camera, beforeRender$ },
        },
      ],
    });
  });

  it('follows the engine camera and replaces coarse patches with nearby detail', () => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', [{ level: 0, x: 0, z: 0 }]);
    fixture.componentRef.setInput('maxLod', 2);
    fixture.componentRef.setInput('refinementDistance', 1_200);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('generationBudget', 100);
    camera.position.set(5_000, 100, 5_000);
    fixture.detectChanges();

    beforeRender$.next();
    expect(scene.children.length).toBe(1);
    expect(scene.children[0].children.length).toBe(1);

    camera.position.set(400, 100, -400);
    beforeRender$.next();
    expect(scene.children[0].children.length).toBe(16);

    fixture.destroy();
    expect(scene.children.length).toBe(0);
  });

  it('uses an explicit LOD position instead of the camera when supplied', () => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', [{ level: 0, x: 0, z: 0 }]);
    fixture.componentRef.setInput('lodPosition', [400, 100, -400]);
    fixture.componentRef.setInput('maxLod', 1);
    fixture.componentRef.setInput('refinementDistance', 1_200);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('generationBudget', 100);
    camera.position.set(5_000, 100, 5_000);
    fixture.detectChanges();

    beforeRender$.next();
    expect(scene.children[0].children.length).toBe(4);
  });

  it('uses an opt-in patch selector while retaining shared mesh streaming', () => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    const selector = jasmine
      .createSpy('patchSelector')
      .and.callFake(({ roots }: { roots: readonly unknown[] }) => roots);
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', [{ level: 0, x: 0, z: 0 }]);
    fixture.componentRef.setInput('maxLod', 2);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('generationBudget', 100);
    fixture.componentRef.setInput('patchSelector', selector);
    fixture.detectChanges();

    beforeRender$.next();

    expect(selector).toHaveBeenCalledWith(
      jasmine.objectContaining({ maxLevel: 2 }),
    );
    expect(scene.children[0].children.length).toBe(1);
  });

  it('reports resident geometry bytes and skirt draw calls for performance diagnostics', () => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    const stats: ITerrainSurfaceLodStats[] = [];
    fixture.componentInstance.lodChange.subscribe((value) => stats.push(value));
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', [{ level: 0, x: 0, z: 0 }]);
    fixture.componentRef.setInput('maxLod', 0);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('skirtDepth', 10);
    fixture.componentRef.setInput('generationBudget', 1);
    fixture.detectChanges();

    beforeRender$.next();

    expect(stats.at(-1)).toEqual(
      jasmine.objectContaining({
        desired: 1,
        resident: 1,
        queued: 0,
        drawCalls: 2,
      }),
    );
    expect(stats.at(-1)!.geometryBytes).toBeGreaterThan(0);
  });
});
