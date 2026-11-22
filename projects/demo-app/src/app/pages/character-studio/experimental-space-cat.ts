import {
  CapsuleGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial,
  QuadraticBezierCurve3, Shape, TorusGeometry, TubeGeometry, Vector3,
} from 'three';
import {
  CAPSULE_CAT_PRESETS,
  type CapsuleCatCharacterDNA,
  type CapsuleCatTailPose,
  type FacialAnimationController,
} from 'triangular-engine/characters';
import {
  CapsuleCatActor, CapsuleCatTailMesh, RubberHoseLimbMesh, type CapsuleCatPawAssembly,
} from 'triangular-engine/procedural';
import { buildConceptCatHelmet, buildConceptCatSuit } from './experimental-space-cat-gear';
import { fitConceptCatEar } from './experimental-space-cat-ear';

/** Studio-only variant of the Goofy Walk cat, fitted to the supplied turnaround. */
export const EXPERIMENTAL_SPACE_CAT = {
  ...CAPSULE_CAT_PRESETS[0],
  id: 'space-cat-concept-fit',
  label: 'Space Cat (Concept Fit)',
  eyeSpacing: 0.59,
  eyeScale: 1.29,
  pupilScale: 0.35,
  earScale: 1.16,
  innerEarColor: '#c9857d',
  whiskerCount: 2,
  cuffColor: '#776b62',
  suitBooties: true,
} satisfies CapsuleCatCharacterDNA;

type AppearanceChanges = Partial<Pick<CapsuleCatCharacterDNA,
  'bodyPattern' | 'furColor' | 'furAccentColor' | 'pack' | 'helmet' | 'harness'
  | 'suitBooties' | 'restMouthPose' | 'tuft' | 'panicked'>>;

function fitFace(actor: CapsuleCatActor, headZ: number): void {
  const { leftEar, rightEar, leftWhiskers, rightWhiskers, root } = actor.catFaceRig;
  leftEar.position.x = -0.195;
  rightEar.position.x = 0.195;
  for (const ear of [leftEar, rightEar]) {
    ear.position.y += 0.006;
    ear.position.z -= 0.030;
    fitConceptCatEar(ear);
  }

  const nose = root.getObjectByName('capsule-cat-nose') as Mesh;
  const shape = new Shape();
  shape.moveTo(-0.025, 0.013);
  shape.quadraticCurveTo(0, 0.024, 0.025, 0.013);
  shape.quadraticCurveTo(0.032, 0.005, 0.009, -0.021);
  shape.quadraticCurveTo(0, -0.028, -0.009, -0.021);
  shape.quadraticCurveTo(-0.032, 0.005, -0.025, 0.013);
  nose.geometry.dispose();
  nose.geometry = new ExtrudeGeometry(shape, { depth: 0.009, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3 });
  nose.position.set(0, -0.032, headZ + 0.274);
  nose.scale.set(1, 1, 1);

  // Anchor the whiskers on the cheeks and let them project away from the face.
  const cheekPoint = (x: number, y: number) => new Vector3(
    x, y, Math.sqrt(Math.max(0, 1 - (x / 0.3276) ** 2 - (y / 0.3276) ** 2)) * 0.28 + headZ + 0.012,
  );
  for (const { group, side } of [{ group: leftWhiskers, side: -1 }, { group: rightWhiskers, side: 1 }]) {
    group.position.copy(cheekPoint(side * 0.14, -0.08));
    for (const [index, mesh] of (group.children as Mesh[]).entries()) {
      const y = -0.073 - index * 0.036;
      const endY = y - index * 0.044;
      const start = cheekPoint(side * 0.137, y);
      const tip = new Vector3(side * 0.265, endY, start.z + 0.025);
      const curve = new QuadraticBezierCurve3(
        start.clone().sub(group.position),
        start.clone().lerp(tip, 0.5).sub(group.position),
        tip.sub(group.position),
      );
      mesh.geometry.dispose();
      mesh.geometry = new TubeGeometry(curve, 16, 0.0088, 10, false);
    }
  }
}

