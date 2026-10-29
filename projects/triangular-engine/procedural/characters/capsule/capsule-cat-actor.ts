/**
 * High-level parametric procedural Capsule Doodle Space Cat Actor.
 *
 * Unifies:
 * - Horizontal single-mesh capsule body with 3 suit/fur patterns and a 2D SDF
 *   `:3` / omega mouth
 * - Cat face rig (pointed ears, crown tuft, googly eyes, eyelids, nose, whiskers)
 * - Four short zero-allocation Quadratic Bezier rubber-hose legs with rounded paws
 * - S-curved tapered procedural tail with spring-damper secondary lag
 * - Modular cat space gear (angled bubble helmet, dorsal pet jetpack + harness,
 *   brown/blue mini saddle packs)
 * - Quadruped gait sampling shared with the framework-free `characters` entry
 */

import {
  CapsuleGeometry,
  Color,
  Group,
  MeshStandardMaterial,
  Quaternion,
} from 'three';
import {
  DEFAULT_CAPSULE_CAT_DNA,
  FacialAnimationController,
  generateCapsuleCatCharacterDNA,
  normalizeCapsuleCatCharacterDNA,
  projectCapsuleCatFaceState,
  sampleCapsuleCatLocomotion,
  stepSpringDamper3D,
  type CapsuleCatCharacterDNA,
  type CapsuleCatFaceProjection,
  type CapsuleCatGaitMode,
  type CapsuleCatLocomotionSample,
  type CharacterVector3,
  type FacialFrameState,
  type SpringDamper3DState,
} from 'triangular-engine/characters';
import {
  buildCapsuleCatBodyMesh,
  type CapsuleCatBodyMeshResult,
} from './capsule-cat-body-material';
import {
  buildCapsuleCatFaceRig,
  type CapsuleCatFaceRigResult,
} from './capsule-cat-face-rig';
import {
  buildCapsuleCatPaw,
  type CapsuleCatPawAssembly,
  type CapsuleCatPawAppearance,
} from './capsule-cat-paws';
import { CapsuleCatTailMesh } from './capsule-cat-tail';
import {
  buildCapsuleCatSpaceGear,
  type CapsuleCatSpaceGearResult,
} from './capsule-cat-space-gear';
import { RubberHoseLimbMesh } from './capsule-rubber-hose-limb';

export interface CapsuleCatActorOptions {
  readonly dna?: Partial<CapsuleCatCharacterDNA>;
  readonly seed?: string | number;
  readonly facialController?: FacialAnimationController;
  readonly autoBlink?: boolean;
}

export class CapsuleCatActor {
  readonly root = new Group();
  readonly torsoGroup = new Group();
  readonly limbsGroup = new Group();
  readonly facialController: FacialAnimationController;

  private currentDna: CapsuleCatCharacterDNA;
  private body: CapsuleCatBodyMeshResult;
  private faceRig: CapsuleCatFaceRigResult;
  private spaceGear: CapsuleCatSpaceGearResult;
  private readonly tail: CapsuleCatTailMesh;

  private limbMaterial: MeshStandardMaterial;
  frontLeftLimb!: RubberHoseLimbMesh;
  frontRightLimb!: RubberHoseLimbMesh;
  backLeftLimb!: RubberHoseLimbMesh;
  backRightLimb!: RubberHoseLimbMesh;

  frontLeftPaw!: CapsuleCatPawAssembly;
  frontRightPaw!: CapsuleCatPawAssembly;
  backLeftPaw!: CapsuleCatPawAssembly;
  backRightPaw!: CapsuleCatPawAssembly;

  private locomotionMode: CapsuleCatGaitMode;
  private speedMultiplier = 1;
  private elapsedSeconds = 0;

