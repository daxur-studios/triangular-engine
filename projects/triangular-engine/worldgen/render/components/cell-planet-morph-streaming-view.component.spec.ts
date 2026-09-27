import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { PerspectiveCamera, Scene } from 'three';
import { EngineService } from 'triangular-engine';
import { TerrainSurfaceComponent } from 'triangular-engine/terrain';
import { CellPlanetMorphStreamingViewComponent } from './cell-planet-morph-streaming-view.component';

describe('CellPlanetMorphStreamingViewComponent selection invalidation', () => {
  beforeEach(() => TestBed.configureTestingModule({
    imports: [CellPlanetMorphStreamingViewComponent],
    providers: [{
      provide: EngineService,
      useValue: { scene: new Scene(), camera: new PerspectiveCamera(), beforeRender$: new Subject<void>() },
    }],
  }));

  function createFixture() {
    const fixture = TestBed.createComponent(CellPlanetMorphStreamingViewComponent);
    fixture.componentRef.setInput('radiusM', 1_000);
    fixture.componentRef.setInput('meshGenerator', jasmine.createSpy('unused generator'));
    fixture.detectChanges();
    const surface = fixture.debugElement.query(By.directive(TerrainSurfaceComponent))
      .componentInstance as TerrainSurfaceComponent;
    return { fixture, surface };
  }

  it('updates the selection revision for culling, relief, and caller settings', fakeAsync(() => {
    const { fixture, surface } = createFixture();
    let revision = surface.selectionRevision();
    for (const [name, value] of [
      ['frustumCulling', false], ['horizonCulling', false], ['frustumSafetyFactor', 1.5],
      ['heightScaleM', 2_000], ['selectionRevision', 1], ['projectionKind', 'equirectangular'],
    ] as const) {
      fixture.componentRef.setInput(name, value);
      fixture.detectChanges();
      expect(surface.selectionRevision()).not.toBe(revision);
      revision = surface.selectionRevision();
    }
    expect(JSON.parse(String(revision))).toContain(2_000);
    tick(200);
    fixture.destroy();
  }));

  it('invalidates selection after the morph debounce without changing the selector reference', fakeAsync(() => {
    const { fixture, surface } = createFixture();
    tick(200);
    fixture.detectChanges();
    const selector = surface.patchSelector();
    const revision = surface.selectionRevision();
    fixture.componentRef.setInput('morphProgress', 0.5);
    fixture.detectChanges();
    tick(199);
    fixture.detectChanges();
    expect(surface.selectionRevision()).toBe(revision);
    tick(1);
    fixture.detectChanges();
    expect(surface.selectionRevision()).not.toBe(revision);
    expect(surface.patchSelector()).toBe(selector);
    fixture.destroy();
  }));
});
