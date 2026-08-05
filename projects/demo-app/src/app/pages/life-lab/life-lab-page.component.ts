import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  avoidObstacles,
  alignment,
  cohesion,
  fleeInfluences,
  keepAbove,
  keepWithinBounds,
  LifeSimulation,
  separation,
  type LifeBehavior,
  type LifeInfluence,
} from 'triangular-engine/life';

const WORLD_SIZE = 80;
const BIRD_COUNT = 60;
const FISH_COUNT = 36;
const HERD_COUNT = 18;

type BirdStage = 0 | 1 | 2 | 3 | 4;
type TimeScale = 0.5 | 1 | 2 | 5 | 10;
type LifeMode = 'birds' | 'fish' | 'herd';

@Component({
  selector: 'app-life-lab-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './life-lab-page.component.html',
  styleUrl: './life-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class LifeLabPageComponent {
  protected birdStage: BirdStage = 4;
  protected lifeMode: LifeMode = 'birds';
  protected fishLevel = 2;
  protected herdLevel = 2;
  protected timeScale: TimeScale = 1;
  protected readonly timeScales: readonly TimeScale[] = [0.5, 1, 2, 5, 10];
  private readonly engine = inject(EngineService);
  private readonly group = new Group();
  private readonly simulation = new LifeSimulation({ neighborRadius: 10 });
  private readonly birdMesh: InstancedMesh;
  private readonly fishMesh: InstancedMesh;
  private readonly herdMesh: InstancedMesh;
  private readonly fishSimulation = new LifeSimulation({ neighborRadius: 8 });
  private readonly herdSimulation = new LifeSimulation({ neighborRadius: 10 });
  private readonly herdPhaseOffsets = Array.from({ length: HERD_COUNT }, (_, index) => (index * 3.7) % 18);
  private readonly treeMeshes: Mesh[] = [];
  private readonly player = new Mesh(
    new SphereGeometry(1.4, 16, 12),
    new MeshStandardMaterial({ color: '#e66b55', roughness: 0.7 }),
  );
  private readonly birdDummy = new Object3D();
  private readonly birdDirection = new Vector3();
  private readonly birdPosition = new Vector3();
  private readonly playerInfluence: LifeInfluence = {
    id: 'player',
    position: { x: 0, y: 0, z: 0 },
    radius: 2,
    tags: ['player', 'threat'],
  };

  constructor() {
    this.birdMesh = new InstancedMesh(
      new ConeGeometry(0.35, 1.7, 4),
      new MeshStandardMaterial({ color: '#f4c26b', roughness: 0.8 }),
      BIRD_COUNT,
    );
    this.fishMesh = new InstancedMesh(new ConeGeometry(0.28, 1.2, 5), new MeshStandardMaterial({ color: '#75c7d9' }), FISH_COUNT);
    this.herdMesh = new InstancedMesh(new SphereGeometry(0.8, 8, 6), new MeshStandardMaterial({ color: '#c78f61' }), HERD_COUNT);
    this.group.add(this.birdMesh, this.fishMesh, this.herdMesh);
    this.buildWorld();
    this.buildLife();
    this.buildFish();
    this.buildHerd();
    this.setBirdStage(this.birdStage);
    this.setLifeMode(this.lifeMode);
    this.engine.scene.add(this.group);

    const destroyRef = inject(DestroyRef);
    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((deltaSeconds) => this.update(deltaSeconds));
    destroyRef.onDestroy(() => this.dispose());
  }

  private buildWorld(): void {
    const ground = new Mesh(
      new PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
      new MeshStandardMaterial({ color: '#45634c', roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.group.add(ground);

    const treeMaterial = new MeshStandardMaterial({ color: '#31513b', roughness: 1 });
    const trunkMaterial = new MeshStandardMaterial({ color: '#694b32', roughness: 1 });
    for (let index = 0; index < 14; index++) {
      const angle = index * 2.399;
      const radius = 14 + (index % 4) * 6;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const trunk = new Mesh(new CylinderGeometry(0.35, 0.5, 4, 8), trunkMaterial);
      trunk.position.set(x, 2, z);
      const canopy = new Mesh(new SphereGeometry(2.5 + (index % 3) * 0.5, 10, 8), treeMaterial);
      canopy.position.set(x, 5, z);
      this.group.add(trunk, canopy);
      this.treeMeshes.push(canopy);
      this.simulation.obstacles.push({
        id: `tree-${index}`,
        position: { x, y: 5, z },
        radius: canopy.scale.x * 2.5,
        height: 7,
        tags: ['tree', 'canopy', 'obstacle'],
      });
    }
    this.player.position.set(0, 1.4, 0);
    this.group.add(this.player);
  }

  private buildLife(): void {
    this.simulation.behaviors.push(
      separation(4, 9),
      alignment(1.4),
      cohesion(0.9),
      avoidObstacles(15),
      fleeInfluences(20),
      keepAbove(8, 4),
    );
    for (let index = 0; index < BIRD_COUNT; index++) {
      const angle = index * 2.399;
      const radius = 8 + (index % 5) * 1.5;
      this.simulation.addAgent({
        id: index,
        position: {
          x: Math.cos(angle) * radius,
          y: 12 + (index % 7) * 0.8,
          z: Math.sin(angle) * radius,
        },
        velocity: { x: Math.sin(angle) * 2.5, y: 0, z: Math.cos(angle) * 2.5 },
        maxSpeed: 8,
        maxAcceleration: 16,
        radius: 0.4,
      });
    }
  }

  private buildFish(): void {
    this.fishSimulation.behaviors.push(separation(2.5, 5), alignment(1), cohesion(0.7), keepWithinBounds({ x: -32, y: 1, z: -32 }, { x: 32, y: 6, z: 32 }, 8));
    for (let index = 0; index < FISH_COUNT; index++) {
      const angle = index * 2.399;
      this.fishSimulation.addAgent({ id: index, position: { x: Math.cos(angle) * (8 + index % 5), y: 2 + (index % 4) * 0.6, z: Math.sin(angle) * (8 + index % 5) }, velocity: { x: Math.sin(angle) * 1.5, y: 0, z: Math.cos(angle) * 1.5 }, maxSpeed: 5, maxAcceleration: 10, radius: 0.3 });
    }
  }

  private buildHerd(): void {
    const graze: LifeBehavior = ({ agent, timeSeconds }, out) => {
      const phase = agent.id * 2.399;
      const cycle = (timeSeconds + this.herdPhaseOffsets[agent.id]) % 18;

      if (cycle >= 7) {
        // Grazing: settle in place and let the herd slowly spread around the patch.
        out.x -= agent.velocity.x * 2.2;
        out.y -= agent.velocity.y * 2.2;
        out.z -= agent.velocity.z * 2.2;
        return;
      }

      const target = {
        x: Math.sin(timeSeconds * 0.11 + phase) * 18 + Math.cos(timeSeconds * 0.047 + phase * 1.7) * 7,
        y: 0.9,
        z: Math.cos(timeSeconds * 0.083 + phase * 1.3) * 18 + Math.sin(timeSeconds * 0.053 + phase * 0.6) * 7,
      };
      out.x += (target.x - agent.position.x) * 0.16;
      out.y += (target.y - agent.position.y) * 0.8;
      out.z += (target.z - agent.position.z) * 0.16;
    };

    this.herdSimulation.behaviors.push(
      separation(2.4, 18),
      alignment(0.25),
      graze,
      keepAbove(0.9, 12),
      keepWithinBounds({ x: -28, y: 0.9, z: -28 }, { x: 28, y: 1.4, z: 28 }, 8),
      avoidObstacles(18),
    );
    for (let index = 0; index < HERD_COUNT; index++) {
      const angle = index * 2.399;
      this.herdSimulation.addAgent({ id: index, position: { x: Math.cos(angle) * (10 + index % 4), y: 0.9, z: Math.sin(angle) * (10 + index % 4) }, velocity: { x: Math.sin(angle) * 0.35, y: 0, z: Math.cos(angle) * 0.35 }, maxSpeed: 1.8, maxAcceleration: 5, radius: 0.95 });
    }
  }

  protected setLifeMode(mode: LifeMode): void {
    this.lifeMode = mode;
    this.birdMesh.visible = mode === 'birds';
    this.fishMesh.visible = mode === 'fish';
    this.herdMesh.visible = mode === 'herd';
  }
  protected setFishLevel(level: number): void { this.fishLevel = level; this.fishMesh.count = level === 0 ? 1 : level === 1 ? 8 : FISH_COUNT; }
  protected setHerdLevel(level: number): void { this.herdLevel = level; this.herdMesh.count = level === 0 ? 1 : level === 1 ? 6 : HERD_COUNT; }

  protected setBirdStage(stage: BirdStage): void {
    this.birdStage = stage;
    this.birdMesh.count = stage === 0 ? 1 : stage === 1 ? 8 : stage === 2 ? 24 : BIRD_COUNT;
    this.simulation.behaviors.length = 0;
    if (stage >= 1) this.simulation.behaviors.push(separation(4, 9));
    if (stage >= 2) this.simulation.behaviors.push(alignment(1.4), cohesion(0.9));
    if (stage >= 3) {
      this.simulation.behaviors.push(
        avoidObstacles(15),
        keepAbove(8, 4),
        keepWithinBounds({ x: -34, y: 8, z: -34 }, { x: 34, y: 30, z: 34 }, 3),
      );
    }
    if (stage >= 4) this.simulation.behaviors.push(fleeInfluences(20));
  }

  protected setTimeScale(scale: TimeScale): void {
    this.timeScale = scale;
  }

  private update(deltaSeconds: number): void {
    const time = this.engine.elapsedTime$.value;
    this.player.position.set(Math.sin(time * 0.45) * 18, 1.4, Math.cos(time * 0.3) * 14);
    this.playerInfluence.position.x = this.player.position.x;
    this.playerInfluence.position.y = 7;
    this.playerInfluence.position.z = this.player.position.z;
    this.simulation.influences.length = 0;
    this.simulation.influences.push(this.playerInfluence);
    this.simulation.step(deltaSeconds * this.timeScale);
    this.fishSimulation.step(deltaSeconds * this.timeScale);
    this.herdSimulation.step(deltaSeconds * this.timeScale);

    for (let index = 0; index < this.simulation.agents.length; index++) {
      const agent = this.simulation.agents[index];
      this.birdPosition.set(agent.position.x, agent.position.y, agent.position.z);
      this.birdDirection.set(agent.velocity.x, agent.velocity.y, agent.velocity.z);
      if (this.birdDirection.lengthSq() < 1e-6) this.birdDirection.set(0, 0, 1);
      this.birdDummy.position.copy(this.birdPosition);
      this.birdDummy.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), this.birdDirection.normalize());
      this.birdDummy.updateMatrix();
      if (index < this.birdMesh.count) this.birdMesh.setMatrixAt(index, this.birdDummy.matrix);
    }
    this.birdMesh.instanceMatrix.needsUpdate = true;
    this.renderAgents(this.fishSimulation, this.fishMesh);
    this.renderAgents(this.herdSimulation, this.herdMesh);
  }

  private renderAgents(simulation: LifeSimulation, mesh: InstancedMesh): void {
    for (let index = 0; index < mesh.count; index++) {
      const agent = simulation.agents[index];
      this.birdDummy.position.set(agent.position.x, agent.position.y, agent.position.z);
      this.birdDirection.set(agent.velocity.x, agent.velocity.y, agent.velocity.z);
      if (this.birdDirection.lengthSq() < 1e-6) this.birdDirection.set(0, 0, 1);
      this.birdDummy.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), this.birdDirection.normalize());
      this.birdDummy.updateMatrix();
      mesh.setMatrixAt(index, this.birdDummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private dispose(): void {
    this.group.removeFromParent();
    this.birdMesh.geometry.dispose();
    (this.birdMesh.material as MeshStandardMaterial).dispose();
    this.fishMesh.geometry.dispose();
    (this.fishMesh.material as MeshStandardMaterial).dispose();
    this.herdMesh.geometry.dispose();
    (this.herdMesh.material as MeshStandardMaterial).dispose();
    this.player.geometry.dispose();
    (this.player.material as MeshStandardMaterial).dispose();
    for (const mesh of this.treeMeshes) {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
  }
}
