import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Vector3Tuple } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { JoltPhysicsModule } from 'triangular-engine/jolt';
import {
  PlaneWaterDomain,
  WaterSurfaceComponent,
  type WaterMotionPresetName,
} from 'triangular-engine/water';
import { WaterBuoyancyComponent } from 'triangular-engine/water/jolt';

type HullShape = 'box' | 'sphere';

interface SpawnedHull {
  readonly id: number;
  readonly shape: HullShape;
  readonly spawnPositionM: Vector3Tuple;
  readonly buoyancy: number;
  readonly color: string;
}

const SEAFLOOR_Y = -40;
const SPAWN_HEIGHT_M = 14;
const SEAFLOOR_BOX_PARAMS: Vector3Tuple = [140, 2, 140];
const BOX_PARAMS: Vector3Tuple = [1.6, 1, 2.4];
const SPHERE_RADIUS_M = 0.9;

/**
 * Phase 3 demo for `triangular-engine/water/jolt`'s `WaterBuoyancyComponent`
 * (docs/runbook/002_water_sublibrary.md). Deliberately open water, away from
 * shore: the shallow-water/near-shore wave accuracy work (Phase 1b) is a
 * separate, still-open item and this demo does not depend on it.
 */
@Component({
  selector: 'app-water-buoyancy-poc-page',
  imports: [
    DecimalPipe,
    RouterLink,
    EngineModule,
    JoltPhysicsModule,
    WaterSurfaceComponent,
    WaterBuoyancyComponent,
  ],
  templateUrl: './water-buoyancy-poc-page.component.html',
  styleUrl: './water-buoyancy-poc-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class WaterBuoyancyPocPageComponent {
  readonly initialCameraPosition: Vector3Tuple = [55, 26, 65];
  readonly initialTarget: Vector3Tuple = [0, -4, 0];
  readonly waterDomain = new PlaneWaterDomain();
  readonly seafloorPosition: Vector3Tuple = [0, SEAFLOOR_Y, 0];
  readonly seafloorBoxParams = SEAFLOOR_BOX_PARAMS;
  readonly boxParams = BOX_PARAMS;
  readonly sphereRadiusM = SPHERE_RADIUS_M;

  readonly waveMotionOptions: ReadonlyArray<{
    readonly value: WaterMotionPresetName;
    readonly label: string;
  }> = [
    { value: 'calmLake', label: 'Calm' },
    { value: 'oceanSwell', label: 'Mid' },
    { value: 'storm', label: 'Storm' },
  ];
  readonly waveMotion = signal<WaterMotionPresetName>('oceanSwell');

  readonly physicsDebug = signal(false);
  readonly customBuoyancy = signal(1.1);
  readonly hulls = signal<readonly SpawnedHull[]>([]);
  readonly underwaterIds = signal<ReadonlySet<number>>(new Set());

  readonly floatingCount = computed(
    () => this.hulls().length - this.underwaterIds().size,
  );
  readonly submergedCount = computed(() => this.underwaterIds().size);

  private nextId = 1;

  setWaveMotion(preset: WaterMotionPresetName): void {
    this.waveMotion.set(preset);
  }

  togglePhysicsDebug(): void {
    this.physicsDebug.update((value) => !value);
  }

  setCustomBuoyancy(input: HTMLInputElement): void {
    this.customBuoyancy.set(Number(input.value));
  }

  spawnFloater(): void {
    this.#spawn(1.15);
  }

  spawnNeutral(): void {
    this.#spawn(1.0);
  }

  spawnSinker(): void {
    this.#spawn(0.5);
  }

  spawnCustom(): void {
    this.#spawn(this.customBuoyancy());
  }

  clearAll(): void {
    this.hulls.set([]);
    this.underwaterIds.set(new Set());
  }

  markEntered(id: number): void {
    this.underwaterIds.update((set) => new Set(set).add(id));
  }

  markExited(id: number): void {
    this.underwaterIds.update((set) => {
      if (!set.has(id)) return set;
      const next = new Set(set);
      next.delete(id);
      return next;
    });
  }

  #spawn(buoyancy: number): void {
    const shape: HullShape = this.hulls().length % 2 === 0 ? 'box' : 'sphere';
    const angle = Math.random() * Math.PI * 2;
    const radius = 6 + Math.random() * 18;
    const id = this.nextId++;
    const color =
      buoyancy >= 1.05 ? '#4fd6a8' : buoyancy <= 0.85 ? '#ff6b6b' : '#f0c95f';
    this.hulls.update((list) => [
      ...list,
      {
        id,
        shape,
        spawnPositionM: [
          Math.cos(angle) * radius,
          SPAWN_HEIGHT_M,
          Math.sin(angle) * radius,
        ],
        buoyancy,
        color,
      },
    ]);
  }
}
