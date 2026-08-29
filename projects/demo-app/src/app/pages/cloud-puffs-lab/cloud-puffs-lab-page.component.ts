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
  buildCloudAtmosphere,
  buildCloudPuffCluster,
  CLOUD_PUFF_DOMAINS,
  CLOUD_PUFF_STYLES,
  DEFAULT_CLOUD_PUFF_DOMAIN_ID,
  DEFAULT_CLOUD_PUFF_STYLE_ID,
  type ICloudAtmosphere,
  type ICloudPuffCluster,
  type ICloudPuffPointLight,
} from 'triangular-engine/clouds';
import { findCellNear } from 'triangular-engine/worldgen';
import { PlanetViewComponent } from 'triangular-engine/worldgen/render';

export type WorldScale = 'small' | 'medium' | 'large';

export interface IWorldScalePreset {
  readonly id: WorldScale;
  readonly label: string;
  readonly boxRegion: readonly [number, number, number];
  readonly groundPlaneSize: number;
  readonly groundPlaneY: number;
  readonly planetRadius: number;
  readonly planetCloudRadius: number;
  readonly cloudBandThicknessM: number;
  readonly cylinderRadius: number;
  readonly cylinderLength: number;
  readonly cylinderCloudRadius: number;
  readonly defaultGpuPuffs: number;
  readonly defaultMeshPuffs: number;
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
    planetCloudRadius: 56.4,
    cloudBandThicknessM: 10,
    cylinderRadius: 96,
    cylinderLength: 260,
    cylinderCloudRadius: 70,
    defaultGpuPuffs: 800,
    defaultMeshPuffs: 260,
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
    planetCloudRadius: 225.5,
    cloudBandThicknessM: 12,
    cylinderRadius: 350,
    cylinderLength: 1000,
    cylinderCloudRadius: 325,
    defaultGpuPuffs: 2400,
    defaultMeshPuffs: 800,
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
    planetCloudRadius: 717.5,
    cloudBandThicknessM: 15,
    cylinderRadius: 1000,
    cylinderLength: 3200,
    cylinderCloudRadius: 965,
    defaultGpuPuffs: 6000,
    defaultMeshPuffs: 1800,
    cameraPos: [0, 700, 2200],
    far: 60000,
  },
};

