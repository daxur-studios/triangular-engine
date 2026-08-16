import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import {
  BackSide, BoxGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, SphereGeometry, Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  createAnimalAquaticSchoolCyclePlayback,
  type AnimalAquaticSchoolCyclePlayback,
  type AnimalAquaticSchoolCycleDefinition,
  type AnimalAquaticSchoolMember,
  type AnimalVector3,
  type AnimalWaterVolume,
} from 'triangular-engine/animals';
import { TerrainAnimalWorldSurface } from 'triangular-engine/animals/terrain';
import { TerrainWaterAnimalVolume } from 'triangular-engine/animals/water';
import {
  CylinderWaterDomain, PlaneWaterDomain, SphereWaterDomain, type WaterSurface,
} from 'triangular-engine/water';
import {
  ConstantTerrainField, CylinderTerrainDomain, PlaneTerrainDomain, SphereTerrainDomain,
} from 'triangular-engine/terrain';

type WorldShape = 'plane' | 'sphere' | 'cylinder';
interface WorldView {
  readonly shape: WorldShape;
  readonly root: Group;
  readonly water: AnimalWaterVolume;
  readonly definition: AnimalAquaticSchoolCycleDefinition;
  readonly playback: AnimalAquaticSchoolCyclePlayback;
  readonly fish: readonly Mesh[];
}

const WATER_DEPTH_M = 3;
const FISH_DEPTH_M = 1.5;
const flatFlow: WaterSurface = {
  getHeight: () => 0,
  getNormal: (_x, _z, _time, out = new Vector3()) => out.set(0, 1, 0),
  getFlow: (_x, _z, _time, out = new Vector3()) => out.set(0.24, 0, 0),
};

/**
 * Presentation-only proof for the aquatic policy. Fish transforms are sampled
 * directly from the bounded production cycle at the selected Universal Time.
 */
