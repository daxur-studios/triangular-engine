/**
 * Custom MeshStandardMaterial for the horizontal Capsule Cat head/torso capsule.
 *
 * Implements:
 * 1. Three parametric suit/fur patterns painted along the forward Z axis:
 *    `front_suit`, `full_suit` and the bare `natural_two_tone`.
 * 2. A projected 2D Signed Distance Field cat mouth on the front cap that morphs
 *    between the classic twin-arch `:3` / omega mouth, an open `MEOW` oval and a
 *    happy open `:D`, with philtrum and pink tongue.
 */

import {
  CapsuleGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type {
  CapsuleCatBodyPatternId,
  CapsuleCatCharacterDNA,
  CapsuleCatSdfMouthUniforms,
} from 'triangular-engine/characters';

export interface CapsuleCatBodyUniformMap {
  uFurColor: { value: Color };
  uFurAccentColor: { value: Color };
  uSuitColor: { value: Color };
  uSuitTrimColor: { value: Color };
  uPattern: { value: number };
  uNeckZ: { value: number };
  uHipZ: { value: number };
  uBodyRadius: { value: number };
  uMouthCenterY: { value: number };
  uMouthOpen: { value: number };
  uMouthWidth: { value: number };
  uMouthCurve: { value: number };
  uMouthMeow: { value: number };
  uTongueVisible: { value: number };
}

export interface CapsuleCatBodyMeshResult {
  readonly mesh: Mesh<CapsuleGeometry, MeshStandardMaterial>;
  readonly uniforms: CapsuleCatBodyUniformMap;
  readonly updateDna: (dna: CapsuleCatCharacterDNA) => void;
  readonly updateMouth: (mouth: CapsuleCatSdfMouthUniforms) => void;
}

function patternToFloat(pattern: CapsuleCatBodyPatternId): number {
  if (pattern === 'full_suit') return 1;
  if (pattern === 'natural_two_tone') return 2;
  return 0;
}

export function createCapsuleCatBodyUniforms(dna: CapsuleCatCharacterDNA): CapsuleCatBodyUniformMap {
  return {
    uFurColor: { value: new Color(dna.furColor) },
    uFurAccentColor: { value: new Color(dna.furAccentColor) },
    uSuitColor: { value: new Color(dna.suitColor) },
    uSuitTrimColor: { value: new Color(dna.suitTrimColor) },
    uPattern: { value: patternToFloat(dna.bodyPattern) },
    uNeckZ: { value: dna.bodyLength * 0.5 },
    uHipZ: { value: -dna.bodyLength * 0.1 },
    uBodyRadius: { value: dna.bodyRadius },
    uMouthCenterY: { value: -dna.bodyRadius * 0.18 },
    uMouthOpen: { value: dna.restMouthPose === 'meow' ? 0.5 : 0.05 },
    uMouthWidth: { value: 0.6 },
    uMouthCurve: { value: 0.35 },
    uMouthMeow: { value: dna.restMouthPose === 'meow' ? 0.82 : 0 },
    uTongueVisible: { value: dna.restMouthPose === 'meow' ? 0.8 : 0 },
  };
}

/**
 * Creates a `MeshStandardMaterial` augmented via `onBeforeCompile` with the cat
 * suit/fur pattern and 2D SDF omega mouth shader.
 */
export function createCapsuleCatBodyMaterial(
  dna: CapsuleCatCharacterDNA,
): { material: MeshStandardMaterial; uniforms: CapsuleCatBodyUniformMap } {
  const uniforms = createCapsuleCatBodyUniforms(dna);

  const material = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.65,
    metalness: 0.02,
  });

  material.customProgramCacheKey = () => 'capsule-cat-body-sdf-v2';

  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vCatLocalPos;
varying vec3 vCatLocalNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vCatLocalPos = position;
vCatLocalNormal = normal;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vCatLocalPos;
varying vec3 vCatLocalNormal;

