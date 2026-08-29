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
  buildCloudPuffCluster,
  CLOUD_PUFF_DOMAINS,
  CLOUD_PUFF_STYLES,
  DEFAULT_CLOUD_PUFF_DOMAIN_ID,
  DEFAULT_CLOUD_PUFF_STYLE_ID,
  type ICloudPuffCluster,
  type ICloudPuffPointLight,
} from 'triangular-engine/clouds';
import { findCellNear } from 'triangular-engine/worldgen';
import { PlanetViewComponent } from 'triangular-engine/worldgen/render';

export type WorldScale = 'small' | 'medium' | 'large';

export interface IWorldScalePreset {
  readonly id: WorldScale;
  readonly label: string;
  /** Actual physical half-extents of the Cartesian bounding box (metres). */
  readonly boxRegion: readonly [number, number, number];
  readonly groundPlaneSize: number;
  readonly groundPlaneY: number;
  /** Radius of the planet sphere (metres). */
  readonly planetRadius: number;
  /** Altitude of the cloud layer shell above planet center (metres). */
  readonly planetCloudRadius: number;
  /** Physical thickness of the cloud altitude band (metres) - remains human/atmospheric scale. */
  readonly cloudBandThicknessM: number;
  /** Inner radius of the O'Neill cylinder hull (metres). */
  readonly cylinderRadius: number;
  /** Physical length of the cylinder (metres). */
  readonly cylinderLength: number;
  /** Radius of the interior cloud layer (metres). */
  readonly cylinderCloudRadius: number;
  /** Number of physical puffs required to populate this world scale. */
  readonly defaultPuffCount: number;
  readonly maxPuffCount: number;
  /** Orbit camera framing position for this world size. */
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
    planetCloudRadius: 70,
    cloudBandThicknessM: 10,
    cylinderRadius: 96,
    cylinderLength: 260,
    cylinderCloudRadius: 70,
    defaultPuffCount: 300,
    maxPuffCount: 1500,
    cameraPos: [0, 55, 200],
    far: 6000,
  },
  medium: {
    id: 'medium',
    label: 'Medium (Regional Habitat / Continent — R=220m)',
    boxRegion: [350, 25, 350],
    groundPlaneSize: 1200,
    groundPlaneY: -45,
    planetRadius: 220,
    planetCloudRadius: 238,
    cloudBandThicknessM: 12,
    cylinderRadius: 350,
    cylinderLength: 1000,
    cylinderCloudRadius: 325,
    defaultPuffCount: 1200,
    maxPuffCount: 4000,
    cameraPos: [0, 220, 750],
    far: 20000,
  },
  large: {
    id: 'large',
    label: 'Large (Global Planet / Megastructure — R=700m)',
    boxRegion: [1000, 30, 1000],
    groundPlaneSize: 3500,
    groundPlaneY: -90,
    planetRadius: 700,
    planetCloudRadius: 725,
    cloudBandThicknessM: 15,
    cylinderRadius: 1000,
    cylinderLength: 3200,
    cylinderCloudRadius: 965,
    defaultPuffCount: 3000,
    maxPuffCount: 8000,
    cameraPos: [0, 700, 2400],
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

  readonly scalePresets = WORLD_SCALE_PRESETS;
  readonly scales: WorldScale[] = ['small', 'medium', 'large'];
  readonly worldScale = signal<WorldScale>('small');
  readonly activePreset = computed(() => WORLD_SCALE_PRESETS[this.worldScale()]);

  readonly styles = CLOUD_PUFF_STYLES;
  readonly styleId = signal(DEFAULT_CLOUD_PUFF_STYLE_ID);
  readonly selectedStyleDescription = computed(
    () => this.styles.find((style) => style.id === this.styleId())?.description ?? '',
  );

  readonly domains = CLOUD_PUFF_DOMAINS;
  readonly domainId = signal(DEFAULT_CLOUD_PUFF_DOMAIN_ID);
  readonly selectedDomainDescription = computed(
    () => this.domains.find((domain) => domain.id === this.domainId())?.description ?? '',
  );

  /** Physical puff scale in metres (constant human scale across all worlds). */
  readonly puffScaleMin = signal(5);
  readonly puffScaleMax = signal(14);
  readonly puffCount = signal(300);
  readonly flatShading = signal(true);
  readonly seed = signal(7);

  readonly sunAzimuthDeg = signal(35);
  readonly sunElevationDeg = signal(38);
  readonly rimStrength = signal(1.2);
  readonly windSpeed = signal(3.5);
  readonly curlTurbulence = signal(0.4);
  readonly timewarp = signal(1);
  readonly zonalBanding = signal(false);
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

  private readonly cluster = signal<ICloudPuffCluster | null>(null);
  private readonly engine = inject(EngineService);
  private rocketAngle = 0;
  private lightningCooldownS = 3;
  private lightningIntensity = 0;
  private readonly lightningPositionVector = new Vector3();
  private simulationTimeS = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      const ecology = this.planet()?.ecology();
      const isMoisture = this.moistureDriven();
      const preset = this.activePreset();

      const options = {
        count: this.puffCount(),
        scaleMin: this.puffScaleMin(),
        scaleMax: this.puffScaleMax(),
        shading: this.flatShading() ? ('flat' as const) : ('smooth' as const),
        seed: this.seed(),
        styleId: this.styleId(),
        domainId: this.domainId(),
        isMoisture,
        ecology,
        preset,
      };
      untracked(() => this.rebuildCluster(options));
    });

    effect(() => {
      const rim = this.rimStrength();
      const cluster = this.cluster();
      if (cluster) cluster.material.uniforms['rimStrength'].value = rim;
    });

    effect(() => {
      const direction = this.sunDirection();
      this.cluster()?.setSunDirection(direction);
    });

    this.engine.tick$.pipe(takeUntilDestroyed(destroyRef)).subscribe((delta) => {
      const effectiveDelta = delta * this.timewarp();
      this.simulationTimeS += effectiveDelta;
      this.cluster()?.advanceWind(
        effectiveDelta,
        {
          speed: this.windSpeed(),
          curlTurbulence: this.curlTurbulence(),
          zonalBanding: this.domainId() === 'sphere-shell' && this.zonalBanding(),
        },
        this.simulationTimeS,
      );
      this.updateDynamicLights(effectiveDelta);
    });

    destroyRef.onDestroy(() => this.disposeCluster());
  }

  onWorldScaleChange(scale: WorldScale): void {
    this.worldScale.set(scale);
    const preset = WORLD_SCALE_PRESETS[scale];
    this.puffCount.set(preset.defaultPuffCount);
  }

  private rebuildCluster(options: {
    count: number;
    scaleMin: number;
    scaleMax: number;
    shading: 'flat' | 'smooth';
    seed: number;
    styleId: string;
    domainId: string;
    isMoisture: boolean;
    preset: IWorldScalePreset;
  }): void {
    this.disposeCluster();
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
      speed: this.windSpeed(),
      curlTurbulence: this.curlTurbulence(),
      zonalBanding: options.domainId === 'sphere-shell' && this.zonalBanding(),
    });
    this.engine.scene.add(cluster.group);
    this.cluster.set(cluster);
  }

  private disposeCluster(): void {
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
