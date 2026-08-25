import {
  Color,
  DoubleSide,
  ShaderMaterial,
  Vector3,
  Vector4,
} from 'three';
import { ICelestialBody } from 'triangular-engine/celestial';

export interface ICdlodTerrainPalette {
  id: string;
  name: string;
  lowlandColor: [number, number, number];
  midlandColor: [number, number, number];
  highlandColor: [number, number, number];
  peakColor: [number, number, number];
  cliffColor: [number, number, number];
  cliffHighColor: [number, number, number];
  shorelineColor: [number, number, number];
  seabedColor: [number, number, number];
  cliffSlopeThreshold: number;
  strataFrequency: number;
  snowElevationNorm: number;
}

export const TERRAIN_PALETTES: Readonly<Record<string, ICdlodTerrainPalette>> = {
  'home-planet': {
    id: 'home-planet',
    name: 'Temperate Continental',
    lowlandColor: [0.24, 0.52, 0.18],
    midlandColor: [0.10, 0.32, 0.12],
    highlandColor: [0.38, 0.34, 0.30],
    peakColor: [0.96, 0.97, 0.99],
    cliffColor: [0.38, 0.34, 0.30],
    cliffHighColor: [0.24, 0.22, 0.20],
    shorelineColor: [0.74, 0.66, 0.48],
    seabedColor: [0.18, 0.26, 0.28],
    cliffSlopeThreshold: 0.72,
    strataFrequency: 0.1,
    snowElevationNorm: 0.65,
  },
  'alpine-planet': {
    id: 'alpine-planet',
    name: 'Alpine Glacial',
    lowlandColor: [0.16, 0.38, 0.18],
    midlandColor: [0.28, 0.48, 0.22],
    highlandColor: [0.35, 0.36, 0.40],
    peakColor: [0.98, 0.98, 1.0],
    cliffColor: [0.28, 0.30, 0.34],
    cliffHighColor: [0.18, 0.20, 0.24],
    shorelineColor: [0.65, 0.68, 0.62],
    seabedColor: [0.12, 0.22, 0.28],
    cliffSlopeThreshold: 0.76,
    strataFrequency: 0.08,
    snowElevationNorm: 0.52,
  },
  'canyon-planet': {
    id: 'canyon-planet',
    name: 'Arid Canyon / Rift',
    lowlandColor: [0.58, 0.26, 0.16],
    midlandColor: [0.72, 0.48, 0.28],
    highlandColor: [0.82, 0.62, 0.40],
    peakColor: [0.90, 0.82, 0.65],
    cliffColor: [0.42, 0.18, 0.12],
    cliffHighColor: [0.62, 0.28, 0.18],
    shorelineColor: [0.75, 0.55, 0.35],
    seabedColor: [0.35, 0.18, 0.12],
    cliffSlopeThreshold: 0.82,
    strataFrequency: 0.18,
    snowElevationNorm: 1.0,
  },
  'archipelago-planet': {
    id: 'archipelago-planet',
    name: 'Tropical Archipelago',
    lowlandColor: [0.15, 0.60, 0.22],
    midlandColor: [0.28, 0.52, 0.25],
    highlandColor: [0.32, 0.36, 0.30],
    peakColor: [0.48, 0.45, 0.40],
    cliffColor: [0.20, 0.20, 0.22],
    cliffHighColor: [0.34, 0.34, 0.38],
    shorelineColor: [0.92, 0.90, 0.80],
    seabedColor: [0.10, 0.42, 0.48],
    cliffSlopeThreshold: 0.70,
    strataFrequency: 0.12,
    snowElevationNorm: 1.0,
  },
  'cratered-moon': {
    id: 'cratered-moon',
    name: 'Lunar Basalt & Regolith',
    lowlandColor: [0.18, 0.19, 0.21],
    midlandColor: [0.34, 0.35, 0.38],
    highlandColor: [0.58, 0.60, 0.66],
    peakColor: [0.82, 0.85, 0.90],
    cliffColor: [0.15, 0.15, 0.18],
    cliffHighColor: [0.28, 0.29, 0.32],
    shorelineColor: [0.34, 0.35, 0.38],
    seabedColor: [0.18, 0.19, 0.21],
    cliffSlopeThreshold: 0.74,
    strataFrequency: 0.05,
    snowElevationNorm: 1.0,
  },
};

