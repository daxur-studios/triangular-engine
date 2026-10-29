import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AnimationMixer,
  Bone,
  Box3,
  CylinderGeometry,
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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  applyLookAt,
  blendPoses,
  CAPSULE_ACCESSORY_IDS,
  CAPSULE_CAT_BODY_PATTERN_IDS,
  CAPSULE_CAT_PACK_IDS,
  CAPSULE_CAT_PRESETS,
  CAPSULE_CHARACTER_PRESETS,
  CAPSULE_CHEST_PATCH_IDS,
  CAPSULE_FACIAL_HAIR_IDS,
  CAPSULE_HAIR_STYLE_IDS,
  createHumanoidRig,
  DEFAULT_CAPSULE_BOOT_COLORS,
  DEFAULT_CAPSULE_CAT_ACCENT_COLORS,
  DEFAULT_CAPSULE_CAT_FUR_COLORS,
  DEFAULT_CAPSULE_HAIR_COLORS,
  DEFAULT_CAPSULE_SKIN_TONES,
  EMOTION_NAMES,
  EXTENDED_EMOTION_NAMES,
  FacialAnimationController,
  HUMAN_BONE_NAMES,
  preProcessText,
  sampleLocomotion,
  SIT_POSE,
  solveTwoBoneIk,
  wordsToVisemes,
  type CapsuleAccessoryId,
  type CapsuleCatBodyPatternId,
  type CapsuleCatCharacterDNA,
  type CapsuleCatGaitMode,
  type CapsuleCatMouthPose,
  type CapsuleCatPackId,
  type CapsuleCharacterDNA,
  type CapsuleChestPatchId,
  type CapsuleFacialHairId,
  type CapsuleHairStyleId,
  type CapsuleHandActionMode,
  type CapsuleLocomotionMode,
  type EmotionName,
  type ExtendedEmotionName,
  type FaceSemanticChannelName,
  type FacialFrameState,
  type LocomotionMode,
  type RigPose,
  type Viseme,
  type VisemeKeyframe,
} from 'triangular-engine/characters';
import {
  bindCharacterFace,
  HumanoidRigVisualization,
  retargetMixamoClip,
  type CharacterFaceBinding,
} from 'triangular-engine/characters/three';
import {
  applyCharacterFacePose,
  buildCharacterBodyMesh,
  buildProceduralChair,
  buildProceduralDoor,
  buildReferenceFaceMesh,
  CapsuleCatActor,
  CapsuleCharacterActor,
  CHARACTER_BODY_STYLES,
  type CharacterBodyStyle,
  type IProceduralChairResult,
  type IProceduralDoorResult,
  type IReferenceFaceResult,
} from 'triangular-engine/procedural';

