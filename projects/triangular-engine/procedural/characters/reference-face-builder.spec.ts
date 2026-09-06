import {
  REFERENCE_FACE_MORPH_NAMES,
  buildReferenceFaceMesh,
} from './reference-face-builder';

describe('reference-face-builder', () => {
  it('builds a reference face with a head mesh and seated eye assemblies', () => {
    const face = buildReferenceFaceMesh();
    expect(face.root).toBeDefined();
    expect(face.headMesh).toBeDefined();
    expect(face.leftEye).toBeDefined();
    expect(face.rightEye).toBeDefined();
    expect(face.root.children).toContain(face.headMesh);
    expect(face.root.children).toContain(face.leftEye);
    expect(face.root.children).toContain(face.rightEye);
  });

  it('exposes all 17 target morph names in dictionary and geometry', () => {
    const face = buildReferenceFaceMesh();
    expect(REFERENCE_FACE_MORPH_NAMES).toHaveSize(17);
    for (const name of REFERENCE_FACE_MORPH_NAMES) {
      expect(face.morphTargetDictionary[name]).toBeDefined();
    }
    expect(face.headMesh.geometry.morphAttributes.position).toHaveSize(17);
  });

  it('applies expressions, speech visemes, and gaze rotations cleanly via applyPose', () => {
    const face = buildReferenceFaceMesh();
    face.applyPose(
      {
        mouthSmileLeft: 0.8,
        mouthSmileRight: 0.8,
        jawOpen: 0.6,
        mouthClose: 0.4,
        mouthPucker: 0.7,
        eyeBlinkLeft: 1.0,
        browOuterUpRight: 0.9,
      },
      {
        left: { yaw: 0.25, pitch: -0.15 },
        right: { yaw: 0.25, pitch: -0.15 },
      },
    );

    const inf = face.headMesh.morphTargetInfluences!;
    expect(inf[face.morphTargetDictionary.mouthSmile]).toBeCloseTo(0.8, 4);
    expect(inf[face.morphTargetDictionary.jawOpen]).toBeCloseTo(0.6, 4);
    expect(inf[face.morphTargetDictionary.mouthClose]).toBeCloseTo(0.4, 4);
    expect(inf[face.morphTargetDictionary.mouthRound]).toBeCloseTo(0.7, 4);
    expect(inf[face.morphTargetDictionary.eyeBlinkLeft]).toBeCloseTo(1.0, 4);
    expect(inf[face.morphTargetDictionary.eyeBlinkRight]).toBe(0);
    expect(inf[face.morphTargetDictionary.browUpRight]).toBeCloseTo(0.9, 4);
    expect(inf[face.morphTargetDictionary.browUpLeft]).toBe(0);

    // Eye rotations
    expect(face.leftEye.rotation.y).toBeCloseTo(0.25, 4);
    expect(face.leftEye.rotation.x).toBeCloseTo(-0.15, 4);
    expect(face.rightEye.rotation.y).toBeCloseTo(0.25, 4);
    expect(face.rightEye.rotation.x).toBeCloseTo(-0.15, 4);
  });

  it('preserves eyeball position relative to eye socket during rotation', () => {
    const face = buildReferenceFaceMesh({ headRadius: 0.12 });
    const initialPos = face.leftEye.position.clone();

    face.applyPose(
      {},
      {
        left: { yaw: 0.52, pitch: -0.35 },
        right: { yaw: 0.52, pitch: -0.35 },
      },
    );

    // Seated center does not shift or pop out of socket!
    expect(face.leftEye.position.x).toBeCloseTo(initialPos.x, 6);
    expect(face.leftEye.position.y).toBeCloseTo(initialPos.y, 6);
    expect(face.leftEye.position.z).toBeCloseTo(initialPos.z, 6);
  });
});
