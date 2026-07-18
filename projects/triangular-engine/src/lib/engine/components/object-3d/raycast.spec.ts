import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { Object3D, PerspectiveCamera } from 'three';
import { EngineService, EngineSettingsService } from '../../services';
import { Object3DComponent } from './object-3d.component';
import { IRaycastEvent, RaycastDirective, RaycastService } from './raycast';

class FakeObject3DComponent {
  private readonly obj = new Object3D();
  object3D = () => this.obj;
}

function makeMouseEvent(button: number): MouseEvent {
  return { button, offsetX: 0, offsetY: 0 } as MouseEvent;
}

@Component({
  standalone: true,
  imports: [RaycastDirective],
  template: `
    <div
      raycast
      [raycastGroup]="group"
      [raycastFar]="far"
      (rayClick)="rayClick = $event"
      (rayClickOutside)="rayClickOutside = $event"
      (rayGroupClick)="rayGroupClick = $event"
      (rayRightClick)="rayRightClick = $event"
      (rayRightClickOutside)="rayRightClickOutside = $event"
      (rayGroupRightClick)="rayGroupRightClick = $event"
    ></div>
  `,
  providers: [
    { provide: Object3DComponent, useValue: new FakeObject3DComponent() },
  ],
})
class HostComponent {
  group: string | undefined = 'default-group';
  far = Infinity;

  rayClick?: IRaycastEvent;
  rayClickOutside?: IRaycastEvent;
  rayGroupClick?: IRaycastEvent[];
  rayRightClick?: IRaycastEvent;
  rayRightClickOutside?: IRaycastEvent;
  rayGroupRightClick?: IRaycastEvent[];
}

describe('RaycastDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let mouseup$: BehaviorSubject<MouseEvent | null>;
  let raycastService: RaycastService;

  beforeEach(() => {
    mouseup$ = new BehaviorSubject<MouseEvent | null>(null);

    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        {
          provide: EngineService,
          useValue: {
            resolution$: new BehaviorSubject({ width: 100, height: 100 }),
            mouseup$,
            mousemove$: new BehaviorSubject<MouseEvent | null>(null),
            camera: new PerspectiveCamera(),
            scene: { add: () => {}, remove: () => {} },
          },
        },
        { provide: EngineSettingsService, useValue: { debug: false } },
      ],
    });

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();

    raycastService = TestBed.inject(RaycastService);
  });

  it('routes a left mouse-up to rayClick, leaving right-click outputs untouched', () => {
    spyOn(raycastService.raycaster, 'intersectObject').and.returnValue([
      { distance: 5 } as any,
    ]);

    mouseup$.next(makeMouseEvent(0));

    expect(host.rayClick).toBeTruthy();
    expect(host.rayGroupClick).toBeTruthy();
    expect(host.rayRightClick).toBeUndefined();
    expect(host.rayGroupRightClick).toBeUndefined();
  });

  it('routes a right mouse-up to rayRightClick, leaving left-click outputs untouched', () => {
    spyOn(raycastService.raycaster, 'intersectObject').and.returnValue([
      { distance: 5 } as any,
    ]);

    mouseup$.next(makeMouseEvent(2));

    expect(host.rayRightClick).toBeTruthy();
    expect(host.rayGroupRightClick).toBeTruthy();
    expect(host.rayClick).toBeUndefined();
    expect(host.rayGroupClick).toBeUndefined();
  });

  it('emits rayRightClickOutside when the right-click misses', () => {
    spyOn(raycastService.raycaster, 'intersectObject').and.returnValue([]);

    mouseup$.next(makeMouseEvent(2));

    expect(host.rayRightClickOutside).toBeTruthy();
    expect(host.rayRightClick).toBeUndefined();
  });

  it('ignores middle-click mouse-up events entirely', () => {
    spyOn(raycastService.raycaster, 'intersectObject').and.returnValue([
      { distance: 5 } as any,
    ]);

    mouseup$.next(makeMouseEvent(1));

    expect(host.rayClick).toBeUndefined();
    expect(host.rayRightClick).toBeUndefined();
  });

  it('applies the configured raycastFar to the raycaster on every click', () => {
    spyOn(raycastService.raycaster, 'intersectObject').and.returnValue([]);

    host.far = 750;
    fixture.detectChanges();
    mouseup$.next(makeMouseEvent(0));
    expect(raycastService.raycaster.far).toBe(750);

    host.far = 250;
    fixture.detectChanges();
    mouseup$.next(makeMouseEvent(2));
    expect(raycastService.raycaster.far).toBe(250);
  });

  it('defaults raycastFar to Infinity when unset', () => {
    spyOn(raycastService.raycaster, 'intersectObject').and.returnValue([]);

    mouseup$.next(makeMouseEvent(0));
    expect(raycastService.raycaster.far).toBe(Infinity);
  });
});
