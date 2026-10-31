import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { PerspectiveCamera, Scene } from 'three';
import { EngineService, PLANET_CONTEXT, type PlanetContext } from 'triangular-engine';
import { SURFACE_LAYER_ORDER, type PlanetSurfaceMaterial, type SurfaceLayer } from 'triangular-engine/planet-material';
import { FlatFeaturePageWindow, type FlatFeature } from 'triangular-engine/worldgen/render/core';
import { PlanetSurfaceDetailComponent } from './planet-surface-detail.component';

/* eslint-disable @typescript-eslint/no-explicit-any */

const RADIUS_M = 600_000;

function fakeLayer(): SurfaceLayer {
  return (() => undefined) as unknown as SurfaceLayer;
}

/**
 * A stand-in material with the same rule as the real one: adding a taken id throws. `active` is the net set of layers on it,
 * replayed from the calls, so each assertion reads what the material would draw.
 */
function standIn() {
  const active = new Map<string, { order: number; layer: SurfaceLayer }>();
  const spies = {
    addSurfaceLayer: jasmine.createSpy('addSurfaceLayer').and.callFake((entry: { id: string; order: number; layer: SurfaceLayer }) => {
      if (active.has(entry.id)) throw new Error(`Planet material slot "${entry.id}" already exists`);
      active.set(entry.id, { order: entry.order, layer: entry.layer });
      return surface;
    }),
    removeSurfaceLayer: jasmine.createSpy('removeSurfaceLayer').and.callFake((id: string) => active.delete(id)),
  };
  const surface = spies as unknown as { addSurfaceLayer: any; removeSurfaceLayer: any };
  return { surface: surface as unknown as PlanetSurfaceMaterial, spies, active };
}

