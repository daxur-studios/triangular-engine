import {
  Bone,
  Color,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Skeleton,
  SkeletonHelper,
  SphereGeometry,
} from 'three';
import type { HumanoidRig, RigPose } from 'triangular-engine/characters';

export interface BonesVisualizationOptions {
  readonly jointRadius?: number;
  readonly jointColor?: number;
  readonly lineColor?: number;
  /** Whether the skeleton helper lines and joint spheres start visible. */
  readonly overlayVisible?: boolean;
}

/**
 * Builds a real `THREE.Bone` tree that mirrors a `HumanoidRig`, wrapped with a
 * `THREE.Skeleton` for later `SkinnedMesh`/`AnimationMixer` use. The rig's
 * per-bone XYZ Euler pose is applied as local bone quaternions and three.js
 * resolves the hierarchy, while `THREE.SkeletonHelper` draws the parent→child
 * lines and a small sphere marks each joint.
 */
export class HumanoidRigVisualization {
  readonly group = new Group();
  /** The bone tree, in rig order (parent before child). */
  readonly bones: Bone[] = [];
  /** A `THREE.Skeleton` over `bones`, inversed in the rest pose. */
  readonly skeleton: Skeleton;

  private readonly rig: HumanoidRig;
  private readonly rootBone: Bone;
  private readonly helper: SkeletonHelper;
  private readonly jointGeometry: SphereGeometry;
  private readonly jointMaterial: MeshBasicMaterial;
  private readonly jointMeshes: Mesh[] = [];

  private readonly euler = new Euler(0, 0, 0, 'XYZ');
  private readonly quaternion = new Quaternion();

  constructor(rig: HumanoidRig, options: BonesVisualizationOptions = {}) {
    this.rig = rig;
    const jointRadius = options.jointRadius ?? 0.025;
    const jointColor = options.jointColor ?? 0x9ad6ff;
    const lineColor = options.lineColor ?? 0x4fc3f7;
    const overlayVisible = options.overlayVisible ?? true;

    const boneByName = new Map<string, Bone>();
    for (const bone of rig.bones) {
      const threeBone = new Bone();
      threeBone.name = bone.name;
      this.bones.push(threeBone);
      boneByName.set(bone.name, threeBone);
    }

    for (const bone of rig.bones) {
      const threeBone = boneByName.get(bone.name)!;
      const parentPosition = bone.parent === null
        ? { x: 0, y: 0, z: 0 }
        : rig.boneByName.get(bone.parent)!.restPosition;
      threeBone.position.set(
        bone.restPosition.x - parentPosition.x,
        bone.restPosition.y - parentPosition.y,
        bone.restPosition.z - parentPosition.z,
      );
      if (bone.parent !== null) boneByName.get(bone.parent)!.add(threeBone);
    }

    this.rootBone = this.bones[0];
    this.rootBone.updateMatrixWorld(true);
    this.skeleton = new Skeleton(this.bones);

    this.helper = new SkeletonHelper(this.rootBone);
    this.helper.setColors(new Color(lineColor), new Color(lineColor));
    this.helper.frustumCulled = false;
    // `SkeletonHelper` stores `matrix = root.matrixWorld` and is meant to live at
    // the scene root. Because we parent it under `group` (which the caller may
    // transform), point its matrix at the root bone's *local* matrix instead, so
    // `matrixWorld = group.matrixWorld * root.matrix` resolves to the same space
    // as the root bone and avoids double-applying `group`'s transform.
    this.helper.matrix = this.rootBone.matrix;

    this.jointGeometry = new SphereGeometry(jointRadius, 8, 6);
    this.jointMaterial = new MeshBasicMaterial({ color: jointColor });
    for (const bone of this.bones) {
      const jointMesh = new Mesh(this.jointGeometry, this.jointMaterial);
      this.jointMeshes.push(jointMesh);
      bone.add(jointMesh);
    }

    this.group.add(this.rootBone, this.helper);

    this.setOverlayVisible(overlayVisible);
    this.setPose({});
  }

  /**
   * Shows or hides the debug overlay: the `SkeletonHelper` bone lines and the
   * per-joint spheres. The underlying skeleton and any skinned meshes are
   * unaffected, so this is safe to toggle while the body is visible.
   */
  setOverlayVisible(visible: boolean): void {
    this.helper.visible = visible;
    for (const mesh of this.jointMeshes) mesh.visible = visible;
  }

  setPose(pose: RigPose = {}): void {
    for (let index = 0; index < this.rig.bones.length; index++) {
      const rotation = pose[this.rig.bones[index].name];
      this.euler.set(rotation?.[0] ?? 0, rotation?.[1] ?? 0, rotation?.[2] ?? 0, 'XYZ');
      this.quaternion.setFromEuler(this.euler);
      this.bones[index].quaternion.copy(this.quaternion);
    }
  }

  dispose(): void {
    this.helper.dispose();
    this.jointGeometry.dispose();
    this.jointMaterial.dispose();
    this.group.removeFromParent();
  }
}
