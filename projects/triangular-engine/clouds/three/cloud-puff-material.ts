import { Color, DoubleSide, ShaderMaterial, Uniform, Vector3 } from 'three';

/** Fixed so the fragment loop stays a cheap unrolled 4 iterations with no dynamic branching. */
export const CLOUD_PUFF_MAX_POINT_LIGHTS = 4;

export interface ICloudPuffPointLight {
  readonly position: Vector3;
  readonly color: Color;
  /** Roughly the light's brightness at 1m distance; falls off with an inverse-square-ish curve. */
  readonly intensity: number;
}

export interface ICloudPuffMaterialOptions {
  readonly baseColor?: Color;
  readonly ambientColor?: Color;
  readonly sunColor?: Color;
  readonly rimStrength?: number;
  readonly opacity?: number;
}

const VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
  #ifdef USE_INSTANCING
    transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    objectNormal = mat3(instanceMatrix) * objectNormal;
  #endif
  vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
#define MAX_POINT_LIGHTS ${CLOUD_PUFF_MAX_POINT_LIGHTS}

uniform vec3 baseColor;
uniform vec3 ambientColor;
uniform vec3 sunColor;
uniform vec3 sunDirection;
uniform float rimStrength;
uniform float opacity;

uniform vec3 pointLightPosition[MAX_POINT_LIGHTS];
uniform vec3 pointLightColor[MAX_POINT_LIGHTS];
uniform float pointLightIntensity[MAX_POINT_LIGHTS];
uniform int pointLightCount;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float viewFresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.5);

  float sunLambert = max(dot(normal, sunDirection), 0.0);
  float sunBacklight = max(dot(-normal, sunDirection), 0.0);
  vec3 color = ambientColor * baseColor;
  color += sunColor * baseColor * sunLambert;
  color += sunColor * viewFresnel * sunBacklight * rimStrength;

  for (int i = 0; i < MAX_POINT_LIGHTS; i++) {
    if (i >= pointLightCount) break;
    vec3 toLight = pointLightPosition[i] - vWorldPosition;
    float dist = length(toLight);
    vec3 lightDir = toLight / max(dist, 0.001);
    float attenuation = pointLightIntensity[i] / (1.0 + dist * dist * 0.02);
    float lambert = max(dot(normal, lightDir), 0.0);
    // A light sitting behind the surface (relative to the camera) reads as glowing through the
    // puff from inside rather than lighting its outer face — the whole point of this term.
    float insideGlow = viewFresnel * max(dot(-normal, lightDir), 0.0);
    color += pointLightColor[i] * attenuation * (lambert * 0.6 + insideGlow * 1.4);
  }

  gl_FragColor = vec4(color, opacity);
}
`;

/**
 * Hand-rolled `ShaderMaterial` rather than a patched standard material — cloud puffs need full
 * control over sun + multi-point-light shading (see the from-inside "glow" term) instead of
 * Three's PBR pipeline.
 */
export function createCloudPuffMaterial(
  options: ICloudPuffMaterialOptions = {},
): ShaderMaterial {
  const opacity = options.opacity ?? 1;
  const uniforms = {
    baseColor: new Uniform(options.baseColor?.clone() ?? new Color('#f5f7f9')),
    ambientColor: new Uniform(options.ambientColor?.clone() ?? new Color('#3a4552')),
    sunColor: new Uniform(options.sunColor?.clone() ?? new Color('#fff3df')),
    sunDirection: new Uniform(new Vector3(0, 1, 0)),
    rimStrength: new Uniform(options.rimStrength ?? 1.2),
    opacity: new Uniform(opacity),
    pointLightPosition: new Uniform(
      Array.from({ length: CLOUD_PUFF_MAX_POINT_LIGHTS }, () => new Vector3()),
    ),
    pointLightColor: new Uniform(
      Array.from({ length: CLOUD_PUFF_MAX_POINT_LIGHTS }, () => new Color(0, 0, 0)),
    ),
    pointLightIntensity: new Uniform(new Float32Array(CLOUD_PUFF_MAX_POINT_LIGHTS)),
    pointLightCount: new Uniform(0),
  };

  return new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: DoubleSide,
    transparent: opacity < 1,
  });
}

export function setCloudPuffSunDirection(material: ShaderMaterial, direction: Vector3): void {
  (material.uniforms['sunDirection'].value as Vector3).copy(direction).normalize();
}

export function setCloudPuffPointLights(
  material: ShaderMaterial,
  lights: readonly ICloudPuffPointLight[],
): void {
  const count = Math.min(lights.length, CLOUD_PUFF_MAX_POINT_LIGHTS);
  const positions = material.uniforms['pointLightPosition'].value as Vector3[];
  const colors = material.uniforms['pointLightColor'].value as Color[];
  const intensities = material.uniforms['pointLightIntensity'].value as Float32Array;
  for (let i = 0; i < count; i++) {
    positions[i].copy(lights[i].position);
    colors[i].copy(lights[i].color);
    intensities[i] = lights[i].intensity;
  }
  for (let i = count; i < CLOUD_PUFF_MAX_POINT_LIGHTS; i++) {
    intensities[i] = 0;
  }
  material.uniforms['pointLightCount'].value = count;
}
