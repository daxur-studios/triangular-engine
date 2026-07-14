import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import type { CloudsQualityPreset } from '@takram/three-clouds';

export interface TakramCloudDemoParameters {
  qualityPreset: CloudsQualityPreset;
  coverage: number;
  resolutionScale: number;
  temporalUpscale: boolean;
  shapeDetail: boolean;
  turbulence: boolean;
  haze: boolean;
  lightShafts: boolean;
  localWeatherVelocity: readonly [number, number];
  altitude: number;
  height: number;
  densityScale: number;
  cameraFov: number;
  cameraNear: number;
  cameraFar: number;
}

/** Shared live controls and canonical preset for both Takram cloud demos. */
@Component({
  standalone: true,
  selector: 'app-takram-cloud-controls',
  templateUrl: './takram-cloud-controls.component.html',
  styleUrl: './takram-cloud-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TakramCloudControlsComponent {
  readonly qualityPreset = signal<CloudsQualityPreset>('low');
  readonly coverage = signal(0.45);
  readonly resolutionScale = signal(0.5);
  readonly temporalUpscale = signal(true);
  readonly shapeDetail = signal(false);
  readonly turbulence = signal(false);
  readonly haze = signal(true);
  readonly lightShafts = signal(false);
  readonly localWeatherVelocityX = signal(0.002);
  readonly altitude = signal(750);
  readonly height = signal(650);
  readonly densityScale = signal(0.2);

  readonly cameraFov = signal(60);
  readonly cameraNear = signal(1);
  readonly cameraFar = signal(300_000);

  readonly parameters = computed<TakramCloudDemoParameters>(() => ({
    qualityPreset: this.qualityPreset(),
    coverage: this.coverage(),
    resolutionScale: this.resolutionScale(),
    temporalUpscale: this.temporalUpscale(),
    shapeDetail: this.shapeDetail(),
    turbulence: this.turbulence(),
    haze: this.haze(),
    lightShafts: this.lightShafts(),
    localWeatherVelocity: [this.localWeatherVelocityX(), 0],
    altitude: this.altitude(),
    height: this.height(),
    densityScale: this.densityScale(),
    cameraFov: this.cameraFov(),
    cameraNear: this.cameraNear(),
    cameraFar: this.cameraFar(),
  }));

  setNumber(target: { set(value: number): void }, event: Event): void {
    target.set(Number((event.target as HTMLInputElement).value));
  }
}
