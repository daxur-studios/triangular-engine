import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
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

const REGION_SIZE_M: readonly [number, number, number] = [110, 22, 110];
const CLUSTER_ORIGIN_M: readonly [number, number, number] = [0, 20, 0];
const ROCKET_COLOR = new Color('#7fd9ff');
const LIGHTNING_COLOR = new Color('#dce8ff');

@Component({
  selector: 'app-cloud-puffs-lab-page',
  imports: [EngineModule],
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

  readonly puffCount = signal(220);
  readonly puffScaleMin = signal(6);
  readonly puffScaleMax = signal(15);
  readonly flatShading = signal(true);
  readonly seed = signal(7);

  readonly sunAzimuthDeg = signal(35);
  readonly sunElevationDeg = signal(38);
  readonly rimStrength = signal(1.2);
  readonly windSpeed = signal(3);

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
    return [direction.x * 200, direction.y * 200, direction.z * 200];
  });

  private readonly cluster = signal<ICloudPuffCluster | null>(null);
  private readonly engine = inject(EngineService);
  private rocketAngle = 0;
  private lightningCooldownS = 3;
  private lightningIntensity = 0;
  private readonly lightningPositionVector = new Vector3();

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      const options = {
        count: this.puffCount(),
        scaleMin: this.puffScaleMin(),
        scaleMax: this.puffScaleMax(),
        shading: this.flatShading() ? ('flat' as const) : ('smooth' as const),
        seed: this.seed(),
        styleId: this.styleId(),
        domainId: this.domainId(),
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
      this.cluster()?.advanceWind(delta, this.windSpeed());
      this.updateDynamicLights(delta);
    });

    destroyRef.onDestroy(() => this.disposeCluster());
  }

  private rebuildCluster(options: {
    count: number;
    scaleMin: number;
    scaleMax: number;
    shading: 'flat' | 'smooth';
    seed: number;
    styleId: string;
    domainId: string;
  }): void {
    this.disposeCluster();
    const isBox = options.domainId === 'box';
    const cluster = buildCloudPuffCluster({
      instanceCount: options.count,
      seed: options.seed,
      regionSizeM: REGION_SIZE_M,
      originM: isBox ? CLUSTER_ORIGIN_M : [0, 0, 0],
      radiusM: options.domainId === 'sphere-shell' ? 70 : 90,
      lengthM: 260,
      shellThicknessM: 14,
      puffScaleRangeM: [options.scaleMin, options.scaleMax],
      shading: options.shading,
      styleId: options.styleId,
      domainId: options.domainId,
      material: { rimStrength: this.rimStrength() },
    });
    cluster.setSunDirection(this.sunDirection());
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

    if (this.rocketEngineEnabled()) {
      this.rocketAngle += deltaSeconds * 0.6;
      const x = Math.cos(this.rocketAngle) * 55;
      const z = Math.sin(this.rocketAngle) * 40;
      const y = Math.sin(this.rocketAngle * 1.7) * 12;
      this.rocketPosition.set([x, y, z]);
      lights.push({
        position: new Vector3(x, y, z),
        color: ROCKET_COLOR,
        intensity: 70,
      });
    }

    if (this.lightningEnabled()) {
      if (this.lightningIntensity > 0.5) {
        this.lightningIntensity = Math.max(0, this.lightningIntensity - deltaSeconds * 900);
      } else {
        this.lightningCooldownS -= deltaSeconds;
        if (this.lightningCooldownS <= 0) {
          this.lightningPositionVector.set(
            (Math.random() * 2 - 1) * 50,
            Math.random() * 12,
            (Math.random() * 2 - 1) * 50,
          );
          this.lightningPosition.set([
            this.lightningPositionVector.x,
            this.lightningPositionVector.y,
            this.lightningPositionVector.z,
          ]);
          this.lightningIntensity = 450;
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
