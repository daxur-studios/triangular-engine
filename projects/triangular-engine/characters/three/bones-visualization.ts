import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from 'three';
import {
  solveForwardKinematics,
  type HumanoidRig,
  type RigPose,
} from 'triangular-engine/characters';

export interface BonesVisualizationOptions {
  readonly jointRadius?: number;
  readonly jointColor?: number;
  readonly lineColor?: number;
}

/**
 * Draws a `HumanoidRig` the way three.js debug skeletons look: a thin line from
 * each joint to its parent (like `THREE.SkeletonHelper`), plus a small joint
 * marker per bone. `setPose` re-resolves the rig through forward kinematics and
 * rewrites every line vertex and marker position.
 */
export class HumanoidRigVisualization {
  readonly group = new Group();

  private readonly rig: HumanoidRig;
  private readonly indexByName = new Map<string, number>();
  private readonly jointMeshes: Mesh[] = [];

  private readonly lineGeometry: BufferGeometry;
  private readonly lineMaterial: LineBasicMaterial;
  private readonly jointGeometry: SphereGeometry;
  private readonly jointMaterial: MeshBasicMaterial;

  private readonly vertices: Float32Array;

  constructor(rig: HumanoidRig, options: BonesVisualizationOptions = {}) {
    this.rig = rig;
    const jointRadius = options.jointRadius ?? 0.025;
    const jointColor = options.jointColor ?? 0x9ad6ff;
    const lineColor = options.lineColor ?? 0x4fc3f7;

    const segmentCount = rig.bones.filter((bone) => bone.parent !== null).length;
    this.vertices = new Float32Array(segmentCount * 2 * 3);
    this.lineGeometry = new BufferGeometry();
    this.lineGeometry.setAttribute('position', new BufferAttribute(this.vertices, 3));
    this.lineMaterial = new LineBasicMaterial({ color: lineColor });

    this.jointGeometry = new SphereGeometry(jointRadius, 8, 6);
    this.jointMaterial = new MeshBasicMaterial({ color: jointColor });

    const lines = new LineSegments(this.lineGeometry, this.lineMaterial);
    lines.frustumCulled = false;
    this.group.add(lines);

    rig.bones.forEach((bone, index) => {
      this.indexByName.set(bone.name, index);
      const joint = new Mesh(this.jointGeometry, this.jointMaterial);
      joint.position.set(bone.restPosition.x, bone.restPosition.y, bone.restPosition.z);
      this.group.add(joint);
      this.jointMeshes.push(joint);
    });

    this.setPose({});
  }

  setPose(pose: RigPose = {}): void {
    const solved = solveForwardKinematics(this.rig, pose);
    let offset = 0;
    for (const bone of this.rig.bones) {
      if (bone.parent === null) continue;
      const parent = solved.positions[this.indexByName.get(bone.parent)!];
      const position = solved.positions[this.indexByName.get(bone.name)!];
      this.vertices[offset++] = parent.x;
      this.vertices[offset++] = parent.y;
      this.vertices[offset++] = parent.z;
      this.vertices[offset++] = position.x;
      this.vertices[offset++] = position.y;
      this.vertices[offset++] = position.z;
    }
    this.lineGeometry.getAttribute('position').needsUpdate = true;

    solved.positions.forEach((position, index) => {
      this.jointMeshes[index].position.set(position.x, position.y, position.z);
    });
  }

  dispose(): void {
    this.lineGeometry.dispose();
    this.lineMaterial.dispose();
    this.jointGeometry.dispose();
    this.jointMaterial.dispose();
    this.group.removeFromParent();
  }
}