function fitPaw(paw: CapsuleCatPawAssembly): void {
  const [pad, ...details] = paw.root.children as Mesh[];
  const cuff = details.pop()!;
  for (const toe of details) toe.visible = false;
  pad.position.set(0, -0.034, 0.012);
  pad.scale.set(0.9, 1.14, 0.83);
  cuff.geometry.dispose();
  cuff.geometry = new TorusGeometry(0.052, 0.012, 12, 28).rotateX(Math.PI / 2);
  cuff.position.y = -0.003;
}

/** The studio study uses the standard cat's face and gait on a separate head and torso. */
export function buildExperimentalSpaceCat(autoBlink = true, facialController?: FacialAnimationController) {
  const actor = new CapsuleCatActor({
    dna: EXPERIMENTAL_SPACE_CAT,
    autoBlink,
    facialController,
    closedSmileStyle: 'paired-curves',
  });
  const radius = actor.dna.bodyRadius;
  const headZ = actor.dna.bodyLength / 2;
  const { mesh, uniforms } = actor.catBody;
  mesh.geometry.dispose();
  // Keep the front hemisphere in the original local coordinates for the animated
  // mouth shader and facial rig, and round off its back into a distinct head.
  mesh.geometry = new CapsuleGeometry(radius, 0, 32, 48)
    .rotateX(Math.PI / 2)
    .scale(1.17, 1.17, 1)
    .translate(0, 0, headZ);
  const head = new Group();
  head.name = 'concept-cat-head';
  head.position.set(0, 0.195, 0.176);
  head.scale.set(0.96, 0.96, 1.04);
  fitFace(actor, headZ);
  head.add(mesh, actor.catFaceRig.root);
  actor.torsoGroup.add(head);

  const body = buildConceptCatSuit();
  const helmet = buildConceptCatHelmet();
  actor.torsoGroup.getObjectByName('capsule-cat-head-gear')?.removeFromParent();
  const stockTorsoGear = actor.torsoGroup.getObjectByName('capsule-cat-torso-gear')!;
  stockTorsoGear.position.y = -0.052;
  actor.torsoGroup.add(body.mesh, helmet.root);

  const tailSocket = actor.torsoGroup.getObjectByName('capsule-cat-tail')!;
  tailSocket.remove(...tailSocket.children);
  const tail = new CapsuleCatTailMesh({ name: 'concept-cat-tail', color: actor.dna.furColor, tipRadiusRatio: 0.9 });
  tailSocket.add(tail.root);
  const tailPose = {
    base: new Vector3(), control1: new Vector3(), control2: new Vector3(), tip: new Vector3(), radius: 0.065,
  } satisfies CapsuleCatTailPose;

  const forelegMaterial = new MeshStandardMaterial({ roughness: 0.72 });
  const hindlegMaterial = new MeshStandardMaterial({ roughness: 0.72 });
  const replaceLimb = (key: 'frontLeftLimb' | 'frontRightLimb' | 'backLeftLimb' | 'backRightLimb', front: boolean) => {
    const original = actor[key];
    original.mesh.removeFromParent();
    original.dispose();
    const limb = new RubberHoseLimbMesh({
      name: original.mesh.name,
      radius: front ? 0.063 : 0.06,
      material: front ? forelegMaterial : hindlegMaterial,
    });
    actor[key] = limb;
    actor.limbsGroup.add(limb.mesh);
    return limb;
  };
  const legs = [
    { limb: replaceLimb('frontLeftLimb', true), paw: actor.frontLeftPaw, key: 'frontLeft', front: true },
    { limb: replaceLimb('frontRightLimb', true), paw: actor.frontRightPaw, key: 'frontRight', front: true },
    { limb: replaceLimb('backLeftLimb', false), paw: actor.backLeftPaw, key: 'backLeft', front: false },
    { limb: replaceLimb('backRightLimb', false), paw: actor.backRightPaw, key: 'backRight', front: false },
  ] as const;
  for (const { paw } of legs) fitPaw(paw);
  const socketOffset = new Vector3();
  const shoulder = new Vector3();
  const elbow = new Vector3();
  const ankle = new Vector3();
  const ankleTangent = new Vector3();
  const updatePose = (): void => {
    const gait = actor.latestLocomotionSample;
    if (!gait) return;
    for (const { limb, paw, key, front } of legs) {
      const { p0, p2 } = gait[key];
      socketOffset.set(0, 0.006, front ? 0.112 : -0.104).applyQuaternion(actor.torsoGroup.quaternion);
      shoulder.set(p0.x, p0.y, p0.z).add(socketOffset);
      ankle.set(p2.x * 1.06, p2.y + 0.023, p2.z + (front ? 0.183 : -0.168));
      elbow.lerpVectors(shoulder, ankle, 0.52);
      elbow.z += front ? -0.033 : 0.05;
      limb.updateCurve(shoulder, elbow, ankle);
      paw.root.position.copy(ankle);
      paw.root.scale.setScalar(1.18);
      ankleTangent.subVectors(ankle, elbow);
      limb.computeEndOrientation(ankleTangent, paw.root.quaternion);
      paw.root.rotateX(gait[`${key}PawPitch`]);
    }

    const swing = gait.tail;
    const tipLift = swing.tip.y - radius * (1.78 + actor.dna.tailCurl * 0.6);
    const streaming = actor.locomotion === 'bound_run' ? -0.035 : 0;
    tailPose.base.set(swing.base.x, 0.095, -0.337);
    tailPose.control1.set(swing.control1.x * 1.15, 0.198 + tipLift * 0.3, -0.666);
    tailPose.control2.set(swing.control2.x * 1.3, 0.582 + tipLift * 0.7, -0.334 + streaming);
    tailPose.tip.set(swing.tip.x * 1.3, 0.531 + tipLift, -0.567 + streaming);
    tailPose.radius = swing.radius * 1.45;
    tail.updateFromPose(tailPose);
    uniforms.uMouthWidth.value *= 1.22;
  };

  const updateAppearance = (): void => {
    // The head uses the existing natural fur mode with the same shade on both halves.
    uniforms.uPattern.value = 2;
    uniforms.uFurAccentColor.value.copy(uniforms.uFurColor.value);
    uniforms.uMouthCenterY.value = -0.087;
    const dna = actor.dna;
    body.setAppearance(dna);
    helmet.setAppearance(dna);
    tail.setColor(dna.furColor);
    const frontSuited = dna.bodyPattern !== 'natural_two_tone';
    const backSuited = dna.bodyPattern === 'full_suit';
    const rearFur = dna.bodyPattern === 'natural_two_tone' ? dna.furAccentColor : dna.furColor;
    forelegMaterial.color.set(frontSuited ? dna.suitColor : dna.furColor);
    hindlegMaterial.color.set(backSuited ? dna.suitColor : rearFur);
    for (const { paw, front } of legs) {
      paw.setAppearance({
        furColor: front ? dna.furColor : rearFur,
        bootieColor: dna.suitColor,
        cuffColor: dna.cuffColor,
        suited: dna.suitBooties && (front || dna.bodyPattern !== 'front_suit'),
      });
    }
    // The concept collar also serves as the open collar when adding a pack.
    for (const child of [...stockTorsoGear.children]) {
      if ((child as Mesh).isMesh) {
        (child as Mesh).geometry.dispose();
        child.removeFromParent();
      }
    }
  };
  updateAppearance();
  updatePose();

  return {
    actor,
    setDna(changes: AppearanceChanges): void {
      actor.setDna(changes);
      updateAppearance();
      updatePose();
    },
    update(deltaSeconds: number): void {
      actor.update(deltaSeconds);
      updatePose();
    },
    dispose(): void {
      actor.dispose();
      body.dispose();
      helmet.dispose();
      tail.dispose();
      forelegMaterial.dispose();
      hindlegMaterial.dispose();
    },
  };
}
