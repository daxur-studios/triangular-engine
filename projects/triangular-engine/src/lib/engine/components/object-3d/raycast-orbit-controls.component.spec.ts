import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { PerspectiveCamera, Raycaster, Scene, Vector3, Vector3Tuple } from 'three';
import { EngineService } from '../../services';
import { RaycastService } from './raycast';
import { RaycastOrbitControlsComponent } from './raycast-orbit-controls.component';

describe('RaycastOrbitControls bookmark focus', () => {
  let fixture: ComponentFixture<RaycastOrbitControlsComponent>;
  let controls: RaycastOrbitControlsComponent;
  let tick$: Subject<number>;
  let mousemove$: Subject<MouseEvent>;
  let pointerdown$: Subject<PointerEvent>;
  let wheel$: Subject<WheelEvent>;

  function focus(target: Vector3Tuple, position: Vector3Tuple): void {
    fixture.componentRef.setInput('target', target);
    fixture.componentRef.setInput('cameraPosition', position);
    fixture.detectChanges();
  }

  function cacheCursor(): void {
    fixture.componentRef.setInput('raycastFocusResolver', () => new Vector3(-900, 0, 700));
    fixture.detectChanges();
    mousemove$.next({ offsetX: 50, offsetY: 50 } as MouseEvent);
  }

  function zoomOnce(scale = 0.5): void {
    wheel$.next({ offsetX: 50, offsetY: 50, deltaY: -100 } as WheelEvent);
    controls.orbitControls()!.dollyIn(scale);
    tick$.next(1 / 60);
  }

  beforeEach(() => {
    tick$ = new Subject<number>();
    mousemove$ = new Subject<MouseEvent>();
    pointerdown$ = new Subject<PointerEvent>();
    wheel$ = new Subject<WheelEvent>();
    const engine = {
      scene: new Scene(),
      renderer: { domElement: document.createElement('canvas') },
      camera: new PerspectiveCamera(),
      resolution$: new BehaviorSubject({ width: 100, height: 100 }),
      isDraggingTransformControls$: new BehaviorSubject(false),
      tick$, postTick$: new Subject<number>(), mousemove$, pointerdown$, wheel$,
      switchCamera(camera: PerspectiveCamera) { this.camera = camera; },
    };
    TestBed.configureTestingModule({
      imports: [RaycastOrbitControlsComponent],
      providers: [
        { provide: EngineService, useValue: engine },
        { provide: RaycastService, useValue: { raycaster: new Raycaster() } },
      ],
    });
    fixture = TestBed.createComponent(RaycastOrbitControlsComponent);
    controls = fixture.componentInstance;
    focus([0, 0, 0], [0, 100, 100]);
    tick$.next(1 / 60);
    cacheCursor();
  });

  it('keeps both close bookmark and overview poses through subsequent ticks', () => {
    for (const [target, position] of [
      [[120, 8, -70], [140, 28, -50]],
      [[0, 0, 0], [4800, 4200, 4800]],
    ] as [Vector3Tuple, Vector3Tuple][]) {
      focus(target, position);
      for (let frame = 0; frame < 20; frame++) tick$.next(1 / 60);
      expect(controls.orbitControls()!.target.toArray()).toEqual(target);
      expect(controls.internalCamera.position.toArray()).toEqual(position);
      cacheCursor();
    }
  });

  it('cancels an unfinished rotate handoff when a bookmark is selected', () => {
    pointerdown$.next({ button: 1 } as PointerEvent);
    tick$.next(0.04);
    focus([120, 8, -70], [140, 28, -50]);
    tick$.next(0.2);
    expect(controls.orbitControls()!.target.toArray()).toEqual([120, 8, -70]);
    expect(controls.internalCamera.position.toArray()).toEqual([140, 28, -50]);
  });

  it('still anchors a user dolly after a fresh cursor sample', () => {
    focus([120, 8, -70], [140, 28, -50]);
    tick$.next(1 / 60);
    cacheCursor();
    const orbit = controls.orbitControls()!;
    const offset = controls.internalCamera.position.clone().sub(orbit.target).multiplyScalar(0.5);
    controls.internalCamera.position.copy(orbit.target).add(offset);
    tick$.next(1 / 60);
    expect(orbit.target.toArray()).toEqual([-390, 4, 315]);
    expect(controls.internalCamera.position.clone().sub(orbit.target).toArray()).toEqual(offset.toArray());
  });

  it('re-queries and rebases every repeated zoom on the same surface point', () => {
    const surface = new Vector3(10, 0, 0);
    let resolverCalls = 0;
    fixture.componentRef.setInput('raycastFocusResolver', () => {
      resolverCalls++;
      return surface;
    });
    fixture.detectChanges();

    for (let step = 0; step < 20; step++) zoomOnce();

    expect(resolverCalls).toBe(20);
    expect(controls.internalCamera.position.distanceTo(surface)).toBeGreaterThanOrEqual(0.5 - 1e-8);
    expect(controls.internalCamera.position.distanceTo(surface)).toBeLessThan(1);
  });

  it('rebases alternating near and far terrain hits without retaining the old anchor', () => {
    const hits = [new Vector3(8, 0, 0), new Vector3(-800, 0, 0)];
    let resolverCalls = 0;
    fixture.componentRef.setInput('raycastFocusResolver', () => hits[resolverCalls++ % hits.length]);
    fixture.detectChanges();

    zoomOnce();
    const afterNearHit = controls.internalCamera.position.distanceTo(hits[0]);
    zoomOnce();
    const afterFarHit = controls.internalCamera.position.distanceTo(hits[1]);

    expect(afterNearHit).toBeGreaterThanOrEqual(0.5 - 1e-8);
    expect(afterFarHit).toBeGreaterThanOrEqual(0.5 - 1e-8);
    expect(resolverCalls).toBe(2);
  });

  it('uses the moving surface returned by dynamic LOD or morphing on each zoom', () => {
    const surfaces = [
      new Vector3(0, 0, 40),
      new Vector3(0, 0, 20),
      new Vector3(0, 0, 5),
    ];
    let resolverCalls = 0;
    fixture.componentRef.setInput('raycastFocusResolver', () => surfaces[Math.min(resolverCalls++, surfaces.length - 1)]);
    fixture.detectChanges();

    for (const surface of surfaces) {
      zoomOnce();
      expect(controls.internalCamera.position.distanceTo(surface)).toBeGreaterThanOrEqual(0.5 - 1e-8);
    }

    expect(resolverCalls).toBe(surfaces.length);
  });

  it('keeps flat and spherical terrain hits on the camera side of the surface', () => {
    for (const surface of [new Vector3(0, 0, 30), new Vector3(0, 30, 0)]) {
      focus([0, 0, 0], [0, 100, 100]);
      fixture.componentRef.setInput('raycastFocusResolver', () => surface);
      fixture.detectChanges();

      for (let step = 0; step < 12; step++) zoomOnce();

      expect(controls.internalCamera.position.distanceTo(surface)).toBeGreaterThanOrEqual(0.5 - 1e-8);
    }
  });

  it('keeps the distance-scaled fallback when the current ray misses terrain', () => {
    fixture.componentRef.setInput('raycastFocusResolver', () => null);
    fixture.detectChanges();
    const before = controls.internalCamera.position.distanceTo(controls.orbitControls()!.target);

    zoomOnce();

    expect(controls.internalCamera.position.distanceTo(controls.orbitControls()!.target)).toBeLessThan(before);
  });
});