const ROCKET_COLOR = new Color('#7fd9ff');
const LIGHTNING_COLOR = new Color('#dce8ff');

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

  readonly renderMode = signal<'gpu-atmosphere' | 'mesh-cluster'>('gpu-atmosphere');
  readonly scalePresets = WORLD_SCALE_PRESETS;
  readonly scales: WorldScale[] = ['small', 'medium', 'large'];
  readonly worldScale = signal<WorldScale>('small');
  readonly activePreset = computed(() => WORLD_SCALE_PRESETS[this.worldScale()]);

  // Atmospheric Layers
  readonly showPuffLayer = signal(true);
  readonly showCirrusLayer = signal(true);

  // Clump & Puff Dynamics (matching planetary-clouds-weather)
  readonly puffPixelScale = signal(9.0);
  readonly puffClumpRadius = signal(0.015);
  readonly puffFollowLag = signal(1.5);
  readonly particleLifespanS = signal(20.0);
  readonly gpuParticleCount = signal(800);

  // Wind & Flow Dynamics
  readonly windSpeed = signal(0.05);
  readonly curlTurbulence = signal(0.06);
  readonly curlFrequency = signal(2.0);
  readonly zonalBanding = signal(true);
  readonly timewarp = signal(1);

  // Mesh Cluster Options
  readonly styles = CLOUD_PUFF_STYLES;
  readonly styleId = signal(DEFAULT_CLOUD_PUFF_STYLE_ID);
  readonly domains = CLOUD_PUFF_DOMAINS;
  readonly domainId = signal(DEFAULT_CLOUD_PUFF_DOMAIN_ID);
  readonly meshPuffCount = signal(260);
  readonly meshPuffScaleMin = signal(5);
  readonly meshPuffScaleMax = signal(14);
  readonly flatShading = signal(true);

  // Lighting & Surface
  readonly sunAzimuthDeg = signal(35);
  readonly sunElevationDeg = signal(38);
  readonly rimStrength = signal(1.2);
  readonly moistureDriven = signal(true);
  readonly planetRenderMode = signal<'elevation' | 'moisture' | 'biome' | 'temperature' | 'land'>('elevation');

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

  private readonly atmosphere = signal<ICloudAtmosphere | null>(null);
  private readonly cluster = signal<ICloudPuffCluster | null>(null);
  private readonly engine = inject(EngineService);
  private rocketAngle = 0;
  private lightningCooldownS = 3;
  private lightningIntensity = 0;
  private readonly lightningPositionVector = new Vector3();
  private simulationTimeS = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);

    // Rebuild GPU Atmosphere or Mesh Cluster
    effect(() => {
      const mode = this.renderMode();
      const preset = this.activePreset();
      const gpuCount = this.gpuParticleCount();
      const meshCount = this.meshPuffCount();
      const styleId = this.styleId();
      const domainId = this.domainId();
      const shading = this.flatShading() ? ('flat' as const) : ('smooth' as const);
      const isMoisture = this.moistureDriven();
      const ecology = this.planet()?.ecology();

      untracked(() => {
        if (mode === 'gpu-atmosphere') {
          this.disposeMeshCluster();
          this.rebuildAtmosphere(preset, gpuCount);
        } else {
          this.disposeAtmosphere();
          this.rebuildMeshCluster({
            count: meshCount,
            scaleMin: this.meshPuffScaleMin(),
            scaleMax: this.meshPuffScaleMax(),
            shading,
            seed: 7,
            styleId,
            domainId,
            isMoisture,
            ecology,
            preset,
          });
        }
      });
    });

    // Reactive Updates to GPU Atmosphere Uniforms
    effect(() => {
      const atmos = this.atmosphere();
      if (!atmos) return;
      atmos.showPuffs(this.showPuffLayer());
      atmos.showCirrus(this.showCirrusLayer());
      atmos.setPuffPixelScale(this.puffPixelScale());
      atmos.setClumpRadius(this.puffClumpRadius());
      atmos.setFollowLag(this.puffFollowLag());
      atmos.setLifespan(this.particleLifespanS());
      atmos.setWindParams({
        zonalSpeed: this.windSpeed(),
        curlStrength: this.curlTurbulence(),
        curlFrequency: this.curlFrequency(),
      });
      atmos.setSunDirection(this.sunDirection());
    });

    // Frame Tick
    this.engine.tick$.pipe(takeUntilDestroyed(destroyRef)).subscribe((delta) => {
      const effectiveDelta = delta * this.timewarp();
      this.simulationTimeS += effectiveDelta;

      const atmos = this.atmosphere();
      if (atmos) {
        atmos.update(this.simulationTimeS);
      }

      const cluster = this.cluster();
      if (cluster) {
        cluster.advanceWind(
          effectiveDelta,
          {
            speed: this.windSpeed() * 70,
            curlTurbulence: this.curlTurbulence() * 8,
            zonalBanding: this.domainId() === 'sphere-shell' && this.zonalBanding(),
          },
          this.simulationTimeS,
        );
      }

      this.updateDynamicLights(effectiveDelta);
    });

    destroyRef.onDestroy(() => {
      this.disposeAtmosphere();
      this.disposeMeshCluster();
    });
  }

  onWorldScaleChange(scale: WorldScale): void {
    this.worldScale.set(scale);
    const preset = WORLD_SCALE_PRESETS[scale];
    this.gpuParticleCount.set(preset.defaultGpuPuffs);
    this.meshPuffCount.set(preset.defaultMeshPuffs);
  }

  private rebuildAtmosphere(preset: IWorldScalePreset, particleCount: number): void {
    this.disposeAtmosphere();
    const atmos = buildCloudAtmosphere({
      particleCount,
      planetRadius: preset.planetRadius,
      puffShellRadius: preset.planetCloudRadius,
      cirrusShellRadius: preset.planetRadius * 1.055,
      puffPixelScale: this.puffPixelScale(),
      clumpRadius: this.puffClumpRadius(),
      followLag: this.puffFollowLag(),
      lifespanS: this.particleLifespanS(),
      zonalSpeed: this.windSpeed(),
      curlStrength: this.curlTurbulence(),
      curlFrequency: this.curlFrequency(),
      rimStrength: this.rimStrength(),
    });
    atmos.setSunDirection(this.sunDirection());
    this.engine.scene.add(atmos.group);
    this.atmosphere.set(atmos);
  }

  private disposeAtmosphere(): void {
    const atmos = this.atmosphere();
    if (!atmos) return;
    atmos.group.removeFromParent();
    atmos.dispose();
    this.atmosphere.set(null);
  }

  private rebuildMeshCluster(options: {
    count: number;
    scaleMin: number;
    scaleMax: number;
    shading: 'flat' | 'smooth';
    seed: number;
    styleId: string;
    domainId: string;
    isMoisture: boolean;
    ecology: any;
    preset: IWorldScalePreset;
  }): void {
    this.disposeMeshCluster();
    const isBox = options.domainId === 'box';
    const isSphere = options.domainId === 'sphere-shell';
    const preset = options.preset;

    let densityAt: ((dir: Vector3) => number) | undefined = undefined;
    if (isSphere && options.isMoisture) {
      const planet = this.planet();
      const graph = planet?.graph();
      const ecology = planet?.ecology();
      if (graph && ecology) {
        let hintId = 0;
        densityAt = (dir: Vector3) => {
          const cell = findCellNear(graph, dir, hintId);
          hintId = cell.id;
          const moisture = ecology.moisture[cell.id] ?? 0.5;
          return Math.max(0.04, Math.pow(moisture, 1.4));
        };
      }
    }

    const clusterOrigin: readonly [number, number, number] = isBox
      ? [0, preset.boxRegion[1] * 0.9, 0]
      : [0, 0, 0];

    const cluster = buildCloudPuffCluster({
      instanceCount: options.count,
      seed: options.seed,
      regionSizeM: preset.boxRegion,
      originM: clusterOrigin,
      radiusM: isSphere ? preset.planetCloudRadius : preset.cylinderCloudRadius,
      lengthM: preset.cylinderLength,
      shellThicknessM: preset.cloudBandThicknessM,
      puffScaleRangeM: [options.scaleMin, options.scaleMax],
      shading: options.shading,
      styleId: options.styleId,
      domainId: options.domainId,
      densityAt,
      material: { rimStrength: this.rimStrength() },
    });
    cluster.setSunDirection(this.sunDirection());
    cluster.setTime(this.simulationTimeS, {
      speed: this.windSpeed() * 70,
      curlTurbulence: this.curlTurbulence() * 8,
      zonalBanding: options.domainId === 'sphere-shell' && this.zonalBanding(),
    });
    this.engine.scene.add(cluster.group);
    this.cluster.set(cluster);
  }

  private disposeMeshCluster(): void {
    const cluster = this.cluster();
    if (!cluster) return;
    cluster.group.removeFromParent();
    cluster.dispose();
    this.cluster.set(null);
  }

  private updateDynamicLights(deltaSeconds: number): void {
    const cluster = this.cluster();
    if (!cluster) return;
    const lights: ICloudPuffPointLight[] = [];
    const planetR = this.activePreset().planetRadius;

    if (this.rocketEngineEnabled()) {
      this.rocketAngle += deltaSeconds * 0.4;
      const x = Math.cos(this.rocketAngle) * (planetR * 1.15);
      const z = Math.sin(this.rocketAngle) * (planetR * 0.95);
      const y = Math.sin(this.rocketAngle * 1.7) * (planetR * 0.25);
      this.rocketPosition.set([x, y, z]);
      lights.push({
        position: new Vector3(x, y, z),
        color: ROCKET_COLOR,
        intensity: 80 * (planetR / 55),
      });
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
      if (this.lightningIntensity > 0.5) {
        lights.push({
          position: this.lightningPositionVector,
          color: LIGHTNING_COLOR,
          intensity: this.lightningIntensity,
        });
      }
    } else {
      this.lightningVisible.set(false);
    }

    cluster.setPointLights(lights);
  }
}