export function getTerrainPaletteForBody(body: ICelestialBody): ICdlodTerrainPalette {
  if (TERRAIN_PALETTES[body.id]) {
    return TERRAIN_PALETTES[body.id];
  }

  // Automatic procedural fallback derived from body definition
  const visual = body.terrain?.visual;
  const baseColor = visual?.colorRgb ?? [0.25, 0.45, 0.2];
  const highColor = visual?.highColorRgb ?? [0.9, 0.9, 0.92];

  return {
    id: body.id,
    name: body.id,
    lowlandColor: baseColor,
    midlandColor: [baseColor[0] * 0.8, baseColor[1] * 0.8, baseColor[2] * 0.8],
    highlandColor: [highColor[0] * 0.6, highColor[1] * 0.6, highColor[2] * 0.6],
    peakColor: highColor,
    cliffColor: [0.35, 0.32, 0.30],
    cliffHighColor: [0.25, 0.23, 0.21],
    shorelineColor: [0.74, 0.66, 0.48],
    seabedColor: [0.18, 0.26, 0.28],
    cliffSlopeThreshold: 0.72,
    strataFrequency: 0.1,
    snowElevationNorm: 0.65,
  };
}

export interface ICdlodShaderUniforms {
  uMorphFactor: { value: number };
  uEnableMorph: { value: number };
  uEdgeMorph: { value: Vector4 };
  uWireframeMode: { value: number };
  uHidePatchEdges: { value: number };
  uSeaLevelM: { value: number };
  uHasOcean: { value: number };
  uMinElevationM: { value: number };
  uMaxElevationM: { value: number };
  uRenderOrigin: { value: Vector3 };
  uSunDirection: { value: Vector3 };
  uSunColor: { value: Color };
  uAmbientColor: { value: Color };
  uElevationScale: { value: number };
  uLowlandColor: { value: Color };
  uMidlandColor: { value: Color };
  uHighlandColor: { value: Color };
  uPeakColor: { value: Color };
  uCliffColor: { value: Color };
  uCliffHighColor: { value: Color };
  uShorelineColor: { value: Color };
  uSeabedColor: { value: Color };
  uCliffSlopeThreshold: { value: number };
  uStrataFrequency: { value: number };
  uSnowElevationNorm: { value: number };
}

export const CDLOD_VERTEX_SHADER = `
attribute vec3 coarsePosition;
attribute float elevation;

uniform float uMorphFactor;
uniform float uEnableMorph;
uniform vec4 uEdgeMorph; // (left, right, bottom, top)
uniform float uElevationScale;
uniform vec3 uRenderOrigin;
uniform vec3 uSunDirection;

varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vBodyPosition;
varying vec3 vBodyDirection;
varying vec2 vUv;
varying float vElevation;
varying float vSlope;

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vUv = uv;
  vElevation = elevation * uElevationScale;

  vec3 morphedLocalPos = position;

  if (uEnableMorph > 0.5) {
    // Determine if vertex is on patch boundary edge
    float morph = uMorphFactor;
    if (uv.x < 0.001) morph = max(morph, uEdgeMorph.x);
    if (uv.x > 0.999) morph = max(morph, uEdgeMorph.y);
    if (uv.y < 0.001) morph = max(morph, uEdgeMorph.z);
    if (uv.y > 0.999) morph = max(morph, uEdgeMorph.w);

    morphedLocalPos = mix(position, coarsePosition, clamp(morph, 0.0, 1.0));
  }

  vec4 worldPos = modelMatrix * vec4(morphedLocalPos, 1.0);
  vWorldPosition = worldPos.xyz;

  vec3 bodyPos = worldPos.xyz + uRenderOrigin;
  vBodyPosition = bodyPos;
  vBodyDirection = normalize(bodyPos);

  // Transform normal to world space
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  // Compute slope relative to true planetary body radial vector
  vSlope = clamp(dot(vWorldNormal, vBodyDirection), 0.0, 1.0);

  gl_Position = projectionMatrix * viewMatrix * worldPos;

  #include <logdepthbuf_vertex>
}
`;

