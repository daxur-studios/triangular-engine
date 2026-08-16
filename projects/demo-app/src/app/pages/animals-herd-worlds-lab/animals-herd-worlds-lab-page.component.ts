import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import {
  BackSide, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry,
  Matrix4, Quaternion, SphereGeometry, Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  createAnimalLandHerdCyclePlayback,
  type AnimalLandHerdCyclePlayback,
  type AnimalGrazingPatch,
  type AnimalLandHerdCycleDefinition,
  type AnimalLandHerdMember,
  type AnimalVector3,
  type AnimalWorldSurface,
} from 'triangular-engine/animals';
import { TerrainAnimalWorldSurface } from 'triangular-engine/animals/terrain';
import {
  ConstantTerrainField, CylinderTerrainDomain, PlaneTerrainDomain, SphereTerrainDomain,
} from 'triangular-engine/terrain';

type WorldShape = 'plane' | 'sphere' | 'cylinder';
interface HerdWorldView {
  readonly shape: WorldShape;
  readonly label: string;
  readonly root: Group;
  readonly surface: AnimalWorldSurface;
  readonly definition: AnimalLandHerdCycleDefinition;
  readonly playback: AnimalLandHerdCyclePlayback;
  readonly animals: readonly Mesh[];
}

/**
 * Visual acceptance surface for the production land-herd cycle. This component
 * never integrates animal state: it samples one immutable production definition
 * directly at the requested Universal Time for every rendered frame.
 */
