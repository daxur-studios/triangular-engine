import {
  Component,
  forwardRef,
  inject,
  Injector,
  input,
  OnDestroy,
  signal,
  Type,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

import { Object3DComponent } from 'triangular-engine';
import { Jolt, JoltPhysicsService } from '../jolt-physics/jolt-physics.service';
import { JoltRigidBodyComponent } from '../jolt-rigid-body/jolt-rigid-body.component';
import { BehaviorSubject } from 'rxjs';
import { Euler, Vector3Tuple } from 'three';

/** All shapes extending JoltShapeComponent should have this in their providers array */
export function provideShapeComponent<T extends JoltShapeComponent<any>>(
  shapeComponent: Type<T>,
) {
  return [
    {
      provide: JoltShapeComponent,
      useExisting: forwardRef(() => shapeComponent),
    },
  ];
}

/**
 * Value equality for a shape's numeric `params`. Shapes compare their params
 * with this so a binding that hands over a new array with the same numbers
 * (e.g. a template method call) doesn't rebuild the Jolt shape, and with it
 * the parent body's compound, on every change detection.
 */
export function sameShapeParams(
  a: readonly number[],
  b: readonly number[],
): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * IMPORTANT: Make sure when a shape is created, it is added to the reference count of the shape  `shape.AddRef();`
 * so it can be released when the shape is disposed
 */
@Component({
  selector: 'joltShape',
  imports: [],
  template: `<ng-content></ng-content>`,
})
export abstract class JoltShapeComponent<
  T extends Jolt.Shape = Jolt.Shape,
> implements OnDestroy {
  private static nextInstanceId = 1;

  readonly physicsService = inject(JoltPhysicsService);
  readonly injector = inject(Injector);
  /** The nearest Object3DComponent that is containing the shape */
  readonly parentComponent = inject(Object3DComponent);

  /**
   * Stable identity used by a compound rigid body to reconcile this shape
   * without recreating the live body. Supply this for shapes rendered from
   * dynamic collections; otherwise the component instance receives a stable
   * identity for its own lifetime.
   */
  readonly id = input<string>();
  /** Instance-lifetime fallback used when callers do not supply an explicit id. */
  readonly reconciliationId = `jolt-shape-${JoltShapeComponent.nextInstanceId++}`;

  /** Local position of this shape relative to the rigid body (only used in compound shapes) */
  readonly position = input<Vector3Tuple>([0, 0, 0]);
  /** Local rotation of this shape relative to the rigid body as Euler angles in radians (only used in compound shapes) */
  readonly rotation = input<Vector3Tuple>([0, 0, 0]);
  /**
   * kg/m³ for a convex shape (box, sphere, cylinder, capsule, hull); omitted
   * keeps Jolt's default of 1000. A change rebuilds the shape, so the body's
   * mass and centre of mass follow it: an assembled vessel gives each part's
   * collider its part's mass this way. A body's `massKg` still overrides the
   * total.
   */
  readonly density = input<number>();
  get parentRigidBodyComponent() {
    return this.#findClosestRigidBodyComponent();
  }

  readonly shape$ = new BehaviorSubject<T | undefined>(undefined);
  readonly shape = toSignal(this.shape$);

  /** Sets `density` on a freshly built convex shape, before it is published on `shape$`. */
  protected applyDensity(shape: Jolt.ConvexShape): void {
    const density = untracked(this.density);
    if (density !== undefined && density > 0) shape.SetDensity(density);
  }

  /** Create a new shape */
  abstract createShape(...args: any[]): T;
  /** Update an existing shape (or re-create it if it doesn't exist or cannot be updated) */
  abstract updateShape(...args: any[]): T;
  /** Ensure the shape is disposed, released from memory ect */
  abstract disposeShape(): void;

  ngOnDestroy(): void {
    this.disposeShape();
  }

  /**
   * Traverse upwards to find the closest rigid body component
   */
  #findClosestRigidBodyComponent() {
    let parent: JoltRigidBodyComponent | Object3DComponent | null =
      this.parentComponent;

    const maxDepth = 10;
    let depth = 0;

    while (parent) {
      if (parent instanceof JoltRigidBodyComponent) {
        return parent;
      }
      parent = parent.parent;
      depth++;
      if (depth > maxDepth) {
        console.warn('Max depth reached, cannot find rigid body component');
        return null;
      }
    }
    return undefined;
  }
}
