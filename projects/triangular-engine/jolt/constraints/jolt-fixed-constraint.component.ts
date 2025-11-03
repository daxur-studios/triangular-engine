import { Component } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IJoltMetadata, Jolt } from '../jolt-physics/jolt-physics.service';
import {
  JoltConstraintComponent,
  provideJoltConstraintComponent,
} from './jolt-constraint.component';
import { distinctUntilChanged } from 'rxjs';

@Component({
  selector: 'jolt-fixed-constraint',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideJoltConstraintComponent(JoltFixedConstraintComponent)],
})
export class JoltFixedConstraintComponent extends JoltConstraintComponent {
  constructor() {
    super();
    this.#initAsync();
  }

  async #initAsync() {
    const metaData = await this.physicsService.metaDataPromise;
    this.#createConstraint(metaData);
  }

  /**
   * Returns true if there's already a constraint created for the 2 bodies
   *
   */
  #isDistinct(
    a: readonly [Jolt.Body, Jolt.Body] | undefined,
    b: readonly [Jolt.Body, Jolt.Body] | undefined,
  ): boolean {
    return !a || !b || a[0] !== b[0] || a[1] !== b[1];
  }

  #createConstraint(metaData: IJoltMetadata) {
    this.joltBodyPair$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        distinctUntilChanged((a, b) => !this.#isDistinct(a, b)),
      )
      .subscribe((bodies) => {
        // If bodies changed to undefined or invalid, dispose existing constraint
        if (!bodies) {
          this.dispose();
          return;
        }

        const bodyA = bodies[0];
        const bodyB = bodies[1];

        if (!bodyA || !bodyB) {
          this.dispose();
          return;
        }

        // Dispose existing constraint before creating new one
        // (in case distinctUntilChanged didn't catch a change)
        const existingConstraint = this.constraint$.value;
        if (existingConstraint) {
          this.dispose();
        }

        try {
          const fixedSettings = new Jolt.FixedConstraintSettings();

          // Use auto-detect for initial connection
          fixedSettings.mAutoDetectPoint = true;

          // Set space to world space for more predictable behavior
          fixedSettings.mSpace = Jolt.EConstraintSpace_WorldSpace;

          const constraint = fixedSettings.Create(bodyA, bodyB);
          Jolt.destroy(fixedSettings);

          metaData.physicsSystem.AddConstraint(constraint);

          this.constraint$.next(constraint);
          this.physicsService.registerConstraint(constraint, bodyA, bodyB);
        } catch (error) {
          console.error('Failed to create constraint:', error);
        }
      });
  }
}
