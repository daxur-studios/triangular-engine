import { inject, Injectable, signal } from '@angular/core';
import {
  AerialPerspectiveEffect,
  AtmosphereParameters,
  DensityProfileLayer,
  PrecomputedTexturesGenerator,
} from '@takram/three-atmosphere';
import { Ellipsoid } from '@takram/three-geospatial';
import type {
  CloudsEffect,
  CloudsEffectChangeEvent,
} from '@takram/three-clouds';
import { Matrix4, Vector3, WebGLRenderer } from 'three';
import { EngineService } from 'triangular-engine';

/**
 * Takram's default (Earth) atmosphere height, in metres. The Rayleigh/Mie/ozone
 * density profiles below are tuned as absolute-metre curves against this height,
 * not against `bottomRadius`/`topRadius` — see `configurePlanet()`.
 */
const DEFAULT_ATMOSPHERE_HEIGHT =
  AtmosphereParameters.DEFAULT.topRadius -
  AtmosphereParameters.DEFAULT.bottomRadius;

/**
 * Earth's own default config never renders geometry exactly at
 * `atmosphere.bottomRadius`: the WGS84 ellipsoid surface
 * (`Ellipsoid.WGS84.maximumRadius`, 6,378,137 m) sits ~18.1 km above
 * `AtmosphereParameters.DEFAULT.bottomRadius` (6,360,000 m). That headroom
 * keeps rendered-surface ECEF positions off the degenerate `r == bottom_radius`
 * edge of Takram's transmittance/irradiance LUTs (`rho = sqrt(r² - bottom_radius²)`
 * → 0 there), which otherwise produces visible concentric banding wherever
 * post-lighting (`sunLight`/`skyLight`) samples `GetSunAndSkyIrradiance`.
 * `configurePlanet()` reproduces the same ratio so every custom planet keeps
 * this headroom. Takram's own `correctAltitude`/`getAltitudeCorrectionOffset`
 * mechanism (on by default on both `AerialPerspectiveEffect` and
 * `CloudsEffect`) already exists to reconcile an ellipsoid surface radius
 * that differs from `bottomRadius`, so no other adapter code needs to change.
 */
const GROUND_OFFSET_RATIO =
  (Ellipsoid.WGS84.maximumRadius - AtmosphereParameters.DEFAULT.bottomRadius) /
  AtmosphereParameters.DEFAULT.bottomRadius;

/**
 * The nominal atmosphere `bottomRadius` for a planet whose rendered surface
 * (globe mesh, `worldToECEFMatrix` translation, `ellipsoid`) has the given
 * true radius. Always strictly less than `radius` — see `GROUND_OFFSET_RATIO`.
 */
export function computeAtmosphereBottomRadius(radius: number): number {
  return radius / (1 + GROUND_OFFSET_RATIO);
}

/** Shared atmosphere resources and cloud/aerial buffer routing for one subtree. */
@Injectable()
export class TakramAtmosphereService {
  private readonly engine = inject(EngineService);
  private readonly generator: PrecomputedTexturesGenerator;
  private clouds: CloudsEffect | undefined;
  private aerialPerspective: AerialPerspectiveEffect | undefined;
  private cloudShadowsEnabled = true;
  private textureGeneration = 0;
  private textureUpdateInFlight = false;
  private textureUpdateRequested = false;
  private textureConfiguration: string | undefined;
  private disposed = false;

