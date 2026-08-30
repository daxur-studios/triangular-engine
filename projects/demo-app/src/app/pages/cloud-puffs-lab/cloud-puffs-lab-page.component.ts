import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Color, MathUtils, NoToneMapping, Vector3 } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  buildCloudPuffLodSystem,
  CLOUD_PUFF_DOMAINS,
  CLOUD_PUFF_STYLES,
  DEFAULT_CLOUD_PUFF_DOMAIN_ID,
  DEFAULT_CLOUD_PUFF_STYLE_ID,
  type ICloudPuffLodSystem,
} from 'triangular-engine/clouds';
import { PlanetViewComponent } from 'triangular-engine/worldgen/render';

export type WorldScale = 'small' | 'medium' | 'large';

export interface IWorldScalePreset {
  readonly id: WorldScale;
  readonly label: string;
  readonly boxRegion: readonly [number, number, number];
  readonly groundPlaneSize: number;
  readonly groundPlaneY: number;
  readonly planetRadius: number;
  readonly lowerCloudRadius: number;
  readonly cylinderRadius: number;
  readonly cylinderLength: number;
  readonly defaultGpuParticles: number;
  readonly defaultLodDistance: number;
  readonly cameraPos: [number, number, number];
  readonly far: number;
}

export const WORLD_SCALE_PRESETS: Record<WorldScale, IWorldScalePreset> = {
  small: {
    id: 'small',
    label: 'Small (Local Region — R=55m)',
    boxRegion: [100, 20, 100],
    groundPlaneSize: 350,
    groundPlaneY: -18,
    planetRadius: 55,
    lowerCloudRadius: 56.5,
    cylinderRadius: 96,
    cylinderLength: 260,
    defaultGpuParticles: 600,
    defaultLodDistance: 65,
    cameraPos: [0, 55, 175],
    far: 6000,
  },
  medium: {
    id: 'medium',
    label: 'Medium (Regional Continent — R=220m)',
    boxRegion: [350, 25, 350],
    groundPlaneSize: 1200,
    groundPlaneY: -45,
    planetRadius: 220,
    lowerCloudRadius: 226,
    cylinderRadius: 350,
    cylinderLength: 1000,
    defaultGpuParticles: 1800,
    defaultLodDistance: 220,
    cameraPos: [0, 220, 700],
    far: 20000,
  },
  large: {
    id: 'large',
    label: 'Large (Global Planet — R=700m)',
    boxRegion: [1000, 30, 1000],
    groundPlaneSize: 3500,
    groundPlaneY: -90,
    planetRadius: 700,
    lowerCloudRadius: 718,
    cylinderRadius: 1000,
    cylinderLength: 3200,
    defaultGpuParticles: 4000,
    defaultLodDistance: 500,
    cameraPos: [0, 700, 2200],
    far: 60000,
  },
};

@Component({
  selector: 'app-cloud-puffs-lab-page',
  imports: [EngineModule, PlanetViewComponent],
  templateUrl: './cloud-puffs-lab-page.component.html',
  styleUrl: './cloud-puffs-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      toneMapping: NoToneMapping,
    }),
  ],
  host: { class: 'flex-page' },
})
export class CloudPuffsLabPageComponent {
  readonly planet = viewChild<PlanetViewComponent>('planet');

  readonly scalePresets = WORLD_SCALE_PRESETS;
  readonly scales: WorldScale[] = ['small', 'medium', 'large'];
  readonly worldScale = signal<WorldScale>('small');
  readonly activePreset = computed(() => WORLD_SCALE_PRESETS[this.worldScale()]);

  readonly domains = CLOUD_PUFF_DOMAINS;
  readonly domainId = signal(DEFAULT_CLOUD_PUFF_DOMAIN_ID);

  readonly styles = CLOUD_PUFF_STYLES;
  readonly cloudStyleId = signal(DEFAULT_CLOUD_PUFF_STYLE_ID); // 'card-stack' or 'low-poly-blob'

  // Unified 1-to-1 Cloud System (GPU Puffs <-> 3D Mesh LOD)
  readonly gpuParticleCount = signal(600);
  readonly puffPixelScale = signal(10.0);
  readonly puffClumpRadius = signal(0.018);
  readonly puffFollowLag = signal(1.5);
  readonly particleLifespanS = signal(22);
  readonly lodDistance = signal(65);

  // Wind Dynamics
  readonly windSpeed = signal(0.06);
  readonly curlTurbulence = signal(0.05);
  readonly curlFrequency = signal(2.0);
  readonly timewarp = signal(1);

  // Lighting & Surface
  readonly sunAzimuthDeg = signal(35);
  readonly sunElevationDeg = signal(38);
  readonly rimStrength = signal(1.2);
  readonly planetRenderMode = signal<'elevation' | 'moisture' | 'biome' | 'temperature' | 'land'>('elevation');

  // Dynamic Point Lights
  readonly rocketEngineEnabled = signal(false);
  readonly lightningEnabled = signal(false);
  readonly rocketPosition = signal<[number, number, number]>([0, 0, 0]);
  readonly lightningPosition = signal<[number, number, number]>([0, 0, 0]);
  readonly lightningVisible = signal(false);

  readonly sunDirection = computed(() => {
    const azimuth = MathUtils.degToRad(this.sunAzimuthDeg());
    const elevation = MathUtils.degToRad(this.sunElevationDeg());
    return new Vector3(
      Math.cos(elevation) * Math.cos(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.sin(azimuth),
    ).normalize();
  });

  readonly sunLightPosition = computed<[number, number, number]>(() => {
    const direction = this.sunDirection();
    const radius = this.activePreset().planetRadius * 3.5;
    return [direction.x * radius, direction.y * radius, direction.z * radius];
  });

  private readonly cloudLodSystem = signal<ICloudPuffLodSystem | null>(null);
  private readonly engine = inject(EngineService);
  private rocketAngle = 0;
  private lightningCooldownS = 3;
  private lightningIntensity = 0;
  private readonly lightningPositionVector = new Vector3();
  private simulationTimeS = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);