  private tailSpring: SpringDamper3DState = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  private packSpring: SpringDamper3DState = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };

  private lastLocomotionSample?: CapsuleCatLocomotionSample;
  private lastFaceProjection?: CapsuleCatFaceProjection;
  private readonly tmpQuat = new Quaternion();

  constructor(options: CapsuleCatActorOptions = {}) {
    const baseDna =
      options.seed !== undefined
        ? generateCapsuleCatCharacterDNA(options.seed)
        : DEFAULT_CAPSULE_CAT_DNA;
    this.currentDna = normalizeCapsuleCatCharacterDNA({ ...baseDna, ...options.dna });
    this.locomotionMode = this.currentDna.gait;

    this.facialController =
      options.facialController ??
      new FacialAnimationController({
        autoBlink: options.autoBlink ?? true,
        defaultTransitionSeconds: 0.2,
      });

    this.root.name = this.currentDna.id ?? 'capsule-cat-actor';
    this.torsoGroup.name = 'capsule-cat-torso-group';
    this.limbsGroup.name = 'capsule-cat-limbs-group';
    this.root.add(this.torsoGroup, this.limbsGroup);

    this.body = buildCapsuleCatBodyMesh(this.currentDna);
    this.torsoGroup.add(this.body.mesh);

    this.faceRig = buildCapsuleCatFaceRig(this.currentDna);
    this.torsoGroup.add(this.faceRig.root);

    this.spaceGear = buildCapsuleCatSpaceGear(this.currentDna);
    this.torsoGroup.add(this.spaceGear.torsoGearGroup, this.spaceGear.headGearGroup);

    this.tail = new CapsuleCatTailMesh({
      color: this.currentDna.furColor,
      tubularSegments: 22,
      radialSegments: 12,
    });
    this.torsoGroup.add(this.tail.root);

    this.limbMaterial = new MeshStandardMaterial({
      color: new Color(this.currentDna.furColor),
      roughness: 0.7,
      metalness: 0.02,
    });

    this.buildLimbsAndPaws();

    this.update(0);
  }

  get dna(): CapsuleCatCharacterDNA {
    return this.currentDna;
  }

  get locomotion(): CapsuleCatGaitMode {
    return this.locomotionMode;
  }

  get latestLocomotionSample(): CapsuleCatLocomotionSample | undefined {
    return this.lastLocomotionSample;
  }

  get latestFaceProjection(): CapsuleCatFaceProjection | undefined {
    return this.lastFaceProjection;
  }

  /**
   * Updates the cat's DNA in place, rebuilding only the geometry that actually
   * changed (body, face rig, gear, or limb thickness).
   */
  setDna(partial: Partial<CapsuleCatCharacterDNA>): void {
    const prev = this.currentDna;
    const next = normalizeCapsuleCatCharacterDNA({ ...prev, ...partial });
    this.currentDna = next;

    const bodySizeChanged =
      prev.bodyRadius !== next.bodyRadius || prev.bodyLength !== next.bodyLength;
    const faceGeometryChanged =
      bodySizeChanged ||
      prev.eyeSpacing !== next.eyeSpacing ||
      prev.eyeScale !== next.eyeScale ||
      prev.earScale !== next.earScale ||
      prev.whiskerCount !== next.whiskerCount;

    if (bodySizeChanged) {
      this.body.mesh.geometry.dispose();
      const geometry = new CapsuleGeometry(next.bodyRadius, next.bodyLength, 32, 48);
      geometry.rotateX(Math.PI * 0.5);
      this.body.mesh.geometry = geometry;
    }
    this.body.updateDna(next);

    if (faceGeometryChanged) {
      this.torsoGroup.remove(this.faceRig.root);
      this.faceRig.dispose();
      this.faceRig = buildCapsuleCatFaceRig(next);
      this.torsoGroup.add(this.faceRig.root);
    } else {
      this.faceRig.updateColorsAndStyle(next);
    }

    this.spaceGear.updateGear(next);
    this.limbMaterial.color.set(next.furColor);
    this.tail.setColor(next.furColor);

    if (prev.bodyRadius !== next.bodyRadius) {
      this.buildLimbsAndPaws();
    } else {
      this.applyPawAppearance(next);
    }

    if (prev.gait !== next.gait) {
      this.locomotionMode = next.gait;
    }

    this.update(0);
  }

  setSeed(seed: string | number): void {
    this.setDna(generateCapsuleCatCharacterDNA(seed));
  }

  setLocomotion(mode: CapsuleCatGaitMode, speedMultiplier = 1): void {
    this.locomotionMode = mode;
    this.speedMultiplier = speedMultiplier;
  }

  /**
   * Advances quadrupeds locomotion, zero-allocation rubber-hose legs, tail and pack
   * spring-damper secondary motion, and `:3` mouth / googly-eye animation.
   */
  update(deltaSeconds: number, externalFrameState?: FacialFrameState): void {
    this.elapsedSeconds += Math.max(0, deltaSeconds);

    const frameState = externalFrameState ?? this.facialController.update(deltaSeconds);
    const faceProjection = projectCapsuleCatFaceState(frameState, this.currentDna, {
      elapsedSeconds: this.elapsedSeconds,
    });
    this.lastFaceProjection = faceProjection;

    this.body.updateMouth(faceProjection.mouth);
    this.faceRig.updateFromProjection(faceProjection);

    const loco = sampleCapsuleCatLocomotion({
      mode: this.locomotionMode,
      elapsedSeconds: this.elapsedSeconds,
      dna: this.currentDna,
      speedMultiplier: this.speedMultiplier,
    });
    this.lastLocomotionSample = loco;

    this.torsoGroup.position.set(
      loco.bodySwayX,
      loco.bodyCenterY + loco.bodyBounceY,
      0,
    );
    this.torsoGroup.rotation.set(loco.bodyTiltX, loco.bodyYawY, loco.bodyRollZ);
    this.torsoGroup.scale.set(
      1 + loco.breathing * 0.008,
      1 + loco.breathing * 0.014,
      1 + loco.breathing * 0.008,
    );

    this.frontLeftLimb.updateFromSolution(loco.frontLeft);
    this.frontRightLimb.updateFromSolution(loco.frontRight);
    this.backLeftLimb.updateFromSolution(loco.backLeft);
    this.backRightLimb.updateFromSolution(loco.backRight);

    this.placePaw(
      this.frontLeftPaw,
      this.frontLeftLimb,
      loco.frontLeft,
      loco.frontLeftPawPitch,
    );
    this.placePaw(
      this.frontRightPaw,
      this.frontRightLimb,
      loco.frontRight,
      loco.frontRightPawPitch,
    );
    this.placePaw(
      this.backLeftPaw,
      this.backLeftLimb,
      loco.backLeft,
      loco.backLeftPawPitch,
    );
    this.placePaw(
      this.backRightPaw,
      this.backRightLimb,
      loco.backRight,
      loco.backRightPawPitch,
    );

    const springTarget: CharacterVector3 = {
      x: -loco.bodySwayX * 0.45,
      y: -loco.bodyBounceY * 0.65,
      z: -loco.bodyTiltX * 0.12,
    };

    this.tailSpring = stepSpringDamper3D(this.tailSpring, springTarget, deltaSeconds, {
      stiffness: 110,
      damping: 11,
      maxDisplacement: 0.07,
    });
    this.tail.root.position.set(
      this.tailSpring.position.x * 0.45,
      this.tailSpring.position.y * 0.45,
      this.tailSpring.position.z * 0.45,
    );
    this.tail.root.rotation.x = -this.tailSpring.position.y * 1.6;
    this.tail.root.rotation.z = this.tailSpring.position.x * 1.6;
    this.tail.updateFromPose(loco.tail);

    this.packSpring = stepSpringDamper3D(this.packSpring, springTarget, deltaSeconds, {
      stiffness: 150,
      damping: 14,
      maxDisplacement: 0.08,
    });
    this.spaceGear.packGroup.position.set(
      this.packSpring.position.x,
      this.packSpring.position.y,
      this.packSpring.position.z,
    );
    this.spaceGear.packGroup.rotation.x = this.packSpring.position.y * 1.8;
    this.spaceGear.packGroup.rotation.z = -this.packSpring.position.x * 1.2;
  }

  dispose(): void {
    this.body.mesh.geometry.dispose();
    this.body.mesh.material.dispose();
    this.faceRig.dispose();
    this.spaceGear.dispose();
    this.tail.dispose();
    this.disposeLimbsAndPaws();
    this.limbMaterial.dispose();
  }

  private buildLimbsAndPaws(): void {
    this.disposeLimbsAndPaws();

    const r = this.currentDna.bodyRadius;
    const limbRadius = Math.max(0.035, r * 0.175);
    const pawRadius = r * 0.22;

    this.limbMaterial = new MeshStandardMaterial({
      color: new Color(this.currentDna.furColor),
      roughness: 0.7,
      metalness: 0.02,
    });

    this.frontLeftLimb = this.createLimb('front-left', limbRadius);
    this.frontRightLimb = this.createLimb('front-right', limbRadius);
    this.backLeftLimb = this.createLimb('back-left', limbRadius);
    this.backRightLimb = this.createLimb('back-right', limbRadius);

    const appearance = this.pawAppearance(this.currentDna);
    this.frontLeftPaw = buildCapsuleCatPaw('front-left', pawRadius, appearance);
    this.frontRightPaw = buildCapsuleCatPaw('front-right', pawRadius, appearance);
    this.backLeftPaw = buildCapsuleCatPaw('back-left', pawRadius, appearance);
    this.backRightPaw = buildCapsuleCatPaw('back-right', pawRadius, appearance);

    this.limbsGroup.add(
      this.frontLeftLimb.mesh,
      this.frontRightLimb.mesh,
      this.backLeftLimb.mesh,
      this.backRightLimb.mesh,
      this.frontLeftPaw.root,
      this.frontRightPaw.root,
      this.backLeftPaw.root,
      this.backRightPaw.root,
    );
  }

  private createLimb(name: string, radius: number): RubberHoseLimbMesh {
    return new RubberHoseLimbMesh({
      name: `capsule-cat-${name}-leg`,
      radius,
      tubularSegments: 16,
      radialSegments: 10,
      material: this.limbMaterial,
    });
  }

  private applyPawAppearance(dna: CapsuleCatCharacterDNA): void {
    const appearance = this.pawAppearance(dna);
    this.frontLeftPaw.setAppearance(appearance);
    this.frontRightPaw.setAppearance(appearance);
    this.backLeftPaw.setAppearance(appearance);
    this.backRightPaw.setAppearance(appearance);
  }

  private pawAppearance(dna: CapsuleCatCharacterDNA): CapsuleCatPawAppearance {
    return {
      furColor: dna.furColor,
      bootieColor: dna.suitColor,
      cuffColor: dna.cuffColor,
      suited: dna.suitBooties,
    };
  }

  private placePaw(
    paw: CapsuleCatPawAssembly,
    limb: RubberHoseLimbMesh,
    solution: CapsuleCatLocomotionSample['frontLeft'],
    pitch: number,
  ): void {
    paw.root.position.set(solution.p2.x, solution.p2.y, solution.p2.z);
    limb.computeEndOrientation(solution.endTangent, this.tmpQuat);
    paw.root.quaternion.copy(this.tmpQuat);
    paw.root.rotateX(pitch);
  }

  private disposeLimbsAndPaws(): void {
    const limbs = [this.frontLeftLimb, this.frontRightLimb, this.backLeftLimb, this.backRightLimb];
    for (const limb of limbs) {
      if (!limb) continue;
      this.limbsGroup.remove(limb.mesh);
      limb.dispose();
    }
    const paws = [this.frontLeftPaw, this.frontRightPaw, this.backLeftPaw, this.backRightPaw];
    for (const paw of paws) {
      if (!paw) continue;
      this.limbsGroup.remove(paw.root);
      paw.dispose();
    }
    this.limbMaterial?.dispose();
  }
}
