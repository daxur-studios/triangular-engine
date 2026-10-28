/**
 * High-level parametric procedural Capsule Doodle Character Actor.
 *
 * Unifies:
 * - Single-mesh Capsule Body + Skin/Suit Split + 2D SDF Mouth shader
 * - Googly Eyes, Gaze Pupils, Hemisphere Eyelids, Female Lashes & Floating Brows
 * - Zero-allocation Quadratic Bezier Rubber-Hose Arms & Legs
 * - 3-Pose Gloved Hands & Chunky Space Boots
 * - Modular Hair, Facial Hair & Space Gear Kit (Bubble Helmet, Jetpack, Headset, Walkie-Talkie)
 * - Spring-Damper Secondary Motion & `FacialAnimationController` integration
 */

import {
  CapsuleGeometry,
  Color,
  Group,
  MeshStandardMaterial,
  Quaternion,
} from 'three';
import {
  DEFAULT_CAPSULE_DNA,
  FacialAnimationController,
  generateCapsuleCharacterDNA,
  normalizeCapsuleCharacterDNA,
  projectCapsuleFaceState,
  sampleCapsuleLocomotion,
  stepSpringDamper3D,
  type CapsuleCharacterDNA,
  type CapsuleFaceProjection,
  type CapsuleHandActionMode,
  type CapsuleHandActionRequest,
  type CapsuleLocomotionMode,
  type CapsuleLocomotionSample,
  type CharacterVector3,
  type FacialFrameState,
  type SpringDamper3DState,
} from 'triangular-engine/characters';
import {
  buildCapsuleBodyMesh,
  type CapsuleBodyMeshResult,
} from './capsule-body-material';
import {
  buildCapsuleFaceRig,
  type CapsuleFaceRigResult,
} from './capsule-face-rig';
import {
  buildCapsuleHairKit,
  type CapsuleHairKitResult,
} from './capsule-hair-kit';
import {
  buildCapsuleGlovedHand,
  buildCapsuleSpaceBoot,
  type CapsuleGlovedHandAssembly,
  type CapsuleSpaceBootAssembly,
} from './capsule-hands-and-boots';
import { RubberHoseLimbMesh } from './capsule-rubber-hose-limb';
import {
  buildCapsuleSpaceGear,
  type CapsuleSpaceGearResult,
} from './capsule-space-gear';

export interface CapsuleCharacterActorOptions {
  readonly dna?: Partial<CapsuleCharacterDNA>;
  readonly seed?: string | number;
  readonly facialController?: FacialAnimationController;
  readonly autoBlink?: boolean;
}

export class CapsuleCharacterActor {
  readonly root = new Group();
  readonly torsoGroup = new Group();
  readonly limbsGroup = new Group();
  readonly facialController: FacialAnimationController;

  private currentDna: CapsuleCharacterDNA;
  private body: CapsuleBodyMeshResult;
  private faceRig: CapsuleFaceRigResult;
  private hairKit: CapsuleHairKitResult;
  private spaceGear: CapsuleSpaceGearResult;

  private readonly limbMaterial: MeshStandardMaterial;
  readonly leftLegMesh: RubberHoseLimbMesh;
  readonly rightLegMesh: RubberHoseLimbMesh;
  readonly leftArmMesh: RubberHoseLimbMesh;
  readonly rightArmMesh: RubberHoseLimbMesh;

  readonly leftBoot: CapsuleSpaceBootAssembly;
  readonly rightBoot: CapsuleSpaceBootAssembly;
  readonly leftHand: CapsuleGlovedHandAssembly;
  readonly rightHand: CapsuleGlovedHandAssembly;

  private locomotionMode: CapsuleLocomotionMode = 'idle';
  private speedMultiplier = 1.0;
  private leftHandAction: CapsuleHandActionRequest = { mode: 'none' };
  private rightHandAction: CapsuleHandActionRequest = { mode: 'none' };
  private wavyMouthOverride?: number;
  private elapsedSeconds = 0;

