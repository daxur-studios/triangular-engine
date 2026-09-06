import { BoxGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Object3D } from 'three';
import {
  bindCharacterFace,
  normalizeMorphTargetName,
  type CharacterFaceBinding,
} from './face-mesh-binding';

describe('normalizeMorphTargetName', () => {
  it('recognizes canonical ARKit names directly', () => {
    expect(normalizeMorphTargetName('eyeBlinkLeft')).toBe('eyeBlinkLeft');
    expect(normalizeMorphTargetName('mouthSmileRight')).toBe('mouthSmileRight');
    expect(normalizeMorphTargetName('jawOpen')).toBe('jawOpen');
    expect(normalizeMorphTargetName('browInnerUp')).toBe('browInnerUp');
  });

  it('recognizes underscore and dot suffixes (_L, _R, .L, .R)', () => {
    expect(normalizeMorphTargetName('eyeBlink_L')).toBe('eyeBlinkLeft');
    expect(normalizeMorphTargetName('eyeBlink_R')).toBe('eyeBlinkRight');
    expect(normalizeMorphTargetName('mouthSmile_L')).toBe('mouthSmileLeft');
    expect(normalizeMorphTargetName('mouthSmile.R')).toBe('mouthSmileRight');
    expect(normalizeMorphTargetName('browDown_l')).toBe('browDownLeft');
  });

  it('strips namespace and mesh prefixes', () => {
    expect(normalizeMorphTargetName('blendShape1.eyeBlink_L')).toBe('eyeBlinkLeft');
    expect(normalizeMorphTargetName('blendShape1.browInnerUp')).toBe('browInnerUp');
    expect(normalizeMorphTargetName('head_mesh.jawOpen')).toBe('jawOpen');
    expect(normalizeMorphTargetName('BS:mouthSmile_R')).toBe('mouthSmileRight');
  });

  it('recognizes Oculus / VRM naming conventions', () => {
    expect(normalizeMorphTargetName('Eye_Blink_L')).toBe('eyeBlinkLeft');
    expect(normalizeMorphTargetName('Eye_Blink_R')).toBe('eyeBlinkRight');
    expect(normalizeMorphTargetName('Mouth_Smile_L')).toBe('mouthSmileLeft');
    expect(normalizeMorphTargetName('Cheek_Puff')).toBe('cheekPuff');
  });

  it('returns undefined for unrecognizable morph names', () => {
    expect(normalizeMorphTargetName('alien_antennae_stretch')).toBeUndefined();
    expect(normalizeMorphTargetName('wing_flap_left')).toBeUndefined();
  });
});

describe('bindCharacterFace', () => {
  function createMockMorphMesh(
    name: string,
    targetNames: readonly string[],
  ): Mesh {
    const geom = new BoxGeometry(1, 1, 1);
    const count = geom.attributes['position'].count;
    geom.morphAttributes['position'] = [];

    const dict: Record<string, number> = {};
    for (let i = 0; i < targetNames.length; i++) {
      dict[targetNames[i]] = i;
      geom.morphAttributes['position'].push(
        new Float32BufferAttribute(new Float32Array(count * 3), 3),
      );
    }

    const mesh = new Mesh(geom, new MeshBasicMaterial());
    mesh.name = name;
    mesh.morphTargetDictionary = dict;
    mesh.morphTargetInfluences = new Array(targetNames.length).fill(0);
    return mesh;
  }

  it('binds meshes and maps canonical names', () => {
    const root = new Group();
    const headMesh = createMockMorphMesh('head', [
      'blendShape1.eyeBlink_L',
      'blendShape1.eyeBlink_R',
      'blendShape1.mouthSmile_L',
      'blendShape1.mouthSmile_R',
      'jawOpen',
    ]);
    root.add(headMesh);

    const binding = bindCharacterFace(root);
    expect(binding.morphMeshes.length).toBe(1);
    expect(binding.recognizedMorphCount).toBe(5);

    binding.applyPose({
      eyeBlinkLeft: 0.8,
      mouthSmileRight: 0.6,
      jawOpen: 0.4,
    });

    const inf = headMesh.morphTargetInfluences!;
    expect(inf[0]).toBeCloseTo(0.8, 3); // eyeBlink_L
    expect(inf[1]).toBe(0); // eyeBlink_R
    expect(inf[2]).toBe(0); // mouthSmile_L
    expect(inf[3]).toBeCloseTo(0.6, 3); // mouthSmile_R
    expect(inf[4]).toBeCloseTo(0.4, 3); // jawOpen
  });

  it('discovers eye nodes and rotates them for gaze', () => {
    const root = new Group();
    const leftEye = new Object3D();
    leftEye.name = 'grp_eyeLeft';
    const rightEye = new Object3D();
    rightEye.name = 'grp_eyeRight';
    root.add(leftEye, rightEye);

    const binding = bindCharacterFace(root);
    expect(binding.leftEyeNode).toBe(leftEye);
    expect(binding.rightEyeNode).toBe(rightEye);

    // Apply positive yaw (looking character right) and positive pitch (looking up)
    binding.applyPose({}, { yaw: 0.2, pitch: 0.15 });

    // Quaternions should deviate from identity
    expect(leftEye.quaternion.y).not.toBe(0);
    expect(leftEye.quaternion.x).not.toBe(0);

    binding.reset();
    expect(leftEye.quaternion.x).toBe(0);
    expect(leftEye.quaternion.y).toBe(0);
    expect(leftEye.quaternion.z).toBe(0);
    expect(leftEye.quaternion.w).toBe(1);
  });

  it('drives ARKit eye morphs from gaze when enabled', () => {
    const root = new Group();
    const headMesh = createMockMorphMesh('head', [
      'eyeLookIn_L',
      'eyeLookOut_L',
      'eyeLookIn_R',
      'eyeLookOut_R',
      'eyeLookUp_L',
      'eyeLookDown_L',
      'eyeLookUp_R',
      'eyeLookDown_R',
    ]);
    root.add(headMesh);

    const binding = bindCharacterFace(root, { driveEyeMorphsFromGaze: true });

    // Looking character right (yaw > 0): left eye looks in, right eye looks out
    binding.applyPose({}, { yaw: 0.2615, pitch: 0 }); // half of 0.523 max yaw
    const inf = headMesh.morphTargetInfluences!;

    // eyeLookIn_L (index 0) should be ~0.5
    expect(inf[0]).toBeCloseTo(0.5, 1);
    // eyeLookOut_R (index 3) should be ~0.5
    expect(inf[3]).toBeCloseTo(0.5, 1);
    // eyeLookOut_L and eyeLookIn_R should be 0
    expect(inf[1]).toBe(0);
    expect(inf[2]).toBe(0);
  });

  it('resets all morph influences to 0 on reset()', () => {
    const root = new Group();
    const headMesh = createMockMorphMesh('head', ['eyeBlinkLeft', 'jawOpen']);
    root.add(headMesh);

    const binding = bindCharacterFace(root);
    binding.applyPose({ eyeBlinkLeft: 1, jawOpen: 0.5 });
    expect(headMesh.morphTargetInfluences![0]).toBe(1);

    binding.reset();
    expect(headMesh.morphTargetInfluences![0]).toBe(0);
    expect(headMesh.morphTargetInfluences![1]).toBe(0);
  });
});
