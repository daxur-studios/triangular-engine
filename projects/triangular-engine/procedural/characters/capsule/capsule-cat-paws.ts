/**
 * Rounded cat paws for the Capsule Doodle Space Cats. A paw is either bare fur
 * with three toe bumps, or a plump white space bootie with a grey ankle cuff.
 * The local origin is the ankle socket ($P_2$) and the sole rests near -Y.
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
    roughness: initial.suited ? 0.5 : 0.72,
    metalness: initial.suited ? 0.06 : 0.02,
  });

  const cuffMat = new MeshStandardMaterial({
    color: new Color(initial.cuffColor),
    roughness: 0.48,
    metalness: 0.2,
  });

  const mainGeo = new SphereGeometry(radius, 16, 12);
  mainGeo.scale(1.16, 0.94, 1.12);
  const main = new Mesh(mainGeo, pawMat);
  main.position.set(0, -radius * 0.56, radius * 0.24);
  main.castShadow = true;
  main.receiveShadow = true;
  root.add(main);

  const toeGeo = new SphereGeometry(radius * 0.34, 12, 10);
  const toeOffsets = [-0.44, 0, 0.44];
  for (const offset of toeOffsets) {
    const toe = new Mesh(toeGeo, pawMat);
    toe.position.set(offset * radius, -radius * 0.72, radius * 0.98);
    toe.scale.set(1, 0.82, 1);
    toe.castShadow = true;
    root.add(toe);
  }

  const cuffGeo = new TorusGeometry(radius * 0.7, radius * 0.16, 10, 20);
  cuffGeo.rotateX(Math.PI * 0.5);
  const cuff = new Mesh(cuffGeo, cuffMat);
  cuff.position.set(0, radius * 0.02, 0);
  cuff.visible = initial.suited;
  cuff.castShadow = true;
  root.add(cuff);

  const setAppearance = (appearance: CapsuleCatPawAppearance): void => {
    pawMat.color.set(appearance.suited ? appearance.bootieColor : appearance.furColor);
    pawMat.roughness = appearance.suited ? 0.5 : 0.72;
    pawMat.metalness = appearance.suited ? 0.06 : 0.02;
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
