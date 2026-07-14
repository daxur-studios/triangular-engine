import {
  Component,
  contentChildren,
  effect,
  input,
  OnDestroy,
} from '@angular/core';
import {
  CloudsEffect,
  type CloudsQualityPreset,
} from '@takram/three-clouds';
import type { Camera } from 'three';
import { PostprocessingEffectComponent } from 'triangular-engine/postprocessing';
import { TakramCloudAssetsService } from './takram-cloud-assets.service';
import { TakramCloudLayerComponent } from './takram-cloud-layer.component';

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
  readonly qualityPreset = input<CloudsQualityPreset>('low');
  readonly coverage = input(0.45);
  readonly resolutionScale = input(0.5);
  readonly temporalUpscale = input(true);
  readonly shapeDetail = input(true);
  readonly turbulence = input(true);
  readonly haze = input(true);
  readonly lightShafts = input(true);

  private clouds: CloudsEffect | undefined;

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

      if (values.length > 4) {
        throw new Error('Takram clouds support at most four cloud layers.');
      }
      if (!this.clouds) return;

      Object.assign(this.clouds, settings);
      this.clouds.cloudLayers.reset().set(values);
    });
  }

  override createEffect(camera: Camera): CloudsEffect {
    this.clouds = new CloudsEffect(camera, {
      resolutionScale: this.resolutionScale(),
    });
    this.applyInputs(this.clouds);
    void this.assets.loadDefaults(this.clouds, this.assetBaseUrl());
    return this.clouds;
  }

  ngOnDestroy(): void {
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

    const layers = this.layers();
    if (layers.length > 4) {
      throw new Error('Takram clouds support at most four cloud layers.');
    }
    clouds.cloudLayers.reset().set(layers.map((layer) => layer.toCloudLayer()));
  }
}
