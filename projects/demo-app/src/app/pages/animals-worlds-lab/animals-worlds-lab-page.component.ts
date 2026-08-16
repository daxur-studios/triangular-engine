import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import {
  BackSide, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide,
  Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, PlaneGeometry,
  Quaternion, SphereGeometry, Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  createAnimalAirFlockCyclePlayback,
  type AnimalAirFlockCyclePlayback,
  type AnimalAirFlockCycleDefinition,
  type AnimalAirFlockMember,
  type AnimalVector3,
  type AnimalWorldSurface,
} from 'triangular-engine/animals';
import { TerrainAnimalWorldSurface } from 'triangular-engine/animals/terrain';
import {
  buildFloraMesh, deriveFloraSockets, FLORA_OAK_ARCHETYPE, FLORA_OAK_COLORS,
  generateFloraSkeleton,
} from 'triangular-engine/procedural';
import {
  ConstantTerrainField, CylinderTerrainDomain, PlaneTerrainDomain, SphereTerrainDomain,
} from 'triangular-engine/terrain';

type WorldShape = 'plane' | 'sphere' | 'cylinder';
interface WorldView {
  readonly shape: WorldShape;
  readonly label: string;
  readonly root: Group;
  readonly surface: AnimalWorldSurface;
  readonly definition: AnimalAirFlockCycleDefinition;
  readonly playback: AnimalAirFlockCyclePlayback;
  readonly birds: readonly Mesh[];
}

