import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { PerspectiveCamera, Scene } from 'three';
import { uniform } from 'three/tsl';
import { EngineService, PLANET_CONTEXT, type PlanetContext } from 'triangular-engine';
import { PlanetCloudsComponent } from './planet-clouds.component';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('PlanetCloudsComponent', () => {
  let scene: Scene;
  let camera: PerspectiveCamera;
  let beforeRender$: Subject<void>;
  let engine: { scene: Scene; camera: PerspectiveCamera; renderer: any; beforeRender$: Subject<void> };

  beforeEach(() => {
    scene = new Scene();
    camera = new PerspectiveCamera();
    camera.position.set(0, 0, 1000);
    beforeRender$ = new Subject<void>();
    // The shell itself needs no GPU; a WebGPU-flagged stand-in turns the per-frame update on.
    engine = { scene, camera, renderer: { isWebGPURenderer: true }, beforeRender$ };
    TestBed.configureTestingModule({
      imports: [PlanetCloudsComponent],
      providers: [{ provide: EngineService, useValue: engine }],
    });
  });

  it('adds the layer to the scene, follows its inputs per frame and cleans up', () => {
    const fixture = TestBed.createComponent(PlanetCloudsComponent);
    fixture.componentRef.setInput('radius', 64_000);
    fixture.componentRef.setInput('coverage', 0.3);
    fixture.componentRef.setInput('enabled', true);
    fixture.detectChanges();

    const shell = fixture.componentInstance.shell()!;
    expect(shell).toBeDefined();
    expect(scene.children).toContain(shell.object);
    expect(shell.object.scale.x).toBeCloseTo(64_000 * 1.0015, 3);

    beforeRender$.next();
    expect(shell.coverage).toBe(0.3);
    expect(shell.object.visible).toBeTrue();

    fixture.componentRef.setInput('enabled', false);
    beforeRender$.next();
    expect(shell.object.visible).toBeFalse();

    const dispose = spyOn(shell, 'dispose').and.callThrough();
    fixture.destroy();
    expect(dispose).toHaveBeenCalled();
    expect(scene.children).not.toContain(shell.object);
    expect(() => beforeRender$.next()).not.toThrow();
  });

  it('keeps the layer hidden and does nothing per frame on a renderer that is not WebGPURenderer', () => {
    engine.renderer = { isWebGPURenderer: false };
    const fixture = TestBed.createComponent(PlanetCloudsComponent);
    fixture.componentRef.setInput('radius', 64_000);
    fixture.detectChanges();
    const shell = fixture.componentInstance.shell()!;
    expect(() => beforeRender$.next()).not.toThrow();
    expect(shell.object.visible).toBeFalse();
    expect(shell.morph).toBe(0);
    fixture.destroy();
  });

  it('throws a clear error when neither the component nor a planet gives a radius', () => {
    const fixture = TestBed.createComponent(PlanetCloudsComponent);
    expect(() => fixture.detectChanges()).toThrowError(/no radius/);
  });

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

    it('takes the radius, the sun and the morph from the planet', () => {
      const { morphUniform } = provideContext();
      const fixture = TestBed.createComponent(PlanetCloudsComponent);
      fixture.detectChanges();

      const shell = fixture.componentInstance.shell()!;
      expect(shell.object.scale.x).toBeCloseTo(64_000 * 1.0015, 3);
      beforeRender$.next();
      expect(shell.sunDirection.y).toBeCloseTo(1, 6);
      expect(shell.morph).toBeCloseTo(0.4, 10);

      // The uniform is followed, not copied: at morph 0.9 the layer is gone.
      morphUniform.value = 0.9;
      beforeRender$.next();
      expect(shell.morph).toBe(0.9);
      expect(shell.object.visible).toBeFalse();
      fixture.destroy();
    });

    it('lets its own radius, sun and morph win over the planet', () => {
      provideContext();
      const fixture = TestBed.createComponent(PlanetCloudsComponent);
      fixture.componentRef.setInput('radius', 32_000);
      fixture.componentRef.setInput('sunDirection', [1, 0, 0]);
      fixture.componentRef.setInput('morph', 0.1);
      fixture.detectChanges();

      const shell = fixture.componentInstance.shell()!;
      expect(shell.object.scale.x).toBeCloseTo(32_000 * 1.0015, 3);
      beforeRender$.next();
      expect(shell.sunDirection.x).toBeCloseTo(1, 6);
      expect(shell.morph).toBe(0.1);
      fixture.destroy();
    });

    it('follows the planet radius when it changes', () => {
      const radius = signal(64_000);
      provideContext(radius);
      const fixture = TestBed.createComponent(PlanetCloudsComponent);
      fixture.detectChanges();
      const shell = fixture.componentInstance.shell()!;
      radius.set(96_000);
      fixture.detectChanges();
      expect(shell.object.scale.x).toBeCloseTo(96_000 * 1.0015, 3);
      fixture.destroy();
    });
  });
});
