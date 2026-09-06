import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AnimationMixer,
  Bone,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
  type AnimationClip,
} from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  applyLookAt,
  blendPoses,
  createHumanoidRig,
  EMOTION_NAMES,
  HUMAN_BONE_NAMES,
  mergeBlendShapeWeights,
  preProcessText,
  sampleEmotion,
  sampleLocomotion,
  sampleVisemeTrack,
  SIT_POSE,
  solveTwoBoneIk,
  visemeToBlendShapes,
  wordsToVisemes,
  type BlendShapeWeights,
  type EmotionName,
  type LocomotionMode,
  type RigPose,
  type VisemeKeyframe,
} from 'triangular-engine/characters';
import { HumanoidRigVisualization, retargetMixamoClip } from 'triangular-engine/characters/three';
import {
  applyCharacterFacePose,
  buildCharacterBodyMesh,
  buildProceduralChair,
  buildProceduralDoor,
  CHARACTER_BODY_STYLES,
  type CharacterBodyStyle,
  type IProceduralChairResult,
  type IProceduralDoorResult,
} from 'triangular-engine/procedural';

export type TargetSourceMode = 'door-knob' | 'chair' | 'manual';

const WALK_RADIUS = 1.6;
const TARGET_SWING_RADIUS = 2.5;
const TARGET_SWING_HEIGHT = 1.5;

