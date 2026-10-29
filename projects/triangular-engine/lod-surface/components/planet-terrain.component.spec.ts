import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { PerspectiveCamera, Scene } from 'three';
import { EngineService } from 'triangular-engine';
import { TERRAIN_DEFAULTS, createGroundSample, createHeightSource } from 'triangular-engine/lod-surface/core';
import { buildCellPlanetWorld } from 'triangular-engine/worldgen';
import { TerrainPlanetMaterial } from '../terrain-planet-material';
import { PlanetTerrainComponent } from './planet-terrain.component';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('PlanetTerrainComponent', () => {
  let scene: Scene;
  let camera: PerspectiveCamera;
  let beforeRender$: Subject<void>;
  let engine: { scene: Scene; camera: PerspectiveCamera; renderer: any; beforeRender$: Subject<void> };
  const webGpu = { isWebGPURenderer: true, domElement: { height: 720 } };

  beforeEach(() => {
    scene = new Scene();
    camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1e9);
    camera.position.set(0, 0, 10_050);
    beforeRender$ = new Subject<void>();
    engine = { scene, camera, renderer: webGpu, beforeRender$ };
    TestBed.configureTestingModule({
      imports: [PlanetTerrainComponent],
      providers: [{ provide: EngineService, useValue: engine }],
    });
  });

  function create(radius = 10_000) {
    const fixture = TestBed.createComponent(PlanetTerrainComponent);
    fixture.componentRef.setInput('radius', radius);
    fixture.detectChanges();
    return fixture;
  }

  it('adds the terrain to the scene with the documented defaults, and removes it on destroy', () => {
    const fixture = create();
    const terrain = fixture.componentInstance.terrain()!;
    expect(terrain).toBeDefined();
    expect(scene.children).toContain(terrain.object);
    const { settings } = terrain.selector;
    expect(settings.domain).toEqual({ kind: 'sphere', sizeM: 10_000, warp: 'equal-angle' });
    expect(settings.leafCap).toBe(4096);
    expect(settings.leafCap).toBe(TERRAIN_DEFAULTS.leafCap);
    expect(settings.cellPixels).toBe(4);
    expect(settings.patchCells).toBe(16);
    expect(settings.hysteresis).toBe(0.15);
    expect(settings.cull).toBeTrue();
    expect(settings.mode).toBe('distance');
    // Flat heights plus the default detail noise: the selector's bound is the noise's, not zero and not the bumps'.
    expect(settings.heightBoundM).toBeGreaterThan(0);
    expect(terrain.settings.detailNoise).toBe(0.04);

    fixture.destroy();
    expect(scene.children).not.toContain(terrain.object);
    expect(() => beforeRender$.next()).not.toThrow();
  });

  it('passes its inputs to the selector and rebuilds the mesh only when the shader changes', () => {
    const fixture = create();
    const terrain = fixture.componentInstance.terrain()!;
    const firstMesh = terrain.surface.mesh;
    const bumps = createHeightSource('bumps', 'sphere');

    fixture.componentRef.setInput('leafCap', 512);
    fixture.componentRef.setInput('cellPixels', 8);
    fixture.componentRef.setInput('hysteresis', 0);
    fixture.componentRef.setInput('cull', false);
    fixture.componentRef.setInput('heights', bumps);
    fixture.componentRef.setInput('detailNoise', 0);
    fixture.detectChanges();
    const settings = terrain.selector.settings;
    expect(settings.leafCap).toBe(512);
    expect(settings.cellPixels).toBe(8);
    expect(settings.hysteresis).toBe(0);
    expect(settings.cull).toBeFalse();
    expect(settings.heightBoundM).toBe(bumps.boundM);

    // A different source, leaf cap and noise switch change the shader or its capacity, so the mesh was remade.
    expect(terrain.surface.mesh).not.toBe(firstMesh);
    expect(terrain.object.children).toEqual([terrain.surface.mesh]);

    const secondMesh = terrain.surface.mesh;
    fixture.componentRef.setInput('cellPixels', 6);
    fixture.componentRef.setInput('hysteresis', 0.3);
    fixture.detectChanges();
    expect(terrain.selector.settings.cellPixels).toBe(6);
    expect(terrain.selector.settings.hysteresis).toBe(0.3);
    expect(terrain.surface.mesh).toBe(secondMesh);

    fixture.componentRef.setInput('patchCells', 32);
    fixture.componentRef.setInput('radius', 600_000);
    fixture.componentRef.setInput('warp', 'none');
    fixture.detectChanges();
    expect(terrain.selector.settings.patchCells).toBe(32);
    expect(terrain.selector.settings.domain).toEqual({ kind: 'sphere', sizeM: 600_000, warp: 'none' });
    expect(terrain.surface.mesh).not.toBe(secondMesh);
    fixture.destroy();
  });

  it('selects from the active camera each frame and keeps the object at the camera', () => {
    const fixture = create();
    fixture.componentRef.setInput('leafCap', 256);
    fixture.detectChanges();
    const terrain = fixture.componentInstance.terrain()!;
    expect(terrain.object.visible).toBeFalse();

    beforeRender$.next();
    expect(terrain.object.visible).toBeTrue();
    expect(terrain.stats.leaves).toBeGreaterThan(6);
    expect(terrain.stats.drawn).toBeGreaterThan(0);
    expect(terrain.stats.drawn).toBeLessThanOrEqual(terrain.stats.leaves);
    expect(terrain.triangles).toBe(terrain.stats.drawn * 2 * 16 * 16);
    expect(terrain.object.position.toArray()).toEqual([0, 0, 10_050]);

    // The camera moved away from the planet: the tree is re-selected and the object follows.
    const before = terrain.stats.leaves;
    camera.position.set(0, 0, 40_000);
    beforeRender$.next();
    expect(terrain.object.position.z).toBe(40_000);
    expect(terrain.stats.leaves).not.toBe(before);
    fixture.destroy();
  });

  it('stays hidden and does nothing on a renderer that is not WebGPURenderer', () => {
    engine.renderer = { isWebGLRenderer: true };
    const fixture = create();
    const terrain = fixture.componentInstance.terrain()!;
    beforeRender$.next();
    expect(terrain.object.visible).toBeFalse();
    expect(terrain.stats.leaves).toBe(0);
    fixture.destroy();
  });

  it('uses a supplied material and leaves its disposal to the caller', async () => {
    const { MeshBasicNodeMaterial } = await import('three/webgpu');
    const material = new MeshBasicNodeMaterial();
    const dispose = spyOn(material, 'dispose').and.callThrough();
    const fixture = create();
    fixture.componentRef.setInput('material', material);
    fixture.detectChanges();
    const terrain = fixture.componentInstance.terrain()!;
    expect(terrain.surface.material).toBe(material);
    expect(material.positionNode).toBeTruthy();
    fixture.destroy();
    expect(dispose).not.toHaveBeenCalled();
  });
  it('draws with the planet material from the `material` input alone, with the cell colours and the sun input', () => {
    const material = new TerrainPlanetMaterial({ cellPlanet: buildCellPlanetWorld({ cellCount: 80, seed: 2 }), cellLookup: { atlasWidth: 64 } });
    const fixture = create();
    fixture.componentRef.setInput('material', material);
    fixture.componentRef.setInput('sunDirection', [0, 0, 2]);
    fixture.detectChanges();
    const terrain = fixture.componentInstance.terrain()!;
    expect(terrain.surface.material).toBe(material);
    // The mesh bound its nodes without any wiring by the caller: the stage-1 override is in force.
    expect(material.stageOverride?.id).toBe('lodTerrain');
    expect(material.stackKey).toContain('cellLookup');
    expect(material.dayNight.uSunDirection.value.z).toBeCloseTo(1, 6);
    fixture.destroy();
    material.dispose();
  });

  describe('pipeline warm-up', () => {
    interface Pending { readonly mesh: unknown; readonly meshVisible: boolean; resolve(): void; reject(error: unknown): void }
    let pending: Pending[];
    let compileAsync: jasmine.Spy;
    const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

    beforeEach(() => {
      pending = [];
      compileAsync = jasmine.createSpy('compileAsync').and.callFake((mesh: { visible: boolean }) => new Promise<void>((resolve, reject) => {
        pending.push({ mesh, meshVisible: mesh.visible, resolve, reject });
      }));
      engine.renderer = { ...webGpu, compileAsync };
    });

    it('keeps the terrain hidden, still selecting, until compileAsync resolves, then shows it', async () => {
      const fixture = create();
      const terrain = fixture.componentInstance.terrain()!;
      beforeRender$.next();
      expect(compileAsync).toHaveBeenCalledTimes(1);
      expect(compileAsync.calls.mostRecent().args).toEqual([terrain.surface.mesh, camera, scene]);
      // The mesh is compiled, not its group: the group is hidden, which compileAsync would skip.
      expect(pending[0].meshVisible).toBeTrue();
      expect(terrain.object.visible).toBeFalse();
      expect(terrain.stats.drawn).toBeGreaterThan(0);

      beforeRender$.next();
      expect(compileAsync).toHaveBeenCalledTimes(1);
      expect(terrain.object.visible).toBeFalse();

      pending[0].resolve();
      await flush();
      beforeRender$.next();
      expect(terrain.object.visible).toBeTrue();
      fixture.destroy();
    });

    it('re-hides and re-warms when a setting rebuilds the mesh, but not when it only updates it', async () => {
      const fixture = create();
      const terrain = fixture.componentInstance.terrain()!;
      beforeRender$.next();
      pending[0].resolve();
      await flush();
      beforeRender$.next();
      expect(terrain.object.visible).toBeTrue();

      fixture.componentRef.setInput('cellPixels', 6);
      fixture.detectChanges();
      beforeRender$.next();
      expect(compileAsync).toHaveBeenCalledTimes(1);
      expect(terrain.object.visible).toBeTrue();

      const firstMesh = terrain.surface.mesh;
      fixture.componentRef.setInput('leafCap', 512);
      fixture.detectChanges();
      expect(terrain.surface.mesh).not.toBe(firstMesh);
      beforeRender$.next();
      expect(terrain.object.visible).toBeFalse();
      expect(compileAsync).toHaveBeenCalledTimes(2);
      expect(compileAsync.calls.mostRecent().args[0]).toBe(terrain.surface.mesh);

      pending[1].resolve();
      await flush();
      beforeRender$.next();
      expect(terrain.object.visible).toBeTrue();
      fixture.destroy();
    });

    it('ignores the answer for a mesh that a rebuild has already replaced', async () => {
      const fixture = create();
      const terrain = fixture.componentInstance.terrain()!;
      beforeRender$.next();
      fixture.componentRef.setInput('leafCap', 512);
      fixture.detectChanges();
      beforeRender$.next();
      expect(compileAsync).toHaveBeenCalledTimes(2);

      pending[0].resolve();
      await flush();
      beforeRender$.next();
      expect(terrain.object.visible).toBeFalse();
      expect(compileAsync).toHaveBeenCalledTimes(2);

      pending[1].resolve();
      await flush();
      beforeRender$.next();
      expect(terrain.object.visible).toBeTrue();
      fixture.destroy();
    });

    it('shows the terrain anyway when the compile fails, and reports it on error$', async () => {
      const errors: { phase: string; error: unknown }[] = [];
      const error$ = new Subject<{ phase: string; error: unknown }>();
      error$.subscribe((event) => errors.push(event));
      (engine as any).error$ = error$;
      const fixture = create();
      const terrain = fixture.componentInstance.terrain()!;
      beforeRender$.next();
      const failure = new Error('pipeline failed');
      pending[0].reject(failure);
      await flush();
      beforeRender$.next();
      expect(terrain.object.visible).toBeTrue();
      expect(errors).toEqual([{ phase: 'compile', error: failure }]);
      fixture.destroy();
    });

    it('does nothing when the answer arrives after the component is destroyed', async () => {
      const errors: unknown[] = [];
      const error$ = new Subject<{ phase: string; error: unknown }>();
      error$.subscribe((event) => errors.push(event));
      (engine as any).error$ = error$;
      const fixture = create();
      beforeRender$.next();
      fixture.destroy();
      pending[0].reject(new Error('too late'));
      await flush();
      expect(() => beforeRender$.next()).not.toThrow();
      expect(errors).toEqual([]);
      expect(compileAsync).toHaveBeenCalledTimes(1);
    });

    it('does not warm and stays hidden on a renderer that is not WebGPURenderer', () => {
      engine.renderer = { isWebGLRenderer: true, compileAsync };
      const fixture = create();
      const terrain = fixture.componentInstance.terrain()!;
      beforeRender$.next();
      expect(compileAsync).not.toHaveBeenCalled();
      expect(terrain.object.visible).toBeFalse();
      fixture.destroy();
    });
  });

  it('answers groundAt with a sample once the terrain exists', () => {
    const fixture = TestBed.createComponent(PlanetTerrainComponent);
    expect(fixture.componentInstance.groundAt([0, 0, 10_005])).toBeUndefined();
    fixture.componentRef.setInput('radius', 10_000);
    fixture.componentRef.setInput('heights', createHeightSource('bumps', 'sphere'));
    fixture.detectChanges();
    const out = createGroundSample();
    const sample = fixture.componentInstance.groundAt([0, 0, 10_005], out)!;
    expect(sample).toBe(out);
    expect(sample.up).toEqual([0, 0, 1]);
    expect(sample.altitudeM).toBeCloseTo(5 - sample.heightM, 9);
    expect(sample.normal.every(Number.isFinite)).toBeTrue();
    fixture.destroy();
  });
});
