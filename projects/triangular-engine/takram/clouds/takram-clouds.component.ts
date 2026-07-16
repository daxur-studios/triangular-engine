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
} from 'three';
import { PostprocessingEffectComponent } from 'triangular-engine/postprocessing';
import { EngineService } from 'triangular-engine';
import { TakramCloudAssetsService } from './takram-cloud-assets.service';
import { TakramCloudLayerComponent } from './takram-cloud-layer.component';
import { TakramAtmosphereService } from '../atmosphere/takram-atmosphere.service';

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
  readonly localWeatherVelocity = input<Vector2Tuple>([0, 0]);
  /** Number of cloud-shadow cascades supported by Takram (1–4). */
  readonly shadowCascadeCount = input<number | undefined>(undefined);

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
      };
      const shadowCascadeCount = this.shadowCascadeCount();

      if (values.length > 4) {
        throw new Error('Takram clouds support at most four cloud layers.');
      }
      if (!this.clouds) return;

      Object.assign(this.clouds, settings);
      this.clouds.localWeatherVelocity.copy(
        new Vector2(...this.localWeatherVelocity()),
      );
      if (shadowCascadeCount !== undefined) {
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
    this.clouds = new CloudsEffect(camera, {
      resolutionScale: this.resolutionScale(),
    }, this.atmosphere?.atmosphere);
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
    clouds.localWeatherVelocity.set(...this.localWeatherVelocity());
    const shadowCascadeCount = this.shadowCascadeCount();
    if (shadowCascadeCount !== undefined) {
      clouds.shadow.cascadeCount =
        validateShadowCascadeCount(shadowCascadeCount);
    }

    const layers = this.layers();
    if (layers.length > 4) {
      throw new Error('Takram clouds support at most four cloud layers.');
    }
    clouds.cloudLayers.reset().set(layers.map((layer) => layer.toCloudLayer()));
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
