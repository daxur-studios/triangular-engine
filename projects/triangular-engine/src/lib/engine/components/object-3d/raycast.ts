import {
  Directive,
  EventEmitter,
  inject,
  Inject,
  Injectable,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';

import { Subject, takeUntil } from 'rxjs';
import { ArrowHelper, Object3D, Raycaster, Vector2 } from 'three';
import { EngineService, EngineSettingsService } from '../../services';
import { Object3DComponent } from './object-3d.component';

export interface IRaycastEvent {
  object: Object3D;
}

interface RaycastEvents {
  rayClick: EventEmitter<IRaycastEvent>;
}

@Directive({
  selector: '[raycast]',
  exportAs: 'raycast',
  standalone: true,
})
export class RaycastDirective implements OnInit, RaycastEvents, OnDestroy {
  //#region Injected Dependencies
  readonly raycastService = inject(RaycastService);
  readonly engineService = inject(EngineService);
  readonly engineSettingsService = inject(EngineSettingsService);
  readonly object3DComponent = inject(Object3DComponent);
  //#endregion

  @Output() rayClick = new RaycastEventEmitter<IRaycastEvent>();
  @Output() rayClickOutside = new RaycastEventEmitter<IRaycastEvent>();

  @Output() rayMouseEnter = new RaycastEventEmitter<IRaycastEvent>();
  @Output() rayMouseLeave = new RaycastEventEmitter<IRaycastEvent>();

  readonly raycaster = this.raycastService.raycaster;
  readonly component = this.object3DComponent;

  readonly scene = this.engineService.scene;

  readonly destroy$ = new Subject<void>();

  private isPointerOver = false;

  constructor() {}

  ngOnInit(): void {
    this.#initClick();
    this.#initMouseEnterAndLeave();
  }

  #initClick() {
    // Logic to only enable raycast checks if onClick has subscribers.
    // This could be periodically checked or triggered by specific events.
    if (this.rayClick.hasSubscribers) {
      // Implement the logic to perform raycast checks here.

      this.engineService.mouseup$
        .pipe(takeUntil(this.destroy$))
        .subscribe((event) => {
          if (!event) return;

          // Check if it's a left mouse up
          if (event.button !== 0) return;

          // Assuming `event` contains the mouse event information
          const mousePosition = new Vector2();

          const resolution = this.engineService.resolution$.value;
          // Convert mouse position to NDC
          mousePosition.x = ((event.offsetX ?? 0) / resolution.width) * 2 - 1;
          mousePosition.y = -((event.offsetY ?? 0) / resolution.height) * 2 + 1;

          // Update the raycaster
          this.raycaster.setFromCamera(
            mousePosition,
            this.engineService.camera,
          );
          this.raycaster.far = 1000;

          // Perform raycasting
          const object3D = this.object3DComponent.object3D();
          if (object3D) {
            const intersects = this.raycastService.raycaster.intersectObject(
              object3D,
              true,
            );
            if (intersects.length > 0) {
              // An intersection occurred
              this.rayClick.emit({ object: object3D });
            } else {
              this.rayClickOutside.emit({ object: object3D });
            }
          }

          //#region debug
          if (this.engineSettingsService.debug) {
            const arrow = new ArrowHelper(
              this.raycaster.ray.direction,
              this.raycaster.ray.origin,
              this.raycaster.far,
              0xff0000,
            );
            this.scene.add(arrow);
            setTimeout(() => {
              this.scene.remove(arrow);
            }, 10000);
          }

          //#endregion
        });
    }
  }
  #initMouseEnterAndLeave() {
    if (
      this.rayMouseEnter.hasSubscribers ||
      this.rayMouseLeave.hasSubscribers
    ) {
      this.engineService.mousemove$
        .pipe(takeUntil(this.destroy$))
        .subscribe((event) => {
          if (!event) return;

          const mousePosition = new Vector2();

          const resolution = this.engineService.resolution$.value;
          // Convert mouse position to NDC
          mousePosition.x = ((event.offsetX ?? 0) / resolution.width) * 2 - 1;
          mousePosition.y = -((event.offsetY ?? 0) / resolution.height) * 2 + 1;

          // Update the raycaster
          this.raycaster.setFromCamera(
            mousePosition,
            this.engineService.camera,
          );
          this.raycaster.far = 1000;

          // Perform raycasting
          const object3D = this.object3DComponent.object3D();
          if (object3D) {
            const intersects = this.raycastService.raycaster.intersectObject(
              object3D,
              true,
            );
            if (intersects.length > 0) {
              if (!this.isPointerOver) {
                this.rayMouseEnter.emit({ object: object3D });
                this.isPointerOver = true;
              }
            } else {
              if (this.isPointerOver) {
                this.rayMouseLeave.emit({ object: object3D });
                this.isPointerOver = false;
              }
            }
          }
        });
    }
  }
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

@Injectable({
  providedIn: 'root',
})
export class RaycastService {
  readonly raycaster = new Raycaster();

  constructor() {
    this.raycaster.firstHitOnly = true;
  }
}

class RaycastEventEmitter<T> extends EventEmitter<T> {
  hasSubscribers = false;

  override subscribe(generatorOrNext?: any, error?: any, complete?: any): any {
    this.hasSubscribers = true;
    return super.subscribe(generatorOrNext, error, complete);
  }
}
