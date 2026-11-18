/**
 * Custom MeshStandardMaterial for the Capsule Doodle single-mesh head/torso.
 *
 * Implements:
 * 1. Parametric Skin / Spacesuit vertical split at `uSuitSplitY` with a subtle
 *    sculpted seam lip and AO crease.
 * 2. Procedural 2D Signed Distance Field (SDF) recessed mouth projected onto the
 *    front face of the capsule, morphing smoothly between `:|`, `:D`, `:O`, `D:`,
 *    and nervous wavy `~~~`, complete with dark interior cavity, top teeth bar
 *    (or split buck teeth), and pink tongue.
 */

import {
  Box3,
  CapsuleGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import {
  computeCapsuleMouthCenterY,
  type CapsuleCharacterDNA,
  type CapsuleSdfMouthUniforms,
} from 'triangular-engine/characters';

/**
 * GLSL for the capsule mouth outline, shared by the shaded body and the ID-colour body.
 *
 * Defines `sdRoundedBox2D` and `capsuleMouthDistance(mp, width, open, curve, wave, out q,
 * out halfW, out halfH, out openAmt)`. `mp` is the torso-frame point in face units
 * (`x / max(0.15, r)`, `(y - mouthCenterY) / max(0.15, r)`); the result is negative inside
 * the mouth. The framework-free probes in `triangular-engine/characters` mirror it.
 */
export const CAPSULE_MOUTH_SDF_GLSL = /* glsl */ `
float sdRoundedBox2D(vec2 p, vec2 b, vec4 r) {
  r.xy = (p.x > 0.0) ? r.xy : r.zw;
  r.x  = (p.y > 0.0) ? r.x  : r.y;
  vec2 q = abs(p) - b + r.x;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
}

float capsuleMouthDistance(
  vec2 mp, float mouthWidth, float mouthOpen, float mouthCurve, float mouthWave,
  out vec2 q, out float halfW, out float halfH, out float openAmt
) {
  halfW = clamp(mouthWidth * 0.34, 0.08, 0.42);
  openAmt = clamp(mouthOpen, 0.0, 1.0);
  halfH = mix(0.014, 0.19, openAmt);

  // Parabolic smile/frown curvature + optional nervous sine wave
  float xNorm = clamp(mp.x / max(0.05, halfW), -1.5, 1.5);
  float parabola = (xNorm * xNorm - 0.35) * mouthCurve * 0.085;
  float waveOffset = sin(mp.x * 28.0) * mouthWave * 0.024;
  q = vec2(mp.x, mp.y - parabola - waveOffset);

  // D-shape asymmetric corner radii:
  // Happy (:D, curve > 0): flatter top corners, deeply rounded bottom corners
  // Panicked/Sad (D:, curve < 0): deeply rounded top, flatter bottom
  float maxR = min(halfW, halfH) * 0.95;
  float topR = mix(maxR * 0.85, maxR * 0.28, clamp(mouthCurve, 0.0, 1.0));
  float botR = mix(maxR * 0.85, maxR * 0.28, clamp(-mouthCurve, 0.0, 1.0));
  return sdRoundedBox2D(q, vec2(halfW, halfH), vec4(topR, botR, topR, botR));
}
`;

export interface CapsuleBodyUniformMap {
  uSkinColor: { value: Color };
  uSuitColor: { value: Color };
  uSuitSplitY: { value: number };
  uMouthCenterY: { value: number };
  uBodyRadius: { value: number };
  uMouthOpen: { value: number };
  uMouthWidth: { value: number };
  uMouthCurve: { value: number };
  uMouthWave: { value: number };
  uBuckTeeth: { value: number };
  uTongueVisible: { value: number };
}

export interface CapsuleBodyMeshResult {
  readonly mesh: Mesh<CapsuleGeometry, MeshStandardMaterial>;
  readonly uniforms: CapsuleBodyUniformMap;
  readonly updateDna: (dna: CapsuleCharacterDNA) => void;
  readonly updateMouth: (mouth: CapsuleSdfMouthUniforms) => void;
  /** Computes the local-space 3D bounding box of the 2D SDF mouth directly from current shader uniforms. */
  readonly getMouthLocalBounds: (target?: Box3) => Box3;
  /** Computes the world-space 3D bounding box of the 2D SDF mouth using `mesh.matrixWorld`. */
  readonly getMouthWorldBounds: (target?: Box3) => Box3;
}

/**
 * Derives the exact local-space 3D bounding box of the front-projected 2D SDF mouth
 * directly from the shader uniforms (`uBodyRadius`, `uMouthCenterY`, `uMouthWidth`,
 * `uMouthOpen`, `uMouthCurve`, `uMouthWave`), including the parabolic smile/frown
 * vertical excursion and outer rim shadow margin.
 */
export function computeCapsuleMouthLocalBounds(
  uniforms: CapsuleBodyUniformMap,
  target = new Box3(),
): Box3 {
  const r = Math.max(0.15, uniforms.uBodyRadius.value);
  const centerY = uniforms.uMouthCenterY.value;
  const widthNorm = Math.max(0.08, Math.min(0.42, uniforms.uMouthWidth.value * 0.34));
  const openAmt = Math.max(0, Math.min(1, uniforms.uMouthOpen.value));
  const halfH = 0.014 + (0.19 - 0.014) * openAmt;
  const curve = uniforms.uMouthCurve.value;
  const minParabola = Math.min(-0.35 * curve, 0.65 * curve) * 0.085;
  const maxParabola = Math.max(-0.35 * curve, 0.65 * curve) * 0.085;
  const wavePad = Math.abs(uniforms.uMouthWave.value) * 0.024;
  const rimPad = 0.026;

  const xHalf = Math.min(r * 0.96, (widthNorm + rimPad) * r);
  const yMin = centerY + (minParabola - halfH - wavePad - rimPad) * r;
  const yMax = centerY + (maxParabola + halfH + wavePad + rimPad) * r;
  const zMin = Math.sqrt(Math.max(0.04, r * r - xHalf * xHalf));
  const zMax = r * 1.015;

  target.min.set(-xHalf, yMin, zMin);
  target.max.set(xHalf, yMax, zMax);
  return target;
}

export function createCapsuleBodyUniforms(dna: CapsuleCharacterDNA): CapsuleBodyUniformMap {
  const mouthCenterY = computeCapsuleMouthCenterY(dna);
  return {
    uSkinColor: { value: new Color(dna.skinTone) },
    uSuitColor: { value: new Color(dna.suitColor) },
    uSuitSplitY: { value: dna.suitSplitY },
    uMouthCenterY: { value: mouthCenterY },
    uBodyRadius: { value: dna.bodyRadius },
    uMouthOpen: { value: 0.12 },
    uMouthWidth: { value: 0.62 },
    uMouthCurve: { value: 0.25 },
    uMouthWave: { value: 0.0 },
    uBuckTeeth: { value: dna.buckTeeth ? 1.0 : 0.0 },
    uTongueVisible: { value: 0.2 },
  };
}

/**
 * Creates a `MeshStandardMaterial` augmented via `onBeforeCompile` with the
 * Capsule Doodle skin/suit split and 2D SDF mouth shader.
 */
export function createCapsuleBodyMaterial(
  dna: CapsuleCharacterDNA,
): { material: MeshStandardMaterial; uniforms: CapsuleBodyUniformMap } {
  const uniforms = createCapsuleBodyUniforms(dna);

  const material = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.04,
  });

  material.customProgramCacheKey = () => 'capsule-doodle-body-sdf-v1';

  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vCapsuleLocalPos;
