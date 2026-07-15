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
  private textureGeneration = 0;

  readonly atmosphere = new AtmosphereParameters();
  ellipsoid = Ellipsoid.WGS84;
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
    this.updateTextures('Failed to generate Takram atmosphere lookup textures.');
  }

  registerClouds(effect: CloudsEffect): void {
    if (this.clouds && this.clouds !== effect) {
      throw new Error('TakramAtmosphereComponent supports one clouds effect.');
    }
    this.clouds = effect;
    effect.events.addEventListener('change', this.onCloudsChange);
    this.applySharedState();
  }

  configurePlanet(
    radius: number,
    atmosphereHeight: number,
    resetWorldToECEF = true,
  ): void {
    if (!(radius > 0) || !(atmosphereHeight > 0)) {
      throw new Error(
        'Takram planetRadius and atmosphereHeight must be greater than zero.',
      );
    }
    this.ellipsoid = new Ellipsoid(radius, radius, radius);
    this.atmosphere.bottomRadius = radius;
    this.atmosphere.topRadius = radius + atmosphereHeight;
    if (resetWorldToECEF) {
      this.worldToECEFMatrix.copy(createWorldToECEFMatrix(radius));
    }
    this.ready.set(false);
    this.updateTextures('Failed to update Takram atmosphere lookup textures.');
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
      this.clouds.ellipsoid = this.ellipsoid;
      this.clouds.sunDirection.copy(this.sunDirection);
      this.clouds.worldToECEFMatrix.copy(this.worldToECEFMatrix);
    }
    if (this.aerialPerspective) {
      Object.assign(this.aerialPerspective, textures);
      this.aerialPerspective.ellipsoid = this.ellipsoid;
      this.aerialPerspective.sunDirection.copy(this.sunDirection);
      this.aerialPerspective.worldToECEFMatrix.copy(this.worldToECEFMatrix);
    }
    this.routeCloudBuffers();
  }

  dispose(): void {
    this.textureGeneration++;
    if (this.clouds) {
      this.clouds.events.removeEventListener('change', this.onCloudsChange);
    }
    this.clouds = undefined;
    this.aerialPerspective = undefined;
    this.generator.dispose();
  }

  private routeCloudBuffers(): void {
    if (!this.aerialPerspective) return;
    routeTakramCloudBuffers(
      this.aerialPerspective,
      this.clouds,
      this.cloudShadowsEnabled,
    );
  }

  private updateTextures(fallbackMessage: string): void {
    const generation = ++this.textureGeneration;
    void this.generator
      .update(this.atmosphere)
      .then(() => {
        if (generation !== this.textureGeneration) return;
        this.error.set(undefined);
        this.applySharedState();
        this.ready.set(true);
      })
      .catch((reason: unknown) => {
        if (generation !== this.textureGeneration) return;
        this.error.set(
          reason instanceof Error ? reason : new Error(fallbackMessage),
        );
      });
  }
}

type AerialCloudBufferTarget = Pick<
  AerialPerspectiveEffect,
  'overlay' | 'shadow' | 'shadowLength'
>;
type CloudBufferSource = Pick<
  CloudsEffect,
  'atmosphereOverlay' | 'atmosphereShadow' | 'atmosphereShadowLength'
>;

/** @internal Exported for focused buffer-routing tests. */
export function routeTakramCloudBuffers(
  aerialPerspective: AerialCloudBufferTarget,
  clouds: CloudBufferSource | undefined,
  shadowsEnabled: boolean,
): void {
  aerialPerspective.overlay = clouds?.atmosphereOverlay ?? null;
  aerialPerspective.shadow = shadowsEnabled
    ? (clouds?.atmosphereShadow ?? null)
    : null;
  aerialPerspective.shadowLength = shadowsEnabled
    ? (clouds?.atmosphereShadowLength ?? null)
    : null;
}

function createDefaultWorldToECEFMatrix(): Matrix4 {
  return createWorldToECEFMatrix(Ellipsoid.WGS84.maximumRadius);
}

function createWorldToECEFMatrix(radius: number): Matrix4 {
  return new Matrix4().set(
    0,
    1,
    0,
    radius,
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