  readonly atmosphere = new AtmosphereParameters();
  /** Pristine Earth density profiles, rescaled by `configurePlanet()` for custom radii. */
  private readonly defaultRayleighDensity = cloneDensityProfile(
    this.atmosphere.rayleighDensity,
  );
  private readonly defaultMieDensity = cloneDensityProfile(
    this.atmosphere.mieDensity,
  );
  private readonly defaultAbsorptionDensity = cloneDensityProfile(
    this.atmosphere.absorptionDensity,
  );
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
  }

  /** Generate the default Earth LUT once when no custom planet is configured. */
  initializeDefaultAtmosphere(): void {
    this.requestTextureUpdate(
      `default:${this.atmosphere.bottomRadius}:${this.atmosphere.topRadius}`,
      'Failed to generate Takram atmosphere lookup textures.',
    );
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
    this.atmosphere.bottomRadius = computeAtmosphereBottomRadius(radius);
    this.atmosphere.topRadius =
      this.atmosphere.bottomRadius + atmosphereHeight;

    // The density profiles are absolute-metre curves (e.g. an 8 km Rayleigh
    // scale height) tuned for Earth's 60 km atmosphere. Left unscaled, a much
    // thinner custom atmosphere compresses that curve into a tiny fraction of
    // the LUT's radial range, which is a known source of visible LUT banding.
    // Rescale so the profile occupies the same fraction of the shell as on Earth.
    const densityScale = atmosphereHeight / DEFAULT_ATMOSPHERE_HEIGHT;
    this.atmosphere.rayleighDensity = scaleDensityProfile(
      this.defaultRayleighDensity,
      densityScale,
    );
    this.atmosphere.mieDensity = scaleDensityProfile(
      this.defaultMieDensity,
      densityScale,
    );
    this.atmosphere.absorptionDensity = scaleDensityProfile(
      this.defaultAbsorptionDensity,
      densityScale,
    );

    if (resetWorldToECEF) {
      this.worldToECEFMatrix.copy(createWorldToECEFMatrix(radius));
    }
    this.requestTextureUpdate(
      `planet:${radius}:${atmosphereHeight}`,
      'Failed to update Takram atmosphere lookup textures.',
    );
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
    this.disposed = true;
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

  private requestTextureUpdate(
    configuration: string,
    fallbackMessage: string,
  ): void {
    if (configuration === this.textureConfiguration) return;
    this.textureConfiguration = configuration;
    this.textureGeneration++;
    this.textureUpdateRequested = true;
    this.ready.set(false);
    this.runTextureUpdate(fallbackMessage);
  }

  private runTextureUpdate(fallbackMessage: string): void {
    if (
      this.textureUpdateInFlight ||
      !this.textureUpdateRequested ||
      this.disposed
    ) {
      return;
    }
    this.textureUpdateRequested = false;
    this.textureUpdateInFlight = true;
    const generation = this.textureGeneration;
    void this.generator
      .update(this.atmosphere)
      .then(() => {
        if (generation !== this.textureGeneration || this.disposed) return;
        this.error.set(undefined);
        this.applySharedState();
        this.ready.set(true);
      })
      .catch((reason: unknown) => {
        if (generation !== this.textureGeneration || this.disposed) return;
        this.error.set(
          reason instanceof Error ? reason : new Error(fallbackMessage),
        );
      })
      .finally(() => {
        this.textureUpdateInFlight = false;
        this.runTextureUpdate(fallbackMessage);
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

type DensityProfile = [DensityProfileLayer, DensityProfileLayer];

function cloneDensityProfile(profile: DensityProfile): DensityProfile {
  return [
    cloneDensityProfileLayer(profile[0]),
    cloneDensityProfileLayer(profile[1]),
  ];
}

function cloneDensityProfileLayer(
  layer: DensityProfileLayer,
): DensityProfileLayer {
  return new DensityProfileLayer(
    layer.width,
    layer.expTerm,
    layer.expScale,
    layer.linearTerm,
    layer.constantTerm,
  );
}

/**
 * Rescales a density profile's height-dependent terms so that
 * `density(scale * h) === original density(h)`, i.e. the profile keeps its
 * shape but occupies `scale` times the vertical extent.
 */
function scaleDensityProfile(
  profile: DensityProfile,
  scale: number,
): DensityProfile {
  return [
    scaleDensityProfileLayer(profile[0], scale),
    scaleDensityProfileLayer(profile[1], scale),
  ];
}

function scaleDensityProfileLayer(
  layer: DensityProfileLayer,
  scale: number,
): DensityProfileLayer {
  return new DensityProfileLayer(
    layer.width * scale,
    layer.expTerm,
    layer.expScale / scale,
    layer.linearTerm / scale,
    layer.constantTerm,
  );
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
