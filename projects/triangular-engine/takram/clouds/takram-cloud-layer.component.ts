import { Component, input } from '@angular/core';
import type {
  CloudLayerLike,
  TextureChannel,
} from '@takram/three-clouds';

/** Declarative parameters for one of Takram's four packed cloud layers. */
@Component({
  standalone: true,
  selector: 'takram-cloud-layer',
  template: '',
})
export class TakramCloudLayerComponent {
  readonly channel = input<TextureChannel>('r');
  readonly altitude = input(0);
  readonly height = input(0);
  readonly densityScale = input(0.2);
  readonly shapeAmount = input(1);
  readonly shapeDetailAmount = input(1);
  readonly weatherExponent = input(1);
  readonly shapeAlteringBias = input(0.35);
  readonly coverageFilterWidth = input(0.6);
  readonly densityProfile = input<CloudLayerLike['densityProfile']>();
  readonly shadow = input(false);

  /** Snapshot the Angular inputs into Takram's framework-independent shape. */
  toCloudLayer(): CloudLayerLike {
    return {
      channel: this.channel(),
      altitude: this.altitude(),
      height: this.height(),
      densityScale: this.densityScale(),
      shapeAmount: this.shapeAmount(),
      shapeDetailAmount: this.shapeDetailAmount(),
      weatherExponent: this.weatherExponent(),
      shapeAlteringBias: this.shapeAlteringBias(),
      coverageFilterWidth: this.coverageFilterWidth(),
      densityProfile: this.densityProfile(),
      shadow: this.shadow(),
    };
  }
}
