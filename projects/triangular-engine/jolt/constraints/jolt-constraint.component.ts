import {
  Component,
  computed,
  DestroyRef,
  forwardRef,
  inject,
  Injector,
  input,
  OnDestroy,
  Type,
} from '@angular/core';
import { JoltRigidBodyComponent } from '../jolt-rigid-body/jolt-rigid-body.component';
import { Jolt, JoltPhysicsService } from '../jolt-physics/jolt-physics.service';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  filter,
  map,
  Observable,
  of,
  switchMap,
} from 'rxjs';

export function provideJoltConstraintComponent(
  component: Type<JoltConstraintComponent>,
) {
  return {
    provide: JoltConstraintComponent,
    useExisting: forwardRef(() => component),
  };
}

/**
 * Reference to the bodies that the constraint is applied to.
 *
 * Or IDs of the bodies that the constraint is applied to.
 */
export type JoltConstraintTuple =
  | [JoltRigidBodyComponent, JoltRigidBodyComponent]
  | [JoltRigidBodyComponent, string]
  | [string, JoltRigidBodyComponent]
  | [string, string];

@Component({
  selector: 'jolt-constraint',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [],
})
export class JoltConstraintComponent implements OnDestroy {
  readonly physicsService = inject(JoltPhysicsService);
  readonly destroyRef = inject(DestroyRef);
  readonly injector = inject(Injector);

  /** The 2 bodies that the constraint is applied to. */
  readonly bodies = input.required<JoltConstraintTuple>();
  readonly bodies$ = toObservable(this.bodies);

  readonly joltBodyPair = computed(() => {
    const rigidBodies = this.bodies();
    const a = rigidBodies[0];
    const b = rigidBodies[1];

    const body1 =
      typeof a === 'string'
        ? this.physicsService.getRigidBodyById(a)()
        : a.body();

    const body2 =
      typeof b === 'string'
        ? this.physicsService.getRigidBodyById(b)()
        : b.body();

    if (!body1 || !body2) return;

    return [body1, body2] as const;
  });

  readonly joltBodyPair$ = toObservable(this.joltBodyPair);

  readonly constraint$ = new BehaviorSubject<Jolt.Constraint | undefined>(
    undefined,
  );

  constructor() {}

  public dispose() {
    const constraint = this.constraint$.value;
    if (!constraint) return;

    // Clear the reference first to prevent double disposal
    this.constraint$.next(undefined);

    try {
      this.physicsService.unregisterConstraint(constraint);
      const meta = this.physicsService.metaDat$.value;
      if (meta) {
        meta.physicsSystem.RemoveConstraint(constraint);
      }
      // constraint.Release(); // Decrement reference count
      //Jolt.destroy(constraint);
      // TODO: see if there's a memory leak here or not. constraint.Release and Jolt.destroy are intermittently causing out of memory range errors.
    } catch (error) {
      console.error('Error removing constraint', error);
    }
  }

  ngOnDestroy(): void {
    this.dispose();
  }
}
