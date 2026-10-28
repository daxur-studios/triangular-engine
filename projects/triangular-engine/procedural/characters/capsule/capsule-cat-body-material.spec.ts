import { Vector3 } from 'three';
import {
  CAPSULE_CAT_PRESETS,
  DEFAULT_CAPSULE_CAT_DNA,
  type CapsuleCatSdfMouthUniforms,
} from 'triangular-engine/characters';
import {
  buildCapsuleCatBodyMesh,
  createCapsuleCatBodyUniforms,
} from './capsule-cat-body-material';

describe('capsule-cat-body-material', () => {
  it('builds a horizontal capsule whose long axis follows local Z', () => {
    const result = buildCapsuleCatBodyMesh(DEFAULT_CAPSULE_CAT_DNA);
    result.mesh.geometry.computeBoundingBox();
    const size = new Vector3();
    result.mesh.geometry.boundingBox!.getSize(size);

    expect(size.z).toBeGreaterThan(size.y);
    expect(size.z).toBeCloseTo(DEFAULT_CAPSULE_CAT_DNA.bodyLength + DEFAULT_CAPSULE_CAT_DNA.bodyRadius * 2, 4);
    result.mesh.geometry.dispose();
    result.mesh.material.dispose();
  });

  it('maps all three body patterns to shader ids and derives the neck/hip planes', () => {
    const front = createCapsuleCatBodyUniforms({
      ...DEFAULT_CAPSULE_CAT_DNA,
      bodyPattern: 'front_suit',
    });
    const full = createCapsuleCatBodyUniforms({
      ...DEFAULT_CAPSULE_CAT_DNA,
      bodyPattern: 'full_suit',
    });
    const natural = createCapsuleCatBodyUniforms({
      ...DEFAULT_CAPSULE_CAT_DNA,
      bodyPattern: 'natural_two_tone',
    });

    expect(front.uPattern.value).toBe(0);
    expect(full.uPattern.value).toBe(1);
    expect(natural.uPattern.value).toBe(2);
    expect(front.uNeckZ.value).toBe(DEFAULT_CAPSULE_CAT_DNA.bodyLength * 0.5);
    expect(front.uHipZ.value).toBe(-DEFAULT_CAPSULE_CAT_DNA.bodyLength * 0.1);
  });

  it('forwards the projected cat mouth uniforms', () => {
    const result = buildCapsuleCatBodyMesh(DEFAULT_CAPSULE_CAT_DNA);
    const mouth: CapsuleCatSdfMouthUniforms = {
      mouthOpen: 0.7,
      mouthWidth: 0.55,
      mouthCurve: 0.4,
      meow: 0.8,
      tongueVisible: 0.6,
    };
    result.updateMouth(mouth);

    expect(result.uniforms.uMouthOpen.value).toBe(0.7);
    expect(result.uniforms.uMouthWidth.value).toBe(0.55);
    expect(result.uniforms.uMouthCurve.value).toBe(0.4);
    expect(result.uniforms.uMouthMeow.value).toBe(0.8);
    expect(result.uniforms.uTongueVisible.value).toBe(0.6);

    result.mesh.geometry.dispose();
    result.mesh.material.dispose();
  });

  it('rebuilds cleanly for every concept-sheet cat preset', () => {
    for (const preset of CAPSULE_CAT_PRESETS) {
      const result = buildCapsuleCatBodyMesh(preset);
      expect(result.uniforms.uBodyRadius.value).toBe(preset.bodyRadius);
      expect(result.uniforms.uMouthCenterY.value).toBeCloseTo(-preset.bodyRadius * 0.18, 5);
      result.mesh.geometry.dispose();
      result.mesh.material.dispose();
    }
  });
});