export const CDLOD_FRAGMENT_SHADER = `
uniform float uWireframeMode;
uniform float uHidePatchEdges;
uniform float uSeaLevelM;
uniform float uHasOcean;
uniform float uMinElevationM;
uniform float uMaxElevationM;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;

uniform vec3 uLowlandColor;
uniform vec3 uMidlandColor;
uniform vec3 uHighlandColor;
uniform vec3 uPeakColor;
uniform vec3 uCliffColor;
uniform vec3 uCliffHighColor;
uniform vec3 uShorelineColor;
uniform vec3 uSeabedColor;
uniform float uCliffSlopeThreshold;
uniform float uStrataFrequency;
uniform float uSnowElevationNorm;

varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vBodyPosition;
varying vec3 vBodyDirection;
varying vec2 vUv;
varying float vElevation;
varying float vSlope;

#include <common>
#include <logdepthbuf_pars_fragment>

// 3D hash & noise functions anchored to global planet coordinates
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(hash3(i + vec3(0,0,0)), hash3(i + vec3(1,0,0)), f.x),
      mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x),
      f.y
    ),
    mix(
      mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
      mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x),
      f.y
    ),
    f.z
  );
}

void main() {
  #include <logdepthbuf_fragment>

  // Neighboring patches at different LOD depths compute their normals
  // independently (each from its own finite-difference sample step), so
  // adjacent patch borders rarely agree exactly — visible as both a dark
  // lighting seam AND a color seam, since the cliff-rock blend below is also
  // slope (i.e. normal) derived. When enabled, fade the normal used for both
  // toward the LOD-independent radial (body-direction) normal near patch UV
  // edges so neighboring patches converge to the same value at the border.
  vec3 shadingNormal = vWorldNormal;
  if (uHidePatchEdges > 0.5) {
    float edgeDist = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float edgeFade = 1.0 - smoothstep(0.0, 0.05, edgeDist);
    shadingNormal = normalize(mix(vWorldNormal, vBodyDirection, edgeFade));
  }
  float slope = clamp(dot(shadingNormal, vBodyDirection), 0.0, 1.0);

  // Global spherical noise: Fixed geographic position across all LOD levels
  float macroNoise  = (noise3(vBodyDirection * 15.0) - 0.5) * 0.2;
  float mediumNoise = (noise3(vBodyDirection * 45.0) - 0.5) * 0.12;
  float microNoise  = (noise3(vBodyDirection * 120.0) - 0.5) * 0.06;
  float detailNoise = macroNoise + mediumNoise + microNoise;

  vec3 surfaceColor = uLowlandColor;

  if (uHasOcean > 0.5) {
    if (vElevation < uSeaLevelM) {
      // Underwater seabed floor
      surfaceColor = uSeabedColor;
    } else if (vElevation < uSeaLevelM + 30.0) {
      // Razor-sharp shoreline beach & wet sand transition
      float t = (vElevation - uSeaLevelM) / 30.0;
      surfaceColor = mix(uShorelineColor, uLowlandColor, smoothstep(0.0, 1.0, t));
    } else {
      // Land biomes based on elevation and slope
      float elevSpan = max(100.0, uMaxElevationM - uSeaLevelM);
      float elevNorm = clamp((vElevation - uSeaLevelM) / elevSpan, 0.0, 1.0);

      // Organic cluster distribution
      float clusterMask = smoothstep(0.42, 0.58, noise3(vBodyDirection * 30.0) + macroNoise);
      vec3 lowLandColor = mix(uLowlandColor, uMidlandColor, clusterMask);

      if (elevNorm < 0.35) {
        surfaceColor = lowLandColor;
      } else if (elevNorm < uSnowElevationNorm) {
        float t = (elevNorm - 0.35) / max(0.01, (uSnowElevationNorm - 0.35));
        surfaceColor = mix(lowLandColor, uHighlandColor, smoothstep(0.0, 1.0, t));
      } else {
        float t = clamp((elevNorm - uSnowElevationNorm) / max(0.01, (1.0 - uSnowElevationNorm)), 0.0, 1.0);
        surfaceColor = mix(uHighlandColor, uPeakColor, smoothstep(0.0, 1.0, t + macroNoise));
      }

      // Slope-dependent rock cliffs (vertical rock faces wherever terrain is steep)
      float cliffFactor = 1.0 - smoothstep(uCliffSlopeThreshold - 0.15, uCliffSlopeThreshold + 0.05, slope);
      float strata = sin(vElevation * uStrataFrequency) * 0.5 + 0.5;
      vec3 stratifiedRock = mix(uCliffColor, uCliffHighColor, strata * 0.6);
      surfaceColor = mix(surfaceColor, stratifiedRock, cliffFactor);
    }
  } else {
    // Airless / Dry World (No global oceans)
    float totalSpan = max(100.0, uMaxElevationM - uMinElevationM);
    float elevNorm = clamp((vElevation - uMinElevationM) / totalSpan, 0.0, 1.0);

    float mariaMask = smoothstep(0.40, 0.60, noise3(vBodyDirection * 25.0) + macroNoise);
    vec3 lowColor = mix(uLowlandColor, uMidlandColor, mariaMask);

    if (elevNorm < 0.35) {
      surfaceColor = lowColor;
    } else if (elevNorm < 0.70) {
      float t = (elevNorm - 0.35) / 0.35;
      surfaceColor = mix(lowColor, uHighlandColor, smoothstep(0.0, 1.0, t));
    } else {
      float t = (elevNorm - 0.70) / 0.30;
      surfaceColor = mix(uHighlandColor, uPeakColor, smoothstep(0.0, 1.0, t + macroNoise));
    }

    float cliffFactor = 1.0 - smoothstep(uCliffSlopeThreshold - 0.15, uCliffSlopeThreshold + 0.05, slope);
    float strata = sin(vElevation * uStrataFrequency) * 0.5 + 0.5;
    vec3 stratifiedRock = mix(uCliffColor, uCliffHighColor, strata * 0.5);
    surfaceColor = mix(surfaceColor, stratifiedRock, cliffFactor);
  }

  // Micro surface noise
  surfaceColor += detailNoise;

  // Diffuse directional lighting + ambient
  vec3 lightDir = normalize(uSunDirection);
  float nDotL = max(0.0, dot(shadingNormal, lightDir));
  vec3 diffuse = uSunColor * nDotL;
  vec3 finalColor = surfaceColor * (diffuse + uAmbientColor);

  // Wireframe grid highlight for LOD inspection when enabled
  if (uWireframeMode > 0.5) {
    finalColor = mix(finalColor, vec3(0.0, 0.95, 1.0), 0.4);
  }

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export interface IOceanShaderUniforms {
  uMorphFactor: { value: number };
  uEnableMorph: { value: number };
  uEdgeMorph: { value: Vector4 };
  uWireframeMode: { value: number };
  uRenderOrigin: { value: Vector3 };
  uSunDirection: { value: Vector3 };
  uSunColor: { value: Color };
  uAmbientColor: { value: Color };
  uShallowWaterColor: { value: Color };
  uDeepOceanColor: { value: Color };
}

export const OCEAN_VERTEX_SHADER = `
attribute vec3 coarsePosition;

