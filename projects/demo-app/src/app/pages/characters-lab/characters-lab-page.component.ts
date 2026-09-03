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
import { applyCharacterFacePose, buildCharacterBodyMesh } from 'triangular-engine/procedural';

const WALK_RADIUS = 1.6;
const TARGET_RADIUS = 2.5;
const TARGET_HEIGHT = 1.5;
const SIT_DROP = 0.4;

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
  protected showBones = true;

  protected emotion: EmotionName = 'happy';
  protected speechText = 'Hello there, welcome to the characters lab!';
  protected readonly emotions = EMOTION_NAMES;

  private readonly engine = inject(EngineService);
  private readonly rig = createHumanoidRig();
  private readonly visualization = new HumanoidRigVisualization(this.rig);
  private readonly character = new Group();
  private readonly bodyMesh: SkinnedMesh;
  private readonly ground: Mesh;
  private readonly target: Mesh;

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
      new SphereGeometry(0.09, 16, 12),
      new MeshStandardMaterial({ color: '#ff6b6b', roughness: 0.4, emissive: 0x330000 }),
    );

    this.bodyMesh = buildCharacterBodyMesh(this.rig, this.visualization.skeleton, {
      seed: 'characters-lab',
      fingerCount: 5,
      includeFaceMorphs: true,
    });
    this.visualization.group.add(this.bodyMesh);

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

  protected toggleBones(): void {
    this.showBones = !this.showBones;
    this.visualization.setOverlayVisible(this.showBones);
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

    if (this.dancing && this.danceMixer) {
      this.danceMixer.update(deltaSeconds);
      this.applyFace();
      return;
    }

    const speed = this.sitEnabled ? 0 : this.mode === 'run' ? 2.1 : this.mode === 'walk' ? 0.9 : 0;
    if (speed > 0) this.angle += (speed / WALK_RADIUS) * deltaSeconds;

    const locomotion = this.sitEnabled
      ? sampleLocomotion('idle', this.elapsed)
      : sampleLocomotion(this.mode, this.elapsed);
    this.character.position.set(
      Math.cos(this.angle) * WALK_RADIUS,
      locomotion.bounce - this.sitBlend * SIT_DROP,
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
    this.applyFace();
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
    window.speechSynthesis.cancel();
    this.danceMixer?.stopAllAction();
    this.character.removeFromParent();
    this.ground.removeFromParent();
    this.target.removeFromParent();
    this.visualization.dispose();
    this.bodyMesh.geometry.dispose();
    (this.bodyMesh.material as MeshStandardMaterial).dispose();
    this.ground.geometry.dispose();
    (this.ground.material as MeshStandardMaterial).dispose();
    this.target.geometry.dispose();
    (this.target.material as MeshStandardMaterial).dispose();
  }
}
