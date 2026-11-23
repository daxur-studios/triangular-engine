import { Color, Mesh, MeshBasicMaterial, SkeletonHelper, SphereGeometry, type Object3D } from 'three';

/** Attach the returned helper at the scene root so it follows the actual bone world transforms. */
export function createBoneOverlay(root: Object3D, color: number) {
  const lines = new SkeletonHelper(root);
  lines.setColors(new Color(color), new Color(color));
  lines.frustumCulled = false;
  lines.renderOrder = 10;
  const geometry = new SphereGeometry(.012, 8, 6);
  const material = new MeshBasicMaterial({ color, depthTest: false, depthWrite: false, toneMapped: false });
  const joints = lines.bones.map(bone => {
    const joint = new Mesh(geometry, material);
    joint.renderOrder = 11;
    bone.add(joint);
    return joint;
  });
  function setVisible(visible: boolean): void {
    lines.visible = visible;
    for (const joint of joints) joint.visible = visible;
  }
  setVisible(false);
  return { lines, setVisible };
}