export type TargetSourceMode = 'door-knob' | 'chair' | 'manual';
export type CharactersLabViewMode = 'capsule-doodle' | 'capsule-cats' | 'face-studio' | 'full-body';
export type CameraFramingPreset = 'front' | 'three-quarter' | 'profile' | 'full-shot';
export type CapsuleLayoutMode = 'hero' | 'lineup';

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
  imports: [EngineModule, DecimalPipe],
  templateUrl: './characters-lab-page.component.html',
  styleUrl: './characters-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CharactersLabPageComponent {
  // View mode
  protected viewMode: CharactersLabViewMode = 'capsule-doodle';
  protected cameraFraming: CameraFramingPreset = 'full-shot';
  protected readonly cameraPosition = signal<[number, number, number]>([0.75, 1.38, 2.45]);
  protected readonly cameraTarget = signal<[number, number, number]>([0, 0.92, 0]);

  // Capsule Doodle Studio state
  protected capsuleLayoutMode: CapsuleLayoutMode = 'hero';
  protected readonly capsulePresets = CAPSULE_CHARACTER_PRESETS;
  protected readonly capsuleHairStyles = CAPSULE_HAIR_STYLE_IDS;
  protected readonly capsuleFacialHairStyles = CAPSULE_FACIAL_HAIR_IDS;
  protected readonly capsuleAccessories = CAPSULE_ACCESSORY_IDS;
  protected readonly capsuleChestPatches = CAPSULE_CHEST_PATCH_IDS;
  protected readonly capsuleSkinTones = DEFAULT_CAPSULE_SKIN_TONES;
  protected readonly capsuleHairColors = DEFAULT_CAPSULE_HAIR_COLORS;
  protected readonly capsuleBootColors = DEFAULT_CAPSULE_BOOT_COLORS;

  protected selectedPresetId = CAPSULE_CHARACTER_PRESETS[5].id!; // Wacky Hair Cosmonaut
  protected capsuleLocomotion: CapsuleLocomotionMode = 'idle';
  protected capsuleRightHandAction: CapsuleHandActionMode = 'wave';
  protected capsuleLeftHandAction: CapsuleHandActionMode = 'none';
  protected capsuleWavyMouth = false;
  protected seedCounter = 1;

  private readonly capsuleStudioGroup = new Group();
  private readonly capsuleHeroGroup = new Group();
  private readonly capsuleLineupGroup = new Group();
  protected readonly capsuleHeroActor: CapsuleCharacterActor;
  private readonly capsuleLineupActors: CapsuleCharacterActor[] = [];

  // Capsule Space Cats Studio state
  protected capsuleCatLayoutMode: CapsuleLayoutMode = 'hero';
  protected readonly capsuleCatPresets = CAPSULE_CAT_PRESETS;
  protected readonly capsuleCatPatterns = CAPSULE_CAT_BODY_PATTERN_IDS;
  protected readonly capsuleCatPacks = CAPSULE_CAT_PACK_IDS;
  protected readonly capsuleCatFurColors = DEFAULT_CAPSULE_CAT_FUR_COLORS;
  protected readonly capsuleCatAccentColors = DEFAULT_CAPSULE_CAT_ACCENT_COLORS;
  protected selectedCatPresetId = CAPSULE_CAT_PRESETS[0].id!;
  protected capsuleCatLocomotion: CapsuleCatGaitMode = 'goofy_walk';
  protected catSeedCounter = 1;

  private readonly capsuleCatStudioGroup = new Group();
  private readonly capsuleCatHeroGroup = new Group();
  private readonly capsuleCatLineupGroup = new Group();
  protected readonly capsuleCatHeroActor: CapsuleCatActor;
  private readonly capsuleCatLineupActors: CapsuleCatActor[] = [];

  // Face Studio model selection & binding
  protected faceModelSource: 'reference-model' | 'procedural' = 'reference-model';
  protected referenceModelLoading = true;
  protected referenceModelError?: string;
  protected recognizedMorphCount = 0;
  private readonly referenceModelGroup = new Group();
  private referenceModelBinding?: CharacterFaceBinding;
  private readonly cdr = inject(ChangeDetectorRef);

  // Face Studio state
  protected readonly facialController = new FacialAnimationController({
    autoBlink: true,
    defaultTransitionSeconds: 0.2,
  });
  private referenceFace: IReferenceFaceResult;
  private gazeMarker: Mesh;
  protected wanderGaze = false;
  protected gazeTargetPos = new Vector3(0, 1.58, 0.65);

  protected readonly extendedEmotions = EXTENDED_EMOTION_NAMES;
  protected activeEmotion: ExtendedEmotionName = 'happy';
  protected currentFrameState?: FacialFrameState;

  // Manual channel slider models
  protected channelValues: Record<string, number> = {
    'brow.right.raise': 0,
    'brow.left.raise': 0,
    'brow.lower': 0,
    'eye.blink.left': 0,
    'eye.blink.right': 0,
    'eye.squint': 0,
    'eye.wide': 0,
    'mouth.smile': 0.75,
    'mouth.frown': 0,
    'mouth.jawOpen': 0,
    'mouth.lipClose': 0,
    'mouth.round': 0,
    'mouth.widen': 0,
  };

  // Full-body character state
  protected style: CharacterBodyStyle = 'villager';
  protected readonly styles = CHARACTER_BODY_STYLES;
  protected mode: LocomotionMode = 'idle';
  protected sitEnabled = false;
  protected lookEnabled = true;
  protected reachEnabled = true;
  protected showBones = false;
  protected targetSource: TargetSourceMode = 'door-knob';
  protected doorOpen = false;

  protected emotion: EmotionName = 'happy';
  protected speechText = 'Hello there, welcome to the Capsule Doodle space program!';
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
      new PlaneGeometry(16, 12),
      new MeshStandardMaterial({ color: '#1b2631', roughness: 0.92 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;

    this.target = new Mesh(
      new SphereGeometry(0.06, 16, 12),
      new MeshStandardMaterial({ color: '#ff4757', roughness: 0.3, emissive: 0x440000 }),
    );

    // 1. Capsule Doodle Hero Actor & Concept Sheet Lineup
    this.facialController.setExpression('happy', 1.0, 0);
    this.capsuleHeroActor = new CapsuleCharacterActor({
      dna: CAPSULE_CHARACTER_PRESETS[5],
      facialController: this.facialController,
    });
    this.capsuleHeroActor.setHandAction('right', this.capsuleRightHandAction);

    const heroPedestal = this.createPedestalMesh(0.65);
    this.capsuleHeroGroup.add(this.capsuleHeroActor.root, heroPedestal);
    this.buildCapsuleLineup();
    this.capsuleStudioGroup.add(this.capsuleHeroGroup, this.capsuleLineupGroup);

    // Capsule Space Cats Hero & 7-Cat Concept Sheet Lineup
    this.capsuleCatHeroActor = new CapsuleCatActor({
      dna: CAPSULE_CAT_PRESETS[0],
      facialController: this.facialController,
    });
    this.capsuleCatHeroActor.setLocomotion('goofy_walk');
    this.capsuleCatHeroActor.root.rotation.y = -0.28;
    this.capsuleCatHeroGroup.add(
      this.capsuleCatHeroActor.root,
      this.createPedestalMesh(0.55),
    );
    this.buildCapsuleCatLineup();
    this.capsuleCatStudioGroup.add(this.capsuleCatHeroGroup, this.capsuleCatLineupGroup);

    // 2. Procedural chair at X = 1.5, facing -X towards room center
    this.chair = buildProceduralChair({
      style: 'dining',
      frameColorHex: '#78350f',
      cushionColorHex: '#1e3a8a',
    });
    this.chair.group.position.set(1.5, 0, 0);
    this.chair.group.rotation.y = -Math.PI / 2;

    // 3. Procedural door at X = -1.5, facing +X towards room center
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

    // 4. Reference Face for Face Studio
    this.referenceFace = buildReferenceFaceMesh({
      headRadius: 0.17,
      skinColorHex: '#f0c8a0',
      browColorHex: '#261710',
      eyeColorHex: '#1e3a5f',
      lipColorHex: '#c25a66',
    });
    this.referenceFace.root.position.set(0, 1.58, 0);

    // Gaze target visual reticle
    this.gazeMarker = new Mesh(
      new SphereGeometry(0.016, 12, 8),
      new MeshStandardMaterial({ color: '#38bdf8', emissive: 0x0284c7, roughness: 0.2 }),
    );
    this.gazeMarker.position.copy(this.gazeTargetPos);

    this.rebuildBodyMesh();

    this.character.add(this.visualization.group);
    this.engine.scene.add(
      this.capsuleStudioGroup,
      this.capsuleCatStudioGroup,
      this.character,
      this.referenceFace.root,
      this.referenceModelGroup,
      this.gazeMarker,
      this.ground,
      this.target,
      this.chair.group,
      this.door.group,
    );

    this.applyViewMode(this.viewMode);
    this.loadReferenceModel();

    const destroyRef = inject(DestroyRef);
    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((deltaSeconds) => this.update(deltaSeconds));
    destroyRef.onDestroy(() => this.dispose());
  }

  private createPedestalMesh(radius = 0.58): Mesh {
    const mat = new MeshStandardMaterial({ color: '#243442', roughness: 0.78, metalness: 0.15 });
    const mesh = new Mesh(new CylinderGeometry(radius, radius * 1.06, 0.06, 32), mat);
    mesh.position.y = -0.03;
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildCapsuleLineup(): void {
    const cols = 5;
    const spacingX = 1.55;
    const spacingZ = 1.75;

    const lineupConfigs: ReadonlyArray<{
      loco: CapsuleLocomotionMode;
      emotion: ExtendedEmotionName;
      rightHand: CapsuleHandActionMode;
      wavy?: boolean;
    }> = [
      { loco: 'idle', emotion: 'happy', rightHand: 'none' },
      { loco: 'idle', emotion: 'happy', rightHand: 'none' },
      { loco: 'idle', emotion: 'happy', rightHand: 'none' },
      { loco: 'idle', emotion: 'fearful', rightHand: 'none' },
      { loco: 'idle', emotion: 'skeptical', rightHand: 'wave' },
      { loco: 'idle', emotion: 'surprised', rightHand: 'wave' },
      { loco: 'idle', emotion: 'fearful', rightHand: 'point' },
      { loco: 'run', emotion: 'fearful', rightHand: 'none' },
      { loco: 'walk', emotion: 'happy', rightHand: 'none' },
      { loco: 'float', emotion: 'neutral', rightHand: 'none', wavy: true },
    ];

    CAPSULE_CHARACTER_PRESETS.forEach((preset, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = (col - (cols - 1) * 0.5) * spacingX;
      const z = (row === 0 ? -0.55 : 0.65) * spacingZ;

      const cfg = lineupConfigs[idx] ?? { loco: 'idle', emotion: 'happy', rightHand: 'none' };
      const actor = new CapsuleCharacterActor({ dna: preset, autoBlink: true });
      actor.facialController.setExpression(cfg.emotion, 1.0, 0);
      actor.setLocomotion(cfg.loco);
      actor.setHandAction('right', cfg.rightHand);
      if (cfg.wavy) {
        actor.setWavyMouthOverride(0.8);
      }

      const slot = new Group();
      slot.position.set(x, 0, z);
      slot.add(actor.root, this.createPedestalMesh(0.52));
      this.capsuleLineupGroup.add(slot);
      this.capsuleLineupActors.push(actor);
    });
  }

  private buildCapsuleCatLineup(): void {
    const spacingX = 1.55;
    const emotions: readonly ExtendedEmotionName[] = [
      'happy',
      'happy',
      'happy',
      'happy',
      'happy',
      'fearful',
      'neutral',
    ];

    CAPSULE_CAT_PRESETS.forEach((preset, idx) => {
      // 4 in the back row (idx 0..3), 3 centered in the front row (idx 4..6)
      const isBackRow = idx < 4;
      const col = isBackRow ? idx : idx - 4;
      const x = isBackRow
        ? (col - 1.5) * spacingX
        : (col - 1.0) * spacingX;
      const z = isBackRow ? -0.65 : 0.65;

      const actor = new CapsuleCatActor({ dna: preset, autoBlink: true });
      actor.root.rotation.y = -0.38;
      actor.facialController.setExpression(emotions[idx] ?? 'happy', 1, 0);
      actor.setLocomotion(preset.gait, 0.9 + idx * 0.02);
      actor.update(idx * 0.19);

      const slot = new Group();
      slot.position.set(x, 0, z);
      slot.add(actor.root, this.createPedestalMesh(0.52));
      this.capsuleCatLineupGroup.add(slot);
      this.capsuleCatLineupActors.push(actor);
    });
  }

  // ===========================================================================
  // CAPSULE DOODLE STUDIO CONTROLS
  // ===========================================================================

  protected setCapsuleLayoutMode(mode: CapsuleLayoutMode): void {
    this.capsuleLayoutMode = mode;
    this.applyCapsuleLayoutVisibility();
    if (mode === 'lineup') {
      this.cameraPosition.set([0, 2.55, 5.4]);
      this.cameraTarget.set([0, 0.95, 0.1]);
    } else {
      this.setCameraFraming(this.cameraFraming);
    }
  }

  private applyCapsuleLayoutVisibility(): void {
    const isCapsule = this.viewMode === 'capsule-doodle';
    this.capsuleStudioGroup.visible = isCapsule;
    this.capsuleHeroGroup.visible = isCapsule && this.capsuleLayoutMode === 'hero';
    this.capsuleLineupGroup.visible = isCapsule && this.capsuleLayoutMode === 'lineup';

    const isCats = this.viewMode === 'capsule-cats';
    this.capsuleCatStudioGroup.visible = isCats;
    this.capsuleCatHeroGroup.visible = isCats && this.capsuleCatLayoutMode === 'hero';
    this.capsuleCatLineupGroup.visible = isCats && this.capsuleCatLayoutMode === 'lineup';
  }

  protected selectCapsulePreset(presetId: string): void {
    const found = CAPSULE_CHARACTER_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    this.selectedPresetId = presetId;
    this.capsuleHeroActor.setDna(found);
  }

  protected randomizeCapsuleDna(): void {
    this.seedCounter += 1;
    this.selectedPresetId = 'custom';
    this.capsuleHeroActor.setSeed(`cosmonaut-${this.seedCounter}`);
  }

  protected updateCapsuleDna(partial: Partial<CapsuleCharacterDNA>): void {
    this.selectedPresetId = 'custom';
    this.capsuleHeroActor.setDna(partial);
  }

  protected setCapsuleHairStyle(hairStyleId: CapsuleHairStyleId): void {
    this.updateCapsuleDna({ hairStyleId });
  }

  protected setCapsuleFacialHair(facialHairId: CapsuleFacialHairId): void {
    this.updateCapsuleDna({ facialHairId });
  }

  protected setCapsuleAccessory(accessory: CapsuleAccessoryId): void {
    this.updateCapsuleDna({ accessory });
  }

  protected setCapsuleChestPatch(chestPatch: CapsuleChestPatchId): void {
    this.updateCapsuleDna({ chestPatch });
  }

  protected setCapsuleLocomotion(mode: CapsuleLocomotionMode): void {
    this.capsuleLocomotion = mode;
    this.capsuleHeroActor.setLocomotion(mode);
  }

  protected setCapsuleRightHand(mode: CapsuleHandActionMode): void {
    this.capsuleRightHandAction = mode;
    this.capsuleHeroActor.setHandAction('right', mode);
  }

  protected setCapsuleLeftHand(mode: CapsuleHandActionMode): void {
    this.capsuleLeftHandAction = mode;
    this.capsuleHeroActor.setHandAction('left', mode);
  }

  protected toggleCapsuleWavyMouth(): void {
    this.capsuleWavyMouth = !this.capsuleWavyMouth;
    this.capsuleHeroActor.setWavyMouthOverride(this.capsuleWavyMouth ? 0.85 : undefined);
  }

  // ===========================================================================
  // CAPSULE SPACE CATS STUDIO CONTROLS
  // ===========================================================================

  protected setCapsuleCatLayoutMode(mode: CapsuleLayoutMode): void {
    this.capsuleCatLayoutMode = mode;
    this.applyCapsuleLayoutVisibility();
    if (mode === 'lineup') {
      this.cameraPosition.set([0, 2.35, 4.6]);
      this.cameraTarget.set([0, 0.48, 0.0]);
    } else {
      this.setCameraFraming(this.cameraFraming);
    }
  }

  protected selectCapsuleCatPreset(presetId: string): void {
    const found = CAPSULE_CAT_PRESETS.find((preset) => preset.id === presetId);
    if (!found) return;
    this.selectedCatPresetId = presetId;
    this.capsuleCatHeroActor.setDna(found);
    this.capsuleCatLocomotion = this.capsuleCatHeroActor.locomotion;
  }

  protected randomizeCapsuleCatDna(): void {
    this.catSeedCounter += 1;
    this.selectedCatPresetId = 'custom';
    this.capsuleCatHeroActor.setSeed(`space-cat-${this.catSeedCounter}`);
    this.capsuleCatLocomotion = this.capsuleCatHeroActor.locomotion;
  }

  protected updateCapsuleCatDna(partial: Partial<CapsuleCatCharacterDNA>): void {
    this.selectedCatPresetId = 'custom';
    this.capsuleCatHeroActor.setDna(partial);
    this.capsuleCatLocomotion = this.capsuleCatHeroActor.locomotion;
  }

  protected setCapsuleCatLocomotion(mode: CapsuleCatGaitMode): void {
    this.capsuleCatLocomotion = mode;
    this.capsuleCatHeroActor.setLocomotion(mode);
  }

  protected setCapsuleCatPattern(pattern: CapsuleCatBodyPatternId): void {
    this.updateCapsuleCatDna({ bodyPattern: pattern });
  }

  protected setCapsuleCatPack(pack: CapsuleCatPackId): void {
    this.updateCapsuleCatDna({ pack });
  }

  protected setCapsuleCatMouthPose(restMouthPose: CapsuleCatMouthPose): void {
    this.updateCapsuleCatDna({ restMouthPose });
  }

  protected setCapsuleCatFurColor(furColor: string): void {
    this.updateCapsuleCatDna({ furColor });
  }

  protected setCapsuleCatAccentColor(furAccentColor: string): void {
    this.updateCapsuleCatDna({ furAccentColor });
  }

  protected toggleCapsuleCatHelmet(): void {
    this.updateCapsuleCatDna({ helmet: !this.capsuleCatHeroActor.dna.helmet });
  }

  protected toggleCapsuleCatHarness(): void {
    this.updateCapsuleCatDna({ harness: !this.capsuleCatHeroActor.dna.harness });
  }

  protected toggleCapsuleCatBooties(): void {
    this.updateCapsuleCatDna({ suitBooties: !this.capsuleCatHeroActor.dna.suitBooties });
  }

  protected toggleCapsuleCatTuft(): void {
    this.updateCapsuleCatDna({ tuft: !this.capsuleCatHeroActor.dna.tuft });
  }

  protected toggleCapsuleCatPanic(): void {
    this.updateCapsuleCatDna({ panicked: !this.capsuleCatHeroActor.dna.panicked });
  }

  // ===========================================================================
  // VIEW MODE & CAMERA FRAMING CONTROLS
  // ===========================================================================

  protected setViewMode(mode: CharactersLabViewMode): void {
    this.viewMode = mode;
    this.applyViewMode(mode);
  }

  protected setFaceModelSource(source: 'reference-model' | 'procedural'): void {
    this.faceModelSource = source;
    this.applyFaceModelVisibility();
  }

  private applyFaceModelVisibility(): void {
    const isStudio = this.viewMode === 'face-studio';
    const isRef = isStudio && this.faceModelSource === 'reference-model';
    const isProc = isStudio && this.faceModelSource === 'procedural';

    this.referenceModelGroup.visible = isRef;
    this.referenceFace.root.visible = isProc;
    this.gazeMarker.visible = isStudio || (this.viewMode === 'capsule-doodle' && this.wanderGaze);
  }

  private loadReferenceModel(): void {
    this.referenceModelLoading = true;
    this.referenceModelError = undefined;

    try {
      const ktx2Loader = new KTX2Loader()
        .setTranscoderPath('/basis/')
        .detectSupport(this.engine.renderer);

      const gltfLoader = new GLTFLoader()
        .setKTX2Loader(ktx2Loader)
        .setMeshoptDecoder(MeshoptDecoder);

      gltfLoader.load(
        '/characters/facecap.glb',
        (gltf) => {
          const model = gltf.scene;
          this.referenceModelGroup.add(model);

          model.position.set(0, 0, 0);
          model.scale.set(1, 1, 1);
          model.rotation.set(0, 0, 0);
          this.engine.scene.updateMatrixWorld(true);

          const naturalBox = new Box3().setFromObject(model);
          const naturalSize = new Vector3();
          naturalBox.getSize(naturalSize);
          const naturalCenter = new Vector3();
          naturalBox.getCenter(naturalCenter);

          const targetHeight = 0.36;
          const scale = naturalSize.y > 0 ? targetHeight / naturalSize.y : 0.108;
          model.scale.setScalar(scale);

          model.position.x = -naturalCenter.x * scale;
          model.position.y = 1.58 - naturalCenter.y * scale;
          model.position.z = -naturalCenter.z * scale;

          this.engine.scene.updateMatrixWorld(true);

          this.referenceModelBinding = bindCharacterFace(model, {
            driveEyeMorphsFromGaze: true,
          });
          this.recognizedMorphCount = this.referenceModelBinding.recognizedMorphCount;
          this.referenceModelLoading = false;
          this.applyFaceModelVisibility();
          this.cdr.markForCheck();
        },
        undefined,
        (err) => {
          console.error('Failed to load facecap.glb:', err);
          this.referenceModelError = 'Failed to load reference model';
          this.referenceModelLoading = false;
          this.faceModelSource = 'procedural';
          this.applyFaceModelVisibility();
          this.cdr.markForCheck();
        },
      );
    } catch (err) {
      console.error('Error creating GLTF/KTX2 loaders:', err);
      this.referenceModelError = String(err);
      this.referenceModelLoading = false;
      this.faceModelSource = 'procedural';
      this.applyFaceModelVisibility();
      this.cdr.markForCheck();
    }
  }

  private applyViewMode(mode: CharactersLabViewMode): void {
    const isFaceStudio = mode === 'face-studio';
    const isFullBody = mode === 'full-body';
    const isCapsule = mode === 'capsule-doodle';
    const isCats = mode === 'capsule-cats';

    this.applyFaceModelVisibility();
    this.applyCapsuleLayoutVisibility();

    this.character.visible = isFullBody;
    this.ground.visible = isFullBody || isCapsule || isCats;
    this.target.visible = isFullBody;
    this.chair.group.visible = isFullBody;
    this.door.group.visible = isFullBody;

    if (isCapsule) {
      if (this.capsuleLayoutMode === 'lineup') {
        this.cameraPosition.set([0, 2.55, 5.4]);
        this.cameraTarget.set([0, 0.95, 0.1]);
      } else {
        this.setCameraFraming(this.cameraFraming);
      }
    } else if (isCats) {
      if (this.capsuleCatLayoutMode === 'lineup') {
        this.cameraPosition.set([0, 2.35, 4.6]);
        this.cameraTarget.set([0, 0.48, 0.0]);
      } else {
        this.setCameraFraming(this.cameraFraming);
      }
    } else if (isFaceStudio) {
      if (this.cameraFraming === 'full-shot') {
        this.cameraFraming = 'three-quarter';
      }
      this.setCameraFraming(this.cameraFraming);
    } else {
      this.cameraPosition.set([3.4, 2.4, 4.2]);
      this.cameraTarget.set([0, 0.9, 0]);
    }
  }

  protected setCameraFraming(framing: CameraFramingPreset): void {
    this.cameraFraming = framing;
    if (this.viewMode === 'capsule-cats') {
      if (this.capsuleCatLayoutMode === 'lineup') {
        this.cameraPosition.set([0, 2.35, 4.6]);
        this.cameraTarget.set([0, 0.48, 0.0]);
      } else if (framing === 'full-shot') {
        this.cameraPosition.set([1.15, 0.72, 1.45]);
        this.cameraTarget.set([0, 0.40, 0.05]);
      } else if (framing === 'front') {
        this.cameraPosition.set([0, 0.54, 1.05]);
        this.cameraTarget.set([0, 0.48, 0.32]);
      } else if (framing === 'three-quarter') {
        this.cameraPosition.set([0.65, 0.58, 0.95]);
        this.cameraTarget.set([0, 0.46, 0.18]);
      } else {
        this.cameraPosition.set([1.35, 0.48, 0.0]);
        this.cameraTarget.set([0, 0.44, 0.0]);
      }
      return;
    }
    if (this.viewMode === 'capsule-doodle') {
      if (framing === 'full-shot') {
        this.cameraPosition.set([0.75, 1.38, 2.45]);
        this.cameraTarget.set([0, 0.92, 0]);
      } else if (framing === 'front') {
        this.cameraPosition.set([0, 1.42, 1.38]);
        this.cameraTarget.set([0, 1.36, 0]);
      } else if (framing === 'three-quarter') {
        this.cameraPosition.set([0.62, 1.48, 1.32]);
        this.cameraTarget.set([0, 1.36, 0]);
      } else {
        this.cameraPosition.set([1.45, 1.36, 0.15]);
        this.cameraTarget.set([0, 1.30, 0]);
      }
      return;
    }

    if (framing === 'front') {
      this.cameraPosition.set([0, 1.58, 0.46]);
    } else if (framing === 'three-quarter') {
      this.cameraPosition.set([0.26, 1.62, 0.38]);
    } else {
      this.cameraPosition.set([0.46, 1.58, 0.0]);
    }
    this.cameraTarget.set([0, 1.58, 0]);
  }

  // ===========================================================================
  // FACE STUDIO: EXPRESSION PRESETS & CHANNELS
  // ===========================================================================

  protected setFaceExpression(emotion: ExtendedEmotionName): void {
    this.activeEmotion = emotion;
    this.facialController.setExpression(emotion, 1.0, 0.25);
    this.syncSlidersFromExpression(emotion);
  }

  protected onChannelChange(channel: FaceSemanticChannelName, rawValue: string | number): void {
    const val = typeof rawValue === 'string' ? parseFloat(rawValue) : rawValue;
    this.channelValues[channel] = val;
    this.facialController.setFaceChannel(channel, val, 0.08);
  }

  protected triggerBlink(): void {
    this.facialController.blink('both', 0.18);
  }

  protected triggerLeftBlink(): void {
    this.facialController.blink('left', 0.22);
  }

  protected triggerRightBlink(): void {
    this.facialController.blink('right', 0.22);
  }

  private syncSlidersFromExpression(emotion: ExtendedEmotionName): void {
    if (emotion === 'neutral') {
      for (const k of Object.keys(this.channelValues)) {
        this.channelValues[k] = 0;
      }
    } else if (emotion === 'happy') {
      this.channelValues['mouth.smile'] = 0.75;
      this.channelValues['eye.squint'] = 0.25;
      this.channelValues['brow.right.raise'] = 0.15;
      this.channelValues['brow.left.raise'] = 0.15;
      this.channelValues['mouth.frown'] = 0;
    } else if (emotion === 'sad') {
      this.channelValues['mouth.frown'] = 0.65;
      this.channelValues['brow.lower'] = 0.25;
      this.channelValues['mouth.smile'] = 0;
    } else if (emotion === 'surprised') {
      this.channelValues['brow.right.raise'] = 0.85;
      this.channelValues['brow.left.raise'] = 0.85;
      this.channelValues['eye.wide'] = 0.85;
      this.channelValues['mouth.jawOpen'] = 0.65;
      this.channelValues['mouth.round'] = 0.35;
    } else if (emotion === 'angry') {
      this.channelValues['brow.lower'] = 0.8;
      this.channelValues['eye.squint'] = 0.5;
      this.channelValues['mouth.frown'] = 0.35;
      this.channelValues['mouth.widen'] = 0.3;
    } else if (emotion === 'skeptical') {
      this.channelValues['brow.right.raise'] = 0.9;
      this.channelValues['brow.left.raise'] = 0;
      this.channelValues['brow.lower'] = 0.25;
      this.channelValues['mouth.smile'] = 0.3;
    }
  }

  // ===========================================================================
  // FACE STUDIO: GAZE CONTROL
  // ===========================================================================

  protected setGazePreset(preset: 'center' | 'left' | 'right' | 'up' | 'down'): void {
    this.wanderGaze = false;
    this.applyFaceModelVisibility();
    switch (preset) {
      case 'center':
        this.gazeTargetPos.set(0, 1.58, 0.65);
        break;
      case 'left':
        this.gazeTargetPos.set(-0.25, 1.58, 0.55);
        break;
      case 'right':
        this.gazeTargetPos.set(0.25, 1.58, 0.55);
        break;
      case 'up':
        this.gazeTargetPos.set(0, 1.76, 0.55);
        break;
      case 'down':
        this.gazeTargetPos.set(0, 1.40, 0.55);
        break;
    }
    this.gazeMarker.position.copy(this.gazeTargetPos);
    this.facialController.lookAt(
      {
        x: this.gazeTargetPos.x,
        y: this.gazeTargetPos.y - 1.58,
        z: this.gazeTargetPos.z,
      },
      0.15,
    );
  }

  protected toggleWanderGaze(): void {
    this.wanderGaze = !this.wanderGaze;
    this.applyFaceModelVisibility();
  }

  // ===========================================================================
  // FACE STUDIO: SPEECH & VISEMES
  // ===========================================================================

  protected playArticulationSequence(): void {
    this.facialController.playVisemes(FacialAnimationController.createArticulationFixture());
  }

  protected setManualViseme(viseme: Viseme): void {
    if (viseme === 'sil') {
      this.facialController.stopSpeech();
    } else {
      this.facialController.playVisemes([{ time: 0, viseme, duration: 1.2 }]);
    }
  }

  protected playCombinedPerformance(): void {
    this.setFaceExpression('happy');
    const words = preProcessText('Hello there, smiling while speaking with clear visemes and natural gaze!');
    this.facialController.playVisemes(wordsToVisemes(words));
    this.wanderGaze = true;
    this.applyFaceModelVisibility();
    this.facialController.blink('both', 0.18);
  }

  protected resetFaceToNeutral(): void {
    this.wanderGaze = false;
    this.capsuleWavyMouth = false;
    this.capsuleHeroActor.setWavyMouthOverride(undefined);
    this.applyFaceModelVisibility();
    this.gazeTargetPos.set(0, 1.58, 0.65);
    this.gazeMarker.position.copy(this.gazeTargetPos);
    this.facialController.resetToNeutral(0.25);
    this.referenceModelBinding?.reset();
    this.referenceFace.applyPose({});
    this.activeEmotion = 'neutral';
    for (const k of Object.keys(this.channelValues)) {
      this.channelValues[k] = 0;
    }
  }

  // ===========================================================================
  // FULL-BODY SCENE CONTROLS
  // ===========================================================================

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

    this.facialController.playVisemes(this.visemeTrack);

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

  // ===========================================================================
  // FRAME UPDATE LOOP
  // ===========================================================================

  private update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;

    // 1. Update Facial Controller
    if (this.wanderGaze) {
      this.gazeTargetPos.x = Math.sin(this.elapsed * 1.6) * 0.22;
      this.gazeTargetPos.y = 1.58 + Math.cos(this.elapsed * 2.2) * 0.12;
      this.gazeMarker.position.copy(this.gazeTargetPos);
      this.facialController.lookAt(
        {
          x: this.gazeTargetPos.x,
          y: this.gazeTargetPos.y - 1.58,
          z: this.gazeTargetPos.z,
        },
        0.1,
      );
    }

    const frame = this.facialController.update(deltaSeconds);
    this.currentFrameState = frame;

    // 2. Capsule Doodle Studio Update
    if (this.viewMode === 'capsule-doodle') {
      if (this.capsuleLayoutMode === 'hero') {
        this.capsuleHeroActor.update(deltaSeconds, frame);
      } else {
        for (const actor of this.capsuleLineupActors) {
          actor.update(deltaSeconds);
        }
      }
      return;
    }

    // 2b. Capsule Space Cats Studio Update
    if (this.viewMode === 'capsule-cats') {
      if (this.capsuleCatLayoutMode === 'hero') {
        this.capsuleCatHeroActor.update(deltaSeconds, frame);
      } else {
        for (const actor of this.capsuleCatLineupActors) {
          actor.update(deltaSeconds);
        }
      }
      return;
    }

    // 3. Apply to active Face model in Face Studio
    if (this.viewMode === 'face-studio') {
      if (this.faceModelSource === 'reference-model' && this.referenceModelBinding) {
        this.referenceModelBinding.applyPose(
          frame.blendShapes,
          frame.gaze,
        );
      } else {
        this.referenceFace.applyPose(frame.blendShapes, frame.gaze);
      }
      return;
    }

    // 4. Full-body scene update
    if (this.viewMode === 'full-body') {
      const targetDoorAngle = this.doorOpen ? Math.PI / 2 : 0;
      const currentDoorAngle = this.door.getOpenAngle();
      if (Math.abs(targetDoorAngle - currentDoorAngle) > 0.001) {
        const step = (targetDoorAngle - currentDoorAngle) * Math.min(1, deltaSeconds * 5);
        this.door.setOpenAngle(currentDoorAngle + step);
      }

      if (this.dancing && this.danceMixer) {
        this.danceMixer.update(deltaSeconds);
        applyCharacterFacePose(this.bodyMesh, frame.blendShapes);
        return;
      }

      const isSittingOrTransitioning = this.sitEnabled || this.sitBlend > 0.005;
      const speed = isSittingOrTransitioning ? 0 : this.mode === 'run' ? 2.1 : this.mode === 'walk' ? 0.9 : 0;
      if (speed > 0) {
        this.angle = (this.angle + (speed / WALK_RADIUS) * deltaSeconds) % (Math.PI * 2);
      }

      const locomotion = isSittingOrTransitioning
        ? sampleLocomotion('idle', this.elapsed)
        : sampleLocomotion(this.mode, this.elapsed);

      const sitTarget = this.sitEnabled ? 1 : 0;
      this.sitBlend += (sitTarget - this.sitBlend) * Math.min(1, deltaSeconds * 6);

      const chairAffordance = this.chair.getSitAffordance();
      const chairYaw = Math.atan2(chairAffordance.facingDirection.x, chairAffordance.facingDirection.z);

      const normalWalkX = Math.cos(this.angle) * WALK_RADIUS;
      const normalWalkZ = Math.sin(this.angle) * WALK_RADIUS;
      const normalRotY = -this.angle;

      const seatDrop = 0.80 - chairAffordance.seatHeight;
      const seatedY = locomotion.bounce * (1 - this.sitBlend) - this.sitBlend * seatDrop;

      const charX = normalWalkX + (chairAffordance.seatPosition.x - normalWalkX) * this.sitBlend;
      const charZ = normalWalkZ + (chairAffordance.seatPosition.z - normalWalkZ) * this.sitBlend;
      const charRotY = lerpAngle(normalRotY, chairYaw, this.sitBlend);

      this.character.position.set(charX, seatedY, charZ);
      this.character.rotation.y = charRotY;

      if (this.sitBlend > 0.999) {
        this.angle = 0;
      }

      let pose = locomotion.pose;
      if (this.sitBlend > 0.0005) pose = blendPoses(pose, SIT_POSE, this.sitBlend);

      const worldTarget = this.resolveTarget(deltaSeconds);
      this.target.position.copy(worldTarget);

      if (this.lookEnabled || this.reachEnabled) {
        const localTarget = this.toLocal(worldTarget);
        if (this.lookEnabled) pose = this.applyLook(pose, localTarget);
        if (this.reachEnabled) pose = this.applyReach(pose, localTarget);
      }

      this.visualization.setPose(pose);
      applyCharacterFacePose(this.bodyMesh, frame.blendShapes);
    }
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
    const maxReach = 0.56;
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
    this.capsuleHeroActor.dispose();
    for (const actor of this.capsuleLineupActors) {
      actor.dispose();
    }
    this.capsuleCatHeroActor.dispose();
    for (const actor of this.capsuleCatLineupActors) {
      actor.dispose();
    }
    this.capsuleStudioGroup.removeFromParent();
    this.capsuleCatStudioGroup.removeFromParent();
    this.character.removeFromParent();
    this.referenceModelBinding?.dispose();
    this.referenceModelGroup.removeFromParent();
    this.referenceFace.root.removeFromParent();
    this.gazeMarker.removeFromParent();
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
