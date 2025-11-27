import {
  Directive,
  EventEmitter,
  inject,
  Inject,
  Injectable,
  input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';

import { Subject, takeUntil } from 'rxjs';
import { ArrowHelper, Intersection, Object3D, Raycaster, Vector2 } from 'three';
import { EngineService, EngineSettingsService } from '../../services';
import { Object3DComponent } from './object-3d.component';

export interface IRaycastEvent {
  //event: MouseEvent;
  object: Object3D;

  /**
   * The instance id of the object that was hit if clicking on an instanced mesh
   */
  instanceId?: number;

  /**
   * Distance from the camera to the hit point
   */
  distance?: number;
  intersects: Intersection[];
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
  /** The parent object3D component this directive is attached to */
  readonly object3DComponent = inject(Object3DComponent);
  //#endregion

  /**
   * Default value: `default-group`
   *
   * If this is set, the raycast will also check for objects in the same group and emit the closest hit.
   * Example: both ground and units need raycast, but only the unit's rayClick should be triggered if both are hit.
   *
   * For now only the initial value at ngOnInit is used, so changing it dynamically won't work.
   */
  readonly raycastGroup = input<string | undefined>('default-group');

  /**
   * Emitted when the raycast hits the parent object3D component
   */
  @Output() rayClick = new RaycastEventEmitter<IRaycastEvent>();
  /**
   * Emitted when the raycast hits an object but the object is not the parent object3D component
   */
  @Output() rayClickOutside = new RaycastEventEmitter<IRaycastEvent>();
  /**
   * Emitted when any object in the raycast group is hit, includes all hits sorted by distance.
   * Only emitted if this directive is part of a raycastGroup.
   */
  @Output() rayGroupClick = new RaycastEventEmitter<IRaycastEvent[]>();

  @Output() rayMouseEnter = new RaycastEventEmitter<IRaycastEvent>();
  @Output() rayMouseLeave = new RaycastEventEmitter<IRaycastEvent>();

  readonly raycaster = this.raycastService.raycaster;
  readonly component = this.object3DComponent;

  readonly scene = this.engineService.scene;

  readonly destroy$ = new Subject<void>();

  private isPointerOver = false;

  constructor() {}

  /** for now changing raycast group is not supported, so just using the 1st value */
  #initialRaycastGroup: string | undefined;

  ngOnInit(): void {
    this.#initialRaycastGroup = this.raycastGroup();
    // Register with group if raycastGroup is set
    const groupName = this.#initialRaycastGroup;
    if (groupName) {
      this.raycastService.registerToGroup(groupName, this);
    }

    this.#initClick();
    this.#initMouseEnterAndLeave();
  }

  #initClick() {
    // Logic to only enable raycast checks if onClick has subscribers.
    // This could be periodically checked or triggered by specific events.
    if (this.rayClick.hasSubscribers || this.rayGroupClick.hasSubscribers) {
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

          const groupName = this.#initialRaycastGroup;

          // If part of a group, coordinate with other group members
          if (groupName) {
            this.#handleGroupClick(groupName);
          } else {
            // Original behavior for non-grouped raycasts
            this.#handleIndividualClick();
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

  #handleIndividualClick() {
    const object3D = this.object3DComponent.object3D();
    if (object3D) {
      const intersects = this.raycastService.raycaster.intersectObject(
        object3D,
        true,
      );
      if (intersects.length > 0) {
        // An intersection occurred
        this.rayClick.emit({
          object: object3D,
          instanceId: intersects[0].instanceId,
          distance: intersects[0].distance,
          intersects: intersects,
        });
      } else {
        this.rayClickOutside.emit({ object: object3D, intersects: [] });
      }
    }
  }

  #handleGroupClick(groupName: string) {
    const groupHits = this.raycastService.getGroupIntersections(groupName);

    // Sort by distance (closest first)
    groupHits.sort((a: IGroupHit, b: IGroupHit) => a.distance - b.distance);

    if (groupHits.length > 0) {
      // Emit rayGroupClick for all group members if they have subscribers
      const groupMembers = this.raycastService.getGroupMembers(groupName);
      groupMembers?.forEach((directive: RaycastDirective) => {
        if (directive.rayGroupClick.hasSubscribers) {
          directive.rayGroupClick.emit(groupHits);
        }
      });

      // Only emit rayClick for the closest hit
      const closestHit = groupHits[0];
      if (closestHit.directive === this) {
        this.rayClick.emit({
          object: closestHit.object,
          instanceId: closestHit.instanceId,
          distance: closestHit.distance,
          intersects: closestHit.intersects,
        });
      }
    } else {
      // No hits in the group
      this.rayClickOutside.emit({
        object: this.object3DComponent.object3D()!,
        intersects: [],
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
                this.rayMouseEnter.emit({
                  object: object3D,
                  instanceId: intersects[0].instanceId,
                  intersects: intersects,
                });
                this.isPointerOver = true;
              }
            } else {
              if (this.isPointerOver) {
                this.rayMouseLeave.emit({
                  object: object3D,
                  intersects: intersects,
                });
                this.isPointerOver = false;
              }
            }
          }
        });
    }
  }
  ngOnDestroy(): void {
    // Unregister from group if raycastGroup was set
    const groupName = this.#initialRaycastGroup;
    if (groupName) {
      this.raycastService.unregisterFromGroup(groupName, this);
    }

    this.destroy$.next();
    this.destroy$.complete();
  }
}

export interface IGroupHit extends IRaycastEvent {
  directive: RaycastDirective;
  distance: number;
}

@Injectable({
  providedIn: 'root',
})
export class RaycastService {
  readonly raycaster = new Raycaster();

  /**
   * Map of group names to sets of raycast directives in that group
   */
  private readonly groups = new Map<string, Set<RaycastDirective>>();

  constructor() {
    this.raycaster.firstHitOnly = true;
  }

  /**
   * Register a directive to a raycast group
   */
  registerToGroup(groupName: string, directive: RaycastDirective): void {
    if (!this.groups.has(groupName)) {
      this.groups.set(groupName, new Set());
    }
    this.groups.get(groupName)!.add(directive);
  }

  /**
   * Unregister a directive from a raycast group
   */
  unregisterFromGroup(groupName: string, directive: RaycastDirective): void {
    const group = this.groups.get(groupName);
    if (group) {
      group.delete(directive);
      if (group.size === 0) {
        this.groups.delete(groupName);
      }
    }
  }

  /**
   * Get all members of a group
   */
  getGroupMembers(groupName: string): Set<RaycastDirective> | undefined {
    return this.groups.get(groupName);
  }

  /**
   * Perform raycasting for all members of a group and return hits sorted by distance
   */
  getGroupIntersections(groupName: string): IGroupHit[] {
    const group = this.groups.get(groupName);
    if (!group) return [];

    const hits: IGroupHit[] = [];

    group.forEach((directive) => {
      const object3D = directive.object3DComponent.object3D();
      if (object3D) {
        const intersects = this.raycaster.intersectObject(object3D, true);
        if (intersects.length > 0) {
          hits.push({
            directive,
            object: object3D,
            instanceId: intersects[0].instanceId,
            distance: intersects[0].distance,
            intersects: intersects,
          });
        }
      }
    });

    return hits;
  }
}

class RaycastEventEmitter<T> extends EventEmitter<T> {
  hasSubscribers = false;

  override subscribe(generatorOrNext?: any, error?: any, complete?: any): any {
    this.hasSubscribers = true;
    return super.subscribe(generatorOrNext, error, complete);
  }
}