uniform float uMorphFactor;
uniform float uEnableMorph;
uniform vec4 uEdgeMorph; // (left, right, bottom, top)
uniform vec3 uRenderOrigin;

varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vBodyDirection;

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vec3 morphedLocalPos = position;

  if (uEnableMorph > 0.5) {
    float morph = uMorphFactor;
    if (uv.x < 0.001) morph = max(morph, uEdgeMorph.x);
    if (uv.x > 0.999) morph = max(morph, uEdgeMorph.y);
    if (uv.y < 0.001) morph = max(morph, uEdgeMorph.z);
    if (uv.y > 0.999) morph = max(morph, uEdgeMorph.w);

    morphedLocalPos = mix(position, coarsePosition, clamp(morph, 0.0, 1.0));
  }

  vec4 worldPos = modelMatrix * vec4(morphedLocalPos, 1.0);
  vWorldPosition = worldPos.xyz;
  vBodyDirection = normalize(worldPos.xyz + uRenderOrigin);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  gl_Position = projectionMatrix * viewMatrix * worldPos;

  #include <logdepthbuf_vertex>
}
`;

export const OCEAN_FRAGMENT_SHADER = `
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;
uniform float uWireframeMode;
uniform vec3 uShallowWaterColor;
uniform vec3 uDeepOceanColor;

varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vBodyDirection;

#include <common>
#include <logdepthbuf_pars_fragment>

