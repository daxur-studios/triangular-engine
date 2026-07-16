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
import { Color, FrontSide, NoToneMapping, Vector3 } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { PostprocessingModule } from 'triangular-engine/postprocessing';
import { TakramModule } from 'triangular-engine/takram';
import {
  TakramCloudControlsComponent,
  TakramCloudControlsStore,
} from '../../shared/takram-cloud-controls/takram-cloud-controls.component';
import { TakramCloudDemoTextures } from '../../shared/takram-cloud-controls/takram-cloud-demo-textures.service';

const PLANET_RADIUS = 100_000;
const ATMOSPHERE_HEIGHT = 20_000;
const CLOUD_ALTITUDE = 3_000;
const CLOUD_HEIGHT = 2_000;
const TRANSITION_START = 30_000;
const TRANSITION_END = 80_000;

@Component({
  selector: 'app-takram-mini-planet-page',
  imports: [
    DecimalPipe,
    PercentPipe,
    EngineModule,
    PostprocessingModule,
    TakramModule,
    TakramCloudControlsComponent,
  ],
  templateUrl: './takram-mini-planet-page.component.html',
  styleUrl: './takram-mini-planet-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    TakramCloudControlsStore,
    TakramCloudDemoTextures,
    EngineService.provide({
      showFPS: true,
      pixelRatio: 1,
      toneMapping: NoToneMapping,
      toneMappingExposure: 1.3,
      webGLRendererParameters: {
        antialias: false,
        logarithmicDepthBuffer: true,
      },
    }),
  ],
  host: { class: 'flex-page' },
})
export class TakramMiniPlanetPageComponent {
  readonly planetRadius = PLANET_RADIUS;
  readonly atmosphereHeight = ATMOSPHERE_HEIGHT;
  readonly controls = inject(TakramCloudControlsStore);
  readonly textures = inject(TakramCloudDemoTextures);
  readonly planetCentre: [number, number, number] = [0, -PLANET_RADIUS, 0];
  readonly surfaceTarget: [number, number, number] = [
    this.planetCentre[0],
    this.planetCentre[1] + this.planetRadius,
    this.planetCentre[2],
  ];
  readonly cloudShellRadius =
    PLANET_RADIUS + CLOUD_ALTITUDE + CLOUD_HEIGHT * 0.5;
  readonly cameraAltitude = signal(0);
  readonly shellOpacity = computed(() =>
    smoothstep(TRANSITION_START, TRANSITION_END, this.cameraAltitude()),
  );
  readonly shellMaterial = computed(() => ({
    color: '#f4f7f8',
    opacity: this.shellOpacity() * 0.9,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  }));

  private readonly engine = inject(EngineService);
  private readonly centre = new Vector3(...this.planetCentre);

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color(0x000006);
    destroyRef.onDestroy(() => {
      this.engine.scene.background = previousBackground;
    });
    this.controls.altitude.set(CLOUD_ALTITUDE);
    this.controls.height.set(CLOUD_HEIGHT);
    this.controls.densityScale.set(0.3);
    this.controls.temporalUpscale.set(false);
    this.controls.cameraFar.set(50_000_000);
    this.engine.postTick$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
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
