import { Color, DoubleSide, ShaderMaterial, Vector3, Vector4 } from 'three';
import { ICelestialBody } from 'triangular-engine/celestial';
import { getTerrainPaletteForBody, ICdlodTerrainPalette } from '../cdlod-materials';

export const CDLOD_V3_TERRAIN_VERTEX_SHADER = `
attribute vec3 coarsePosition;
attribute float instanceMorph;
attribute vec4 instanceEdgeMorph;
attribute vec3 instanceCenter;

uniform vec3 uRenderOrigin;

varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vBodyDirection;
varying float vElevation;
varying float vSlope;
varying vec3 vPatchCenter;

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vec3 morphedPos = position;

  // GPU Geomorphing
  float morph = instanceMorph;
  if (uv.x < 0.001) morph = max(morph, instanceEdgeMorph.x);
  if (uv.x > 0.999) morph = max(morph, instanceEdgeMorph.y);
  if (uv.y < 0.001) morph = max(morph, instanceEdgeMorph.z);
  if (uv.y > 0.999) morph = max(morph, instanceEdgeMorph.w);

  if (morph > 0.001) {
    morphedPos = mix(position, coarsePosition, clamp(morph, 0.0, 1.0));
  }

  // Transform by instance matrix
  vec4 localPos = vec4(morphedPos + instanceCenter, 1.0);
  vec4 worldPos = modelMatrix * localPos;

  vWorldPosition = worldPos.xyz;
  vBodyDirection = normalize(worldPos.xyz + uRenderOrigin);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vPatchCenter = instanceCenter;

  gl_Position = projectionMatrix * viewMatrix * worldPos;

  #include <logdepthbuf_vertex>
}
`;

export const CDLOD_V3_TERRAIN_FRAGMENT_SHADER = `
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;
uniform float uWireframeMode;
uniform float uHidePatchEdges;

// Biome palette uniforms
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
varying vec3 vBodyDirection;
varying vec3 vPatchCenter;

#include <common>
#include <logdepthbuf_pars_fragment>

void main() {
  #include <logdepthbuf_fragment>

  vec3 normal = normalize(vWorldNormal);
  vec3 up = normalize(vBodyDirection);
  float slope = max(0.0, dot(normal, up));

  vec3 lightDir = normalize(uSunDirection);
  float nDotL = max(0.0, dot(normal, lightDir));

  // Tri-planar slope shading
  vec3 baseColor = uMidlandColor;
  if (slope < uCliffSlopeThreshold) {
    baseColor = mix(uCliffColor, uCliffHighColor, 0.5);
  } else {
    baseColor = mix(uLowlandColor, uHighlandColor, 0.5);
  }

  vec3 diffuse = baseColor * (uSunColor * nDotL + uAmbientColor);

  // Patch wireframe debug overlay
  if (uWireframeMode > 0.5) {
    diffuse = mix(diffuse, vec3(0.1, 0.9, 0.2), 0.4);
  }

  gl_FragColor = vec4(diffuse, 1.0);
}
`;

export const CDLOD_V3_OCEAN_VERTEX_SHADER = `
attribute vec3 coarsePosition;
attribute float instanceMorph;
attribute vec4 instanceEdgeMorph;
attribute vec3 instanceCenter;

uniform vec3 uRenderOrigin;

varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vBodyDirection;

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vec3 morphedPos = position;

  float morph = instanceMorph;
  if (uv.x < 0.001) morph = max(morph, instanceEdgeMorph.x);
  if (uv.x > 0.999) morph = max(morph, instanceEdgeMorph.y);
  if (uv.y < 0.001) morph = max(morph, instanceEdgeMorph.z);
  if (uv.y > 0.999) morph = max(morph, instanceEdgeMorph.w);

  if (morph > 0.001) {
    morphedPos = mix(position, coarsePosition, clamp(morph, 0.0, 1.0));
  }

  vec4 localPos = vec4(morphedPos + instanceCenter, 1.0);
  vec4 worldPos = modelMatrix * localPos;

  vWorldPosition = worldPos.xyz;
  vBodyDirection = normalize(worldPos.xyz + uRenderOrigin);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  gl_Position = projectionMatrix * viewMatrix * worldPos;

  #include <logdepthbuf_vertex>
}
`;

export const CDLOD_V3_OCEAN_FRAGMENT_SHADER = `
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
  // Analytical smooth radial normal for 100% glass-smooth horizon and reflection glints
  vec3 normal = vBodyDirection;

  float nDotV = max(0.0, dot(normal, viewDir));
  float fresnel = pow(1.0 - nDotV, 4.0) * 0.65;

  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(0.0, dot(normal, halfDir)), 64.0) * 0.9;

  float nDotL = max(0.0, dot(normal, lightDir));
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

export function createCdlodV3TerrainMaterial(options?: {
  wireframe?: boolean;
  body?: ICelestialBody;
}): ShaderMaterial {
  const defaultPalette: ICdlodTerrainPalette = {
    id: 'default',
    name: 'Default',
    lowlandColor: [0.25, 0.45, 0.2],
    midlandColor: [0.35, 0.48, 0.25],
    highlandColor: [0.55, 0.50, 0.40],
    peakColor: [0.90, 0.90, 0.92],
    cliffColor: [0.35, 0.32, 0.30],
    cliffHighColor: [0.25, 0.23, 0.21],
    shorelineColor: [0.74, 0.66, 0.48],
    seabedColor: [0.18, 0.26, 0.28],
    cliffSlopeThreshold: 0.72,
    strataFrequency: 0.1,
    snowElevationNorm: 0.85,
  };
  const palette = options?.body ? getTerrainPaletteForBody(options.body) : defaultPalette;
  const uniforms = {
    uWireframeMode: { value: options?.wireframe ? 1.0 : 0.0 },
    uHidePatchEdges: { value: 0.0 },
    uRenderOrigin: { value: new Vector3(0, 0, 0) },
    uSunDirection: { value: new Vector3(0.6, 0.7, 0.3).normalize() },
    uSunColor: { value: new Color(1.0, 0.98, 0.92) },
    uAmbientColor: { value: new Color(0.22, 0.24, 0.30) },
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
    vertexShader: CDLOD_V3_TERRAIN_VERTEX_SHADER,
    fragmentShader: CDLOD_V3_TERRAIN_FRAGMENT_SHADER,
    wireframe: options?.wireframe ?? false,
    side: DoubleSide,
  });
}

export function createCdlodV3OceanMaterial(options?: {
  wireframe?: boolean;
  body?: ICelestialBody;
}): ShaderMaterial {
  const ocean = options?.body?.terrain?.ocean;
  const shallowColor = ocean?.shallowColorRgb ?? [0.08, 0.42, 0.62];
  const deepColor = ocean?.deepColorRgb ?? [0.02, 0.09, 0.24];

  const uniforms = {
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
    vertexShader: CDLOD_V3_OCEAN_VERTEX_SHADER,
    fragmentShader: CDLOD_V3_OCEAN_FRAGMENT_SHADER,
    side: DoubleSide,
    wireframe: options?.wireframe ?? false,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}
