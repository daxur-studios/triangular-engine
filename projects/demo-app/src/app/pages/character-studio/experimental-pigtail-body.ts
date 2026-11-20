import {
  Box3, CatmullRomCurve3, Group, LatheGeometry, Mesh, MeshStandardMaterial,
  Sphere, SphereGeometry, TubeGeometry, Vector2, Vector3,
  type BufferGeometry, type Material,
} from 'three';
import { RubberHoseLimbMesh } from 'triangular-engine/procedural';
import type { CapsuleSpacesuitPreset } from './capsule-spacesuit-presets';
import {
  ZERO_EULER,
  ZERO_VEC3,
  type CapsuleHumanPose,
  type RigMeasurements,
} from '../capsule-human-sandbox/motion/capsule-motion-types';

type Vec3 = readonly [number, number, number];
type ProfilePoint = readonly [number, number];

/** Matches `experimental-pigtail-head`'s local head scale (`0.35`) in blockout units. */
const HEAD_LOCAL_SCALE = 0.35;
/** Fits the full-body figure comfortably on the Character Studio pedestal alongside standard humans. */
const STUDIO_SCALE = 0.55;
const HEAD_SOCKET_Y = 7.95;
const PELVIS_Y = 4.52;
const BODY_SCALE = HEAD_LOCAL_SCALE * STUDIO_SCALE;

interface WalkFoot {
  readonly forward: number;
  readonly lift: number;
}

interface PigtailWalkPose {
  readonly left: WalkFoot;
  readonly right: WalkFoot;
  readonly bounce: number;
  readonly sway: number;
}