function lerpAngle(from: number, to: number, t: number): number {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) {
    diff -= Math.PI * 2;
  } else if (diff < -Math.PI) {
    diff += Math.PI * 2;
  }
  return from + diff * t;
}

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
  protected style: CharacterBodyStyle = 'villager';
  protected readonly styles = CHARACTER_BODY_STYLES;

  protected mode: LocomotionMode = 'idle';
  protected sitEnabled = false;
  protected lookEnabled = true;
  protected reachEnabled = true;
  protected showBones = true;

  protected targetSource: TargetSourceMode = 'door-knob';
  protected doorOpen = false;

  protected emotion: EmotionName = 'happy';
  protected speechText = 'Hello there, welcome to the characters lab!';
  protected readonly emotions = EMOTION_NAMES;

  private readonly engine = inject(EngineService);
  private readonly rig = createHumanoidRig();
  private readonly visualization = new HumanoidRigVisualization(this.rig);
  private readonly character = new Group();
  private bodyMesh!: SkinnedMesh;
  private readonly ground: Mesh;
  private readonly target: Mesh;

  protected readonly chair: IProceduralChairResult;
  protected readonly door: IProceduralDoorResult;

  private readonly headRestY = this.rig.boneByName.get('head')!.restPosition.y;
  private angle = 0;
  private targetSwing = 0;
  private elapsed = 0;
  private sitBlend = 0;

  private visemeTrack: readonly VisemeKeyframe[] = [];
  private speechStartedAt = 0;
  private speechTrackDuration = 0;
  private speaking = false;

  protected dancing = false;
  private danceMixer?: AnimationMixer;
  private danceMixerRoot?: Object3D;
  private readonly fbxLoader = new FBXLoader();

  constructor() {
    this.ground = new Mesh(
      new PlaneGeometry(10, 10),
      new MeshStandardMaterial({ color: '#2a3540', roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;

    this.target = new Mesh(
      new SphereGeometry(0.06, 16, 12),
      new MeshStandardMaterial({ color: '#ff4757', roughness: 0.3, emissive: 0x440000 }),
    );

    // Procedural chair at X = 1.5, facing -X towards room center
    this.chair = buildProceduralChair({
      style: 'dining',
      frameColorHex: '#78350f',
      cushionColorHex: '#1e3a8a',
    });
    this.chair.group.position.set(1.5, 0, 0);
    this.chair.group.rotation.y = -Math.PI / 2;

    // Procedural door at X = -1.5, facing +X towards room center
    this.door = buildProceduralDoor({
      frameWidthM: 0.96,
      frameHeightM: 2.15,
      knobStyle: 'round',
      frameColorHex: '#1e293b',
      doorColorHex: '#92400e',
      knobColorHex: '#f59e0b',
    });
    this.door.group.position.set(-1.5, 0, 0);
    this.door.group.rotation.y = Math.PI / 2;

    this.rebuildBodyMesh();

    this.character.add(this.visualization.group);
    this.engine.scene.add(
      this.character,
      this.ground,
      this.target,
      this.chair.group,
      this.door.group,
    );

    const destroyRef = inject(DestroyRef);
    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((deltaSeconds) => this.update(deltaSeconds));
    destroyRef.onDestroy(() => this.dispose());
  }

  protected setStyle(style: CharacterBodyStyle): void {
    if (this.style === style) return;
    this.style = style;
    this.rebuildBodyMesh();
  }

  private rebuildBodyMesh(): void {
    if (this.bodyMesh) {
      this.visualization.group.remove(this.bodyMesh);
      this.bodyMesh.geometry.dispose();
      if (Array.isArray(this.bodyMesh.material)) {
        this.bodyMesh.material.forEach((m) => m.dispose());
      } else {
        (this.bodyMesh.material as MeshStandardMaterial).dispose();
      }
    }

    this.bodyMesh = buildCharacterBodyMesh(this.rig, this.visualization.skeleton, {
      seed: 'characters-lab',
      fingerCount: 5,
      includeFaceMorphs: true,
      style: this.style,
    });
    this.visualization.group.add(this.bodyMesh);
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

  protected toggleBones(): void {
    this.showBones = !this.showBones;
    this.visualization.setOverlayVisible(this.showBones);
  }

  protected setTargetSource(mode: TargetSourceMode): void {
    this.targetSource = mode;
  }

  protected toggleDoor(): void {
    this.doorOpen = !this.doorOpen;
  }

  protected onDanceFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    void file.arrayBuffer().then((buffer) => this.startDance(buffer));
    input.value = '';
  }

  protected stopDance(): void {
    this.danceMixer?.stopAllAction();
    this.danceMixer = undefined;
    this.danceMixerRoot = undefined;
    this.dancing = false;
    this.visualization.setPose({});
    this.character.position.set(0, 0, 0);
    this.character.rotation.y = 0;
    this.angle = 0;
  }

  private startDance(buffer: ArrayBuffer): void {
    const group = this.fbxLoader.parse(buffer, '');
    const clip = group.animations[0] as AnimationClip | undefined;
    if (!clip) return;

    const bones: Bone[] = [];
    group.traverse((object) => {
      if ((object as Bone).isBone) bones.push(object as Bone);
    });
    if (bones.length === 0) return;

    const ordered: Bone[] = [];
    const visited = new Set<Bone>();
    const visit = (bone: Bone): void => {
      if (visited.has(bone)) return;
      visited.add(bone);
      const parent = bone.parent;
      if (parent && (parent as Bone).isBone) visit(parent as Bone);
      ordered.push(bone);
    };
    for (const bone of bones) visit(bone);

    const retargetedClip = retargetMixamoClip(this.visualization.skeleton, new Skeleton(ordered), clip);

    this.danceMixer?.stopAllAction();
    this.danceMixerRoot = new Object3D();
    (this.danceMixerRoot as Object3D & { skeleton: Skeleton }).skeleton = this.visualization.skeleton;
    (this.danceMixerRoot as Object3D & { bones: Bone[] }).bones = this.visualization.skeleton.bones;
    this.danceMixer = new AnimationMixer(this.danceMixerRoot);
    this.danceMixer.clipAction(retargetedClip).play();

    this.dancing = true;
    this.mode = 'idle';
    this.sitEnabled = false;
    this.angle = 0;
    this.character.position.set(0, 0, 0);
    this.character.rotation.y = 0;
  }

  protected setEmotion(emotion: EmotionName): void {
    this.emotion = emotion;
  }

  protected speak(): void {
    const words = preProcessText(this.speechText);
    if (words.length === 0) return;

    this.visemeTrack = wordsToVisemes(words);
    this.speechTrackDuration = this.visemeTrack.reduce((total, keyframe) => total + keyframe.duration, 0);
    this.speechStartedAt = performance.now();
    this.speaking = true;

    const utterance = new SpeechSynthesisUtterance(this.speechText);
    utterance.onend = () => {
      this.speaking = false;
    };
    utterance.onerror = () => {
      this.speaking = false;
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  private update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;

    // 1. Animate door opening angle smoothly
    const targetDoorAngle = this.doorOpen ? Math.PI / 2 : 0;
    const currentDoorAngle = this.door.getOpenAngle();
    if (Math.abs(targetDoorAngle - currentDoorAngle) > 0.001) {
      const step = (targetDoorAngle - currentDoorAngle) * Math.min(1, deltaSeconds * 5);
      this.door.setOpenAngle(currentDoorAngle + step);
    }

    if (this.dancing && this.danceMixer) {
      this.danceMixer.update(deltaSeconds);
      this.applyFace();
      return;
    }

    // Only advance walk/run circle when not seated and not transitioning to/from sit
    const isSittingOrTransitioning = this.sitEnabled || this.sitBlend > 0.005;
    const speed = isSittingOrTransitioning ? 0 : this.mode === 'run' ? 2.1 : this.mode === 'walk' ? 0.9 : 0;
    if (speed > 0) {
      this.angle = (this.angle + (speed / WALK_RADIUS) * deltaSeconds) % (Math.PI * 2);
    }

    const locomotion = isSittingOrTransitioning
      ? sampleLocomotion('idle', this.elapsed)
      : sampleLocomotion(this.mode, this.elapsed);

    // 2. Sitting transition and positioning (grounded to chair)
    const sitTarget = this.sitEnabled ? 1 : 0;
    this.sitBlend += (sitTarget - this.sitBlend) * Math.min(1, deltaSeconds * 6);

    const chairAffordance = this.chair.getSitAffordance();
    const chairYaw = Math.atan2(chairAffordance.facingDirection.x, chairAffordance.facingDirection.z);

    const normalWalkX = Math.cos(this.angle) * WALK_RADIUS;
    const normalWalkZ = Math.sin(this.angle) * WALK_RADIUS;
    const normalRotY = -this.angle;

    // When sitting, character drops hips onto chair seat (standing hips = 0.80m, drop = 0.80 - seatHeight = 0.35m)
    const seatDrop = 0.80 - chairAffordance.seatHeight;
    const seatedY = locomotion.bounce * (1 - this.sitBlend) - this.sitBlend * seatDrop;

    const charX = normalWalkX + (chairAffordance.seatPosition.x - normalWalkX) * this.sitBlend;
    const charZ = normalWalkZ + (chairAffordance.seatPosition.z - normalWalkZ) * this.sitBlend;
    const charRotY = lerpAngle(normalRotY, chairYaw, this.sitBlend);

    this.character.position.set(charX, seatedY, charZ);
    this.character.rotation.y = charRotY;

    if (this.sitBlend > 0.999) {
      // While seated on the chair, synchronize angle so standing up resumes directly in front of the chair
      this.angle = 0;
    }

    let pose = locomotion.pose;
    if (this.sitBlend > 0.0005) pose = blendPoses(pose, SIT_POSE, this.sitBlend);

    // 3. Target position and Look / Reach IK
    const worldTarget = this.resolveTarget(deltaSeconds);
    this.target.position.copy(worldTarget);

    if (this.lookEnabled || this.reachEnabled) {
      const localTarget = this.toLocal(worldTarget);
      if (this.lookEnabled) pose = this.applyLook(pose, localTarget);
      if (this.reachEnabled) pose = this.applyReach(pose, localTarget);
    }

    this.visualization.setPose(pose);
    this.applyFace();
  }

  private resolveTarget(deltaSeconds: number): Vector3 {
    switch (this.targetSource) {
      case 'door-knob': {
        const knobReach = this.door.getKnobReachAffordance();
        return new Vector3(knobReach.targetPosition.x, knobReach.targetPosition.y, knobReach.targetPosition.z);
      }
      case 'chair': {
        const chairSit = this.chair.getSitAffordance();
        return new Vector3(chairSit.seatPosition.x, chairSit.seatPosition.y + 0.1, chairSit.seatPosition.z);
      }
      case 'manual':
      default: {
        this.targetSwing += deltaSeconds * 0.8;
        const forward = new Vector3(-Math.sin(this.angle), 0, Math.cos(this.angle));
        const right = new Vector3(Math.cos(this.angle), 0, Math.sin(this.angle));
        return this.character.position
          .clone()
          .addScaledVector(forward, TARGET_SWING_RADIUS)
          .addScaledVector(right, Math.sin(this.targetSwing) * TARGET_SWING_RADIUS * 0.7)
          .setY(TARGET_SWING_HEIGHT);
      }
    }
  }

  private applyFace(): void {
    const emotion = sampleEmotion(this.emotion);

    let visemeWeights: BlendShapeWeights = {};
    if (this.speaking) {
      const elapsed = (performance.now() - this.speechStartedAt) / 1000;
      if (elapsed > this.speechTrackDuration) {
        this.speaking = false;
      } else {
        visemeWeights = visemeToBlendShapes(sampleVisemeTrack(this.visemeTrack, elapsed));
      }
    }

    const blinkPhase = this.elapsed % 3.5;
    const blink = blinkPhase < 0.12 ? 1 - Math.abs((blinkPhase - 0.06) / 0.06) : 0;

    applyCharacterFacePose(
      this.bodyMesh,
      mergeBlendShapeWeights(emotion, visemeWeights, { eyeBlinkLeft: blink, eyeBlinkRight: blink }),
    );
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
    const maxReach = 0.56; // Max two-bone arm span (upperArm 0.30 + lowerArm 0.28 - small elbow cushion)
    const reachTarget = distance > maxReach
      ? {
          x: shoulder.x + (dx / distance) * maxReach,
          y: shoulder.y + (dy / distance) * maxReach,
          z: shoulder.z + (dz / distance) * maxReach,
        }
      : { x: target.x, y: target.y, z: target.z };
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
    return this.character.worldToLocal(world.clone());
  }

  private dispose(): void {
    window.speechSynthesis.cancel();
    this.danceMixer?.stopAllAction();
    this.character.removeFromParent();
    this.ground.removeFromParent();
    this.target.removeFromParent();
    this.chair.group.removeFromParent();
    this.door.group.removeFromParent();
    this.chair.dispose();
    this.door.dispose();
    this.visualization.dispose();
    if (this.bodyMesh) {
      this.bodyMesh.geometry.dispose();
      if (Array.isArray(this.bodyMesh.material)) {
        this.bodyMesh.material.forEach((m) => m.dispose());
      } else {
        (this.bodyMesh.material as MeshStandardMaterial).dispose();
      }
    }
    this.ground.geometry.dispose();
    (this.ground.material as MeshStandardMaterial).dispose();
    this.target.geometry.dispose();
    (this.target.material as MeshStandardMaterial).dispose();
  }
}
