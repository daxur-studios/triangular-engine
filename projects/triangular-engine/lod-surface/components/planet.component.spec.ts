import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { PerspectiveCamera, Scene, Texture } from 'three';
import { EngineService, PLANET_CONTEXT } from 'triangular-engine';
import {
  resolveCellPlanetWorld, runBake, seaAlignedGlobeRadius, type BakeClient, type BakeResult,
} from 'triangular-engine/lod-surface/core';
import { PlanetComponent, type PlanetProjectionCentre, type PlanetWorld } from './planet.component';

/* eslint-disable @typescript-eslint/no-explicit-any */

@Component({ standalone: true, selector: 'probe', template: '' })
class ProbeComponent {
  readonly context = inject(PLANET_CONTEXT, { optional: true });
}

@Component({
  standalone: true,
  imports: [PlanetComponent, ProbeComponent],
  template: `<planet
    [radius]="radius()"
    [sunDirection]="sun()"
    [morph]="morph()"
    [projection]="projection()"
    [projectionCentre]="centre()"
    [world]="world()"
    [bake]="bake()"
  ><probe /></planet>`,
})
class HostComponent {
  readonly radius = signal(10_000);
  readonly sun = signal<readonly [number, number, number]>([0, 0, 2]);
  readonly morph = signal(0);
  readonly projection = signal<'equal-earth' | 'equirectangular'>('equal-earth');
  readonly centre = signal<PlanetProjectionCentre | null>(null);
  readonly world = signal<PlanetWorld | undefined>(undefined);
  readonly bake = signal<BakeClient | undefined>(undefined);
}