  private jetpackSpring: SpringDamper3DState = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  private hairSpring: SpringDamper3DState = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };

  private lastLocomotionSample?: CapsuleLocomotionSample;
  private lastFaceProjection?: CapsuleFaceProjection;
  private readonly tmpQuat = new Quaternion();

  constructor(options: CapsuleCharacterActorOptions = {}) {
    const baseDna =
      options.seed !== undefined
        ? generateCapsuleCharacterDNA(options.seed)
        : DEFAULT_CAPSULE_DNA;
    this.currentDna = normalizeCapsuleCharacterDNA({ ...baseDna, ...options.dna });

    this.facialController =
      options.facialController ??
      new FacialAnimationController({
        autoBlink: options.autoBlink ?? true,
        defaultTransitionSeconds: 0.2,
      });

    this.root.name = this.currentDna.id ?? 'capsule-character-actor';
    this.torsoGroup.name = 'capsule-torso-group';
    this.limbsGroup.name = 'capsule-limbs-group';
    this.root.add(this.torsoGroup, this.limbsGroup);

    // 1. Capsule Body + Shader
    this.body = buildCapsuleBodyMesh(this.currentDna);
    this.torsoGroup.add(this.body.mesh);

    // 2. Protruding Face Rig (Googly Eyes, Eyelids, Eyelashes, Brows)
    this.faceRig = buildCapsuleFaceRig(this.currentDna);
    this.torsoGroup.add(this.faceRig.root);

    // 3. Modular Hair & Facial Hair
    this.hairKit = buildCapsuleHairKit(this.currentDna);
    this.torsoGroup.add(this.hairKit.root);

    // 4. Space Gear (Bubble Helmet, Jetpack, Headset, Walkie-Talkie, Chest Patch)
    this.spaceGear = buildCapsuleSpaceGear(this.currentDna);
    this.torsoGroup.add(this.spaceGear.torsoGearGroup, this.spaceGear.headGearGroup);

    // 5. Rubber-Hose Limbs, Hands & Boots
    this.limbMaterial = new MeshStandardMaterial({
      color: new Color(this.currentDna.limbColor),
      roughness: 0.65,
      metalness: 0.08,
    });

    this.leftLegMesh = new RubberHoseLimbMesh({
      name: 'capsule-left-leg',
      radius: 0.042,
      material: this.limbMaterial,
    });
    this.rightLegMesh = new RubberHoseLimbMesh({
      name: 'capsule-right-leg',
      radius: 0.042,
      material: this.limbMaterial,
    });
    this.leftArmMesh = new RubberHoseLimbMesh({
      name: 'capsule-left-arm',
      radius: 0.036,
      material: this.limbMaterial,
    });
    this.rightArmMesh = new RubberHoseLimbMesh({
      name: 'capsule-right-arm',
      radius: 0.036,
      material: this.limbMaterial,
    });

    this.leftBoot = buildCapsuleSpaceBoot('left', this.currentDna.bootColor);
    this.rightBoot = buildCapsuleSpaceBoot('right', this.currentDna.bootColor);
    this.leftHand = buildCapsuleGlovedHand('left', this.limbMaterial);
    this.rightHand = buildCapsuleGlovedHand('right', this.limbMaterial);

    // Attach handheld gadget/flag to left hand socket
    this.leftHand.propSocket.add(this.spaceGear.handPropGroup);

    this.limbsGroup.add(
      this.leftLegMesh.mesh,
      this.rightLegMesh.mesh,
      this.leftArmMesh.mesh,
      this.rightArmMesh.mesh,
      this.leftBoot.root,
      this.rightBoot.root,
      this.leftHand.root,
      this.rightHand.root,
    );

    // Initial pose evaluation at t = 0
    this.update(0);
  }

  get dna(): CapsuleCharacterDNA {
    return this.currentDna;
  }

  get locomotion(): CapsuleLocomotionMode {
    return this.locomotionMode;
  }

  get latestLocomotionSample(): CapsuleLocomotionSample | undefined {
    return this.lastLocomotionSample;
  }

  get latestFaceProjection(): CapsuleFaceProjection | undefined {
    return this.lastFaceProjection;
  }

  /**
   * Updates the character's DNA in-place, rebuilding geometry only when structural
   * dimensions or modular style IDs change.
   */
  setDna(partial: Partial<CapsuleCharacterDNA>): void {
    const prev = this.currentDna;
    const next = normalizeCapsuleCharacterDNA({ ...prev, ...partial });
    this.currentDna = next;

    const geometryChanged =
      prev.bodyRadius !== next.bodyRadius || prev.bodyHeight !== next.bodyHeight;
    const eyeGeometryChanged =
      geometryChanged ||
      prev.eyeSpacing !== next.eyeSpacing ||
      prev.eyeScale !== next.eyeScale;

    if (geometryChanged) {
      this.body.mesh.geometry.dispose();
      this.body.mesh.geometry = new CapsuleGeometry(next.bodyRadius, next.bodyHeight, 24, 48);
    }
    this.body.updateDna(next);

    if (eyeGeometryChanged) {
      this.torsoGroup.remove(this.faceRig.root);
      this.faceRig.dispose();
      this.faceRig = buildCapsuleFaceRig(next);
      this.torsoGroup.add(this.faceRig.root);
    } else {
      this.faceRig.updateColorsAndStyle(next);
    }

    this.hairKit.rebuild(next);
    this.spaceGear.updateGear(next);
    this.limbMaterial.color.set(next.limbColor);
    this.leftBoot.setBootColor(next.bootColor);
    this.rightBoot.setBootColor(next.bootColor);

    this.update(0);
  }

  setSeed(seed: string | number): void {
    this.setDna(generateCapsuleCharacterDNA(seed));
  }

  setLocomotion(mode: CapsuleLocomotionMode, speedMultiplier = 1.0): void {
    this.locomotionMode = mode;
    this.speedMultiplier = speedMultiplier;
  }

  setHandAction(
    side: 'left' | 'right',
    mode: CapsuleHandActionMode,
    target?: CharacterVector3,
  ): void {
    const req: CapsuleHandActionRequest = { mode, target };
    if (side === 'left') {
      this.leftHandAction = req;
    } else {
      this.rightHandAction = req;
    }
  }

  setWavyMouthOverride(value: number | undefined): void {
    this.wavyMouthOverride = value;
  }

  /**
   * Advances procedural locomotion, 3-point Bezier limb deformation, secondary spring
   * motion, and 2D SDF mouth / googly-eye facial animation.
   */
  update(deltaSeconds: number, externalFrameState?: FacialFrameState): void {
    this.elapsedSeconds += Math.max(0, deltaSeconds);

    // 1. Facial State & Projection
    const frameState = externalFrameState ?? this.facialController.update(deltaSeconds);
    const faceProj = projectCapsuleFaceState(frameState, this.currentDna, {
      elapsedSeconds: this.elapsedSeconds,
      wavyMouthOverride: this.wavyMouthOverride,
    });
    this.lastFaceProjection = faceProj;

    this.body.updateMouth(faceProj.mouth);
    this.faceRig.updateFromProjection(faceProj);

    // 2. Locomotion & 3-Point Bezier Limb IK
    const loco = sampleCapsuleLocomotion({
      mode: this.locomotionMode,
      elapsedSeconds: this.elapsedSeconds,
      dna: this.currentDna,
      speedMultiplier: this.speedMultiplier,
      leftHandAction: this.leftHandAction,
      rightHandAction: this.rightHandAction,
    });
    this.lastLocomotionSample = loco;

    // Position the capsule torso above the legs
    const bootAnkleY = 0.13;
    const legLength = 0.56;
    const hipBaseY = bootAnkleY + legLength * 0.92;
    const capsuleCenterBaseY =
      hipBaseY + this.currentDna.bodyRadius * 0.65 + this.currentDna.bodyHeight * 0.5;

    this.torsoGroup.position.set(
      loco.bodySwayX,
      capsuleCenterBaseY + loco.bodyBounceY,
      0,
    );
    this.torsoGroup.rotation.set(loco.bodyTiltX, loco.bodyYawY, loco.bodyRollZ);

    // Update zero-allocation rubber-hose tube meshes
    this.leftLegMesh.updateFromSolution(loco.leftLeg);
    this.rightLegMesh.updateFromSolution(loco.rightLeg);
    this.leftArmMesh.updateFromSolution(loco.leftArm);
    this.rightArmMesh.updateFromSolution(loco.rightArm);

    // Position and orient space boots at ankle targets P2
    this.leftBoot.root.position.set(
      loco.leftLeg.p2.x,
      loco.leftLeg.p2.y,
      loco.leftLeg.p2.z,
    );
    this.leftBoot.root.rotation.set(loco.leftFootPitch, 0, 0);

    this.rightBoot.root.position.set(
      loco.rightLeg.p2.x,
      loco.rightLeg.p2.y,
      loco.rightLeg.p2.z,
    );
    this.rightBoot.root.rotation.set(loco.rightFootPitch, 0, 0);

    // Position and orient gloved hands at wrist targets P2 along curve tangent
    this.leftHand.root.position.set(
      loco.leftArm.p2.x,
      loco.leftArm.p2.y,
      loco.leftArm.p2.z,
    );
    this.leftArmMesh.computeEndOrientation(loco.leftArm.endTangent, this.tmpQuat);
    this.leftHand.root.quaternion.copy(this.tmpQuat);
    this.leftHand.setPose(loco.leftHandPose);

    this.rightHand.root.position.set(
      loco.rightArm.p2.x,
      loco.rightArm.p2.y,
      loco.rightArm.p2.z,
    );
    this.rightArmMesh.computeEndOrientation(loco.rightArm.endTangent, this.tmpQuat);
    this.rightHand.root.quaternion.copy(this.tmpQuat);
    this.rightHand.setPose(loco.rightHandPose);

    // 3. Spring-Damper Secondary Motion (Jetpack & Hair lag behind torso bounce/tilt)
    const springTarget: CharacterVector3 = {
      x: -loco.bodySwayX * 0.45,
      y: -loco.bodyBounceY * 0.65,
      z: -loco.bodyTiltX * 0.12,
    };

    this.jetpackSpring = stepSpringDamper3D(this.jetpackSpring, springTarget, deltaSeconds, {
      stiffness: 150,
      damping: 14,
      maxDisplacement: 0.08,
    });
    this.spaceGear.jetpackGroup.position.set(
      this.jetpackSpring.position.x,
      this.jetpackSpring.position.y,
      this.jetpackSpring.position.z,
    );
    this.spaceGear.jetpackGroup.rotation.x = this.jetpackSpring.position.y * 1.8;

    this.hairSpring = stepSpringDamper3D(this.hairSpring, springTarget, deltaSeconds, {
      stiffness: 120,
      damping: 12,
      maxDisplacement: 0.09,
    });
    this.hairKit.secondaryMotionGroup.position.set(
      this.hairSpring.position.x * 0.6,
      this.hairSpring.position.y * 0.85,
      this.hairSpring.position.z * 0.6,
    );
    this.hairKit.secondaryMotionGroup.rotation.x = -this.hairSpring.position.y * 2.1;
    this.hairKit.secondaryMotionGroup.rotation.z = this.hairSpring.position.x * 2.1;
  }

  dispose(): void {
    this.body.mesh.geometry.dispose();
    this.body.mesh.material.dispose();
    this.faceRig.dispose();
    this.hairKit.dispose();
    this.spaceGear.dispose();
    this.leftLegMesh.dispose();
    this.rightLegMesh.dispose();
    this.leftArmMesh.dispose();
    this.rightArmMesh.dispose();
    this.leftBoot.dispose();
    this.rightBoot.dispose();
    this.leftHand.dispose();
    this.rightHand.dispose();
    this.limbMaterial.dispose();
  }
}