describe('PlanetSurfaceDetailComponent', () => {
  let scene: Scene;
  let camera: PerspectiveCamera;
  let beforeRender$: Subject<void>;
  let engine: { scene: Scene; camera: PerspectiveCamera; renderer: any; beforeRender$: Subject<void> };

  beforeEach(() => {
    scene = new Scene();
    camera = new PerspectiveCamera();
    camera.position.set(0, 0, 1000);
    beforeRender$ = new Subject<void>();
    engine = { scene, camera, renderer: null, beforeRender$ };
    TestBed.configureTestingModule({
      imports: [PlanetSurfaceDetailComponent],
      providers: [{ provide: EngineService, useValue: engine }],
    });
  });

  function provideContext(radius = signal(RADIUS_M)) {
    const context: PlanetContext = {
      radius,
      sunDirection: signal<readonly [number, number, number]>([0, 1, 0]),
      morph: signal(0),
      morphUniform: { value: 0 },
    };
    TestBed.configureTestingModule({ providers: [{ provide: PLANET_CONTEXT, useValue: context }] });
    return context;
  }

  const runway: FlatFeature = { kind: 'rectangle', centre: [1, 0, 0], headingRad: 0, lengthM: 2_000, widthM: 45, markings: 'runway' };

  it('adds each layer under its id, at the game order plus its index unless an order is given', () => {
    const s = standIn();
    const a = fakeLayer();
    const b = fakeLayer();
    const c = fakeLayer();
    const fixture = TestBed.createComponent(PlanetSurfaceDetailComponent);
    fixture.componentRef.setInput('surface', s.surface);
    fixture.componentRef.setInput('layers', [
      { id: 'roads', layer: a },
      { id: 'decals', layer: b, order: 5 },
      { id: 'snow', layer: c },
    ]);
    fixture.detectChanges();

    expect(s.active.size).toBe(3);
    expect(s.active.get('roads')!.layer).toBe(a);
    expect(s.active.get('roads')!.order).toBe(SURFACE_LAYER_ORDER.game);
    expect(s.active.get('decals')!.layer).toBe(b);
    expect(s.active.get('decals')!.order).toBe(5);
    expect(s.active.get('snow')!.layer).toBe(c);
    expect(s.active.get('snow')!.order).toBe(SURFACE_LAYER_ORDER.game + 2);
    fixture.destroy();
  });

  it('removes the old ids and adds the new ones when layers change', () => {
    const s = standIn();
    const b1 = fakeLayer();
    const b2 = fakeLayer();
    const c = fakeLayer();
    const fixture = TestBed.createComponent(PlanetSurfaceDetailComponent);
    fixture.componentRef.setInput('surface', s.surface);
    fixture.componentRef.setInput('layers', [{ id: 'a', layer: fakeLayer() }, { id: 'b', layer: b1 }]);
    fixture.detectChanges();

    fixture.componentRef.setInput('layers', [{ id: 'b', layer: b2 }, { id: 'c', layer: c }]);
    fixture.detectChanges();

    expect(s.spies.removeSurfaceLayer).toHaveBeenCalledWith('a');
    expect([...s.active.keys()].sort()).toEqual(['b', 'c']);
    expect(s.active.get('b')!.layer).toBe(b2);
    expect(s.active.get('c')!.layer).toBe(c);
    fixture.destroy();
  });

  it('keeps the later entry when an id is listed twice', () => {
    const s = standIn();
    const second = fakeLayer();
    const fixture = TestBed.createComponent(PlanetSurfaceDetailComponent);
    fixture.componentRef.setInput('surface', s.surface);
    fixture.componentRef.setInput('layers', [{ id: 'dup', layer: fakeLayer() }, { id: 'dup', layer: second }]);
    expect(() => fixture.detectChanges()).not.toThrow();

    expect(s.active.size).toBe(1);
    expect(s.active.get('dup')!.layer).toBe(second);
    fixture.destroy();
  });

  it('removes every layer when disabled and adds them back when enabled', () => {
    const s = standIn();
    const a = fakeLayer();
    const fixture = TestBed.createComponent(PlanetSurfaceDetailComponent);
    fixture.componentRef.setInput('surface', s.surface);
    fixture.componentRef.setInput('layers', [{ id: 'roads', layer: a }]);
    fixture.detectChanges();
    expect(s.active.has('roads')).toBeTrue();

    fixture.componentRef.setInput('enabled', false);
    fixture.detectChanges();
    expect(s.spies.removeSurfaceLayer).toHaveBeenCalledWith('roads');
    expect(s.active.size).toBe(0);

    fixture.componentRef.setInput('enabled', true);
    fixture.detectChanges();
    expect(s.active.get('roads')!.layer).toBe(a);
    fixture.destroy();
  });

  it('takes its layers off the old material and puts them on the new one when surface changes', () => {
    const first = standIn();
    const second = standIn();
    const a = fakeLayer();
    const fixture = TestBed.createComponent(PlanetSurfaceDetailComponent);
    fixture.componentRef.setInput('surface', first.surface);
    fixture.componentRef.setInput('layers', [{ id: 'roads', layer: a }]);
    fixture.detectChanges();

    fixture.componentRef.setInput('surface', second.surface);
    fixture.detectChanges();
    expect(first.spies.removeSurfaceLayer).toHaveBeenCalledWith('roads');
    expect(first.active.size).toBe(0);
    expect(second.active.get('roads')!.layer).toBe(a);
    fixture.destroy();
  });

  it('does nothing and does not throw while the surface is undefined', () => {
    const fixture = TestBed.createComponent(PlanetSurfaceDetailComponent);
    fixture.componentRef.setInput('layers', [{ id: 'roads', layer: fakeLayer() }]);
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(() => beforeRender$.next()).not.toThrow();
    fixture.destroy();
  });

  it('removes all its layers when destroyed', () => {
    const s = standIn();
    const fixture = TestBed.createComponent(PlanetSurfaceDetailComponent);
    fixture.componentRef.setInput('surface', s.surface);
    fixture.componentRef.setInput('layers', [{ id: 'roads', layer: fakeLayer() }, { id: 'snow', layer: fakeLayer() }]);
    fixture.detectChanges();
    expect(s.active.size).toBe(2);

    fixture.destroy();
    expect(s.spies.removeSurfaceLayer).toHaveBeenCalledWith('roads');
    expect(s.spies.removeSurfaceLayer).toHaveBeenCalledWith('snow');
    expect(s.active.size).toBe(0);
    expect(() => beforeRender$.next()).not.toThrow();
  });

  it('takes the radius from the planet when none is given', () => {
    const s = standIn();
    provideContext();
    const fixture = TestBed.createComponent(PlanetSurfaceDetailComponent);
    fixture.componentRef.setInput('surface', s.surface);
    fixture.componentRef.setInput('flatFeatures', [runway]);
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(s.active.has('flatFeatures')).toBeTrue();
    fixture.destroy();
  });

  describe('flat features', () => {
    it('throws on init when flatFeatures is set and there is no radius', () => {
      const s = standIn();
      const fixture = TestBed.createComponent(PlanetSurfaceDetailComponent);
      fixture.componentRef.setInput('surface', s.surface);
      fixture.componentRef.setInput('flatFeatures', [runway]);
      expect(() => fixture.detectChanges()).toThrowError(/no radius/);
    });

    it('adds the flat-feature layer under the game layers, moves its window every frame and removes it when cleared', () => {
      const s = standIn();
      const update = spyOn(FlatFeaturePageWindow.prototype, 'update').and.callThrough();
      const dispose = spyOn(FlatFeaturePageWindow.prototype, 'dispose').and.callThrough();
      const fixture = TestBed.createComponent(PlanetSurfaceDetailComponent);
      fixture.componentRef.setInput('surface', s.surface);
      fixture.componentRef.setInput('radius', RADIUS_M);
      fixture.componentRef.setInput('layers', [{ id: 'roads', layer: fakeLayer() }]);
      fixture.componentRef.setInput('flatFeatures', [runway]);
      fixture.detectChanges();

      expect(s.active.get('flatFeatures')!.order).toBe(SURFACE_LAYER_ORDER.game - 1);
      expect(s.active.get('roads')!.order).toBe(SURFACE_LAYER_ORDER.game);

      camera.position.set(RADIUS_M + 500, 0, 0);
      beforeRender$.next();
      expect(update).toHaveBeenCalled();
      const [direction, altitude] = update.calls.mostRecent().args as unknown as [number[], number];
      expect(direction[0]).toBeCloseTo(1, 9);
      expect(direction[1]).toBeCloseTo(0, 9);
      expect(altitude).toBeCloseTo(500, 6);

      camera.position.set(0, 0, 2 * RADIUS_M);
      beforeRender$.next();
      expect(update.calls.mostRecent().args[1] as number).toBeCloseTo(RADIUS_M, 6);

      fixture.componentRef.setInput('flatFeatures', undefined);
      fixture.detectChanges();
      expect(dispose).toHaveBeenCalled();
      expect(s.active.has('flatFeatures')).toBeFalse();
      expect(s.active.has('roads')).toBeTrue();

      update.calls.reset();
      beforeRender$.next();
      expect(update).not.toHaveBeenCalled();
      fixture.destroy();
    });
  });
});
