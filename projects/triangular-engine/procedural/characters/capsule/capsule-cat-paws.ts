/**
 * Rounded cat paws for the Capsule Doodle Space Cats.
 *
 * A paw is either bare fur with subtle cartoon toe clefts, or a plump white
 * space bootie with a grey ankle cuff ring. The local origin is the ankle socket
 * ($P_2$) and the sole rests near -Y.
 */

import {
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';

export interface CapsuleCatPawAppearance {
  readonly furColor: string;
  readonly bootieColor: string;
  readonly cuffColor: string;
  readonly suited: boolean;
}

export interface CapsuleCatPawAssembly {
  readonly root: Group;
  readonly setAppearance: (appearance: CapsuleCatPawAppearance) => void;
  readonly dispose: () => void;
}

export function buildCapsuleCatPaw(
  name: string,
  radius: number,
  initial: CapsuleCatPawAppearance,
): CapsuleCatPawAssembly {
  const root = new Group();
  root.name = `capsule-cat-paw-${name}`;

  const pawMat = new MeshStandardMaterial({
    color: new Color(initial.suited ? initial.bootieColor : initial.furColor),
    roughness: initial.suited ? 0.48 : 0.70,
    metalness: initial.suited ? 0.05 : 0.02,
  });

  const cuffMat = new MeshStandardMaterial({
    color: new Color(initial.cuffColor),
    roughness: 0.45,
    metalness: 0.22,
  });

  // Main bean-shaped cartoon cat paw
  const mainGeo = new SphereGeometry(radius, 20, 16);
  mainGeo.scale(1.15, 0.86, 1.25);
  const main = new Mesh(mainGeo, pawMat);
  main.position.set(0, -radius * 0.54, radius * 0.22);
  main.castShadow = true;
  main.receiveShadow = true;
  root.add(main);

  // Soft rounded toe bumps that blend seamlessly into the front profile
  const toeGeo = new SphereGeometry(radius * 0.38, 14, 12);
  toeGeo.scale(1.0, 0.78, 1.05);
  const toeOffsets = [-0.48, 0, 0.48];
  for (const offset of toeOffsets) {
    const toe = new Mesh(toeGeo, pawMat);
    toe.position.set(offset * radius, -radius * 0.62, radius * 0.88);
    toe.castShadow = true;
    toe.receiveShadow = true;
    root.add(toe);
  }

  // Metallic ankle cuff ring for space booties
  const cuffGeo = new TorusGeometry(radius * 0.72, radius * 0.16, 12, 24);
  cuffGeo.rotateX(Math.PI * 0.5);
  const cuff = new Mesh(cuffGeo, cuffMat);
  cuff.position.set(0, radius * 0.02, 0);
  cuff.visible = initial.suited;
  cuff.castShadow = true;
  root.add(cuff);

  const setAppearance = (appearance: CapsuleCatPawAppearance): void => {
    pawMat.color.set(appearance.suited ? appearance.bootieColor : appearance.furColor);
    pawMat.roughness = appearance.suited ? 0.48 : 0.70;
    pawMat.metalness = appearance.suited ? 0.05 : 0.02;
    cuffMat.color.set(appearance.cuffColor);
    cuff.visible = appearance.suited;
  };

  const dispose = (): void => {
    mainGeo.dispose();
    toeGeo.dispose();
    cuffGeo.dispose();
    pawMat.dispose();
    cuffMat.dispose();
  };

  return { root, setAppearance, dispose };
}
