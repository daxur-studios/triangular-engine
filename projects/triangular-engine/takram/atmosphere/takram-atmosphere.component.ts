import { Component, effect, input, OnDestroy } from '@angular/core';
import type { Matrix4, Vector3 } from 'three';
import { TakramAtmosphereService } from './takram-atmosphere.service';

/** Provides shared Takram atmosphere state to projected effects. */
@Component({
  standalone: true,
  selector: 'takram-atmosphere',
  template: '<ng-content />',
  providers: [TakramAtmosphereService],
})
export class TakramAtmosphereComponent implements OnDestroy {
  readonly sunDirection = input<Vector3>();
  readonly worldToECEFMatrix = input<Matrix4>();

  constructor(readonly state: TakramAtmosphereService) {
    effect(() => {
      const sunDirection = this.sunDirection();
      const worldToECEFMatrix = this.worldToECEFMatrix();
      if (sunDirection) state.sunDirection.copy(sunDirection).normalize();
      if (worldToECEFMatrix) state.worldToECEFMatrix.copy(worldToECEFMatrix);
      state.applySharedState();
    });
  }

  ngOnDestroy(): void {
    this.state.dispose();
  }
}
