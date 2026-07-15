import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe, PercentPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NoToneMapping, Vector3 } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { PostprocessingModule } from 'triangular-engine/postprocessing';
import { TakramModule } from 'triangular-engine/takram';

const PLANET_RADIUS = 5_000;
const ATMOSPHERE_HEIGHT = 1_000;
const CLOUD_ALTITUDE = 180;
const CLOUD_HEIGHT = 260;
const TRANSITION_START = 2_000;
const TRANSITION_END = 5_000;

@Component({
  selector: 'app-takram-mini-planet-page',
  imports: [
    DecimalPipe,
    PercentPipe,
    EngineModule,
    PostprocessingModule,
    TakramModule,
  ],
  templateUrl: './takram-mini-planet-page.component.html',
  styleUrl: './takram-mini-planet-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      pixelRatio: 1,
      toneMapping: NoToneMapping,
      toneMappingExposure: 1.3,
      webGLRendererParameters: {
        antialias: false,
        logarithmicDepthBuffer: false,
      },
    }),
  ],
  host: { class: 'flex-page' },
})
export class TakramMiniPlanetPageComponent {
  readonly planetRadius = PLANET_RADIUS;
  readonly atmosphereHeight = ATMOSPHERE_HEIGHT;
  readonly sunDirection = new Vector3(0.65, 0.45, 0.6).normalize();
  readonly planetCentre: [number, number, number] = [0, -PLANET_RADIUS, 0];
  readonly cloudShellRadius =
    PLANET_RADIUS + CLOUD_ALTITUDE + CLOUD_HEIGHT * 0.5;
  readonly cameraAltitude = signal(0);
  readonly shellOpacity = computed(() =>
    smoothstep(TRANSITION_START, TRANSITION_END, this.cameraAltitude()),
  );
  readonly shellMaterial = computed(() => ({
    color: '#f4f7f8',
    opacity: this.shellOpacity() * 0.82,
    transparent: true,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
  }));

  private readonly engine = inject(EngineService);
  private readonly centre = new Vector3(...this.planetCentre);

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.engine.postTick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => {
        const altitude = Math.max(
          0,
          this.engine.camera.position.distanceTo(this.centre) - PLANET_RADIUS,
        );
        if (Math.abs(altitude - this.cameraAltitude()) > 1) {
          this.cameraAltitude.set(altitude);
        }
      });
  }
}

function smoothstep(min: number, max: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
}
