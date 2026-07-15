import { inject, Injectable, signal } from '@angular/core';
import {
  AerialPerspectiveEffect,
  AtmosphereParameters,
  PrecomputedTexturesGenerator,
} from '@takram/three-atmosphere';
import { Ellipsoid } from '@takram/three-geospatial';
import type {
  CloudsEffect,
  CloudsEffectChangeEvent,
} from '@takram/three-clouds';
import { Matrix4, Vector3, WebGLRenderer } from 'three';
import { EngineService } from 'triangular-engine';

/** Shared atmosphere resources and cloud/aerial buffer routing for one subtree. */
@Injectable()
export class TakramAtmosphereService {
  private readonly engine = inject(EngineService);
  private readonly generator: PrecomputedTexturesGenerator;
  private clouds: CloudsEffect | undefined;
  private aerialPerspective: AerialPerspectiveEffect | undefined;
  private cloudShadowsEnabled = true;

  readonly atmosphere = new AtmosphereParameters();
  readonly sunDirection = new Vector3(1, 0.7, 0.4).normalize();
  readonly worldToECEFMatrix = createDefaultWorldToECEFMatrix();
  readonly ready = signal(false);
  readonly error = signal<Error | undefined>(undefined);

  /** Precomputed lookup textures shared by effects and atmosphere lights. */
  get textures() {
    return this.generator.textures;
  }

  private readonly onCloudsChange = (_event: CloudsEffectChangeEvent): void => {
    this.routeCloudBuffers();
  };

  constructor() {
    const renderer = this.engine.renderer;
    if (!(renderer instanceof WebGLRenderer)) {
      throw new Error(
        'TakramAtmosphereComponent requires THREE.WebGLRenderer.',
      );
    }
    if (!renderer.capabilities.isWebGL2) {
      throw new Error(
        'TakramAtmosphereComponent requires WebGL2-class functionality.',
      );
    }

    this.generator = new PrecomputedTexturesGenerator(renderer);
    void this.generator
      .update(this.atmosphere)
      .then(() => this.ready.set(true))
      .catch((reason: unknown) => {
        this.error.set(
          reason instanceof Error
            ? reason
            : new Error(
                'Failed to generate Takram atmosphere lookup textures.',
              ),
        );
      });
  }

  registerClouds(effect: CloudsEffect): void {
    if (this.clouds && this.clouds !== effect) {
      throw new Error('TakramAtmosphereComponent supports one clouds effect.');
    }
    this.clouds = effect;
    effect.events.addEventListener('change', this.onCloudsChange);
    this.applySharedState();
  }

  unregisterClouds(effect: CloudsEffect): void {
    effect.events.removeEventListener('change', this.onCloudsChange);
    if (this.clouds === effect) {
      this.clouds = undefined;
      this.routeCloudBuffers();
    }
  }

  registerAerialPerspective(effect: AerialPerspectiveEffect): void {
    if (this.aerialPerspective && this.aerialPerspective !== effect) {
      throw new Error(
        'TakramAtmosphereComponent supports one aerial-perspective effect.',
      );
    }
    this.aerialPerspective = effect;
    this.applySharedState();
  }

  unregisterAerialPerspective(effect: AerialPerspectiveEffect): void {
    if (this.aerialPerspective === effect) {
      this.aerialPerspective = undefined;
    }
  }

  setCloudShadowsEnabled(enabled: boolean): void {
    this.cloudShadowsEnabled = enabled;
    this.routeCloudBuffers();
  }

  applySharedState(): void {
    const textures = this.generator.textures;
    if (this.clouds) {
      Object.assign(this.clouds, textures);
      this.clouds.sunDirection.copy(this.sunDirection);
      this.clouds.worldToECEFMatrix.copy(this.worldToECEFMatrix);
    }
    if (this.aerialPerspective) {
      Object.assign(this.aerialPerspective, textures);
      this.aerialPerspective.sunDirection.copy(this.sunDirection);
      this.aerialPerspective.worldToECEFMatrix.copy(this.worldToECEFMatrix);
    }
    this.routeCloudBuffers();
  }

  dispose(): void {
    if (this.clouds) {
      this.clouds.events.removeEventListener('change', this.onCloudsChange);
    }
    this.clouds = undefined;
    this.aerialPerspective = undefined;
    this.generator.dispose();
  }

  private routeCloudBuffers(): void {
    if (!this.aerialPerspective) return;
    this.aerialPerspective.overlay = this.clouds?.atmosphereOverlay ?? null;
    this.aerialPerspective.shadow = this.cloudShadowsEnabled
      ? (this.clouds?.atmosphereShadow ?? null)
      : null;
    this.aerialPerspective.shadowLength = this.cloudShadowsEnabled
      ? (this.clouds?.atmosphereShadowLength ?? null)
      : null;
  }
}

function createDefaultWorldToECEFMatrix(): Matrix4 {
  const earthRadius = Ellipsoid.WGS84.maximumRadius;
  return new Matrix4().set(
    0,
    1,
    0,
    earthRadius,
    1,
    0,
    0,
    0,
    0,
    0,
    -1,
    0,
    0,
    0,
    0,
    1,
  );
}
