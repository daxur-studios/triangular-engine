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
  CapsuleGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type {
  CapsuleCharacterDNA,
  CapsuleSdfMouthUniforms,
} from 'triangular-engine/characters';

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
}

export function createCapsuleBodyUniforms(dna: CapsuleCharacterDNA): CapsuleBodyUniformMap {
  const mouthCenterY = dna.suitSplitY + dna.bodyHeight * 0.16;
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

float sdRoundedBox2D(vec2 p, vec2 b, vec4 r) {
  r.xy = (p.x > 0.0) ? r.xy : r.zw;
  r.x  = (p.y > 0.0) ? r.x  : r.y;
  vec2 q = abs(p) - b + r.x;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
}`,
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

    float halfW = clamp(uMouthWidth * 0.34, 0.08, 0.42);
    float openAmt = clamp(uMouthOpen, 0.0, 1.0);
    float halfH = mix(0.014, 0.19, openAmt);

    // Parabolic smile/frown curvature + optional nervous sine wave
    float xNorm = clamp(mp.x / max(0.05, halfW), -1.5, 1.5);
    float parabola = (xNorm * xNorm - 0.35) * uMouthCurve * 0.085;
    float waveOffset = sin(mp.x * 28.0) * uMouthWave * 0.024;
    vec2 q = vec2(mp.x, mp.y - parabola - waveOffset);

    // D-shape asymmetric corner radii:
    // Happy (:D, uMouthCurve > 0): flatter top corners, deeply rounded bottom corners
    // Panicked/Sad (D:, uMouthCurve < 0): deeply rounded top, flatter bottom
    float maxR = min(halfW, halfH) * 0.95;
    float topR = mix(maxR * 0.85, maxR * 0.28, clamp(uMouthCurve, 0.0, 1.0));
    float botR = mix(maxR * 0.85, maxR * 0.28, clamp(-uMouthCurve, 0.0, 1.0));
    vec4 cornerRadii = vec4(topR, botR, topR, botR);

    float dMouth = sdRoundedBox2D(q, vec2(halfW, halfH), cornerRadii);
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
    uniforms.uMouthCenterY.value = nextDna.suitSplitY + nextDna.bodyHeight * 0.16;
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

  return {
    mesh,
    uniforms,
    updateDna,
    updateMouth,
  };
}