describe('PlanetComponent', () => {
  const world: PlanetWorld = { seed: 3, cellCount: 60, heightScaleM: 200, bakeK: 4 };
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve));
  let error$: Subject<{ phase: string; error: unknown }>;
  let errors: { phase: string; error: unknown }[];

  beforeEach(() => {
    error$ = new Subject();
    errors = [];
    error$.subscribe((event) => errors.push(event));
    const engine = { scene: new Scene(), camera: new PerspectiveCamera(), renderer: null, beforeRender$: new Subject<void>(), error$ };
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: EngineService, useValue: engine }],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const planet = fixture.debugElement.children[0].componentInstance as PlanetComponent;
    const probe = fixture.debugElement.children[0].children[0].componentInstance as ProbeComponent;
    return { fixture, host: fixture.componentInstance, planet, probe };
  }

  /** A bake whose answers are released by hand, in any order. */
  function manualBake() {
    const calls: { radius: number; resolve(): void; reject(error: Error): void }[] = [];
    const client: BakeClient = (source, layout, planet) =>
      new Promise<BakeResult>((resolve, reject) => {
        calls.push({
          radius: layout.sizeM,
          resolve: () => resolve({ ...runBake(source, layout, planet), roundTripMs: 0 }),
          reject,
        });
      });
    return { client, calls };
  }

  it('provides PLANET_CONTEXT to its content, backed by the planet itself', () => {
    const { planet, probe } = create();
    expect(probe.context).toBe(planet as any);
    expect(probe.context!.radius()).toBe(10_000);
    expect(probe.context!.morphUniform).toBe(planet.morphUniforms.uMorph as any);
  });

  it('normalises the sun, defaults it to the terrain sun, and clamps the morph', () => {
    const { fixture, host, planet } = create();
    const [x, y, z] = planet.sunDirection();
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    expect([x, y, z]).toEqual([0, 0, 1]);

    host.morph.set(1.7);
    fixture.detectChanges();
    expect(planet.morph()).toBe(1);
    host.morph.set(-3);
    fixture.detectChanges();
    expect(planet.morph()).toBe(0);
    host.morph.set(0.25);
    fixture.detectChanges();
    expect(planet.morph()).toBe(0.25);

    const standalone = TestBed.createComponent(PlanetComponent);
    standalone.componentRef.setInput('radius', 5_000);
    standalone.detectChanges();
    const sun = standalone.componentInstance.sunDirection();
    expect(sun[0]).toBeCloseTo(0.4 / Math.hypot(0.4, 0.8, 0.45), 12);
    expect(standalone.componentInstance.morph()).toBe(0);
    standalone.destroy();
  });

  it('writes morph, projection, centre and map extent into the one shared uniform set', () => {
    const { fixture, host, planet } = create();
    const uniforms = planet.morphUniforms;
    expect(planet.morphUniform).toBe(uniforms.uMorph as any);
    expect(uniforms.uProjectionType.value).toBe(1);
    expect(uniforms.uProjMode.value).toBe(0);
    expect(uniforms.uRadius.value).toBe(10_000);
    expect(uniforms.uMapWidth.value).toBeCloseTo(2 * Math.PI * 10_000, 6);

    host.morph.set(0.5);
    host.projection.set('equirectangular');
    host.centre.set({ lonDeg: 90, latDeg: 0 });
    host.radius.set(20_000);
    fixture.detectChanges();
    expect(planet.morphUniform).toBe(uniforms.uMorph as any);
    expect(planet.morphUniform.value).toBe(0.5);
    expect(uniforms.uProjectionType.value).toBe(0);
    expect(uniforms.uProjMode.value).toBe(1);
    expect(uniforms.uProjForward.value.x).toBeCloseTo(1, 12);
    expect(uniforms.uProjForward.value.z).toBeCloseTo(0, 12);
    expect(uniforms.uRadius.value).toBe(20_000);

    host.projection.set('equal-earth');
    host.centre.set(null);
    fixture.detectChanges();
    expect(uniforms.uProjectionType.value).toBe(1);
    expect(uniforms.uProjMode.value).toBe(0);
  });

  describe('world', () => {
    it('has no heights, cell planet or sea-aligned radius without a world', () => {
      const { planet } = create();
      expect(planet.heights()).toBeUndefined();
      expect(planet.cellPlanet()).toBeUndefined();
      expect(planet.seaAlignedGlobeRadius()).toBeUndefined();
    });

    it('bakes heights for its radius with the default inline bake, then offers them', async () => {
      const { fixture, host, planet } = create();
      host.world.set(world);
      fixture.detectChanges();
      expect(planet.heights()).toBeUndefined();
      expect(planet.cellPlanet()).toEqual({ seed: 3, cellCount: 60 });
      for (let i = 0; i < 200 && !planet.heights(); i += 1) await flush();
      const heights = planet.heights() as any;
      expect(heights).toBeDefined();
      expect(heights.id).toBe('cell-planet');
      expect(heights.baked.layout.sizeM).toBe(10_000);
      expect(heights.baked.layout.k).toBe(4);
    });

    it('passes relaxationIterations on to the cell planet only when set', () => {
      const { fixture, host, planet } = create();
      host.world.set({ ...world, relaxationIterations: 1 });
      host.bake.set(manualBake().client);
      fixture.detectChanges();
      expect(planet.cellPlanet()).toEqual({ seed: 3, cellCount: 60, relaxationIterations: 1 });
    });

    it('ignores a stale bake that lands after a newer one, and frees its texture', async () => {
      const { fixture, host, planet } = create();
      const manual = manualBake();
      host.bake.set(manual.client);
      host.world.set(world);
      fixture.detectChanges();
      host.radius.set(12_000);
      fixture.detectChanges();
      expect(manual.calls.map((call) => call.radius)).toEqual([10_000, 12_000]);

      const dispose = spyOn(Texture.prototype, 'dispose').and.callThrough();
      manual.calls[1].resolve();
      await flush();
      const newest = planet.heights() as any;
      expect(newest.baked.layout.sizeM).toBe(12_000);

      manual.calls[0].resolve();
      await flush();
      expect(planet.heights()).toBe(newest);
      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('goes back to undefined while a changed world bakes, and frees the replaced texture after the next render', async () => {
      const { fixture, host, planet } = create();
      const manual = manualBake();
      host.bake.set(manual.client);
      host.world.set(world);
      fixture.detectChanges();
      manual.calls[0].resolve();
      await flush();
      expect(planet.heights()).toBeDefined();

      const dispose = spyOn(Texture.prototype, 'dispose').and.callThrough();
      host.world.set({ ...world, seed: 4 });
      fixture.detectChanges();
      expect(planet.heights()).toBeUndefined();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(manual.calls.length).toBe(2);

      // An equal description (a new object) does not bake again.
      host.world.set({ ...world, seed: 4 });
      fixture.detectChanges();
      expect(manual.calls.length).toBe(2);
    });

    it('reports a failed bake on engine.error$ (phase bake) and keeps no heights', async () => {
      const { fixture, host, planet } = create();
      const manual = manualBake();
      host.bake.set(manual.client);
      host.world.set(world);
      fixture.detectChanges();
      const failure = new Error('worker died');
      manual.calls[0].reject(failure);
      await flush();
      expect(errors).toEqual([{ phase: 'bake', error: failure }]);
      expect(planet.heights()).toBeUndefined();
    });

    it('reports invalid world parameters as a bake error', async () => {
      const { fixture, host } = create();
      host.world.set({ ...world, seed: -1 });
      fixture.detectChanges();
      for (let i = 0; i < 50 && errors.length === 0; i += 1) await flush();
      expect(errors.length).toBe(1);
      expect(errors[0].phase).toBe('bake');
    });

    it('does not report, or keep, a bake that finishes after the planet is destroyed', async () => {
      const { fixture, host } = create();
      const manual = manualBake();
      host.bake.set(manual.client);
      host.world.set(world);
      fixture.detectChanges();
      const dispose = spyOn(Texture.prototype, 'dispose').and.callThrough();
      fixture.destroy();
      manual.calls[0].resolve();
      await flush();
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(errors).toEqual([]);
    });

    it('frees the current heights when destroyed', async () => {
      const { fixture, host, planet } = create();
      const manual = manualBake();
      host.bake.set(manual.client);
      host.world.set(world);
      fixture.detectChanges();
      manual.calls[0].resolve();
      await flush();
      expect(planet.heights()).toBeDefined();
      const dispose = spyOn(Texture.prototype, 'dispose').and.callThrough();
      fixture.destroy();
      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('gives the radius that aligns a separate globe\'s sea with the terrain\'s', () => {
      const { fixture, host, planet } = create();
      host.bake.set(manualBake().client);
      host.world.set(world);
      fixture.detectChanges();
      const expected = seaAlignedGlobeRadius(10_000, resolveCellPlanetWorld({ seed: 3, cellCount: 60 }), 200);
      expect(planet.seaAlignedGlobeRadius()).toBeCloseTo(expected, 9);
      expect(planet.seaAlignedGlobeRadius()).not.toBe(10_000);

      host.radius.set(20_000);
      fixture.detectChanges();
      expect(planet.seaAlignedGlobeRadius()! - 20_000).toBeCloseTo(expected - 10_000, 9);
    });
  });
});
