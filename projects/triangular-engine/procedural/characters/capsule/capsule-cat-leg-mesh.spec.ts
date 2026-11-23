import {
  BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, Quaternion, Vector3,
} from 'three';
import { CapsuleCatLegMesh, capsuleCatLegSkinWeights } from './capsule-cat-leg-mesh';

const HIP_HEIGHT = 0.265;

/** A stand-in for the baked leg: one vertex per height, ankle at y = 0. */
function legGeometry(heights: readonly number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(heights.flatMap(y => [0, y, 0]), 3),
  );
  return geometry;
}

function weightRow(geometry: BufferGeometry, rest: { hipHeight: number }, index: number) {
  const { weights } = capsuleCatLegSkinWeights(geometry, rest);
  return [weights[index * 4], weights[index * 4 + 1], weights[index * 4 + 2]];
}

describe('CapsuleCatLegMesh skin weights', () => {
  const rest = { hipHeight: HIP_HEIGHT };
  // Hip, upper thigh, knee, shin, ankle joint, paw.
  const heights = [
    HIP_HEIGHT,
    HIP_HEIGHT * 0.75,
    HIP_HEIGHT * (1 - 0.52),
    HIP_HEIGHT * 0.2,
    0,
    -0.06,
  ];
  const geometry = legGeometry(heights);

  it('always sums to one per vertex', () => {
    const { weights } = capsuleCatLegSkinWeights(geometry, rest);
    for (let i = 0; i < heights.length; i += 1) {
      const sum = weights[i * 4] + weights[i * 4 + 1] + weights[i * 4 + 2] + weights[i * 4 + 3];
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it('keeps the hip and the paw rigid and hands the middle to the shin', () => {
    expect(weightRow(geometry, rest, 0)[0]).toBeCloseTo(1, 6);
    const paw = weightRow(geometry, rest, heights.length - 1);
    expect(paw[2]).toBeCloseTo(1, 6);
    const upperThigh = weightRow(geometry, rest, 1);
    expect(upperThigh[0]).toBeGreaterThan(0.9);
    const shin = weightRow(geometry, rest, 3);
    expect(shin[1]).toBeGreaterThan(0.9);
  });

  it('moves weight from hip to shin to paw down the leg', () => {
    const hipWeights = heights.map((_, index) => weightRow(geometry, rest, index)[0]);
    for (let i = 1; i < hipWeights.length; i += 1)
      expect(hipWeights[i]).toBeLessThanOrEqual(hipWeights[i - 1] + 1e-6);

    const pawWeights = heights.map((_, index) => weightRow(geometry, rest, index)[2]);
    for (let i = 1; i < pawWeights.length; i += 1)
      expect(pawWeights[i]).toBeGreaterThanOrEqual(pawWeights[i - 1] - 1e-6);
  });
});

describe('CapsuleCatLegMesh pose', () => {
  let leg: CapsuleCatLegMesh;

  beforeEach(() => {
    leg = new CapsuleCatLegMesh({
      geometry: legGeometry([HIP_HEIGHT, HIP_HEIGHT / 2, 0, -0.06]),
      material: new MeshStandardMaterial(),
      rest: { hipHeight: HIP_HEIGHT },
    });
  });

  afterEach(() => {
    leg.dispose();
    leg.mesh.material.dispose();
  });

  it('puts the bone chain exactly on the posed joints', () => {
    const hip = new Vector3(0, 0.9, 0);
    const knee = new Vector3(0.02, 0.78, 0.01);
    const ankle = new Vector3(0.03, 0.64, 0.05);
    leg.pose(hip, knee, ankle);
    leg.mesh.updateMatrixWorld(true);
    const [hipBone, kneeBone, ankleBone] = leg.mesh.skeleton.bones;
    expect(hipBone.getWorldPosition(new Vector3()).distanceTo(hip)).toBeLessThan(1e-6);
    expect(kneeBone.getWorldPosition(new Vector3()).distanceTo(knee)).toBeLessThan(1e-6);
    expect(ankleBone.getWorldPosition(new Vector3()).distanceTo(ankle)).toBeLessThan(1e-6);
  });

  it('turns the paw by the requested pitch about world X', () => {
    const pitch = 0.4;
    leg.pose(new Vector3(), new Vector3(0, -0.13, 0), new Vector3(0, -0.26, 0), pitch);
    leg.mesh.updateMatrixWorld(true);
    const ankle = leg.mesh.skeleton.bones[2];
    const forward = new Vector3(0, 0, 1).applyQuaternion(ankle.getWorldQuaternion(new Quaternion()));
    // A pitch about X tips the paw's forward axis down by the pitch angle.
    expect(forward.x).toBeCloseTo(0, 6);
    expect(forward.y).toBeCloseTo(-Math.sin(pitch), 6);
    expect(forward.z).toBeCloseTo(Math.cos(pitch), 6);
  });

  it('returns to the baked rest pose', () => {
    leg.pose(new Vector3(0, 0.9, 0), new Vector3(0.1, 0.7, 0.1), new Vector3(0.2, 0.5, 0.2), 0.3);
    leg.rest();
    leg.mesh.updateMatrixWorld(true);
    const [hip, knee, ankle] = leg.mesh.skeleton.bones;
    expect(hip.position.toArray()).toEqual([0, HIP_HEIGHT, 0]);
    expect(knee.position.toArray()).toEqual([0, -HIP_HEIGHT * 0.52, 0]);
    expect(ankle.quaternion.w).toBeCloseTo(1, 6);
  });
});