@Component({
  selector: 'app-animals-worlds-lab-page',
  imports: [EngineModule],
  templateUrl: './animals-worlds-lab-page.component.html',
  styleUrl: './animals-worlds-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class AnimalsWorldsLabPageComponent {
  readonly universalTime = signal(0);
  readonly timeScale = signal(1);
  readonly paused = signal(false);
  readonly phases = signal<Record<WorldShape, string>>({ plane: 'roosting', sphere: 'roosting', cylinder: 'roosting' });
  readonly replaySteps = signal<Record<WorldShape, number>>({ plane: 0, sphere: 0, cylinder: 0 });
  readonly speedOptions = [-50, -10, -5, -1, 0, 1, 5, 10, 50] as const;

  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly birdGeometry = new ConeGeometry(0.16, 0.62, 5);
  private readonly birdMaterial = new MeshStandardMaterial({ color: '#ffd369', roughness: 0.65 });
  private readonly treeMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: DoubleSide });
  private readonly worldViews: readonly WorldView[];

  constructor() {
    this.worldViews = [
      this.createWorld('plane', 'Infinite plane', new TerrainAnimalWorldSurface(
        new ConstantTerrainField(0), new PlaneTerrainDomain(100)), new Vector3(-27, 0, 0), { x: 0, y: 0, z: 0 }),
      this.createWorld('sphere', 'Planet sphere', new TerrainAnimalWorldSurface(
        new ConstantTerrainField(0), new SphereTerrainDomain(10)), new Vector3(0, 0, 0), { x: 10, y: 0, z: 0 }),
      this.createWorld('cylinder', 'Inside cylinder', new TerrainAnimalWorldSurface(
        new ConstantTerrainField(0), new CylinderTerrainDomain({ radiusM: 10, lengthM: 20 })),
        new Vector3(27, 0, 0), { x: 0, y: 10, z: 0 }),
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
      for (const view of this.worldViews) {
        view.root.traverse(object => {
          if (object instanceof Mesh && object.geometry !== this.birdGeometry) object.geometry.dispose();
        });
        view.root.removeFromParent();
      }
      this.birdGeometry.dispose();
      this.birdMaterial.dispose();
      this.treeMaterial.dispose();
    });
  }

  setUniversalTime(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    this.universalTime.set(value);
    this.renderAt(value);
  }
  setTimeScale(value: number): void { this.timeScale.set(value); this.paused.set(value === 0); }
  togglePause(): void { this.paused.update(value => !value); }
  reset(): void { this.universalTime.set(0); this.timeScale.set(1); this.paused.set(false); this.renderAt(0); }

  private createWorld(
    shape: WorldShape,
    label: string,
    surface: AnimalWorldSurface,
    displayOffset: Vector3,
    query: AnimalVector3,
  ): WorldView {
    const root = new Group();
    root.position.copy(displayOffset);
    root.add(this.terrainMesh(shape));
    const origin = surface.sample(query);
    const treeGrounds = [-3, 3].map(offset => surface.sample(surface.moveAlongSurface(
      origin.position, scale(origin.tangentV, offset), 1,
    )));
    const treeSeeds = [420, 423] as const;
    const roostSites = treeGrounds.flatMap((ground, index) => {
      const seed = treeSeeds[index];
      const skeleton = generateFloraSkeleton(FLORA_OAK_ARCHETYPE, seed);
      const { geometry } = buildFloraMesh(skeleton, FLORA_OAK_ARCHETYPE);
      colorizeTree(geometry);
      const tree = new Mesh(geometry, this.treeMaterial);
      const orientation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), vector(ground.surfaceUp));
      tree.position.copy(vector(ground.position));
      tree.quaternion.copy(orientation);
      tree.scale.setScalar(0.55);
      root.add(tree);
      return deriveFloraSockets(skeleton, FLORA_OAK_ARCHETYPE, seed)
        .filter(candidate => candidate.kind === 'perch')
        .map((socket, socketIndex) => {
          const socketOffset = new Vector3(...socket.positionM).multiplyScalar(0.55).applyQuaternion(orientation);
          return {
            id: `${shape}-oak-${index}-perch-${socketIndex}`,
            position: fromVector(vector(ground.position).add(socketOffset)), capacity: 1,
          };
        });
    });
    const flightGround = surface.sample(surface.moveAlongSurface(origin.position, scale(origin.tangentU, 8), 1));
    const flightTarget = addScaled(flightGround.position, flightGround.surfaceUp, 6);
    const policy = {
      surface, maximumMembers: 12, maximumRoostSites: 12,
      maximumSpeedMps: 6, maximumAccelerationMps2: 8,
      maximumSubstepDistanceM: 0.5, maximumSubsteps: 8,
      minimumAltitudeM: 0.5, maximumAltitudeM: 12, preferredAltitudeM: 6,
      separationRadiusM: 1.4, separationWeight: 3.2, cohesionWeight: 1.1,
      alignmentWeight: 0.8, targetWeight: 1.35, arrivalRadiusM: 0.4,
      holdingRadiusM: 4, holdingSpeedMps: 2.5, roostSlotSpacingM: 0.48,
    };
    const definition: AnimalAirFlockCycleDefinition = {
      groupId: `${shape}-flock`, memberCount: 8, roostSites, flightTarget,
      roostDurationS: 5, flightDurationS: 15, returnDurationS: 30,
      // Playback advances incrementally; direct arbitrary-time reads remain bounded.
      fixedStepSeconds: 0.1, maximumReplaySteps: 500, policy,
    };
    const birds = Array.from({ length: definition.memberCount }, () => {
      const bird = new Mesh(this.birdGeometry, this.birdMaterial);
      root.add(bird);
      return bird;
    });
    return { shape, label, root, surface, definition, playback: createAnimalAirFlockCyclePlayback(definition), birds };
  }

  private renderAt(time: number): void {
    const phases = { ...this.phases() };
    const steps = { ...this.replaySteps() };
    for (const view of this.worldViews) {
      const snapshot = view.playback.sample(time);
      phases[view.shape] = snapshot.phase;
      steps[view.shape] = snapshot.replaySteps;
      snapshot.members.forEach((member, index) => this.renderBird(view, view.birds[index], member));
    }
    this.phases.set(phases);
    this.replaySteps.set(steps);
  }

  private renderBird(view: WorldView, bird: Mesh, member: AnimalAirFlockMember): void {
    bird.position.copy(vector(member.position));
    const velocity = vector(member.velocity);
    const forward = velocity.lengthSq() > 1e-8
      ? velocity.normalize()
      : vector(view.surface.sample(member.position).tangentU).normalize();
    bird.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), forward);
  }

  private terrainMesh(shape: WorldShape): Mesh {
    if (shape === 'plane') {
      const mesh = new Mesh(new PlaneGeometry(22, 22, 12, 12), new MeshStandardMaterial({ color: '#304b38', roughness: 1 }));
      mesh.rotation.x = -Math.PI / 2;
      return mesh;
    }
    if (shape === 'sphere') {
      return new Mesh(new SphereGeometry(10, 32, 20), new MeshStandardMaterial({ color: '#315746', wireframe: true, transparent: true, opacity: 0.5 }));
    }
    const mesh = new Mesh(new CylinderGeometry(10, 10, 20, 40, 1, true), new MeshStandardMaterial({ color: '#416052', wireframe: true, transparent: true, opacity: 0.45, side: BackSide }));
    mesh.rotation.z = Math.PI / 2;
    return mesh;
  }
}

function colorizeTree(geometry: BufferGeometry): void {
  const weights = geometry.getAttribute('windWeight');
  const colors = new Float32Array(weights.count * 3);
  const trunk = new Color(FLORA_OAK_COLORS.trunkHex);
  const leaves = new Color(FLORA_OAK_COLORS.leafHex);
  const color = new Color();
  for (let index = 0; index < weights.count; index++) {
    color.copy(trunk).lerp(leaves, weights.getX(index));
    colors[index * 3] = color.r; colors[index * 3 + 1] = color.g; colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
}
function vector(value: AnimalVector3): Vector3 { return new Vector3(value.x, value.y, value.z); }
function fromVector(value: Vector3): AnimalVector3 { return { x: value.x, y: value.y, z: value.z }; }
function scale(value: AnimalVector3, amount: number): AnimalVector3 { return { x: value.x * amount, y: value.y * amount, z: value.z * amount }; }
function addScaled(origin: AnimalVector3, direction: AnimalVector3, amount: number): AnimalVector3 {
  return { x: origin.x + direction.x * amount, y: origin.y + direction.y * amount, z: origin.z + direction.z * amount };
}
