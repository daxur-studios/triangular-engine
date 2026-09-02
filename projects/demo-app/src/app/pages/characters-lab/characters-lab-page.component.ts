import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Group, Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry, Vector3 } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  applyLookAt,
  blendPoses,
  createHumanoidRig,
  HUMAN_BONE_NAMES,
  sampleLocomotion,
  SIT_POSE,
  solveTwoBoneIk,
  type LocomotionMode,
  type RigPose,
} from 'triangular-engine/characters';
import { HumanoidRigVisualization } from 'triangular-engine/characters/three';

const WALK_RADIUS = 1.6;
const TARGET_RADIUS = 2.5;
const TARGET_HEIGHT = 1.5;

@Component({
  selector: 'app-characters-lab-page',
  imports: [EngineModule],
  templateUrl: './characters-lab-page.component.html',
  styleUrl: './characters-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CharactersLabPageComponent {
  protected mode: LocomotionMode = 'idle';
  protected sitEnabled = false;
  protected lookEnabled = true;
  protected reachEnabled = false;

  private readonly engine = inject(EngineService);
  private readonly rig = createHumanoidRig();
  private readonly visualization = new HumanoidRigVisualization(this.rig);
  private readonly character = new Group();
  private readonly ground: Mesh;
  private readonly target: Mesh;

  private readonly headRestY = this.rig.boneByName.get('head')!.restPosition.y;
  private angle = 0;
  private targetSwing = 0;
  private elapsed = 0;
  private sitBlend = 0;

  constructor() {
    this.ground = new Mesh(
      new PlaneGeometry(10, 10),
      new MeshStandardMaterial({ color: '#2a3540', roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;

    this.target = new Mesh(
      new SphereGeometry(0.09, 16, 12),
      new MeshStandardMaterial({ color: '#ff6b6b', roughness: 0.4, emissive: 0x330000 }),
    );

    this.character.add(this.visualization.group);
    this.engine.scene.add(this.character, this.ground, this.target);

    const destroyRef = inject(DestroyRef);
    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((deltaSeconds) => this.update(deltaSeconds));
    destroyRef.onDestroy(() => this.dispose());
  }

  protected setMode(mode: LocomotionMode): void {
    this.mode = mode;
  }

  protected setSit(enabled: boolean): void {
    this.sitEnabled = enabled;
  }

  protected toggleLook(): void {
    this.lookEnabled = !this.lookEnabled;
  }

  protected toggleReach(): void {
    this.reachEnabled = !this.reachEnabled;
  }

  private update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    const speed = this.sitEnabled ? 0 : this.mode === 'run' ? 2.1 : this.mode === 'walk' ? 0.9 : 0;
    if (speed > 0) this.angle += (speed / WALK_RADIUS) * deltaSeconds;

    const locomotion = this.sitEnabled
      ? sampleLocomotion('idle', this.elapsed)
      : sampleLocomotion(this.mode, this.elapsed);
    this.character.position.set(
      Math.cos(this.angle) * WALK_RADIUS,
      locomotion.bounce,
      Math.sin(this.angle) * WALK_RADIUS,
    );
    this.character.rotation.y = -this.angle;

    const sitTarget = this.sitEnabled ? 1 : 0;
    this.sitBlend += (sitTarget - this.sitBlend) * Math.min(1, deltaSeconds * 8);

    let pose = locomotion.pose;
    if (this.sitBlend > 0.0005) pose = blendPoses(pose, SIT_POSE, this.sitBlend);

    if (this.lookEnabled || this.reachEnabled) {
      const localTarget = this.toLocal(this.updateTarget(deltaSeconds));
      if (this.lookEnabled) pose = this.applyLook(pose, localTarget);
      if (this.reachEnabled) pose = this.applyReach(pose, localTarget);
    }

    this.visualization.setPose(pose);
  }

  private updateTarget(deltaSeconds: number): Vector3 {
    this.targetSwing += deltaSeconds * 0.8;
    const forward = new Vector3(-Math.sin(this.angle), 0, Math.cos(this.angle));
    const right = new Vector3(Math.cos(this.angle), 0, Math.sin(this.angle));
    this.target.position
      .copy(this.character.position)
      .addScaledVector(forward, TARGET_RADIUS)
      .addScaledVector(right, Math.sin(this.targetSwing) * TARGET_RADIUS * 0.7);
    this.target.position.y = TARGET_HEIGHT;
    return this.target.position;
  }

  private applyLook(basePose: RigPose, target: Vector3): RigPose {
    const yaw = Math.atan2(target.x, target.z);
    const pitch = -Math.atan2(target.y - this.headRestY, Math.hypot(target.x, target.z));
    return applyLookAt(basePose, { yaw, pitch });
  }

  private applyReach(basePose: RigPose, target: Vector3): RigPose {
    const shoulder = this.rig.boneByName.get(HUMAN_BONE_NAMES.rightUpperArm)!.restPosition;
    const dx = target.x - shoulder.x;
    const dy = target.y - shoulder.y;
    const dz = target.z - shoulder.z;
    const distance = Math.hypot(dx, dy, dz);
    const reachDistance = 0.45;
    const reachTarget = distance > 1e-8
      ? {
          x: shoulder.x + (dx / distance) * reachDistance,
          y: shoulder.y + (dy / distance) * reachDistance,
          z: shoulder.z + (dz / distance) * reachDistance,
        }
      : { x: shoulder.x, y: shoulder.y - reachDistance, z: shoulder.z };
    return solveTwoBoneIk(
      this.rig,
      basePose,
      HUMAN_BONE_NAMES.rightUpperArm,
      HUMAN_BONE_NAMES.rightLowerArm,
      HUMAN_BONE_NAMES.rightHand,
      reachTarget,
    ).pose;
  }

  private toLocal(world: Vector3): Vector3 {
    const cosA = Math.cos(this.angle);
    const sinA = Math.sin(this.angle);
    const dx = world.x - this.character.position.x;
    const dy = world.y - this.character.position.y;
    const dz = world.z - this.character.position.z;
    return new Vector3(dx * cosA + dz * sinA, dy, -dx * sinA + dz * cosA);
  }

  private dispose(): void {
    this.character.removeFromParent();
    this.ground.removeFromParent();
    this.target.removeFromParent();
    this.visualization.dispose();
    this.ground.geometry.dispose();
    (this.ground.material as MeshStandardMaterial).dispose();
    this.target.geometry.dispose();
    (this.target.material as MeshStandardMaterial).dispose();
  }
}
