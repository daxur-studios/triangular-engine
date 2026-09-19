import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { Group, PerspectiveCamera, Scene } from 'three';
import { EngineService } from 'triangular-engine';
import { PlanetViewComponent } from './planet-view.component';

describe('PlanetViewComponent', () => {
  let scene: Scene;
  let camera: PerspectiveCamera;
  let tick$: Subject<number>;

  beforeEach(() => {
    scene = new Scene();
    camera = new PerspectiveCamera();
    tick$ = new Subject<number>();
    TestBed.configureTestingModule({
      imports: [PlanetViewComponent],
      providers: [{ provide: EngineService, useValue: { scene, camera, tick$ } }],
    });
  });

  it('generates a graph/tectonics/ecology and renders chunk meshes on init', () => {
    const fixture = TestBed.createComponent(PlanetViewComponent);
    fixture.componentRef.setInput('cellCount', 60);
    fixture.componentRef.setInput('seed', 1);
    fixture.componentRef.setInput('relaxationIterations', 0);
    fixture.componentRef.setInput('plateCount', 3);
    fixture.detectChanges();

    expect(fixture.componentInstance.graph()).not.toBeNull();
    expect(fixture.componentInstance.tectonics()).not.toBeNull();
    expect(fixture.componentInstance.ecology()).not.toBeNull();
    expect(fixture.componentInstance.buildMs()).not.toBeNull();

    expect(scene.children.length).toBe(1);
    const root = scene.children[0] as Group;
    // previewGroup (chunk meshes) + ocean shell + river lines + coastline lines.
    expect(root.children.length).toBeGreaterThan(0);
    const previewGroup = root.children.find((child) => child.children.length > 0) as Group;
    expect(previewGroup).toBeTruthy();
    expect(previewGroup.children.length).toBeGreaterThan(0);

    fixture.destroy();
    expect(scene.children.length).toBe(0);
  });

  it('re-displaces vertices without rebuilding the graph when elevationScale changes', () => {
    const fixture = TestBed.createComponent(PlanetViewComponent);
    fixture.componentRef.setInput('cellCount', 60);
    fixture.componentRef.setInput('seed', 1);
    fixture.detectChanges();

    const graphBefore = fixture.componentInstance.graph();
    fixture.componentRef.setInput('elevationScale', 0.1);
    fixture.detectChanges();

    expect(fixture.componentInstance.graph()).toBe(graphBefore);

    fixture.destroy();
  });

  it('updates upVector from the camera when useSurfaceUp is enabled', () => {
    camera.position.set(0, 2, 0);
    const fixture = TestBed.createComponent(PlanetViewComponent);
    fixture.componentRef.setInput('cellCount', 60);
    fixture.componentRef.setInput('useSurfaceUp', true);
    fixture.detectChanges();

    tick$.next(0.016);

    expect(fixture.componentInstance.upVector()).toEqual([0, 1, 0]);

    fixture.destroy();
  });

  it('culls chunks in planet-local space when the planet is translated and scaled', () => {
    camera.position.set(1, 0, 0);
    const fixture = TestBed.createComponent(PlanetViewComponent);
    fixture.componentRef.setInput('cellCount', 600);
    fixture.componentRef.setInput('relaxationIterations', 0);
    fixture.detectChanges();

    const root = scene.children[0] as Group;
    tick$.next(0.016);
    const previewGroup = root.children.find(
      (child) => child.children.length > 0,
    ) as Group;
    const atOriginVisibility = previewGroup.children.map(
      (child) => child.visible,
    );

    root.position.set(-10, 0, 0);
    root.scale.setScalar(10);
    root.updateMatrixWorld(true);
    camera.position.set(0, 0, 0);
    tick$.next(0.016);

    expect(previewGroup.children.map((child) => child.visible)).toEqual(
      atOriginVisibility,
    );

    fixture.destroy();
  });

  it('derives surface up in planet-local space', () => {
    camera.position.set(0, 0, 0);
    const fixture = TestBed.createComponent(PlanetViewComponent);
    fixture.componentRef.setInput('cellCount', 60);
    fixture.componentRef.setInput('useSurfaceUp', true);
    fixture.detectChanges();

    const root = scene.children[0] as Group;
    root.position.set(-20, 0, 0);
    root.scale.setScalar(10);
    root.updateMatrixWorld(true);
    tick$.next(0.016);

    expect(fixture.componentInstance.upVector()).toEqual([1, 0, 0]);

    fixture.destroy();
  });

  it('toggles cell borders and territory borders overlays', () => {
    const fixture = TestBed.createComponent(PlanetViewComponent);
    fixture.componentRef.setInput('cellCount', 60);
    fixture.componentRef.setInput('showCellBorders', true);
    fixture.componentRef.setInput('showTerritoryBorders', true);
    fixture.detectChanges();

    const root = scene.children[0] as Group;
    // Verify lines were added to root
    const lineSegments = root.children.filter((c) => c.type === 'LineSegments');
    expect(lineSegments.length).toBeGreaterThanOrEqual(2);

    fixture.destroy();
  });

  it('updates border vertex radius when clampBordersToSeaLevel is toggled', () => {
    const fixture = TestBed.createComponent(PlanetViewComponent);
    fixture.componentRef.setInput('cellCount', 60);
    fixture.componentRef.setInput('elevationScale', 0.1);
    fixture.componentRef.setInput('showCellBorders', true);
    fixture.componentRef.setInput('clampBordersToSeaLevel', true);
    fixture.detectChanges();

    const root = scene.children[0] as Group;
    const borderLines = root.children.find((c) => c.name === 'cell-borders') as LineSegments;
    expect(borderLines).toBeDefined();

    const posAttr = borderLines.geometry.getAttribute('position') as BufferAttribute;
    const posClamped = (posAttr.array as Float32Array).slice();

    // Toggle clamp to false -> underwater edges will sink below 1.0 + clearance
    fixture.componentRef.setInput('clampBordersToSeaLevel', false);
    fixture.detectChanges();

    const posUnclamped = (posAttr.array as Float32Array).slice();

    // Verify at least one underwater vertex position changed to a lower radius
    let foundSubmergedDiff = false;
    for (let i = 0; i < posClamped.length; i += 3) {
      const lenClamped = Math.hypot(posClamped[i], posClamped[i + 1], posClamped[i + 2]);
      const lenUnclamped = Math.hypot(posUnclamped[i], posUnclamped[i + 1], posUnclamped[i + 2]);
      if (lenUnclamped < lenClamped - 1e-4) {
        foundSubmergedDiff = true;
        break;
      }
    }
    expect(foundSubmergedDiff).toBeTrue();

    fixture.destroy();
  });
});
