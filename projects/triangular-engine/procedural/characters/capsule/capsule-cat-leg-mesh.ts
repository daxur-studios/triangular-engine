/**
 * A baked cat leg (leg tube fused to a paw ball, bevelled at the join) driven by
 * three bones: hip, knee and ankle.
 *
 * The baked geometry is straight and rests with the ankle joint at the origin and
 * the hip at +Y. Skin weights come from that rest pose alone, so no hand painting
 * is needed: the leg is a single tube, and the weight is a smooth ramp along its
 * length that splits at the knee and hands the paw to the ankle bone. That keeps
 * the paw rigid, so the modelled bevel between leg and paw stays intact while the
 * knee bends.
 */

import {
  Bone,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three';

/** Where the bones sit along the leg, as fractions of the hip-to-ankle length. */
export interface CapsuleCatLegRestPose {
  /** Hip height above the ankle joint, in metres, in the geometry's rest pose. */
  readonly hipHeight: number;
  /** Knee position as a fraction from hip (0) to ankle (1). */
  readonly kneeAt?: number;
  /** Paw start as a fraction from hip (0) to ankle (1). */
  readonly pawAt?: number;
}

export interface CapsuleCatLegMeshOptions {
  readonly geometry: BufferGeometry;
  readonly material: MeshStandardMaterial;
  readonly rest: CapsuleCatLegRestPose;
  readonly name?: string;
}

const DOWN = new Vector3(0, -1, 0);
const X_AXIS = new Vector3(1, 0, 0);

const DEFAULT_KNEE_AT = 0.52;
const DEFAULT_PAW_AT = 0.96;
/** Half-width of the knee blend, as a fraction of the leg length. Wide enough
 * that the two segments bow like the hose leg instead of kinking at the knee. */
const KNEE_BLEND = 0.32;
/** Half-width of the ankle blend; it straddles the modelled bevel. */
const PAW_BLEND = 0.06;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Skin weights for a straight rest leg, one blend at the knee and one at the
 * ankle. Returns four-component indices and weights, as three expects.
 */
export function capsuleCatLegSkinWeights(
  geometry: BufferGeometry,
  rest: CapsuleCatLegRestPose,
): { indices: Uint16Array; weights: Float32Array } {
  const position = geometry.getAttribute('position');
  const count = position.count;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  const kneeAt = rest.kneeAt ?? DEFAULT_KNEE_AT;
  const pawAt = rest.pawAt ?? DEFAULT_PAW_AT;

  for (let i = 0; i < count; i += 1) {
    // 0 at the hip, 1 at the ankle, above 1 in the paw.
    const t = (rest.hipHeight - position.getY(i)) / rest.hipHeight;
    const wKnee = smoothstep(kneeAt - KNEE_BLEND, kneeAt + KNEE_BLEND, t);
    const wPaw = smoothstep(pawAt - PAW_BLEND, pawAt + PAW_BLEND, t);
    const wShin = wKnee * (1 - wPaw);

    indices[i * 4] = 0;
    indices[i * 4 + 1] = 1;
    indices[i * 4 + 2] = 2;
    weights[i * 4] = 1 - wKnee;
    weights[i * 4 + 1] = wShin;
    weights[i * 4 + 2] = wPaw;
  }

  return { indices, weights };
}

export class CapsuleCatLegMesh {
  readonly mesh: SkinnedMesh<BufferGeometry, MeshStandardMaterial>;
  readonly ownsPaw = true;
  private readonly bones: [Bone, Bone, Bone];
  private readonly skeleton: Skeleton;
  private readonly restPositions: [Vector3, Vector3, Vector3];

  private readonly toKnee = new Vector3();
  private readonly toAnkle = new Vector3();
  private readonly worldKnee = new Quaternion();
  private readonly inverseQuat = new Quaternion();
  private readonly pitchQuat = new Quaternion();
  private readonly kneeQuat = new Quaternion();
  private readonly ankleQuat = new Quaternion();
  private readonly offset = new Vector3();

  constructor(options: CapsuleCatLegMeshOptions) {
    const { geometry, material, rest } = options;
    const kneeAt = rest.kneeAt ?? DEFAULT_KNEE_AT;
    const pawAt = rest.pawAt ?? DEFAULT_PAW_AT;

    const { indices, weights } = capsuleCatLegSkinWeights(geometry, rest);
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));

    const hip = new Bone();
    const knee = new Bone();
    const ankle = new Bone();
    hip.name = 'leg-hip';
    knee.name = 'leg-knee';
    ankle.name = 'leg-ankle';
    hip.position.set(0, rest.hipHeight, 0);
    knee.position.set(0, -rest.hipHeight * kneeAt, 0);
    ankle.position.set(0, -rest.hipHeight * (pawAt - kneeAt), 0);
    hip.add(knee);
    knee.add(ankle);
    this.bones = [hip, knee, ankle];
    this.restPositions = [hip.position.clone(), knee.position.clone(), ankle.position.clone()];

    this.mesh = new SkinnedMesh(geometry, material);
    this.mesh.name = options.name ?? 'capsule-cat-leg';
    this.mesh.add(hip);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // Skinning happens on the GPU, so the static bounding sphere would cull the
    // leg as soon as it swings away from its rest shape.
    this.mesh.frustumCulled = false;

    this.mesh.updateMatrixWorld(true);
    this.skeleton = new Skeleton(this.bones);
    this.mesh.bind(this.skeleton, new Matrix4().identity());
  }

  /** Poses the chain so the hip, knee and ankle land on the given points. */
  pose(hipPoint: Vector3, kneePoint: Vector3, anklePoint: Vector3, pawPitch = 0): void {
    const [hip, knee, ankle] = this.bones;

    hip.position.copy(hipPoint);
    this.toKnee.subVectors(kneePoint, hipPoint).normalize();
    hip.quaternion.setFromUnitVectors(DOWN, this.toKnee);

    this.inverseQuat.copy(hip.quaternion).invert();
    this.offset.subVectors(kneePoint, hipPoint).applyQuaternion(this.inverseQuat);
    knee.position.copy(this.offset);
    // Each segment's world orientation is the minimal turn from straight down.
    this.toAnkle.subVectors(anklePoint, kneePoint).normalize();
    this.worldKnee.setFromUnitVectors(DOWN, this.toAnkle);
    knee.quaternion.multiplyQuaternions(this.inverseQuat, this.worldKnee);

    this.kneeQuat.multiplyQuaternions(hip.quaternion, knee.quaternion);
    this.inverseQuat.copy(this.kneeQuat).invert();
    this.offset.subVectors(anklePoint, kneePoint).applyQuaternion(this.inverseQuat);
    ankle.position.copy(this.offset);
    // The paw follows the shin and then pitches about X, exactly what
    // `paw.root.quaternion = endOrientation; rotateX(gait.pawPitch)` used to do.
    this.pitchQuat.setFromAxisAngle(X_AXIS, pawPitch);
    this.ankleQuat.multiplyQuaternions(this.worldKnee, this.pitchQuat);
    ankle.quaternion.multiplyQuaternions(this.inverseQuat, this.ankleQuat);
  }

  /** Holds the leg in its baked rest pose. */
  rest(): void {
    this.bones.forEach((bone, index) => {
      bone.position.copy(this.restPositions[index]);
      bone.quaternion.identity();
    });
  }

  setColor(color: Color | string): void {
    this.mesh.material.color.set(color);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
