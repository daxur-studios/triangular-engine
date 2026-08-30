import {
  Color,
  CustomBlending,
  FrontSide,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector3,
} from 'three';

export interface ILayeredCloudMaterialOptions {
  readonly morphStrength?: number;
  readonly morphSpeed?: number;
  readonly opacity?: number;
  readonly rimStrength?: number;
  readonly color?: Color | string;
  readonly faceted?: boolean;
}

export const LAYERED_CLOUD_VERTEX_SHADER = /* glsl */ `
  precision highp float;

  attribute float aLayerIndex;
  attribute float aNormalizedHeight;
  attribute float aRadialDist;
  attribute float aPolarAngle;
  attribute float aRandomJitter;

  uniform float uTime;
  uniform float uMorphSpeed;
  uniform float uMorphStrength;
  uniform vec3 uSunDirection;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vSunDir;
  varying vec3 vViewDir;
  varying float vHeightFrac;
  varying float vLayer;

  void main() {
    vLayer = aLayerIndex;
    vHeightFrac = aNormalizedHeight;

    // Dynamic non-rigid perimeter morphing
    // Top layers deform more actively while base layer remains wider and steadier
    float layerChaos = 0.5 + 0.5 * aNormalizedHeight;
    float t = uTime * uMorphSpeed;

    float wave1 = sin(aPolarAngle * 3.0 + t + aRandomJitter * 6.28318);
    float wave2 = cos(aPolarAngle * 5.0 - t * 0.8 + aRandomJitter * 3.14159);
    float wave3 = sin(aPolarAngle * 7.0 + t * 1.3);
    float morphOffset = (wave1 * 0.45 + wave2 * 0.35 + wave3 * 0.2) * uMorphStrength * aRadialDist * layerChaos;

    vec3 localPos = position;
    // Radial expansion/contraction of layer boundaries
    localPos.x += localPos.x * morphOffset;
    localPos.z += localPos.z * morphOffset;

    vec3 transformed = localPos;
    vec3 objectNormal = normal;

    #ifdef USE_INSTANCING
      transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
      objectNormal = mat3(instanceMatrix) * objectNormal;
    #endif

    vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
    vSunDir = normalize(uSunDirection);
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const LAYERED_CLOUD_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float uOpacity;
  uniform float uRimStrength;
  uniform vec3 uCloudColor;
  uniform float uFaceted;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vSunDir;
  varying vec3 vViewDir;
  varying float vHeightFrac;
  varying float vLayer;

  void main() {
    // Dynamic faceted face normal vs smooth interpolated normal
    vec3 N = normalize(vWorldNormal);
    if (uFaceted > 0.5) {
      vec3 dX = dFdx(vWorldPosition);
      vec3 dY = dFdy(vWorldPosition);
      vec3 faceNorm = cross(dX, dY);
      if (length(faceNorm) > 1e-5) {
        N = normalize(faceNorm);
      }
    }

    // Sun directional lighting with day/night terminator wrap
    float NdotL = dot(N, vSunDir);
    float dayFactor = smoothstep(-0.25, 0.45, NdotL);

    // Fresnel limb rim glow
    float VdotN = max(0.0, dot(vViewDir, N));
    float rim = pow(1.0 - VdotN, 2.2) * uRimStrength;

    // Atmospheric tier shading (slightly brighter on top turrets)
    float heightBoost = 0.9 + 0.15 * vHeightFrac;
    vec3 litColor = uCloudColor * heightBoost * (0.35 + 0.65 * dayFactor + rim * 0.35);
    vec3 nightColor = uCloudColor * 0.08;
    vec3 finalColor = mix(nightColor, litColor, dayFactor);

    gl_FragColor = vec4(finalColor, uOpacity * (0.35 + 0.65 * dayFactor));
  }
`;

export function createLayeredCloudMaterial(
  options: ILayeredCloudMaterialOptions = {},
): ShaderMaterial {
  const opacity = options.opacity ?? 0.85;
  return new ShaderMaterial({
    vertexShader: LAYERED_CLOUD_VERTEX_SHADER,
    fragmentShader: LAYERED_CLOUD_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0.0 },
      uMorphSpeed: { value: options.morphSpeed ?? 0.8 },
      uMorphStrength: { value: options.morphStrength ?? 0.22 },
      uOpacity: { value: opacity },
      uRimStrength: { value: options.rimStrength ?? 1.2 },
      uCloudColor: { value: new Color(options.color ?? '#f8fafc') },
      uSunDirection: { value: new Vector3(0.6, 0.7, 0.4).normalize() },
      uFaceted: { value: options.faceted ?? true ? 1.0 : 0.0 },
    },
    transparent: opacity < 1.0,
    depthWrite: opacity > 0.6,
    side: FrontSide,
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });
}
