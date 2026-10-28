/**
 * Modular Gloved Hands (3-pose swap / finger articulation: open, fist, point, grip, wave)
 * and Chunky Rounded Space Boots for Capsule Doodle characters.
 */

import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { CapsuleHandPoseId } from 'triangular-engine/characters';

export interface CapsuleGlovedHandAssembly {
  readonly root: Group;
  readonly propSocket: Group;
  readonly setPose: (pose: CapsuleHandPoseId) => void;
  readonly dispose: () => void;
}

export interface CapsuleSpaceBootAssembly {
  readonly root: Group;
  readonly setBootColor: (hex: string) => void;
  readonly dispose: () => void;
}

interface FingerRig {
  readonly pivot: Group;
  readonly mesh: Mesh;
}

/**
 * Builds a cartoon space glove with wrist cuff, rounded palm, thumb, and 3 cartoon fingers
 * that cleanly articulate between `open`, `fist`, `point`, `grip`, and `wave`.
 */
export function buildCapsuleGlovedHand(
  side: 'left' | 'right',
  gloveMaterial: MeshStandardMaterial,
): CapsuleGlovedHandAssembly {
  const sign = side === 'left' ? -1 : 1;
  const root = new Group();
  root.name = `capsule-hand-${side}`;

  // Puffy wrist cuff ring at local origin (wrist attachment point P2)
  const cuffGeo = new TorusGeometry(0.048, 0.018, 10, 18);
  cuffGeo.rotateX(Math.PI * 0.5);
  const cuffMesh = new Mesh(cuffGeo, gloveMaterial);
  cuffMesh.castShadow = true;
  root.add(cuffMesh);

  // Rounded puffy palm extending along -Y
  const palmGeo = new SphereGeometry(0.058, 16, 14);
  palmGeo.scale(1.05, 1.15, 0.72);
  const palmMesh = new Mesh(palmGeo, gloveMaterial);
  palmMesh.position.set(0, -0.055, 0);
  palmMesh.castShadow = true;
  root.add(palmMesh);

  // Thumb on inner (+Z / inward X) side
  const thumbPivot = new Group();
  thumbPivot.position.set(-sign * 0.046, -0.045, 0.018);
  const thumbGeo = new CapsuleGeometry(0.021, 0.042, 6, 10);
  const thumbMesh = new Mesh(thumbGeo, gloveMaterial);
  thumbMesh.position.set(0, -0.025, 0);
  thumbMesh.castShadow = true;
  thumbPivot.add(thumbMesh);
  root.add(thumbPivot);

  // 3 chunky cartoon fingers (Index, Middle, Ring/Pinky)
  const fingers: FingerRig[] = [];
  const xOffsets = [-sign * 0.032, 0, sign * 0.032];
  const lengths = [0.052, 0.058, 0.046];

  for (let i = 0; i < 3; i++) {
    const pivot = new Group();
    pivot.position.set(xOffsets[i], -0.095, 0);
    const fGeo = new CapsuleGeometry(0.020, lengths[i], 6, 10);
    const fMesh = new Mesh(fGeo, gloveMaterial);
    fMesh.position.set(0, -lengths[i] * 0.55, 0);
    fMesh.castShadow = true;
    pivot.add(fMesh);
    root.add(pivot);
    fingers.push({ pivot, mesh: fMesh });
  }

  // Socket for handheld props (walkie-talkie, flag)
  const propSocket = new Group();
  propSocket.name = `capsule-hand-prop-socket-${side}`;
  propSocket.position.set(0, -0.065, 0.045);
  root.add(propSocket);

  let currentPose: CapsuleHandPoseId | undefined;

  const setPose = (pose: CapsuleHandPoseId): void => {
    if (currentPose === pose) return;
    currentPose = pose;

    if (pose === 'open' || pose === 'wave') {
      thumbPivot.rotation.set(0.25, 0, -sign * 0.68);
      const splay = pose === 'wave' ? 0.26 : 0.16;
      fingers[0].pivot.rotation.set(0.08, 0, -sign * splay);
      fingers[1].pivot.rotation.set(0.05, 0, 0);
      fingers[2].pivot.rotation.set(0.10, 0, sign * splay);
    } else if (pose === 'fist') {
      thumbPivot.rotation.set(0.85, 0, sign * 0.35);
      for (const f of fingers) {
        f.pivot.rotation.set(1.65, 0, 0);
      }
    } else if (pose === 'point') {
      // Index finger straight out, middle & outer fingers curled into palm
      thumbPivot.rotation.set(0.75, 0, sign * 0.25);
      fingers[0].pivot.rotation.set(0.0, 0, 0);
      fingers[1].pivot.rotation.set(1.62, 0, 0);
      fingers[2].pivot.rotation.set(1.68, 0, 0);
    } else if (pose === 'grip') {
      thumbPivot.rotation.set(0.65, 0, -sign * 0.15);
      fingers[0].pivot.rotation.set(1.15, 0, 0);
      fingers[1].pivot.rotation.set(1.22, 0, 0);
      fingers[2].pivot.rotation.set(1.28, 0, 0);
    }
  };

  setPose('open');

  const dispose = (): void => {
    cuffGeo.dispose();
    palmGeo.dispose();
    thumbGeo.dispose();
    for (const f of fingers) {
      f.mesh.geometry.dispose();
    }
  };

  return {
    root,
    propSocket,
    setPose,
    dispose,
  };
}

