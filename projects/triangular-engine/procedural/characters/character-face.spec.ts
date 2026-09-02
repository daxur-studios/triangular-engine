import { SkinnedMesh } from 'three';
import {
  applyCharacterFacePose,
  arkitToCharacterFace,
  CHARACTER_FACE_MORPH_NAMES,
} from './character-face';

describe('character-face', () => {
  it('projects ARKit weights onto the seven procedural face morphs', () => {
    const face = arkitToCharacterFace({
      jawOpen: 0.5,
      mouthSmileLeft: 0.6,
      mouthStretchRight: 0.4,
      browDownLeft: 0.3,
      mouthFunnel: 0.8,
    });

    expect(face.jawOpen).toBeCloseTo(0.5, 6);
    expect(face.mouthSmile).toBeCloseTo(0.6, 6);
    expect(face.browDownLeft).toBeCloseTo(0.3, 6);
    expect(face.mouthOpen).toBeCloseTo(0.4, 6);
    expect(face.eyeBlinkLeft).toBe(0);
  });

  it('rounds lip shapes into a partial mouth open', () => {
    expect(arkitToCharacterFace({ mouthPucker: 0.7 }).mouthOpen).toBeCloseTo(0.35, 6);
    expect(arkitToCharacterFace({}).mouthOpen).toBe(0);
  });

  it('writes influences for the dictionary indices a mesh exposes', () => {
    const mesh = new SkinnedMesh();
    mesh.morphTargetDictionary = {
      jawOpen: 0,
      mouthOpen: 1,
      mouthSmile: 2,
      eyeBlinkLeft: 3,
      eyeBlinkRight: 4,
      browDownLeft: 5,
      browDownRight: 6,
    };
    mesh.morphTargetInfluences = [0, 0, 0, 0, 0, 0, 0];

    applyCharacterFacePose(mesh, { jawOpen: 0.5, mouthSmileLeft: 0.7 });

    expect(mesh.morphTargetInfluences[0]).toBeCloseTo(0.5, 6);
    expect(mesh.morphTargetInfluences[2]).toBeCloseTo(0.7, 6);
    expect(mesh.morphTargetInfluences[1]).toBe(0);
  });

  it('is a no-op on meshes without a morph dictionary', () => {
    const mesh = new SkinnedMesh();
    expect(() => applyCharacterFacePose(mesh, { jawOpen: 1 })).not.toThrow();
  });

  it('covers exactly the names the body mesh authorizes', () => {
    expect(CHARACTER_FACE_MORPH_NAMES).toHaveSize(7);
  });
});