/** Shared standing spacesuit body from the approved full-body blockout with a collar socket for the seeded pigtail heads. */
export function buildExperimentalPigtailBody(preset: CapsuleSpacesuitPreset = 'orange-pigtails') {
  const shaggy = preset === 'shaggy';
  const rootScaleY = STUDIO_SCALE * (shaggy ? .91 : 1);
  const bodyScaleY = rootScaleY * HEAD_LOCAL_SCALE;
  const root = new Group();
  root.name = 'pigtail-standing-body';
  root.scale.set(STUDIO_SCALE, rootScaleY, STUDIO_SCALE);

  const body = new Group();
  body.scale.setScalar(HEAD_LOCAL_SCALE);
  const upperBody = new Group();
  upperBody.position.set(0, PELVIS_Y, 0);
  upperBody.rotation.order = 'YXZ';
  const upperBodyContent = new Group();
  upperBodyContent.position.set(0, -PELVIS_Y, 0);
  upperBody.add(upperBodyContent);
  body.add(upperBody);
  root.add(body);

  const headMount = new Group();
  headMount.position.set(0, HEAD_SOCKET_Y, 0);
  headMount.scale.setScalar(1 / HEAD_LOCAL_SCALE);
  upperBodyContent.add(headMount);

  const headSocket = new Group();
  headSocket.rotation.order = 'YXZ';
  headMount.add(headSocket);

  const sphere = new SphereGeometry(1, 36, 24);
  const geometries: BufferGeometry[] = [sphere];
  const mat = (color: number) => new MeshStandardMaterial({ color, roughness: .74 });
  const suit = mat(shaggy ? 0xe8dcd0 : 0xe6d5bd);
  const charcoal = mat(0x3c393a);
  const soles = mat(shaggy ? 0x6c5b50 : 0x403936);
  const pack = mat(0xc45e25);
  const badge = mat(0xf48125);
  const fixture = mat(0x8f8374);
  const materials: Material[] = [suit, charcoal, soles, pack, badge, fixture];

  function ellipsoid(parent: Group, material: Material, position: Vec3, radii: Vec3): Mesh {
    const mesh = new Mesh(sphere, material);
    mesh.position.set(...position);
    mesh.scale.set(...radii);
    parent.add(mesh);
    return mesh;
  }

  function profile(parent: Group, material: Material, points: readonly ProfilePoint[], position: Vec3, depth = 1): Mesh {
    const curve = new CatmullRomCurve3(points.map(([radius, y]) => new Vector3(radius, y, 0)));
    const contour = curve.getPoints(64).map(({ x, y }) => new Vector2(Math.max(0, x), y));
    const geometry = new LatheGeometry(contour, 64);
    geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.scale.z = depth;
    parent.add(mesh);
    return mesh;
  }

  function limb(parent: Group, material: MeshStandardMaterial, name: string,
    start: Vec3, middle: Vec3, end: Vec3, radius: number) {
    const points = [start, middle, end];
    const curve = new CatmullRomCurve3(points.map(point => new Vector3(...point)));
    const geometry = new TubeGeometry(curve, 22, radius, 18, false);
    geometries.push(geometry);
    const mesh = new Mesh<BufferGeometry, MeshStandardMaterial>(geometry, material);
    mesh.name = name;
    parent.add(mesh);
    const startPoint = new Vector3(...start);
    const endPoint = new Vector3(...end);
    const control = new Vector3();
    const baseControl = new Vector3(...middle).multiplyScalar(2)
      .addScaledVector(startPoint, -.5).addScaledVector(endPoint, -.5);
    let moving: RubberHoseLimbMesh | undefined;

    return {
      move(startOffset: Vector3, endOffset: Vector3, bendOffset: Vector3) {
        if (!moving) {
          moving = new RubberHoseLimbMesh({ radius, material, tubularSegments: 22, radialSegments: 18 });
          geometries.push(moving.geometry);
          // Enclose every walk pose, including the lifted boot and swinging hand.
          moving.geometry.boundingSphere = new Sphere(new Vector3(0, 4, 0), 8);
        }
        mesh.geometry = moving.geometry;
        startPoint.set(...start).add(startOffset);
        endPoint.set(...end).add(endOffset);
        control.copy(baseControl).addScaledVector(startOffset, .5).addScaledVector(endOffset, .5).add(bendOffset);
        moving.updateCurve(startPoint, control, endPoint);
      },
      rest() { mesh.geometry = geometry; },
    };
  }

  // Suit and head meet at nearly the same diameter beneath the collar.
  const torso = profile(upperBodyContent, suit, [
    [0, 4.26], [.62, 4.29], [1.14, 4.47], [1.48, 4.86],
    [1.60, 5.34], [1.60, 6.38], [1.48, 7.39], [1.35, 7.78], [0, 7.79],
  ], [0, 0, 0], .97);
  torso.name = 'pigtail-torso';

  const collar = profile(upperBodyContent, charcoal, [
    [0, -.27], [1.38, -.27], [1.56, -.22], [1.66, -.06],
    [1.67, .13], [1.55, .25], [1.35, .26], [0, .26],
  ], [0, 7.84, 0], 1.01);
  collar.name = 'pigtail-collar';

  const patch = ellipsoid(upperBodyContent, badge, [.35, 6.77, 1.47], [.36, .36, .13]);
  patch.name = 'pigtail-badge';
  patch.rotation.y = .17;

  // The pack sits behind the shoulder rings. The two nozzles stay above the hips.
  const packZ = -2.18;
  const gear = new Group();
  gear.name = 'pigtail-gear';
  if (shaggy) {
    gear.scale.set(1.32, 1.11, 1.04);
    gear.position.y = -.95;
  }
  upperBodyContent.add(gear);
  ellipsoid(gear, charcoal, [0, 6.46, -1.30], [.86, 1.27, .45]);
  const backpack = profile(gear, pack, [
    [0, 4.84], [.69, 4.89], [1.04, 5.16], [1.18, 5.50],
    [1.18, 7.85], [1.12, 8.31], [.85, 8.52], [.45, 8.62], [0, 8.63],
  ], [0, 0, packZ], .87);
  backpack.name = 'pigtail-backpack';

  profile(gear, charcoal, [
    [0, -.08], [1.16, -.08], [1.22, -.03], [1.22, .11], [1.17, .15], [0, .15],
  ], [0, 5.32, packZ], .88);

  const limbs = ([-1, 1] as const).map(side => {
    const sideLabel = side === -1 ? 'left' : 'right';
    const nozzle: Vec3 = [side * .59, 4.57, packZ - .12];
    profile(gear, fixture, [[0, -.19], [.35, -.19], [.38, -.14], [.28, .09], [.24, .48], [0, .50]], nozzle);
    profile(gear, soles, [[0, -.03], [.32, -.03], [.33, 0], [.32, .05], [0, .05]], [nozzle[0], 4.71, nozzle[2]]);
    ellipsoid(gear, fixture, [side * 1.14, 6.49, packZ - .12], [.14, .62, .49]);
    for (const y of [6.87, 6.47]) {
      ellipsoid(gear, charcoal, [side * 1.26, y - .13, packZ - .12], [.05, .125, .135]);
    }

    const shoulder: Vec3 = [side * 1.44, 6.95, .07];
    const elbow: Vec3 = [side * 2.03, 6.11, .11];
    const wrist: Vec3 = [side * 2.31, 4.98, .18];
    ellipsoid(upperBodyContent, charcoal, shoulder, [.38, .74, .65]).rotation.z = side * .27;
    const arm = limb(upperBodyContent, suit, `pigtail-arm-${sideLabel}`, shoulder, elbow, wrist, .275);

    const wristSocket = new Group();
    wristSocket.position.set(...wrist);
    wristSocket.rotation.order = 'YXZ';
    upperBodyContent.add(wristSocket);
    ellipsoid(wristSocket, charcoal, [0, 0, 0], [.43, .21, .40]).rotation.z = -side * .16;

    const palm = new Group();
    palm.name = `pigtail-hand-${sideLabel}`;
    palm.rotation.set(.10, side * .28, -side * .13);
    palm.scale.set(1.23, 1.24, 1.21);
    ellipsoid(palm, charcoal, [0, -.40, 0], [.37, .49, .29]);
    ellipsoid(palm, charcoal, [-side * .30, -.57, .13], [.18, .34, .16]).rotation.z = -side * .39;
    for (const [offset, length] of [[-.18, .31], [0, .36], [.17, .30]] as const) {
      ellipsoid(palm, charcoal, [side * offset, -.79, .045], [.125, length, .18]).rotation.z = -side * .11;
    }
    const propSocket = new Group();
    propSocket.name = `pigtail-prop-socket-${sideLabel}`;
    propSocket.position.set(0, -.55, .15);
    palm.add(propSocket);
    wristSocket.add(palm);

    const ankleX = side === -1 ? -1.25 : 1.00;
    const ankleZ = side === -1 ? -.12 : -.03;
    const hipLocal: Vec3 = [side * .66, PELVIS_Y, -.03];
    const leg = limb(body, charcoal, `pigtail-leg-${sideLabel}`,
      hipLocal, [ankleX * .70, 3.19, ankleZ * .55],
      [ankleX, 1.46, ankleZ],
    .245);

    const foot = new Group();
    foot.name = `pigtail-boot-${sideLabel}`;
    foot.position.set(ankleX, 0, ankleZ);
    foot.rotation.order = 'YXZ';

    const footMesh = new Group();
    const baseFootYaw = side === -1 ? -.52 : .52;
    footMesh.rotation.y = baseFootYaw;
    footMesh.scale.set(1.19, 1.25, 1.11);
    profile(footMesh, soles, [
      [0, 0], [.61, 0], [.70, .054], [.72, .18], [.66, .26], [0, .27],
    ], [0, 0, .35], 1.53);
    profile(footMesh, suit, [
      [0, .18], [.63, .18], [.71, .25], [.70, .40], [.63, .65], [.43, .87], [0, .93],
    ], [0, 0, .35], 1.52);
    profile(footMesh, suit, [
      [0, .44], [.51, .48], [.49, 1.24], [.47, 1.47], [.40, 1.54], [.24, 1.52], [.23, 1.30], [0, 1.29],
    ], [0, 0, 0]);
    foot.add(footMesh);
    body.add(foot);

    // Precompute sole rim points in `foot` space so boot pitch/roll never clips the floor.
    footMesh.updateMatrix();
    const solePoints: Vector3[] = [new Vector3(0, 0, .35).applyMatrix4(footMesh.matrix)];
    for (let sample = 0; sample < 12; sample++) {
      const angle = (sample / 12) * Math.PI * 2;
      solePoints.push(
        new Vector3(
          Math.cos(angle) * .61,
          0,
          .35 + Math.sin(angle) * .61 * 1.53,
        ).applyMatrix4(footMesh.matrix),
      );
    }

    return {
      side,
      arm,
      leg,
      foot,
      ankleX,
      ankleZ,
      hipFromPelvis: new Vector3(hipLocal[0], 0, hipLocal[2]),
      hipRest: new Vector3(...hipLocal),
      ankleRest: new Vector3(ankleX, 1.46, ankleZ),
      solePoints,
      wristSocket,
      wrist,
      propSocket,
    };
  });

  // Seat the lowest point of the boot soles cleanly on the pedestal (y = 0).
  root.updateMatrixWorld(true);
  const soleMinY = new Box3().setFromObject(body, true).min.y;
  const localOffsetY = -soleMinY / rootScaleY;
  body.position.y += localOffsetY;
  root.updateMatrixWorld(true);

  const measurements: RigMeasurements = {
    legLength: PELVIS_Y * bodyScaleY,
    hipHeight: PELVIS_Y * bodyScaleY,
    stanceHalfWidth: ((1.25 + 1.00) * 0.5) * BODY_SCALE,
    armLength: Math.hypot((2.31 - 1.44) * BODY_SCALE, (6.95 - 4.98) * bodyScaleY, (.18 - .07) * BODY_SCALE),
    leftFootRestLocal: { x: -1.25 * BODY_SCALE, y: 0, z: -.12 * BODY_SCALE },
    rightFootRestLocal: { x: 1.00 * BODY_SCALE, y: 0, z: -.03 * BODY_SCALE },
  };

  const zero = new Vector3();
  const footOffset = new Vector3();
  const legStartOffset = new Vector3();
  const legEndOffset = new Vector3();
  const legBendOffset = new Vector3();
  const wristOffset = new Vector3();
  const armBendOffset = new Vector3();
  const tmpPoint = new Vector3();

  function setPose(pose?: CapsuleHumanPose): void {
    if (!pose || (pose.restBlend ?? 0) >= 0.999) {
      upperBody.position.set(0, PELVIS_Y, 0);
      upperBody.rotation.set(0, 0, 0, 'YXZ');
      headSocket.position.set(0, 0, 0);
      headSocket.rotation.set(0, 0, 0, 'YXZ');
      limbs.forEach(({ arm, leg, foot, ankleX, ankleZ, wristSocket, wrist }) => {
        foot.position.set(ankleX, 0, ankleZ);
        foot.rotation.set(0, 0, 0, 'YXZ');
        wristSocket.position.set(...wrist);
        wristSocket.rotation.set(0, 0, 0, 'YXZ');
        leg.rest();
        arm.rest();
      });
      return;
    }

    const activeWeight = 1 - Math.max(0, Math.min(1, pose.restBlend ?? 0));
    const torsoX = pose.torsoOffset.x * activeWeight / BODY_SCALE;
    const torsoY = pose.torsoOffset.y * activeWeight / bodyScaleY;
    const torsoZ = pose.torsoOffset.z * activeWeight / BODY_SCALE;
    upperBody.position.set(torsoX, PELVIS_Y + torsoY, torsoZ);
    upperBody.rotation.set(
      pose.torsoRotation.pitch * activeWeight,
      pose.torsoRotation.yaw * activeWeight,
      pose.torsoRotation.roll * activeWeight,
      'YXZ',
    );

    headSocket.position.set(
      pose.headOffset.x * activeWeight / STUDIO_SCALE,
      pose.headOffset.y * activeWeight / rootScaleY,
      pose.headOffset.z * activeWeight / STUDIO_SCALE,
    );
    headSocket.rotation.set(
      pose.headRotation.pitch * activeWeight,
      pose.headRotation.yaw * activeWeight,
      pose.headRotation.roll * activeWeight,
      'YXZ',
    );

    limbs.forEach((limbEntry, index) => {
      const footPose = index === 0 ? pose.leftFoot : pose.rightFoot;
      const handPose = index === 0 ? pose.leftHand : pose.rightHand;
      const { side, arm, leg, foot, ankleX, ankleZ, hipFromPelvis, hipRest, ankleRest, solePoints, wristSocket, wrist } = limbEntry;

      foot.rotation.set(
        footPose.rotation.pitch * activeWeight,
        footPose.rotation.yaw * activeWeight,
        footPose.rotation.roll * activeWeight,
        'YXZ',
      );
      let minSoleLocalY = 0;
      for (const solePoint of solePoints) {
        tmpPoint.copy(solePoint).applyQuaternion(foot.quaternion);
        if (tmpPoint.y < minSoleLocalY) minSoleLocalY = tmpPoint.y;
      }
      const soleClipLift = -minSoleLocalY;

      footOffset.set(
        footPose.offset.x * activeWeight / BODY_SCALE,
        footPose.offset.y * activeWeight / bodyScaleY,
        footPose.offset.z * activeWeight / BODY_SCALE,
      );
      foot.position.set(
        ankleX + footOffset.x,
        footOffset.y + soleClipLift,
        ankleZ + footOffset.z,
      );

      tmpPoint.copy(hipFromPelvis).applyQuaternion(upperBody.quaternion).add(upperBody.position);
      legStartOffset.copy(tmpPoint).sub(hipRest);
      tmpPoint.set(0, 1.46, 0).applyQuaternion(foot.quaternion).add(foot.position);
      legEndOffset.copy(tmpPoint).sub(ankleRest);

      if (footPose.kneeBend) {
        legBendOffset.set(
          footPose.kneeBend.x * activeWeight / BODY_SCALE,
          footPose.kneeBend.y * activeWeight / bodyScaleY,
          footPose.kneeBend.z * activeWeight / BODY_SCALE,
        );
      } else {
        legBendOffset.set(side * 0.10 * Math.max(0, footOffset.y), 0, Math.max(0, footOffset.y) * .9);
      }
      leg.move(legStartOffset, legEndOffset, legBendOffset);

      wristOffset.set(
        handPose.offset.x * activeWeight / BODY_SCALE,
        handPose.offset.y * activeWeight / bodyScaleY,
        handPose.offset.z * activeWeight / BODY_SCALE,
      );
      wristSocket.position.set(...wrist).add(wristOffset);
      wristSocket.rotation.set(
        handPose.rotation.pitch * activeWeight,
        handPose.rotation.yaw * activeWeight,
        handPose.rotation.roll * activeWeight,
        'YXZ',
      );
      if (handPose.elbowBend) {
        armBendOffset.set(
          handPose.elbowBend.x * activeWeight / BODY_SCALE,
          handPose.elbowBend.y * activeWeight / bodyScaleY,
          handPose.elbowBend.z * activeWeight / BODY_SCALE,
        );
      } else {
        armBendOffset.set(0, 0, wristOffset.z * .12);
      }
      arm.move(zero, wristOffset, armBendOffset);
    });
  }

  function setWalkPose(pose?: PigtailWalkPose): void {
    if (!pose) {
      setPose();
      return;
    }
    const leftForward = pose.left.forward;
    const rightForward = pose.right.forward;
    const leftWristZ = -leftForward * .90;
    const rightWristZ = -rightForward * .90;
    setPose({
      torsoOffset: { x: pose.sway, y: pose.bounce, z: 0 },
      torsoRotation: ZERO_EULER,
      headOffset: ZERO_VEC3,
      headRotation: ZERO_EULER,
      leftFoot: {
        offset: { x: 0, y: pose.left.lift, z: leftForward },
        rotation: ZERO_EULER,
      },
      rightFoot: {
        offset: { x: 0, y: pose.right.lift, z: rightForward },
        rotation: ZERO_EULER,
      },
      leftHand: {
        offset: { x: 0, y: Math.abs(leftForward) * .12, z: leftWristZ },
        rotation: { pitch: -leftWristZ / BODY_SCALE * .29, yaw: 0, roll: 0 },
        elbowBend: { x: 0, y: 0, z: leftWristZ * .12 },
      },
      rightHand: {
        offset: { x: 0, y: Math.abs(rightForward) * .12, z: rightWristZ },
        rotation: { pitch: -rightWristZ / BODY_SCALE * .29, yaw: 0, roll: 0 },
        elbowBend: { x: 0, y: 0, z: rightWristZ * .12 },
      },
      restBlend: 0,
    });
  }

  return {
    root,
    headSocket,
    measurements,
    leftPropSocket: limbs[0].propSocket,
    rightPropSocket: limbs[1].propSocket,
    setPose,
    setWalkPose,
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
