import { Box3, Skeleton, Vector3 } from 'three';
import {
  createHumanoidRig,
  HUMAN_BONE_NAMES,
  type HumanoidRig,
} from 'triangular-engine/characters';
import { HumanoidRigVisualization } from 'triangular-engine/characters/three';
import { buildCharacterBodyMesh } from './character-body-mesh';

describe('Character Body Mesh Builder', () => {
  let rig: HumanoidRig;
  let rigViz: HumanoidRigVisualization;
  let skeleton: Skeleton;

  beforeEach(() => {
    rig = createHumanoidRig();
    rigViz = new HumanoidRigVisualization(rig);
    skeleton = rigViz.skeleton;
  });

  afterEach(() => {
    rigViz.dispose();
  });

  it('builds a skinned mesh bound to the skeleton with default options', () => {
    const mesh = buildCharacterBodyMesh(rig, skeleton);

    expect(mesh).toBeDefined();
    expect(mesh.isSkinnedMesh).toBeTrue();
    expect(mesh.skeleton).toBe(skeleton);
    expect(mesh.geometry).toBeDefined();

    const posAttr = mesh.geometry.getAttribute('position');
    const normAttr = mesh.geometry.getAttribute('normal');
    const colorAttr = mesh.geometry.getAttribute('color');
    const skinIndexAttr = mesh.geometry.getAttribute('skinIndex');
    const skinWeightAttr = mesh.geometry.getAttribute('skinWeight');

    expect(posAttr).toBeDefined();
    expect(normAttr).toBeDefined();
    expect(colorAttr).toBeDefined();
    expect(skinIndexAttr).toBeDefined();
    expect(skinWeightAttr).toBeDefined();

    expect(posAttr.count).toBeGreaterThan(0);
    expect(normAttr.count).toBe(posAttr.count);
    expect(colorAttr.count).toBe(posAttr.count);
    expect(skinIndexAttr.count).toBe(posAttr.count);
    expect(skinWeightAttr.count).toBe(posAttr.count);
  });

  it('ensures every skinIndex is an integer in [0, skeleton.bones.length)', () => {
    const mesh = buildCharacterBodyMesh(rig, skeleton);
    const skinIndexAttr = mesh.geometry.getAttribute('skinIndex');
    const boneCount = skeleton.bones.length;

    for (let i = 0; i < skinIndexAttr.count; i++) {
      const idx0 = skinIndexAttr.getX(i);
      const idx1 = skinIndexAttr.getY(i);
      const idx2 = skinIndexAttr.getZ(i);
      const idx3 = skinIndexAttr.getW(i);

      expect(Number.isInteger(idx0)).toBeTrue();
      expect(Number.isInteger(idx1)).toBeTrue();
      expect(Number.isInteger(idx2)).toBeTrue();
      expect(Number.isInteger(idx3)).toBeTrue();

      expect(idx0).toBeGreaterThanOrEqual(0);
      expect(idx0).toBeLessThan(boneCount);
      expect(idx1).toBeGreaterThanOrEqual(0);
      expect(idx1).toBeLessThan(boneCount);
      expect(idx2).toBeGreaterThanOrEqual(0);
      expect(idx2).toBeLessThan(boneCount);
      expect(idx3).toBeGreaterThanOrEqual(0);
      expect(idx3).toBeLessThan(boneCount);
    }
  });

  it('ensures every skinWeight sums to 1.0 (normalized)', () => {
    const mesh = buildCharacterBodyMesh(rig, skeleton);
    const skinWeightAttr = mesh.geometry.getAttribute('skinWeight');

    for (let i = 0; i < skinWeightAttr.count; i++) {
      const w0 = skinWeightAttr.getX(i);
      const w1 = skinWeightAttr.getY(i);
      const w2 = skinWeightAttr.getZ(i);
      const w3 = skinWeightAttr.getW(i);

      expect(w0).toBeGreaterThanOrEqual(0);
      expect(w1).toBeGreaterThanOrEqual(0);
      expect(w2).toBeGreaterThanOrEqual(0);
      expect(w3).toBeGreaterThanOrEqual(0);

      const sum = w0 + w1 + w2 + w3;
      expect(sum).toBeCloseTo(1.0, 3);
    }
  });

  it('generates geometry vertices falling within the rig rest bounding box with margin', () => {
    const mesh = buildCharacterBodyMesh(rig, skeleton);
    mesh.geometry.computeBoundingBox();
    const meshBox = mesh.geometry.boundingBox!;

    // Compute bounding box over all rig rest bone positions
    const rigBox = new Box3();
    for (const bone of rig.bones) {
      rigBox.expandByPoint(new Vector3(bone.restPosition.x, bone.restPosition.y, bone.restPosition.z));
    }
    // Expand by 0.25m margin for mesh thickness (head radius, limb radius, feet)
    rigBox.expandByScalar(0.25);

    expect(rigBox.containsBox(meshBox)).toBeTrue();
  });

  it('throws RangeError when skeleton is missing a required humanoid bone', () => {
    // Create a skeleton missing the head bone
    const incompleteBones = skeleton.bones.filter((b) => b.name !== HUMAN_BONE_NAMES.head);
    const incompleteSkeleton = new Skeleton(incompleteBones);

    expect(() => buildCharacterBodyMesh(rig, incompleteSkeleton)).toThrowError(
      RangeError,
      /Unresolved bone in skeleton/,
    );
  });

  it('generates deterministic geometry and colors for identical seeds', () => {
    const mesh1 = buildCharacterBodyMesh(rig, skeleton, { seed: 'same-seed' });
    const mesh2 = buildCharacterBodyMesh(rig, skeleton, { seed: 'same-seed' });

    const pos1 = mesh1.geometry.getAttribute('position');
    const pos2 = mesh2.geometry.getAttribute('position');
    const col1 = mesh1.geometry.getAttribute('color');
    const col2 = mesh2.geometry.getAttribute('color');

    expect(pos1.count).toBe(pos2.count);
    for (let i = 0; i < pos1.count * 3; i++) {
      expect(pos1.array[i]).toBe(pos2.array[i]);
      expect(col1.array[i]).toBe(col2.array[i]);
    }
  });

  it('samples variation for different seeds', () => {
    const mesh1 = buildCharacterBodyMesh(rig, skeleton, { seed: 'seed-alpha' });
    const mesh2 = buildCharacterBodyMesh(rig, skeleton, { seed: 'seed-omega' });

    const col1 = mesh1.geometry.getAttribute('color');
    const col2 = mesh2.geometry.getAttribute('color');

    let hasDifference = false;
    for (let i = 0; i < col1.count * 3; i++) {
      if (col1.array[i] !== col2.array[i]) {
        hasDifference = true;
        break;
      }
    }
    expect(hasDifference).toBeTrue();
  });

  it('supports finger count LOD options (0 mitten, 1 finger, 5 fingers)', () => {
    const meshMitten = buildCharacterBodyMesh(rig, skeleton, { fingerCount: 0 });
    const mesh1Finger = buildCharacterBodyMesh(rig, skeleton, { fingerCount: 1 });
    const mesh5Fingers = buildCharacterBodyMesh(rig, skeleton, { fingerCount: 5 });

    expect(meshMitten.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(mesh1Finger.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(mesh5Fingers.geometry.getAttribute('position').count).toBeGreaterThan(0);

    // 5 fingers mesh has more vertices than mitten
    expect(mesh5Fingers.geometry.getAttribute('position').count).toBeGreaterThan(
      meshMitten.geometry.getAttribute('position').count,
    );
  });

  it('includes ARKit face morph targets when includeFaceMorphs is true', () => {
    const mesh = buildCharacterBodyMesh(rig, skeleton, { includeFaceMorphs: true });

    expect(mesh.morphTargetDictionary).toBeDefined();
    expect(mesh.morphTargetInfluences).toBeDefined();
    expect(mesh.morphTargetDictionary!['jawOpen']).toBeDefined();
    expect(mesh.morphTargetDictionary!['mouthOpen']).toBeDefined();
    expect(mesh.morphTargetDictionary!['mouthSmile']).toBeDefined();
    expect(mesh.morphTargetDictionary!['eyeBlinkLeft']).toBeDefined();
    expect(mesh.morphTargetDictionary!['eyeBlinkRight']).toBeDefined();
    expect(mesh.morphTargetDictionary!['browDownLeft']).toBeDefined();
    expect(mesh.morphTargetDictionary!['browDownRight']).toBeDefined();

    const morphAttrs = mesh.geometry.morphAttributes['position'];
    expect(morphAttrs).toBeDefined();
    expect(morphAttrs?.length).toBe(7);
    expect(mesh.geometry.morphTargetsRelative).toBeTrue();
  });

  it('omits morph targets when includeFaceMorphs is false or omitted', () => {
    const mesh = buildCharacterBodyMesh(rig, skeleton, { includeFaceMorphs: false });

    expect(mesh.morphTargetDictionary).toBeUndefined();
    expect(mesh.geometry.morphAttributes['position']).toBeUndefined();
  });

  it('throws RangeError when triangle budget is exceeded', () => {
    expect(() =>
      buildCharacterBodyMesh(rig, skeleton, {
        maxTriangles: 10,
      }),
    ).toThrowError(RangeError, /triangle count/);
  });

  it('builds villager style with sculpted facial features and morph targets', () => {
    const mesh = buildCharacterBodyMesh(rig, skeleton, {
      style: 'villager',
      includeFaceMorphs: true,
    });
    expect(mesh.name).toBe('villager-body-mesh');
    expect(mesh.isSkinnedMesh).toBeTrue();
    expect(mesh.morphTargetDictionary!['jawOpen']).toBeDefined();

    const skinIndexAttr = mesh.geometry.getAttribute('skinIndex');
    const skinWeightAttr = mesh.geometry.getAttribute('skinWeight');
    expect(skinIndexAttr.count).toBeGreaterThan(0);

    // Verify all weights sum to 1.0
    for (let i = 0; i < skinWeightAttr.count; i++) {
      const sum = skinWeightAttr.getX(i) + skinWeightAttr.getY(i) + skinWeightAttr.getZ(i) + skinWeightAttr.getW(i);
      expect(sum).toBeCloseTo(1.0, 3);
    }
  });

  it('builds faceted-vector style with dynamic vectorFace canvas texture callback', () => {
    const mesh = buildCharacterBodyMesh(rig, skeleton, {
      style: 'faceted-vector',
      includeFaceMorphs: true,
    });
    expect(mesh.name).toBe('faceted-vector-mesh');
    expect(mesh.isSkinnedMesh).toBeTrue();
    expect(typeof mesh.userData['vectorFace']).toBe('function');

    // Verify calling vectorFace does not throw
    expect(() => mesh.userData['vectorFace']({ jawOpen: 0.5, mouthSmile: 0.8 })).not.toThrow();

    const skinWeightAttr = mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < skinWeightAttr.count; i++) {
      const sum = skinWeightAttr.getX(i) + skinWeightAttr.getY(i) + skinWeightAttr.getZ(i) + skinWeightAttr.getW(i);
      expect(sum).toBeCloseTo(1.0, 3);
    }
  });

  it('builds extruded-silhouette style with valid geometry and skinning', () => {
    const mesh = buildCharacterBodyMesh(rig, skeleton, {
      style: 'extruded-silhouette',
      includeFaceMorphs: true,
    });
    expect(mesh.name).toBe('extruded-silhouette-mesh');
    expect(mesh.isSkinnedMesh).toBeTrue();

    const skinWeightAttr = mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < skinWeightAttr.count; i++) {
      const sum = skinWeightAttr.getX(i) + skinWeightAttr.getY(i) + skinWeightAttr.getZ(i) + skinWeightAttr.getW(i);
      expect(sum).toBeCloseTo(1.0, 3);
    }
  });

  it('builds mannequin style for backward compatibility', () => {
    const mesh = buildCharacterBodyMesh(rig, skeleton, {
      style: 'mannequin',
      includeFaceMorphs: true,
    });
    expect(mesh.isSkinnedMesh).toBeTrue();
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });
});
