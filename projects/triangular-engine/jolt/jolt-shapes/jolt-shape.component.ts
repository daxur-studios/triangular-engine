import {
  Component,
  forwardRef,
  inject,
  Injector,
  input,
  OnDestroy,
  signal,
  Type,
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
 * IMPORTANT: Make sure when a shape is created, it is added to the reference count of the shape  `shape.AddRef();`
 * so it can be released when the shape is disposed
 */
@Component({
  selector: 'jolt-shape',
  imports: [],
  template: `<ng-content></ng-content>`,
})
export abstract class JoltShapeComponent<T extends Jolt.Shape = Jolt.Shape>
  implements OnDestroy
{
  readonly physicsService = inject(JoltPhysicsService);
  readonly injector = inject(Injector);
  /** The nearest Object3DComponent that is containing the shape */
  readonly parentComponent = inject(Object3DComponent);

  /** Local position of this shape relative to the rigid body (only used in compound shapes) */
  readonly position = input<Vector3Tuple>([0, 0, 0]);
  /** Local rotation of this shape relative to the rigid body as Euler angles in radians (only used in compound shapes) */
  readonly rotation = input<Vector3Tuple>([0, 0, 0]);
  get parentRigidBodyComponent() {
    return this.#findClosestRigidBodyComponent();
  }

  readonly shape$ = new BehaviorSubject<T | undefined>(undefined);
  readonly shape = toSignal(this.shape$);

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
