import {
  Component,
  forwardRef,
  inject,
  Injector,
  OnDestroy,
  signal,
  Type,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

import { Object3DComponent } from '../../../components/object-3d/object-3d.component';
import { Jolt, JoltPhysicsService } from '../jolt-physics/jolt-physics.service';
import { JoltRigidBodyComponent } from '../jolt-rigid-body/jolt-rigid-body.component';
import { BehaviorSubject } from 'rxjs';

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