uniform vec3 uFurColor;
uniform vec3 uFurAccentColor;
uniform vec3 uSuitColor;
uniform vec3 uSuitTrimColor;
uniform float uPattern;
uniform float uNeckZ;
uniform float uHipZ;
uniform float uBodyRadius;
uniform float uMouthCenterY;
uniform float uMouthOpen;
uniform float uMouthWidth;
uniform float uMouthCurve;
uniform float uMouthMeow;
uniform float uTongueVisible;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float r = max(0.1, uBodyRadius);
  float z = vCatLocalPos.z;
  float edge = fwidth(z) * 1.5 + 0.003;

  float headMask = smoothstep(uNeckZ - edge, uNeckZ + edge, z);
  float hipMask = smoothstep(uHipZ - edge, uHipZ + edge, z);

  vec3 baseCol;
  if (uPattern < 0.5) {
    // Fur head, white suit mid-torso, fur hind/rump.
    float suitMask = hipMask * (1.0 - headMask);
    baseCol = mix(uFurColor, uSuitColor, suitMask);
  } else if (uPattern < 1.5) {
    // Fur head and full white spacesuit behind neck collar.
    baseCol = mix(uSuitColor, uFurColor, headMask);
  } else {
    // Natural bare two-tone fur with soft seam at mid-torso.
    float seam = smoothstep(-0.06, 0.06, z / r);
    baseCol = mix(uFurAccentColor, uFurColor, seam);
    float naturalSeam = exp(-pow(z * 90.0, 2.0));
    baseCol *= (1.0 - naturalSeam * 0.06);
  }

  // Sculpted collar & hip seam crease / highlight when suited
  if (uPattern < 1.5) {
    float neckCrease = exp(-pow((z - uNeckZ) * 160.0, 2.0));
    float hipCrease = exp(-pow((z - uHipZ) * 160.0, 2.0));
    baseCol *= (1.0 - (neckCrease + hipCrease) * 0.14);
    baseCol += vec3(min(0.06, neckCrease * 0.04));
  }

  // 2D SDF Cat Mouth on the front snout cap (below the nose button)
  if (z > uNeckZ && vCatLocalNormal.z > 0.12) {
    vec2 mp = vec2(
      vCatLocalPos.x / r,
      (vCatLocalPos.y - uMouthCenterY) / r
    );

    float halfW = clamp(uMouthWidth * 0.32, 0.08, 0.38);
    float openAmt = clamp(uMouthOpen, 0.0, 1.0);
    float meowAmt = clamp(uMouthMeow, 0.0, 1.0);
    float halfH = mix(0.014, 0.16, openAmt) * mix(1.0, 1.25, meowAmt);

    float archR = halfW * mix(0.50, 0.42, meowAmt);
    float xNorm = clamp(mp.x / max(0.05, halfW), -1.5, 1.5);
    float curveY = (1.0 - xNorm * xNorm) * uMouthCurve * 0.05;

    // Twin-arch omega upper lip
    vec2 archP = vec2(abs(mp.x) - archR, mp.y - curveY);
    float dArch = max(abs(length(archP) - archR) - mix(0.014, 0.020, meowAmt), archP.y);

    // Philtrum seam connecting from nose down to the twin arches
    float dPhiltrum = max(abs(mp.x) - 0.009, -(mp.y - curveY));
    dPhiltrum = max(dPhiltrum, (mp.y - curveY) - 0.14);
    float dClosedMouth = min(dArch, dPhiltrum);

    // Oval lower cavity for open mouth / meow
    vec2 ovalP = vec2(
      mp.x / max(0.02, halfW),
      (mp.y - curveY + halfH * 0.28) / max(0.02, halfH)
    );
    float dOval = (length(ovalP) - 1.0) * min(halfW, halfH);

    float openBlend = smoothstep(0.04, 0.30, openAmt);
    float dMouth = mix(dClosedMouth, dOval, openBlend);
    float aa = max(fwidth(dMouth) * 1.35, 0.004);

    float rimShadow = smoothstep(0.025, 0.0, abs(dMouth)) * mix(0.06, 0.14, openBlend);
    baseCol *= (1.0 - rimShadow);

    if (dMouth < aa) {
      float mouthMask = 1.0 - smoothstep(-aa, aa, dMouth);
      vec3 cavity = mix(
        vec3(0.14, 0.05, 0.07),
        vec3(0.24, 0.09, 0.11),
        clamp((mp.y - curveY + halfH) / max(0.02, 2.0 * halfH), 0.0, 1.0)
      );
      vec3 interior = cavity;

      if (openBlend > 0.05) {
        vec2 tongueCenter = vec2(0.0, curveY - halfH * 0.60);
        float dTongue = length(
          (vec2(mp.x, mp.y - curveY) - tongueCenter) * vec2(0.9, 1.15)
        ) - halfW * 0.58;
        float tongueMask = (1.0 - smoothstep(-aa, aa, dTongue)) * uTongueVisible;
        vec3 tongue = mix(vec3(0.86, 0.32, 0.42), vec3(0.98, 0.48, 0.56), 0.5);
        interior = mix(interior, tongue, tongueMask);
      }

      baseCol = mix(baseCol, interior, mouthMask);
    }

    // Keep the twin-arch lip line defined over an open meow
    float lipLine = abs(length(archP) - archR) - mix(0.012, 0.016, openBlend);
    lipLine = max(lipLine, archP.y);
    float lipMask = (1.0 - smoothstep(-aa, aa, lipLine)) * mix(0.65, 0.95, openBlend);
    baseCol = mix(baseCol, vec3(0.18, 0.07, 0.08), lipMask);
  }

  diffuseColor.rgb = baseCol;
}`,
      );
  };

  return { material, uniforms };
}

/**
 * Builds the horizontal capsule body (head + torso) with the suit/fur pattern and
 * cat SDF mouth. The geometry is rotated so its long axis follows local +Z.
 */
export function buildCapsuleCatBodyMesh(dna: CapsuleCatCharacterDNA): CapsuleCatBodyMeshResult {
  const geometry = new CapsuleGeometry(dna.bodyRadius, dna.bodyLength, 32, 48);
  geometry.rotateX(Math.PI * 0.5);
  const { material, uniforms } = createCapsuleCatBodyMaterial(dna);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'capsule-cat-body';
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const updateDna = (nextDna: CapsuleCatCharacterDNA): void => {
    uniforms.uFurColor.value.set(nextDna.furColor);
    uniforms.uFurAccentColor.value.set(nextDna.furAccentColor);
    uniforms.uSuitColor.value.set(nextDna.suitColor);
    uniforms.uSuitTrimColor.value.set(nextDna.suitTrimColor);
    uniforms.uPattern.value = patternToFloat(nextDna.bodyPattern);
    uniforms.uNeckZ.value = nextDna.bodyLength * 0.5;
    uniforms.uHipZ.value = -nextDna.bodyLength * 0.1;
    uniforms.uBodyRadius.value = nextDna.bodyRadius;
    uniforms.uMouthCenterY.value = -nextDna.bodyRadius * 0.18;
  };

  const updateMouth = (mouth: CapsuleCatSdfMouthUniforms): void => {
    uniforms.uMouthOpen.value = mouth.mouthOpen;
    uniforms.uMouthWidth.value = mouth.mouthWidth;
    uniforms.uMouthCurve.value = mouth.mouthCurve;
    uniforms.uMouthMeow.value = mouth.meow;
    uniforms.uTongueVisible.value = mouth.tongueVisible;
  };

  return {
    mesh,
    uniforms,
    updateDna,
    updateMouth,
  };
}