void main() {
  #include <logdepthbuf_fragment>

  vec3 lightDir = normalize(uSunDirection);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);

  // Fresnel edge reflection
  float nDotV = max(0.0, dot(vWorldNormal, viewDir));
  float fresnel = pow(1.0 - nDotV, 4.0) * 0.65;

  // Specular sun glint
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(0.0, dot(vWorldNormal, halfDir)), 64.0) * 0.9;

  // Diffuse & Ambient
  float nDotL = max(0.0, dot(vWorldNormal, lightDir));
  vec3 baseColor = mix(uDeepOceanColor, uShallowWaterColor, 0.35);
  vec3 diffuse = baseColor * (uSunColor * nDotL + uAmbientColor);
  vec3 finalColor = mix(diffuse, vec3(0.75, 0.88, 1.0), fresnel) + vec3(spec);

  if (uWireframeMode > 0.5) {
    finalColor = mix(finalColor, vec3(0.0, 0.6, 1.0), 0.5);
  }

  float alpha = mix(0.70, 0.95, fresnel);
  gl_FragColor = vec4(finalColor, alpha);
}
`;

export function createCdlodTerrainMaterial(options?: {
  wireframe?: boolean;
  hidePatchEdges?: boolean;
  elevationScale?: number;
  body?: ICelestialBody;
  palette?: ICdlodTerrainPalette;
}): ShaderMaterial {
  const body = options?.body;
  const palette = options?.palette ?? (body ? getTerrainPaletteForBody(body) : TERRAIN_PALETTES['home-planet']);

  const minElev = body?.terrain?.minElevationM ?? -4000;
  const maxElev = body?.terrain?.maxElevationM ?? 10000;
  const hasOcean = body?.terrain?.ocean ? 1.0 : (body ? 0.0 : 1.0);
  const seaLevel = body?.terrain?.ocean?.seaLevelM ?? 0.0;

  const uniforms: ICdlodShaderUniforms = {
    uMorphFactor: { value: 0.0 },
    uEnableMorph: { value: 1.0 },
    uEdgeMorph: { value: new Vector4(0, 0, 0, 0) },
    uWireframeMode: { value: options?.wireframe ? 1.0 : 0.0 },
    uHidePatchEdges: { value: options?.hidePatchEdges ? 1.0 : 0.0 },
    uSeaLevelM: { value: seaLevel },
    uHasOcean: { value: hasOcean },
    uMinElevationM: { value: minElev },
    uMaxElevationM: { value: maxElev },
    uRenderOrigin: { value: new Vector3(0, 0, 0) },
    uSunDirection: { value: new Vector3(0.6, 0.7, 0.3).normalize() },
    uSunColor: { value: new Color(1.0, 0.98, 0.92) },
    uAmbientColor: { value: new Color(0.22, 0.24, 0.30) },
    uElevationScale: { value: options?.elevationScale ?? 1.0 },
    uLowlandColor: { value: new Color(...palette.lowlandColor) },
    uMidlandColor: { value: new Color(...palette.midlandColor) },
    uHighlandColor: { value: new Color(...palette.highlandColor) },
    uPeakColor: { value: new Color(...palette.peakColor) },
    uCliffColor: { value: new Color(...palette.cliffColor) },
    uCliffHighColor: { value: new Color(...palette.cliffHighColor) },
    uShorelineColor: { value: new Color(...palette.shorelineColor) },
    uSeabedColor: { value: new Color(...palette.seabedColor) },
    uCliffSlopeThreshold: { value: palette.cliffSlopeThreshold },
    uStrataFrequency: { value: palette.strataFrequency },
    uSnowElevationNorm: { value: palette.snowElevationNorm },
  };

  return new ShaderMaterial({
    uniforms: uniforms as unknown as { [uniform: string]: { value: unknown } },
    vertexShader: CDLOD_VERTEX_SHADER,
    fragmentShader: CDLOD_FRAGMENT_SHADER,
    wireframe: options?.wireframe ?? false,
    side: DoubleSide,
  });
}

export function createOceanMaterial(options?: {
  wireframe?: boolean;
  body?: ICelestialBody;
}): ShaderMaterial {
  const ocean = options?.body?.terrain?.ocean;
  const shallowColor = ocean?.shallowColorRgb ?? [0.08, 0.42, 0.62];
  const deepColor = ocean?.deepColorRgb ?? [0.02, 0.09, 0.24];

  const uniforms: IOceanShaderUniforms = {
    uMorphFactor: { value: 0.0 },
    uEnableMorph: { value: 1.0 },
    uEdgeMorph: { value: new Vector4(0, 0, 0, 0) },
    uWireframeMode: { value: options?.wireframe ? 1.0 : 0.0 },
    uRenderOrigin: { value: new Vector3(0, 0, 0) },
    uSunDirection: { value: new Vector3(0.6, 0.7, 0.3).normalize() },
    uSunColor: { value: new Color(1.0, 0.98, 0.92) },
    uAmbientColor: { value: new Color(0.22, 0.24, 0.30) },
    uShallowWaterColor: { value: new Color(...shallowColor) },
    uDeepOceanColor: { value: new Color(...deepColor) },
  };

  return new ShaderMaterial({
    uniforms: uniforms as unknown as { [uniform: string]: { value: unknown } },
    vertexShader: OCEAN_VERTEX_SHADER,
    fragmentShader: OCEAN_FRAGMENT_SHADER,
    side: DoubleSide,
    wireframe: options?.wireframe ?? false,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}
