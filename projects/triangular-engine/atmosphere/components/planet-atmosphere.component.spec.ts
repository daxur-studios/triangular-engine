import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { PerspectiveCamera, Scene } from 'three';
import { uniform } from 'three/tsl';
import { EngineService, PLANET_CONTEXT, type PlanetContext } from 'triangular-engine';
import { getEvalRenderer } from '../../planet-material/gpu-eval.testing';
import type { IAtmosphereSurface } from '../planet-atmosphere';
import { PlanetAtmosphereComponent } from './planet-atmosphere.component';

/* eslint-disable @typescript-eslint/no-explicit-any */

class FakeSurface implements IAtmosphereSurface {
  lighting: { id: string } | null = null;
  haze: { id: string } | null = null;
  setLightingStage(entry: { id: string } | null): void {
    this.lighting = entry;
  }
  setAtmosphereStage(entry: { id: string } | null): void {
    this.haze = entry;
  }
}

describe('PlanetAtmosphereComponent', () => {
  let scene: Scene;
  let camera: PerspectiveCamera;
  let beforeRender$: Subject<void>;
  let engine: { scene: Scene; camera: PerspectiveCamera; renderer: any; beforeRender$: Subject<void> };

  beforeEach(() => {
    scene = new Scene();
    camera = new PerspectiveCamera();
    camera.position.set(0, 0, 1.5);
    beforeRender$ = new Subject<void>();
    engine = { scene, camera, renderer: null, beforeRender$ };
    TestBed.configureTestingModule({
      imports: [PlanetAtmosphereComponent],
      providers: [{ provide: EngineService, useValue: engine }],
    });
  });

  it('adds the sky, lights the surfaces, follows its inputs per frame and cleans up', async () => {
    engine.renderer = await getEvalRenderer();
    const planet = new FakeSurface();
    const ocean = new FakeSurface();
    const morph = uniform(0.3);
    const fixture = TestBed.createComponent(PlanetAtmosphereComponent);
    fixture.componentRef.setInput('radius', 64_000);
    fixture.componentRef.setInput('radiusUnits', 1);
    fixture.componentRef.setInput('surfaces', [planet, ocean]);
    fixture.componentRef.setInput('morph', morph);
    fixture.componentRef.setInput('sunDirection', [0, 1, 0]);
    fixture.detectChanges();

    const atmosphere = fixture.componentInstance.atmosphere()!;
    expect(atmosphere).toBeDefined();
    expect(scene.children).toContain(atmosphere.object);
    expect(planet.lighting?.id).toBe('atmosphere');
    expect(ocean.haze?.id).toBe('atmosphere');
    expect(atmosphere.binding.morph as unknown).toBe(morph);

    beforeRender$.next();
    expect(atmosphere.binding.cameraAltitude.value).toBeCloseTo(32_000, 0);
    expect(atmosphere.binding.sunBody.value.y).toBeCloseTo(1, 6);

    // Dropping a surface takes the atmosphere off it; turning haze off swaps the stage on the rest.
    fixture.componentRef.setInput('surfaces', [planet]);
    fixture.componentRef.setInput('haze', false);
    fixture.detectChanges();
    expect(ocean.lighting).toBeNull();
    expect(planet.lighting?.id).toBe('atmosphere');
    expect(planet.haze).toBeNull();

    // A thicker air rebakes.
    const version = atmosphere.model.profileVersion;
    fixture.componentRef.setInput('thickness', 0.05);
    fixture.detectChanges();
    expect(atmosphere.model.profileVersion).toBe(version + 1);

    fixture.componentRef.setInput('enabled', false);
    beforeRender$.next();
    expect(atmosphere.backdrop.mesh.visible).toBeFalse();

    fixture.destroy();
    expect(scene.children).not.toContain(atmosphere.object);
    expect(planet.lighting).toBeNull();
    expect(() => beforeRender$.next()).not.toThrow();
  }, 30_000);

  it('does nothing per frame on a renderer that is not WebGPURenderer', () => {
    const fixture = TestBed.createComponent(PlanetAtmosphereComponent);
    fixture.componentRef.setInput('radius', 64_000);
    fixture.componentRef.setInput('radiusUnits', 1);
    fixture.detectChanges();
    expect(() => beforeRender$.next()).not.toThrow();
    expect(fixture.componentInstance.atmosphere()!.binding.cameraAltitude.value).toBe(0);
    fixture.destroy();
  }, 30_000);

  describe('inside a planet', () => {
    function provideContext(radius = signal(64_000)) {
      const morphUniform = uniform(0.4);
      const context: PlanetContext = {
        radius,
        sunDirection: signal<readonly [number, number, number]>([0, 1, 0]),
        morph: signal(0.4),
        morphUniform: morphUniform as unknown as { value: number },
      };
      TestBed.configureTestingModule({ providers: [{ provide: PLANET_CONTEXT, useValue: context }] });
      return { context, morphUniform };
    }

    it('takes the radius, the sun and the morph uniform from the planet', async () => {
      engine.renderer = await getEvalRenderer();
      const { morphUniform } = provideContext();
      const fixture = TestBed.createComponent(PlanetAtmosphereComponent);
      fixture.componentRef.setInput('radiusUnits', 1);
      fixture.detectChanges();

      const atmosphere = fixture.componentInstance.atmosphere()!;
      expect(atmosphere.binding.morph as unknown).toBe(morphUniform);
      beforeRender$.next();
      expect(atmosphere.binding.cameraAltitude.value).toBeCloseTo(32_000, 0);
      expect(atmosphere.binding.sunBody.value.y).toBeCloseTo(1, 6);

      // The uniform is followed, not copied.
      morphUniform.value = 0.9;
      beforeRender$.next();
      expect(atmosphere.binding.morph.value).toBe(0.9);
      expect(atmosphere.morph).toBe(0.9);
      fixture.destroy();
    }, 30_000);

    it('lets its own radius, sun and morph win over the planet', async () => {
      engine.renderer = await getEvalRenderer();
      const { morphUniform } = provideContext();
      const fixture = TestBed.createComponent(PlanetAtmosphereComponent);
      fixture.componentRef.setInput('radius', 32_000);
      fixture.componentRef.setInput('radiusUnits', 1);
      fixture.componentRef.setInput('sunDirection', [1, 0, 0]);
      fixture.componentRef.setInput('morph', 0.7);
      fixture.detectChanges();

      const atmosphere = fixture.componentInstance.atmosphere()!;
      beforeRender$.next();
      expect(atmosphere.binding.morph as unknown).not.toBe(morphUniform);
      expect(atmosphere.binding.morph.value).toBe(0.7);
      expect(atmosphere.binding.cameraAltitude.value).toBeCloseTo(16_000, 0);
      expect(atmosphere.binding.sunBody.value.x).toBeCloseTo(1, 6);
      expect(morphUniform.value).toBe(0.4);
      fixture.destroy();
    }, 30_000);

    it('uses an own morph uniform over the planet one', () => {
      const { morphUniform } = provideContext();
      const own = uniform(0.2);
      const fixture = TestBed.createComponent(PlanetAtmosphereComponent);
      fixture.componentRef.setInput('radiusUnits', 1);
      fixture.componentRef.setInput('morph', own);
      fixture.detectChanges();
      const atmosphere = fixture.componentInstance.atmosphere()!;
      expect(atmosphere.binding.morph as unknown).toBe(own);
      expect(atmosphere.binding.morph as unknown).not.toBe(morphUniform);
      fixture.destroy();
    });

    it('follows the planet radius when it changes', () => {
      const radius = signal(64_000);
      provideContext(radius);
      const fixture = TestBed.createComponent(PlanetAtmosphereComponent);
      fixture.componentRef.setInput('radiusUnits', 1);
      fixture.detectChanges();
      const atmosphere = fixture.componentInstance.atmosphere()!;
      const version = atmosphere.model.profileVersion;
      radius.set(96_000);
      fixture.detectChanges();
      expect(atmosphere.model.profileVersion).toBe(version + 1);
      fixture.destroy();
    }, 30_000);
  });

  it('throws a clear error when neither the component nor a planet gives a radius', () => {
    const fixture = TestBed.createComponent(PlanetAtmosphereComponent);
    expect(() => fixture.detectChanges()).toThrowError(/no radius/);
  });
});