@Component({
  selector: 'app-animals-herd-worlds-lab-page',
  imports: [EngineModule],
  templateUrl: './animals-herd-worlds-lab-page.component.html',
  styleUrl: './animals-herd-worlds-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class AnimalsHerdWorldsLabPageComponent {
  readonly universalTime = signal(0);
  readonly timeScale = signal(1);
  readonly paused = signal(false);
  readonly phases = signal<Record<WorldShape, string>>({
    plane: 'resting', sphere: 'resting', cylinder: 'resting',
  });
  readonly selectedPatches = signal<Record<WorldShape, string>>({
    plane: 'none', sphere: 'none', cylinder: 'none',
  });
  readonly replaySteps = signal<Record<WorldShape, number>>({ plane: 0, sphere: 0, cylinder: 0 });
  readonly speedOptions = [-50, -10, -5, -1, 0, 1, 5, 10, 50] as const;

  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly animalGeometry = new SphereGeometry(0.38, 12, 8);
  private readonly animalMaterial = new MeshStandardMaterial({ color: '#d49b55', roughness: 0.72 });
  private readonly worldViews: readonly HerdWorldView[];

  constructor() {
    this.worldViews = [
      this.createWorld(
        'plane', 'Infinite plane',
        new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new PlaneTerrainDomain(100)),
        new Vector3(-28, 0, 0), { x: 0, y: 0, z: 0 },
      ),
      this.createWorld(
        'sphere', 'Planet sphere',
        new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new SphereTerrainDomain(10)),
        new Vector3(0, 0, 0), { x: 10, y: 0, z: 0 },
      ),
      this.createWorld(
        'cylinder', 'Inside cylinder',
        new TerrainAnimalWorldSurface(
          new ConstantTerrainField(0), new CylinderTerrainDomain({ radiusM: 10, lengthM: 20 }),
        ),
        new Vector3(28, 0, 0), { x: 0, y: 10, z: 0 },
      ),
    ];
    for (const world of this.worldViews) this.engine.scene.add(world.root);
    this.renderAt(0);

    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsedSeconds = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      if (!this.paused() && this.timeScale() !== 0) {
        this.universalTime.update(value => value + elapsedSeconds * this.timeScale());
        this.renderAt(this.universalTime());
      }
    }, 50);
    this.destroyRef.onDestroy(() => {
      window.clearInterval(timer);
      for (const world of this.worldViews) {
        world.root.traverse(object => {
          if (object instanceof Mesh && object.geometry !== this.animalGeometry) {
            object.geometry.dispose();
            if (object.material instanceof MeshStandardMaterial) object.material.dispose();
          }
        });
        world.root.removeFromParent();
      }
      this.animalGeometry.dispose();
      this.animalMaterial.dispose();
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

  private createWorld(
    shape: WorldShape,
    label: string,
    surface: AnimalWorldSurface,
    displayOffset: Vector3,
    query: AnimalVector3,
  ): HerdWorldView {
    const root = new Group();
    root.position.copy(displayOffset);
    root.add(this.terrainMesh(shape));

    const homeCenter = surface.sample(query);
    const pastureCenter = surface.sample(surface.moveAlongSurface(
      homeCenter.position, scale(homeCenter.tangentU, 9), 1,
    ));
    const sidePastureCenter = surface.sample(surface.moveAlongSurface(
      pastureCenter.position, scale(homeCenter.tangentV, 3), 1,
    ));
    const homePatch: AnimalGrazingPatch = {
      id: `${shape}-home`, position: homeCenter.position, radiusM: 2.4, capacity: 8, suitability01: 1,
    };
    const grazingPatches: readonly AnimalGrazingPatch[] = [
      { id: `${shape}-meadow`, position: pastureCenter.position, radiusM: 3.3, capacity: 8, suitability01: 0.92 },
      { id: `${shape}-ridge`, position: sidePastureCenter.position, radiusM: 3.3, capacity: 8, suitability01: 0.72 },
    ];
    root.add(this.patchMesh(homePatch, surface, '#577a4c'));
    for (const patch of grazingPatches) root.add(this.patchMesh(patch, surface, '#819d50'));

    const policy = {
      surface, maximumMembers: 12, maximumPatches: 4,
      maximumSpeedMps: 2.5, maximumAccelerationMps2: 4,
      maximumSubstepDistanceM: 0.3, maximumSubsteps: 8,
      maximumSlope01: 0.6, maximumPatchDistanceM: 30, minimumPatchSuitability01: 0.3,
      // Land herds coordinate loosely: separation keeps individuals apart,
      // while cohesion is deliberately softer than the bird/fish schools.
      separationRadiusM: 1.6, separationWeight: 3, cohesionWeight: 0.2,
      // Avoid a constant orbital pull toward patch centres; animals should
      // wander to a slot, then settle instead of sliding like particles.
      alignmentWeight: 0.25, targetWeight: 0.55, arrivalRadiusM: 0.3,
      slotSpacingM: 0.8,
      // Followers respond to the leader with a deterministic lag and spacing;
      // they are not assigned fixed marching slots.
      travelLineSpacingM: 1.2, leaderFollowDelaySeconds: 0.8,
      maximumAvoidanceAttempts: 4,
    };
    const definition: AnimalLandHerdCycleDefinition = {
      groupId: `${shape}-herd`, groupSeed: 91, memberCount: 8,
      homePatch, grazingPatches,
      restDurationS: 5, outboundTravelDurationS: 10, grazeDurationS: 10, returnTravelDurationS: 15,
      // Playback advances incrementally; direct arbitrary-time reads remain bounded.
      fixedStepSeconds: 0.1, maximumReplaySteps: 400, policy,
    };
    const animals = Array.from({ length: definition.memberCount }, () => {
      const animal = new Mesh(this.animalGeometry, this.animalMaterial);
      root.add(animal);
      return animal;
    });
    return { shape, label, root, surface, definition, playback: createAnimalLandHerdCyclePlayback(definition), animals };
  }

  private renderAt(time: number): void {
    const phases = { ...this.phases() };
    const selectedPatches = { ...this.selectedPatches() };
    const replaySteps = { ...this.replaySteps() };
    for (const world of this.worldViews) {
      const snapshot = world.playback.sample(time);
      phases[world.shape] = snapshot.phase;
      selectedPatches[world.shape] = snapshot.selectedGrazingPatchId ?? 'none';
      replaySteps[world.shape] = snapshot.replaySteps;
      snapshot.members.forEach((member, index) => this.renderAnimal(world, world.animals[index], member));
    }
    this.phases.set(phases);
    this.selectedPatches.set(selectedPatches);
    this.replaySteps.set(replaySteps);
  }

  private renderAnimal(world: HerdWorldView, animal: Mesh, member: AnimalLandHerdMember): void {
    animal.position.copy(vector(member.position));
    const frame = world.surface.sample(member.position);
    const velocity = vector(member.velocity);
    const forward = velocity.lengthSq() > 1e-8
      ? velocity.normalize()
      : vector(frame.tangentU).normalize();
    const up = vector(frame.surfaceUp).normalize();
    animal.quaternion.copy(orientation(forward, up));
  }

  private patchMesh(patch: AnimalGrazingPatch, surface: AnimalWorldSurface, color: string): Mesh {
    const mesh = new Mesh(
      new CylinderGeometry(patch.radiusM, patch.radiusM, 0.03, 24),
      new MeshStandardMaterial({ color, roughness: 1, transparent: true, opacity: 0.45 }),
    );
    const frame = surface.sample(patch.position);
    mesh.position.copy(vector(frame.position));
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), vector(frame.surfaceUp).normalize());
    return mesh;
  }

  private terrainMesh(shape: WorldShape): Mesh {
    if (shape === 'plane') {
      const mesh = new Mesh(new PlaneGeometry(24, 24, 12, 12), new MeshStandardMaterial({ color: '#304b38', roughness: 1 }));
      mesh.rotation.x = -Math.PI / 2;
      return mesh;
    }
    if (shape === 'sphere') {
      return new Mesh(new SphereGeometry(10, 32, 20), new MeshStandardMaterial({ color: '#315746', wireframe: true, transparent: true, opacity: 0.5 }));
    }
    const mesh = new Mesh(new CylinderGeometry(10, 10, 20, 40, 1, true),
      new MeshStandardMaterial({ color: '#416052', wireframe: true, transparent: true, opacity: 0.45, side: BackSide }));
    mesh.rotation.z = Math.PI / 2;
    return mesh;
  }
}

function orientation(forward: Vector3, up: Vector3): Quaternion {
  const right = new Vector3().crossVectors(up, forward).normalize();
  const correctedForward = new Vector3().crossVectors(right, up).normalize();
  return new Quaternion().setFromRotationMatrix(
    // A Three.js object faces +Z. Keep its local Y aligned with the surface up.
    new Matrix4().makeBasis(right, up, correctedForward),
  );
}

function vector(value: AnimalVector3): Vector3 { return new Vector3(value.x, value.y, value.z); }
function scale(value: AnimalVector3, amount: number): AnimalVector3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}