varying vec3 vCapsuleLocalNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vCapsuleLocalPos = position;
vCapsuleLocalNormal = normal;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vCapsuleLocalPos;
varying vec3 vCapsuleLocalNormal;

uniform vec3 uSkinColor;
uniform vec3 uSuitColor;
uniform float uSuitSplitY;
uniform float uMouthCenterY;
uniform float uBodyRadius;
uniform float uMouthOpen;
uniform float uMouthWidth;
uniform float uMouthCurve;
uniform float uMouthWave;
uniform float uBuckTeeth;
uniform float uTongueVisible;

${CAPSULE_MOUTH_SDF_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // 1. Skin vs Spacesuit split along local Y
  float seamDist = vCapsuleLocalPos.y - uSuitSplitY;
  float seamEdge = fwidth(seamDist) * 1.5 + 0.003;
  float isSkin = smoothstep(-seamEdge, seamEdge, seamDist);
  vec3 baseCol = mix(uSuitColor, uSkinColor, isSkin);

  // Subtle suit lip shadow & highlight right at the seam
  float seamBand = exp(-abs(seamDist) * 140.0);
  float seamLipHighlight = exp(-pow((seamDist + 0.008) * 180.0, 2.0));
  baseCol *= (1.0 - seamBand * 0.14);
  baseCol += vec3(seamLipHighlight * 0.06);

  // 2. Front-facing 2D SDF Mouth projection
  if (vCapsuleLocalPos.z > uBodyRadius * 0.25) {
    // Normalize face coordinates relative to bodyRadius
    vec2 mp = vec2(
      vCapsuleLocalPos.x / max(0.15, uBodyRadius),
      (vCapsuleLocalPos.y - uMouthCenterY) / max(0.15, uBodyRadius)
    );

    vec2 q;
    float halfW;
    float halfH;
    float openAmt;
    float dMouth = capsuleMouthDistance(mp, uMouthWidth, uMouthOpen, uMouthCurve, uMouthWave, q, halfW, halfH, openAmt);
    float aa = max(fwidth(dMouth) * 1.35, 0.004);

    // Subtle outer lip crease / shadow around mouth rim
    float rimShadow = smoothstep(0.022, 0.0, abs(dMouth)) * 0.12;
    baseCol *= (1.0 - rimShadow);

    if (dMouth < aa) {
      float mouthMask = 1.0 - smoothstep(-aa, aa, dMouth);

      // Dark oral cavity interior with subtle top-down depth gradient
      vec3 cavityCol = mix(vec3(0.11, 0.04, 0.05), vec3(0.18, 0.07, 0.08), clamp((q.y + halfH) / max(0.02, 2.0 * halfH), 0.0, 1.0));
      vec3 interiorCol = cavityCol;

      if (openAmt > 0.08) {
        // Pink tongue circle at the bottom of the cavity
        vec2 tongueCenter = vec2(0.0, -halfH * 0.95);
        float dTongue = length((q - tongueCenter) * vec2(0.82, 1.15)) - halfW * 0.62;
        float tongueMask = (1.0 - smoothstep(-aa, aa, dTongue)) * uTongueVisible;
        vec3 tongueCol = mix(vec3(0.86, 0.33, 0.40), vec3(0.95, 0.48, 0.54), clamp((q.y + halfH) * 4.0, 0.0, 1.0));
        interiorCol = mix(interiorCol, tongueCol, tongueMask);

        // White upper teeth along top rim (either full bar or split buck teeth)
        float teethHeight = min(halfH * 0.52, 0.058);
        float teethY = q.y - (halfH - teethHeight * 0.55);
        float dTeeth;
        if (uBuckTeeth > 0.5) {
          // Two prominent rounded buck teeth separated by a small center gap
          vec2 bp = vec2(abs(q.x) - halfW * 0.21, teethY);
          dTeeth = sdRoundedBox2D(bp, vec2(halfW * 0.17, teethHeight * 0.82), vec4(0.015));
        } else {
          // Standard wide top teeth bar
          dTeeth = sdRoundedBox2D(vec2(q.x, teethY), vec2(halfW * 0.76, teethHeight * 0.65), vec4(0.018));
        }
        float teethMask = 1.0 - smoothstep(-aa, aa, dTeeth);
        vec3 teethCol = vec3(0.98, 0.97, 0.95);
        interiorCol = mix(interiorCol, teethCol, teethMask);
      }

      // Inner lip ambient occlusion right inside the mouth boundary
      float innerRim = smoothstep(-0.025, 0.0, dMouth);
      interiorCol *= (1.0 - innerRim * 0.28);

      baseCol = mix(baseCol, interiorCol, mouthMask);
    }
  }

  diffuseColor.rgb = baseCol;
}`,
      );
  };

  return { material, uniforms };
}

/**
 * Builds the single-mesh capsule body with the skin/suit split and 2D SDF mouth shader.
 */
export function buildCapsuleBodyMesh(dna: CapsuleCharacterDNA): CapsuleBodyMeshResult {
  const geometry = new CapsuleGeometry(dna.bodyRadius, dna.bodyHeight, 24, 48);
  const { material, uniforms } = createCapsuleBodyMaterial(dna);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'capsule-doodle-body';
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const updateDna = (nextDna: CapsuleCharacterDNA): void => {
    uniforms.uSkinColor.value.set(nextDna.skinTone);
    uniforms.uSuitColor.value.set(nextDna.suitColor);
    uniforms.uSuitSplitY.value = nextDna.suitSplitY;
    uniforms.uMouthCenterY.value = computeCapsuleMouthCenterY(nextDna);
    uniforms.uBodyRadius.value = nextDna.bodyRadius;
    uniforms.uBuckTeeth.value = nextDna.buckTeeth ? 1.0 : 0.0;
  };

  const updateMouth = (mouth: CapsuleSdfMouthUniforms): void => {
    uniforms.uMouthOpen.value = mouth.mouthOpen;
    uniforms.uMouthWidth.value = mouth.mouthWidth;
    uniforms.uMouthCurve.value = mouth.mouthCurve;
    uniforms.uMouthWave.value = mouth.mouthWave;
    uniforms.uBuckTeeth.value = mouth.buckTeeth;
    uniforms.uTongueVisible.value = mouth.tongueVisible;
  };

  const getMouthLocalBounds = (target = new Box3()): Box3 =>
    computeCapsuleMouthLocalBounds(uniforms, target);

  const getMouthWorldBounds = (target = new Box3()): Box3 => {
    mesh.updateWorldMatrix(true, false);
    computeCapsuleMouthLocalBounds(uniforms, target);
    target.applyMatrix4(mesh.matrixWorld);
    return target;
  };

  return {
    mesh,
    uniforms,
    updateDna,
    updateMouth,
    getMouthLocalBounds,
    getMouthWorldBounds,
  };
}
