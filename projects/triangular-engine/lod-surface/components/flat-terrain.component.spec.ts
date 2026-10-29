import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { PerspectiveCamera, Scene } from 'three';
import { EngineService } from 'triangular-engine';
import { createHeightSource } from 'triangular-engine/lod-surface/core';
import { FlatTerrainComponent } from './flat-terrain.component';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('FlatTerrainComponent', () => {
  let scene: Scene;
  let camera: PerspectiveCamera;
  let beforeRender$: Subject<void>;
  let engine: { scene: Scene; camera: PerspectiveCamera; renderer: any; beforeRender$: Subject<void> };

  beforeEach(() => {
    scene = new Scene();
    camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1e9);
    camera.position.set(1_000, 200, 3_000);
    camera.lookAt(0, 0, 0);
    beforeRender$ = new Subject<void>();
    engine = { scene, camera, renderer: { isWebGPURenderer: true, domElement: { height: 1080 } }, beforeRender$ };
    TestBed.configureTestingModule({
      imports: [FlatTerrainComponent],
      providers: [{ provide: EngineService, useValue: engine }],
    });
  });

  it('builds a plane domain from `size` with the defaults, and follows its inputs', () => {
    const fixture = TestBed.createComponent(FlatTerrainComponent);
    fixture.componentRef.setInput('size', 100_000);
    fixture.detectChanges();
    const terrain = fixture.componentInstance.terrain()!;
    expect(scene.children).toContain(terrain.object);
    expect(terrain.selector.settings.domain).toEqual({ kind: 'plane', sizeM: 100_000, warp: 'equal-angle' });
    expect(terrain.selector.settings.leafCap).toBe(4096);
    expect(terrain.selector.settings.cellPixels).toBe(4);
    expect(terrain.selector.settings.patchCells).toBe(16);

    const bumps = createHeightSource('bumps', 'plane');
    fixture.componentRef.setInput('size', 20_000);
    fixture.componentRef.setInput('heights', bumps);
    fixture.componentRef.setInput('leafCap', 300);
    fixture.componentRef.setInput('cellPixels', 3);
    fixture.componentRef.setInput('patchCells', 64);
    fixture.detectChanges();
    const { settings } = terrain.selector;
    expect(settings.domain.sizeM).toBe(20_000);
    expect(settings.leafCap).toBe(300);
    expect(settings.cellPixels).toBe(3);
    expect(settings.patchCells).toBe(64);
    // The selector sees the new source through the noise wrapper, which only widens its bound.
    expect(terrain.source.boundM).toBeGreaterThanOrEqual(bumps.boundM);
    fixture.destroy();
    expect(scene.children).not.toContain(terrain.object);
  });

  it('selects from the camera and draws no more than it selected', () => {
    const fixture = TestBed.createComponent(FlatTerrainComponent);
    fixture.componentRef.setInput('size', 100_000);
    fixture.componentRef.setInput('leafCap', 256);
    fixture.detectChanges();
    const terrain = fixture.componentInstance.terrain()!;
    beforeRender$.next();
    expect(terrain.stats.leaves).toBeGreaterThan(1);
    expect(terrain.stats.drawn).toBeGreaterThan(0);
    expect(terrain.stats.leaves).toBeLessThanOrEqual(256 + 144 + 6);
    expect(terrain.object.position.toArray()).toEqual([1_000, 200, 3_000]);

    // Culling off draws every selected leaf; on, a camera facing away draws fewer.
    camera.lookAt(1_000, 200, 6_000);
    beforeRender$.next();
    const awayDrawn = terrain.stats.drawn;
    fixture.componentRef.setInput('cull', false);
    fixture.detectChanges();
    beforeRender$.next();
    expect(terrain.stats.drawn).toBe(terrain.stats.leaves);
    expect(terrain.stats.drawn).toBeGreaterThan(awayDrawn);
    fixture.destroy();
  });
});
