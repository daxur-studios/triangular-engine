import { Component, effect, input, OnDestroy, OnInit } from '@angular/core';
import type { Matrix4, Vector3 } from 'three';
import {
  type TakramAtmosphereParameters,
  TakramAtmosphereService,
} from './takram-atmosphere.service';

/** Provides shared Takram atmosphere state to projected effects. */
@Component({
  standalone: true,
  selector: 'takram-atmosphere',
  template: '<ng-content />',
  providers: [TakramAtmosphereService],
})
export class TakramAtmosphereComponent implements OnInit, OnDestroy {
  readonly sunDirection = input<Vector3>();
  readonly worldToECEFMatrix = input<Matrix4>();
  /** Optional spherical planet radius in world units (metres by default). */
  readonly planetRadius = input<number>();
  /** Atmosphere thickness above a custom spherical planet. */
  readonly atmosphereHeight = input(60_000);
  /** Physical scattering preset. Replace the object to apply a changed preset. */
  readonly parameters = input<TakramAtmosphereParameters>();

  constructor(readonly state: TakramAtmosphereService) {
    effect(() => {
      const sunDirection = this.sunDirection();
      const worldToECEFMatrix = this.worldToECEFMatrix();
      if (sunDirection) state.sunDirection.copy(sunDirection).normalize();
      if (worldToECEFMatrix) state.worldToECEFMatrix.copy(worldToECEFMatrix);
      state.applySharedState();
    });
    effect(() => {
      const planetRadius = this.planetRadius();
      const parameters = this.parameters();
      if (planetRadius !== undefined) {
        this.configurePlanet(planetRadius, parameters);
      } else {
        this.state.initializeDefaultAtmosphere(parameters);
      }
    });
  }

  ngOnInit(): void {
    // Takram snapshots the atmosphere radii into effect uniforms during effect
    // construction. Configure the parent synchronously before projected child
    // effects are initialized; the effect above handles subsequent changes.
    const planetRadius = this.planetRadius();
    if (planetRadius !== undefined) {
      this.configurePlanet(planetRadius, this.parameters());
    } else {
      this.state.initializeDefaultAtmosphere(this.parameters());
    }
  }

  ngOnDestroy(): void {
    this.state.dispose();
  }

  private configurePlanet(
    planetRadius: number,
    parameters?: TakramAtmosphereParameters,
  ): void {
    const worldToECEFMatrix = this.worldToECEFMatrix();
    this.state.configurePlanet(
      planetRadius,
      this.atmosphereHeight(),
      worldToECEFMatrix === undefined,
      parameters,
    );
    if (worldToECEFMatrix) {
      this.state.worldToECEFMatrix.copy(worldToECEFMatrix);
      this.state.applySharedState();
    }
  }
}
