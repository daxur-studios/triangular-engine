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
  LifeSimulation,
  separation,
  type LifeInfluence,
} from 'triangular-engine/life';

const WORLD_SIZE = 80;
const BIRD_COUNT = 60;

type BirdStage = 0 | 1 | 2 | 3 | 4;

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
  private readonly engine = inject(EngineService);
  private readonly group = new Group();
  private readonly simulation = new LifeSimulation({ neighborRadius: 10 });
  private readonly birdMesh: InstancedMesh;
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
    this.group.add(this.birdMesh);
    this.buildWorld();
    this.buildLife();
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

  protected setBirdStage(stage: BirdStage): void {
    this.birdStage = stage;
    this.birdMesh.count = stage === 0 ? 1 : stage === 1 ? 8 : stage === 2 ? 24 : BIRD_COUNT;
    this.simulation.behaviors.length = 0;
    if (stage >= 1) this.simulation.behaviors.push(separation(4, 9));
    if (stage >= 2) this.simulation.behaviors.push(alignment(1.4), cohesion(0.9));
    if (stage >= 3) this.simulation.behaviors.push(avoidObstacles(15), keepAbove(8, 4));
    if (stage >= 4) this.simulation.behaviors.push(fleeInfluences(20));
  }

  private update(deltaSeconds: number): void {
    const time = this.engine.elapsedTime$.value;
    this.player.position.set(Math.sin(time * 0.45) * 18, 1.4, Math.cos(time * 0.3) * 14);
    this.playerInfluence.position.x = this.player.position.x;
    this.playerInfluence.position.y = 7;
    this.playerInfluence.position.z = this.player.position.z;
    this.simulation.influences.length = 0;
    this.simulation.influences.push(this.playerInfluence);
    this.simulation.step(deltaSeconds);

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
  }

  private dispose(): void {
    this.group.removeFromParent();
    this.birdMesh.geometry.dispose();
    (this.birdMesh.material as MeshStandardMaterial).dispose();
    this.player.geometry.dispose();
    (this.player.material as MeshStandardMaterial).dispose();
    for (const mesh of this.treeMeshes) {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
  }
}