    // Rebuild Unified 1-to-1 Cloud LOD System
    effect(() => {
      const preset = this.activePreset();
      const domainId = this.domainId();
      const styleId = this.cloudStyleId();

      const options = {
        particleCount: this.gpuParticleCount(),
        clumpRadius: this.puffClumpRadius(),
        followLag: this.puffFollowLag(),
        lifespan: this.particleLifespanS(),
        zonalSpeed: this.windSpeed(),
        curlStrength: this.curlTurbulence(),
        curlFrequency: this.curlFrequency(),
        lodDistance: this.lodDistance(),
        pixelScale: this.puffPixelScale(),
        styleId,
      };

      untracked(() => {
        this.rebuildSystem(preset, domainId, options);
      });
    });

    // Reactive Updates to Material Uniforms
    effect(() => {
      const sun = this.sunDirection();
      const sys = this.cloudLodSystem();
      if (sys) {
        sys.setSunDirection(sun);
        sys.setStyle(this.cloudStyleId());
        sys.setLodDistance(this.lodDistance());
        sys.setWindParams({
          zonalSpeed: this.windSpeed(),
          curlStrength: this.curlTurbulence(),
          curlFrequency: this.curlFrequency(),
        });
      }
    });

    // Frame Tick Subscription
    this.engine.tick$.pipe(takeUntilDestroyed(destroyRef)).subscribe((delta) => {
      const effectiveDelta = delta * this.timewarp();
      this.simulationTimeS += effectiveDelta;

      const camera = this.engine.camera;
      const camPos = camera ? camera.position : new Vector3(0, 55, 175);

      // Single update: advances GPU streamlines and evaluates close-up 3D meshes in 100% sync
      const sys = this.cloudLodSystem();
      if (sys) {
        sys.update(this.simulationTimeS, camPos);
      }

      this.updateDynamicLights(effectiveDelta);
    });

    destroyRef.onDestroy(() => {
      this.disposeSystem();
    });
  }

  onWorldScaleChange(scale: WorldScale): void {
    this.worldScale.set(scale);
    const preset = WORLD_SCALE_PRESETS[scale];
    this.gpuParticleCount.set(preset.defaultGpuParticles);
    this.lodDistance.set(preset.defaultLodDistance);
  }

  private rebuildSystem(
    preset: IWorldScalePreset,
    domainId: string,
    opts: {
      particleCount: number;
      clumpRadius: number;
      followLag: number;
      lifespan: number;
      zonalSpeed: number;
      curlStrength: number;
      curlFrequency: number;
      lodDistance: number;
      pixelScale: number;
      styleId: string;
    },
  ): void {
    this.disposeSystem();

    if (domainId === 'sphere-shell') {
      const sys = buildCloudPuffLodSystem({
        particleCount: opts.particleCount,
        clumpSize: 4,
        planetRadius: preset.planetRadius,
        shellRadius: preset.lowerCloudRadius,
        puffPixelScale: opts.pixelScale,
        clumpRadius: opts.clumpRadius,
        followLag: opts.followLag,
        lifespanS: opts.lifespan,
        zonalSpeed: opts.zonalSpeed,
        curlStrength: opts.curlStrength,
        curlFrequency: opts.curlFrequency,
        rimStrength: this.rimStrength(),
        styleId: opts.styleId,
        lodDistanceM: opts.lodDistance,
        maxCloseUpMeshes: 400,
      });
      sys.setSunDirection(this.sunDirection());
      this.engine.scene.add(sys.group);
      this.cloudLodSystem.set(sys);
    }
  }

  private disposeSystem(): void {
    const sys = this.cloudLodSystem();
    if (sys) {
      sys.group.removeFromParent();
      sys.dispose();
      this.cloudLodSystem.set(null);
    }
  }

  private updateDynamicLights(deltaSeconds: number): void {
    const planetR = this.activePreset().planetRadius;

    if (this.rocketEngineEnabled()) {
      this.rocketAngle += deltaSeconds * 0.4;
      const x = Math.cos(this.rocketAngle) * (planetR * 1.15);
      const z = Math.sin(this.rocketAngle) * (planetR * 0.95);
      const y = Math.sin(this.rocketAngle * 1.7) * (planetR * 0.25);
      this.rocketPosition.set([x, y, z]);
    }

    if (this.lightningEnabled()) {
      if (this.lightningIntensity > 0.5) {
        this.lightningIntensity = Math.max(0, this.lightningIntensity - deltaSeconds * 900);
      } else {
        this.lightningCooldownS -= deltaSeconds;
        if (this.lightningCooldownS <= 0) {
          this.lightningPositionVector.set(
            (Math.random() * 2 - 1) * planetR * 0.8,
            Math.random() * planetR * 0.3,
            (Math.random() * 2 - 1) * planetR * 0.8,
          );
          this.lightningPosition.set([
            this.lightningPositionVector.x,
            this.lightningPositionVector.y,
            this.lightningPositionVector.z,
          ]);
          this.lightningIntensity = 450 * (planetR / 55);
          this.lightningCooldownS = 2 + Math.random() * 4;
        }
      }
      this.lightningVisible.set(this.lightningIntensity > 30);
    } else {
      this.lightningVisible.set(false);
    }
  }
}
