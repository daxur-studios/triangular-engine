import {
  Color,
  CustomBlending,
  DoubleSide,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector3,
} from 'three';

export interface ICirrusAtmosphereMaterialOptions {
  readonly radius?: number;
  readonly coverage?: number;
  readonly wispiness?: number;
  readonly flowSpeed?: number;
  readonly curlStrength?: number;
  readonly curlFrequency?: number;
  readonly zonalFrequency?: number;
  readonly rimStrength?: number;
  readonly color?: Color | string;
  readonly faceted?: boolean;
}

export const CIRRUS_ATMOSPHERE_VERTEX_SHADER = `
  precision highp float;

  uniform float uTime;
  uniform float uFlowSpeed;
  uniform float uRadius;
  uniform vec3 uSunDirection;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vSunDir;
  varying vec3 vViewDir;

  void main() {
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vSunDir = normalize(uSunDirection);
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const CIRRUS_ATMOSPHERE_FRAGMENT_SHADER = `
  precision highp float;

  #define PI 3.14159265359

  uniform float uTime;
  uniform float uFlowSpeed;
  uniform float uCoverage;
  uniform float uWispiness;
  uniform float uCurlStrength;
  uniform float uCurlFrequency;
  uniform float uZonalFrequency;
  uniform float uRimStrength;
  uniform vec3 uColor;
  uniform float uFaceted;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vSunDir;
  varying vec3 vViewDir;

  float hash31(vec3 p) {
    p = fract(p * vec3(123.34, 456.21, 789.53));
    p += dot(p, p.yxz + 45.32);
    return fract(p.x * p.y * p.z);
  }

  vec3 hash33(vec3 p) {
    p = fract(p * vec3(123.34, 456.21, 789.53));
    p += dot(p, p.yxz + 45.32);
    return fract(vec3(p.x * p.y, p.y * p.z, p.z * p.x));
  }

  float valueNoise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), u.x),
          mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), u.x), u.y),
      mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), u.x),
          mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), u.x), u.y),
      u.z
    );
  }

  // 3D Spherical Curl Noise for fluid swirling
  vec3 curlNoise3D(vec3 P, float freq, float t) {
    vec3 q = P * freq + vec3(t * 0.03, t * 0.015, t * 0.01);
    const float eps = 0.03;
    float nx = valueNoise3D(q + vec3(eps,0,0)) - valueNoise3D(q - vec3(eps,0,0));
    float ny = valueNoise3D(q + vec3(0,eps,0)) - valueNoise3D(q - vec3(0,eps,0));
    float nz = valueNoise3D(q + vec3(0,0,eps)) - valueNoise3D(q - vec3(0,0,eps));
    vec3 grad = vec3(nx, ny, nz) / (2.0 * eps);
    return cross(normalize(P), grad);
  }

  // 3D Worley / Cellular Noise for atmospheric cloud sheets and cells
  float worley3D(vec3 p) {
    vec3 id = floor(p);
    vec3 f = fract(p);
    float minDist = 1.0;

    for (int k = -1; k <= 1; k++) {
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec3 neighbor = vec3(float(i), float(j), float(k));
          vec3 pt = hash33(id + neighbor);
          vec3 diff = neighbor + pt - f;
          float dist = length(diff);
          minDist = min(minDist, dist);
        }
      }
    }
    return minDist;
  }

  // Multi-octave fractional Brownian flow
  float fbmFlow(vec3 p, float t) {
    float sum = 0.0;
    float amp = 0.55;
    float freq = 1.0;
    for (int i = 0; i < 4; i++) {
      sum += amp * valueNoise3D(p * freq + vec3(t * 0.02 * float(i + 1)));
      freq *= 2.05;
      amp *= 0.48;
    }
    return sum;
  }

  void main() {
    vec3 normP = normalize(vWorldPosition);
    float lat = asin(clamp(normP.y, -1.0, 1.0));
    float t = uTime * uFlowSpeed;

    // Zonal jet drift along longitude
    float zonalSpeed = 0.08 * (1.0 + 0.7 * sin(uZonalFrequency * lat));
    float angleDrift = t * zonalSpeed;
    float cosA = cos(angleDrift);
    float sinA = sin(angleDrift);
    vec3 driftedP = vec3(
      normP.x * cosA - normP.z * sinA,
      normP.y,
      normP.x * sinA + normP.z * cosA
    );

    // Multi-octave curl turbulence advection
    vec3 curl = curlNoise3D(driftedP, uCurlFrequency, t) * uCurlStrength;
    vec3 sampleCoord = (driftedP + curl) * 2.8;

    // Multi-scale Worley cellular cloud sheet ("butter spread")
    float cell1 = 1.0 - worley3D(sampleCoord * 1.5);
    float cell2 = 1.0 - worley3D(sampleCoord * 3.8 + vec3(t * 0.02));
    float fbm = fbmFlow(sampleCoord * 2.0, t);

    // Continuous veil density
    float rawDensity = cell1 * 0.55 + cell2 * 0.25 + fbm * 0.35;
    
    // Coverage and wispiness thresholding
    float edgeLow = 1.0 - uCoverage;
    float edgeHigh = edgeLow + max(0.05, uWispiness);
    float alpha = smoothstep(edgeLow, edgeHigh, rawDensity);

    if (alpha < 0.01) discard;

    // Faceted low-poly vs smooth normal calculation
    vec3 N = normalize(vWorldNormal);
    if (uFaceted > 0.5) {
      vec3 dX = dFdx(vWorldPosition);
      vec3 dY = dFdy(vWorldPosition);
      N = normalize(cross(dX, dY));
    }

    // Solar lighting with day/night terminator wrap
    float NdotL = dot(N, vSunDir);
    float dayFactor = smoothstep(-0.25, 0.45, NdotL);
    
    // Atmospheric Fresnel limb rim glow
    float VdotN = max(0.0, dot(vViewDir, N));
    float rim = pow(1.0 - VdotN, 2.5) * uRimStrength;

    // Scattered sky tint
    vec3 sunLitColor = uColor * (0.4 + 0.6 * dayFactor + rim * 0.45);
    vec3 nightColor = uColor * 0.08;
    vec3 finalColor = mix(nightColor, sunLitColor, dayFactor);

    gl_FragColor = vec4(finalColor, alpha * (0.2 + 0.65 * dayFactor));
  }
`;

export function createCirrusAtmosphereMaterial(
  options: ICirrusAtmosphereMaterialOptions = {},
): ShaderMaterial {
  const material = new ShaderMaterial({
    vertexShader: CIRRUS_ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: CIRRUS_ATMOSPHERE_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0.0 },
      uFlowSpeed: { value: options.flowSpeed ?? 0.08 },
      uRadius: { value: options.radius ?? 60.0 },
      uCoverage: { value: options.coverage ?? 0.62 },
      uWispiness: { value: options.wispiness ?? 0.35 },
      uCurlStrength: { value: options.curlStrength ?? 0.15 },
      uCurlFrequency: { value: options.curlFrequency ?? 2.2 },
      uZonalFrequency: { value: options.zonalFrequency ?? 4.0 },
      uRimStrength: { value: options.rimStrength ?? 1.5 },
      uColor: { value: new Color(options.color ?? '#e6f0ff') },
      uSunDirection: { value: new Vector3(0.6, 0.7, 0.4).normalize() },
      uFaceted: { value: options.faceted ? 1.0 : 0.0 },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });

  return material;
}
