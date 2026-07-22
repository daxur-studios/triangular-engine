import {
  Component,
  contentChildren,
  effect,
  inject,
  input,
  OnDestroy,
  signal,
} from '@angular/core';
import {
  CloudsEffect,
  type CloudsQualityPreset,
  type Procedural3DTexture,
  type ProceduralTexture,
} from '@takram/three-clouds';
import {
  Vector2,
  PerspectiveCamera,
  WebGLRenderer,
  type Camera,
  type Data3DTexture,
  type Texture,
  type Vector2Tuple,
  type Vector3Tuple,
} from 'three';
import { PostprocessingEffectComponent } from 'triangular-engine/postprocessing';
import { EngineService } from 'triangular-engine';
import { TakramCloudAssetsService } from './takram-cloud-assets.service';
import { TakramCloudLayerComponent } from './takram-cloud-layer.component';
import { TakramAtmosphereService } from '../atmosphere/takram-atmosphere.service';
import { applyTakramCloudCameraHeightFix } from './takram-clouds-compat';
import {
  applyTakramCylinderClouds,
  type TakramCylinderHazeModel,
} from './takram-cylinder-clouds-compat';

/** Declarative adapter for Takram's framework-independent CloudsEffect. */
@Component({
  standalone: true,
  selector: 'takram-clouds',
  template: '<ng-content />',
  providers: [
    TakramCloudAssetsService,
    {
      provide: PostprocessingEffectComponent,
      useExisting: TakramCloudsComponent,
    },
  ],
})
export class TakramCloudsComponent
  extends PostprocessingEffectComponent
  implements OnDestroy
{
  readonly layers = contentChildren(TakramCloudLayerComponent);

  readonly assetBaseUrl = input('/takram-clouds');
  /** Optional caller-owned weather map. May be a loaded or procedural texture. */
  readonly localWeatherTexture = input<Texture | ProceduralTexture>();
  /** Optional caller-owned turbulence map. May be a loaded or procedural texture. */
  readonly turbulenceTexture = input<Texture | ProceduralTexture>();
  /** Optional caller-owned base cloud-noise volume. */
  readonly shapeTexture = input<Data3DTexture | Procedural3DTexture>();
  /** Optional caller-owned detail cloud-noise volume. */
  readonly shapeDetailTexture = input<Data3DTexture | Procedural3DTexture>();
  /** Optional caller-owned spatiotemporal blue-noise volume. */
  readonly stbnTexture = input<Data3DTexture>();
  readonly qualityPreset = input<CloudsQualityPreset>('low');
  readonly coverage = input(0.45);
  readonly resolutionScale = input(0.5);
  readonly temporalUpscale = input(true);
  readonly shapeDetail = input(true);
  readonly turbulence = input(true);
  readonly haze = input(true);
  readonly lightShafts = input(true);
  /** Skips the expensive cloud march while retaining the effect instance. */
  readonly skipRendering = input(false);
  readonly localWeatherVelocity = input<Vector2Tuple>([0, 0]);
  /** Globe-UV tiling. Scale with planet radius to preserve physical feature size. */
  readonly localWeatherRepeat = input<Vector2Tuple>([100, 100]);
  readonly shapeRepeat = input<Vector3Tuple>([0.0003, 0.0003, 0.0003]);
  readonly maxIterationCount = input<number | undefined>(undefined);
  readonly maxIterationCountToSun = input<number | undefined>(undefined);
  /** Number of cloud-shadow cascades supported by Takram (1–4). */
  readonly shadowCascadeCount = input<number | undefined>(undefined);
  /** Enables the O'Neill-cylinder POC (X axis, camera inside the habitat). */
  readonly cylindrical = input(false);
  /** Inner wall radius in world units when cylindrical mode is enabled. */
  readonly cylinderRadius = input(10_000);
  readonly cylinderHazeModel = input<TakramCylinderHazeModel>('bounded-v2');
  /** Artistic direct-light multiplier used by the cylindrical cloud shader. */
  readonly sunLightScale = input(1);
  readonly skyLightScale = input(1);
  readonly groundBounceScale = input(1);
  readonly hazeDensityScale = input(1);
  readonly hazeScaleHeight = input(2_000);
  readonly maxRayDistance = input<number | undefined>(undefined);

  private clouds: CloudsEffect | undefined;
  /** The most recent default-asset loading failure, if any. */
  readonly assetError = signal<Error | undefined>(undefined);
  private readonly engine = inject(EngineService);
  private readonly atmosphere = inject(TakramAtmosphereService, {
    optional: true,
  });

  constructor(private readonly assets: TakramCloudAssetsService) {
    super();
    effect(() => {
      const layers = this.layers();
      const values = layers.map((layer) => layer.toCloudLayer());
      const settings = {
        qualityPreset: this.qualityPreset(),
        coverage: this.coverage(),
        resolutionScale: this.resolutionScale(),
        temporalUpscale: this.temporalUpscale(),
        shapeDetail: this.shapeDetail(),
        turbulence: this.turbulence(),
        haze: this.haze(),
        lightShafts: this.lightShafts(),
        skipRendering: this.skipRendering(),
        skyLightScale: this.skyLightScale(),
        groundBounceScale: this.groundBounceScale(),
      };
      const shadowCascadeCount = this.shadowCascadeCount();
      const localWeatherRepeat = this.localWeatherRepeat();
      const shapeRepeat = this.shapeRepeat();
      const cylindrical = this.cylindrical();
      const cylinderRadius = this.cylinderRadius();
      const sunLightScale = this.sunLightScale();
      const cylinderHazeModel = this.cylinderHazeModel();

      if (values.length > 4) {
        throw new Error('Takram clouds support at most four cloud layers.');
      }
      if (!this.clouds) return;

      Object.assign(this.clouds, settings);
      this.clouds.skyLightScale = this.skyLightScale();
      this.clouds.groundBounceScale = this.groundBounceScale();
      this.clouds.clouds.hazeDensityScale = this.hazeDensityScale();
      this.clouds.clouds.hazeExponent = 1 / this.hazeScaleHeight();
      const maxRayDistance = this.maxRayDistance();
      if (maxRayDistance !== undefined) {
        this.clouds.clouds.maxRayDistance = maxRayDistance;
      }
      this.clouds.localWeatherVelocity.copy(
        new Vector2(...this.localWeatherVelocity()),
      );
      this.clouds.localWeatherRepeat.set(...localWeatherRepeat);
      this.clouds.shapeRepeat.set(...shapeRepeat);
      if (cylindrical) {
        applyTakramCylinderClouds(
          this.clouds,
          cylinderRadius,
          sunLightScale,
          cylinderHazeModel,
        );
        this.clouds.shadow.cascadeCount = 1;
        this.applyCylinderRenderSettings(this.clouds);
      } else if (shadowCascadeCount !== undefined) {
        this.clouds.shadow.cascadeCount =
          validateShadowCascadeCount(shadowCascadeCount);
      }
      this.clouds.cloudLayers.reset().set(values);
    });
    effect(() => {
      const assetBaseUrl = this.assetBaseUrl();
      const textures = this.customTextures();
      if (!this.clouds) return;
      this.loadAssets(this.clouds, assetBaseUrl, textures);
    });
  }

  override createEffect(camera: Camera): CloudsEffect {
    this.validateRuntime(camera);
    if (this.clouds) {
      this.atmosphere?.unregisterClouds(this.clouds);
    }
    this.clouds = new CloudsEffect(
      camera,
      {
        resolutionScale: this.resolutionScale(),
      },
      this.atmosphere?.atmosphere,
    );
    if (this.cylindrical()) {
      applyTakramCylinderClouds(
        this.clouds,
        this.cylinderRadius(),
        this.sunLightScale(),
        this.cylinderHazeModel(),
      );
      // Takram always renders its shadow array target, so it must retain at
      // least one layer even though cylinder-aware shadows are not supported.
      this.clouds.shadow.cascadeCount = 1;
    } else {
      applyTakramCloudCameraHeightFix(this.clouds);
    }
    this.applyInputs(this.clouds);
    this.atmosphere?.registerClouds(this.clouds);
    this.loadAssets(this.clouds, this.assetBaseUrl(), this.customTextures());
    return this.clouds;
  }

  ngOnDestroy(): void {
    if (this.clouds) this.atmosphere?.unregisterClouds(this.clouds);
    this.clouds?.dispose();
    this.clouds = undefined;
    this.assets.dispose();
  }

  /** Escape hatch for atmosphere composition and advanced Takram settings. */
  get effect(): CloudsEffect | undefined {
    return this.clouds;
  }

  private applyInputs(clouds: CloudsEffect): void {
    clouds.qualityPreset = this.qualityPreset();
    clouds.coverage = this.coverage();
    clouds.resolutionScale = this.resolutionScale();
    clouds.temporalUpscale = this.temporalUpscale();
    clouds.shapeDetail = this.shapeDetail();
    clouds.turbulence = this.turbulence();
    clouds.haze = this.haze();
    clouds.lightShafts = this.lightShafts();
    clouds.skipRendering = this.skipRendering();
    clouds.skyLightScale = this.skyLightScale();
    clouds.groundBounceScale = this.groundBounceScale();
    clouds.clouds.hazeDensityScale = this.hazeDensityScale();
    clouds.clouds.hazeExponent = 1 / this.hazeScaleHeight();
    const maxRayDistance = this.maxRayDistance();
    if (maxRayDistance !== undefined) {
      clouds.clouds.maxRayDistance = maxRayDistance;
    }
    clouds.localWeatherVelocity.set(...this.localWeatherVelocity());
    clouds.localWeatherRepeat.set(...this.localWeatherRepeat());
    clouds.shapeRepeat.set(...this.shapeRepeat());
    if (this.cylindrical()) {
      clouds.correctAltitude = false;
      applyTakramCylinderClouds(
        clouds,
        this.cylinderRadius(),
        this.sunLightScale(),
        this.cylinderHazeModel(),
      );
      this.applyCylinderRenderSettings(clouds);
    }
    const shadowCascadeCount = this.shadowCascadeCount();
    if (this.cylindrical()) {
      clouds.shadow.cascadeCount = 1;
    } else if (shadowCascadeCount !== undefined) {
      clouds.shadow.cascadeCount =
        validateShadowCascadeCount(shadowCascadeCount);
    }

    const layers = this.layers();
    if (layers.length > 4) {
      throw new Error('Takram clouds support at most four cloud layers.');
    }
    clouds.cloudLayers.reset().set(layers.map((layer) => layer.toCloudLayer()));
  }

  private applyCylinderRenderSettings(clouds: CloudsEffect): void {
    // These match the known-good fork POC. Spherical LUT sampling and the
    // shadow-length attachment are not meaningful for the cylinder adapter.
    clouds.clouds.accurateSunSkyLight = false;
    // A cloud layer only a few kilometres thick can be tens of kilometres
    // away near the axis. Takram's planetary perspective stepping can jump
    // over that shell, so use bounded steps for cylindrical habitats.
    clouds.clouds.minStepSize = 25;
    clouds.clouds.maxStepSize = 100;
    clouds.clouds.perspectiveStepScale = 1;
    clouds.shadow.maxIterationCount = 0;
    const maxIterationCount = this.maxIterationCount();
    if (maxIterationCount !== undefined) {
      clouds.clouds.maxIterationCount = maxIterationCount;
    }
    const maxIterationCountToSun = this.maxIterationCountToSun();
    if (maxIterationCountToSun !== undefined) {
      clouds.clouds.maxIterationCountToSun = maxIterationCountToSun;
    }
  }

  private customTextures() {
    return {
      localWeather: this.localWeatherTexture(),
      turbulence: this.turbulenceTexture(),
      shape: this.shapeTexture(),
      shapeDetail: this.shapeDetailTexture(),
      stbn: this.stbnTexture(),
    };
  }

  private loadAssets(
    clouds: CloudsEffect,
    assetBaseUrl: string,
    textures: ReturnType<TakramCloudsComponent['customTextures']>,
  ): void {
    void this.assets
      .loadDefaults(clouds, assetBaseUrl, textures)
      .then(() => this.assetError.set(undefined))
      .catch((reason: unknown) => {
        const error =
          reason instanceof Error
            ? reason
            : new Error('Failed to load Takram cloud assets.');
        this.assetError.set(error);
        console.error(error);
      });
  }

  private validateRuntime(camera: Camera): void {
    if (!(this.engine.renderer instanceof WebGLRenderer)) {
      throw new Error('TakramCloudsComponent requires THREE.WebGLRenderer.');
    }
    if (!this.engine.renderer.capabilities.isWebGL2) {
      throw new Error(
        'TakramCloudsComponent requires WebGL2-class functionality.',
      );
    }
    if (!(camera instanceof PerspectiveCamera)) {
      throw new Error(
        'TakramCloudsComponent requires a THREE.PerspectiveCamera.',
      );
    }
  }
}

function validateShadowCascadeCount(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    throw new Error(
      'Takram shadowCascadeCount must be an integer from 1 to 4.',
    );
  }
  return value;
}