/**
 * Builds a chunky rounded space boot from the Modular Character Kit sheet.
 * Local origin `(0, 0, 0)` is the ankle socket $P_2$; the sole rests at `y = -0.13`.
 */
export function buildCapsuleSpaceBoot(
  side: 'left' | 'right',
  initialBootColorHex: string,
): CapsuleSpaceBootAssembly {
  const root = new Group();
  root.name = `capsule-boot-${side}`;

  const bootMat = new MeshStandardMaterial({
    color: new Color(initialBootColorHex),
    roughness: 0.52,
    metalness: 0.08,
  });

  const soleMat = new MeshStandardMaterial({
    color: new Color(initialBootColorHex).multiplyScalar(0.76),
    roughness: 0.68,
    metalness: 0.05,
  });

  // Upper ankle collar cylinder + puffy torus rim
  const collarGeo = new CylinderGeometry(0.068, 0.078, 0.075, 18);
  const collarMesh = new Mesh(collarGeo, bootMat);
  collarMesh.position.set(0, -0.032, 0);
  collarMesh.castShadow = true;
  collarMesh.receiveShadow = true;
  root.add(collarMesh);

  const rimGeo = new TorusGeometry(0.068, 0.016, 10, 20);
  rimGeo.rotateX(Math.PI * 0.5);
  const rimMesh = new Mesh(rimGeo, bootMat);
  rimMesh.position.set(0, 0.002, 0);
  rimMesh.castShadow = true;
  root.add(rimMesh);

  // Bulbous rounded toe & main foot body
  const toeGeo = new CapsuleGeometry(0.072, 0.095, 12, 20);
  toeGeo.rotateX(Math.PI * 0.5);
  toeGeo.scale(1.08, 0.82, 1.15);
  const toeMesh = new Mesh(toeGeo, bootMat);
  toeMesh.position.set(0, -0.076, 0.048);
  toeMesh.castShadow = true;
  toeMesh.receiveShadow = true;
  root.add(toeMesh);

  // Thick flat sole slab at the bottom
  const soleGeo = new CapsuleGeometry(0.076, 0.105, 8, 18);
  soleGeo.rotateX(Math.PI * 0.5);
  soleGeo.scale(1.12, 0.30, 1.18);
  const soleMesh = new Mesh(soleGeo, soleMat);
  soleMesh.position.set(0, -0.112, 0.048);
  soleMesh.castShadow = true;
  soleMesh.receiveShadow = true;
  root.add(soleMesh);

  // Subtle heel block
  const heelGeo = new BoxGeometry(0.11, 0.028, 0.08);
  const heelMesh = new Mesh(heelGeo, soleMat);
  heelMesh.position.set(0, -0.116, -0.012);
  root.add(heelMesh);

  const setBootColor = (hex: string): void => {
    bootMat.color.set(hex);
    soleMat.color.set(hex).multiplyScalar(0.76);
  };

  const dispose = (): void => {
    collarGeo.dispose();
    rimGeo.dispose();
    toeGeo.dispose();
    soleGeo.dispose();
    heelGeo.dispose();
    bootMat.dispose();
    soleMat.dispose();
  };

  return {
    root,
    setBootColor,
    dispose,
  };
}