@Component({
  selector: 'app-animals-fish-worlds-lab-page',
  imports: [EngineModule],
  templateUrl: './animals-fish-worlds-lab-page.component.html',
  styleUrl: './animals-fish-worlds-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class AnimalsFishWorldsLabPageComponent {
  readonly universalTime = signal(0);
  readonly timeScale = signal(1);
  readonly paused = signal(false);
  readonly phases = signal<Record<WorldShape, string>>({ plane: 'home-schooling', sphere: 'home-schooling', cylinder: 'home-schooling' });
  readonly replaySteps = signal<Record<WorldShape, number>>({ plane: 0, sphere: 0, cylinder: 0 });
  readonly speedOptions = [-50, -10, -5, -1, 0, 1, 5, 10, 50] as const;

  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fishGeometry = new ConeGeometry(0.17, 0.68, 5);
  private readonly fishMaterial = new MeshStandardMaterial({ color: '#ffad4a', roughness: 0.55 });
  private readonly terrainMaterial = new MeshStandardMaterial({ color: '#263b46', roughness: 0.95 });
  private readonly waterMaterial = new MeshBasicMaterial({ color: '#2788c8', transparent: true, opacity: 0.22, side: DoubleSide, depthWrite: false });
  private readonly worldViews: readonly WorldView[];

  constructor() {
    this.worldViews = [
      this.createPlane(),
      this.createSphere(),
      this.createCylinder(),
    ];
    for (const view of this.worldViews) this.engine.scene.add(view.root);
    this.renderAt(0);

    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      if (!this.paused() && this.timeScale() !== 0) {
        this.universalTime.update(value => value + elapsed * this.timeScale());
        this.renderAt(this.universalTime());
      }
    }, 50);
    this.destroyRef.onDestroy(() => {
      window.clearInterval(timer);
      for (const view of this.worldViews) view.root.removeFromParent();
      this.fishGeometry.dispose();
      this.fishMaterial.dispose();
      this.terrainMaterial.dispose();
      this.waterMaterial.dispose();
    });
  }

  setUniversalTime(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    this.universalTime.set(value);
    this.renderAt(value);
  }

  setTimeScale(value: number): void {
    this.timeScale.set(value);
    this.paused.set(value === 0);
  }

  togglePause(): void { this.paused.update(value => !value); }

  reset(): void {
    this.universalTime.set(0);
    this.timeScale.set(1);
    this.paused.set(false);
    this.renderAt(0);
  }

  private createPlane(): WorldView {
    const terrain = new TerrainAnimalWorldSurface(new ConstantTerrainField(-WATER_DEPTH_M), new PlaneTerrainDomain(100));
    const water = new TerrainWaterAnimalVolume({ terrain, bodies: [{ body: { id: 'plane-sea', domain: new PlaneWaterDomain(), surface: flatFlow } }] });
    const root = new Group(); root.position.set(-23, 0, 0);
    const seabed = new Mesh(new PlaneGeometry(18, 18, 12, 12), this.terrainMaterial); seabed.rotation.x = -Math.PI / 2; seabed.position.y = -WATER_DEPTH_M; root.add(seabed);
    const volume = new Mesh(new BoxGeometry(18, WATER_DEPTH_M, 18), this.waterMaterial); volume.position.y = -WATER_DEPTH_M / 2; root.add(volume);
    const surface = new Mesh(new PlaneGeometry(18, 18), this.waterMaterial); surface.rotation.x = -Math.PI / 2; root.add(surface);
    return this.finishWorld('plane', root, water, { x: 0, y: -FISH_DEPTH_M, z: 0 });
  }

  private createSphere(): WorldView {
    const terrain = new TerrainAnimalWorldSurface(new ConstantTerrainField(-WATER_DEPTH_M), new SphereTerrainDomain(8));
    const water = new TerrainWaterAnimalVolume({ terrain, bodies: [{ body: { id: 'sphere-sea', domain: new SphereWaterDomain(8), surface: flatFlow } }] });
    const root = new Group();
    root.add(new Mesh(new SphereGeometry(8 - WATER_DEPTH_M, 32, 20), this.terrainMaterial));
    root.add(new Mesh(new SphereGeometry(8, 32, 20), this.waterMaterial));
    return this.finishWorld('sphere', root, water, { x: 8 - FISH_DEPTH_M, y: 0, z: 0 });
  }

  private createCylinder(): WorldView {
    const terrain = new TerrainAnimalWorldSurface(new ConstantTerrainField(-WATER_DEPTH_M), new CylinderTerrainDomain({ radiusM: 8, lengthM: 18 }));
    const water = new TerrainWaterAnimalVolume({ terrain, bodies: [{ body: {
      id: 'cylinder-sea', domain: new CylinderWaterDomain(8, { axis: new Vector3(1, 0, 0), lengthM: 18 }), surface: flatFlow,
    } }] });
    const root = new Group(); root.position.set(23, 0, 0);
    const seabed = new Mesh(new CylinderGeometry(11, 11, 18, 40, 1, true), this.terrainMaterial); seabed.rotation.z = Math.PI / 2; root.add(seabed);
    const surface = new Mesh(new CylinderGeometry(8, 8, 18, 40, 1, true), this.waterMaterial); surface.rotation.z = Math.PI / 2; root.add(surface);
    return this.finishWorld('cylinder', root, water, { x: 0, y: 8 + FISH_DEPTH_M, z: 0 });
  }

  private finishWorld(shape: WorldShape, root: Group, water: AnimalWaterVolume, homePosition: AnimalVector3): WorldView {
    const home = { id: `${shape}-home`, position: homePosition, radiusM: 2.1, capacity: 8, suitability01: 1 };
    const homeSample = water.sample(home.position, 0);
    if (!homeSample.bottom) throw new Error(`${shape} fish viewer home has no water floor.`);
    const targetSurface = water.moveAlongSurface(home.position, scale(homeSample.bottom.tangentV, 5.4), 1, 0);
    if (!targetSurface) throw new Error(`${shape} fish viewer forage zone has no water surface.`);
    const feeding = {
      id: `${shape}-forage`,
      position: addScaled(targetSurface.position, targetSurface.normal, -FISH_DEPTH_M),
      radiusM: 2.1, capacity: 8, suitability01: 0.9,
    };
    const policy = {
      water, maximumMembers: 12, maximumZones: 4, maximumZoneDistanceM: 16,
      minimumZoneSuitability01: 0.3, maximumSpeedMps: 2.5, maximumAccelerationMps2: 4,
      maximumSubstepDistanceM: 0.3, maximumSubsteps: 8,
      minimumSurfaceClearanceM: 0.8, minimumBottomClearanceM: 0.8,
      preferredSurfaceClearanceM: FISH_DEPTH_M, maximumSurfaceClearanceM: 2.2,
      segmentSampleSpacingM: 0.25, separationRadiusM: 0.9, separationWeight: 2,
      cohesionWeight: 0.7, alignmentWeight: 0.2, targetWeight: 4,
      flowWeight: 0.15, depthWeight: 1.5, arrivalRadiusM: 0.3,
      slotSpacingM: 0.65, maximumAvoidanceAttempts: 4,
    };
    const definition: AnimalAquaticSchoolCycleDefinition = {
      groupId: `${shape}-school`, groupSeed: 73, memberCount: 8,
      homeZone: home, feedingZones: [feeding],
      schoolingDurationS: 5, outboundDurationS: 8, feedingDurationS: 8, returnDurationS: 12,
      // Playback advances incrementally; direct arbitrary-time reads remain bounded.
      fixedStepSeconds: 0.1, maximumReplaySteps: 340, policy,
    };
    const fish = Array.from({ length: definition.memberCount }, () => {
      const mesh = new Mesh(this.fishGeometry, this.fishMaterial);
      root.add(mesh);
      return mesh;
    });
    return { shape, root, water, definition, playback: createAnimalAquaticSchoolCyclePlayback(definition), fish };
  }

  private renderAt(time: number): void {
    const phases = { ...this.phases() };
    const replaySteps = { ...this.replaySteps() };
    for (const view of this.worldViews) {
      const snapshot = view.playback.sample(time);
      phases[view.shape] = snapshot.phase;
      replaySteps[view.shape] = snapshot.replaySteps;
      snapshot.members.forEach((member, index) => this.renderFish(view, view.fish[index], member, time));
    }
    this.phases.set(phases);
    this.replaySteps.set(replaySteps);
  }

  private renderFish(view: WorldView, fish: Mesh, member: AnimalAquaticSchoolMember, time: number): void {
    fish.position.copy(vector(member.position));
    const sampled = view.water.sample(member.position, time);
    const velocity = vector(member.velocity);
    const forward = velocity.lengthSq() > 1e-8
      ? velocity.normalize()
      : sampled.bottom ? vector(sampled.bottom.tangentU).normalize() : new Vector3(1, 0, 0);
    fish.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), forward));
  }
}

function vector(value: AnimalVector3): Vector3 { return new Vector3(value.x, value.y, value.z); }
function scale(value: AnimalVector3, amount: number): AnimalVector3 { return { x: value.x * amount, y: value.y * amount, z: value.z * amount }; }
function addScaled(origin: AnimalVector3, direction: AnimalVector3, amount: number): AnimalVector3 {
  return { x: origin.x + direction.x * amount, y: origin.y + direction.y * amount, z: origin.z + direction.z * amount };
}
