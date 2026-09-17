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

  beforeEach(() => {
    tick$ = new Subject<number>();
    mousemove$ = new Subject<MouseEvent>();
    pointerdown$ = new Subject<PointerEvent>();
    const engine = {
      scene: new Scene(),
      renderer: { domElement: document.createElement('canvas') },
      camera: new PerspectiveCamera(),
      resolution$: new BehaviorSubject({ width: 100, height: 100 }),
      isDraggingTransformControls$: new BehaviorSubject(false),
      tick$, postTick$: new Subject<number>(), mousemove$, pointerdown$,
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
});
