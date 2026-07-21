import type { CloudsEffect } from '@takram/three-clouds';
import {
  Uniform,
  Vector3,
  type Camera,
  type Matrix4,
  type ShaderMaterial,
} from 'three';

type CylinderCloudUniforms = {
  altitudeCorrection: Uniform<Vector3>;
  cameraHeight: Uniform<number>;
  cylinderRadius: Uniform<number>;
  cylinderHazeModel: Uniform<number>;
  sunLightScale: Uniform<number>;
  worldToECEFMatrix: Uniform<Matrix4>;
};

export type TakramCylinderHazeModel = 'legacy' | 'bounded-v2';

type CylinderCloudMaterial = ShaderMaterial & {
  copyCameraSettings(camera: Camera): void;
  uniforms: Record<string, Uniform<unknown>> & CylinderCloudUniforms;
};

const patchedMaterials = new WeakSet<object>();

/**
 * Installs the O'Neill-cylinder POC geometry in Takram's public cloud material.
 *
 * This intentionally targets a camera inside an X-axis cylinder. Takram's
 * spherical aerial perspective and cloud-shadow pass are not made cylindrical;
 * the cloud material supplies a lightweight internal-haze approximation instead.
 */
export function applyTakramCylinderClouds(
  effect: CloudsEffect,
  radius: number,
  sunLightScale: number,
  hazeModel: TakramCylinderHazeModel = 'bounded-v2',
): void {
  if (!(radius > 0)) {
    throw new Error('Takram cylinderRadius must be greater than zero.');
  }

  const material = effect.cloudsPass.currentMaterial as unknown as CylinderCloudMaterial;
  if (!patchedMaterials.has(material)) {
    validateMaterial(material);
    material.uniforms.cylinderRadius = new Uniform(radius);
    material.uniforms.cylinderHazeModel = new Uniform(hazeModel === 'bounded-v2' ? 1 : 0);
    material.uniforms.sunLightScale = new Uniform(sunLightScale);
    material.defines['CYLINDRICAL'] = '1';
    material.vertexShader = patchVertexShader(material.vertexShader);
    material.fragmentShader = patchFragmentShader(material.fragmentShader);
    patchCameraHeight(material);
    material.needsUpdate = true;
    patchedMaterials.add(material);
  }

  material.uniforms.cylinderRadius.value = radius;
  material.uniforms.cylinderHazeModel.value = hazeModel === 'bounded-v2' ? 1 : 0;
  material.uniforms.sunLightScale.value = sunLightScale;
}

function validateMaterial(material: CylinderCloudMaterial): void {
  if (
    !material.uniforms.altitudeCorrection ||
    !material.uniforms.cameraHeight ||
    !material.uniforms.worldToECEFMatrix ||
    typeof material.copyCameraSettings !== 'function'
  ) {
    throw new Error(
      'Unsupported @takram/three-clouds runtime: cannot install cylinder clouds.',
    );
  }
}

function patchCameraHeight(material: CylinderCloudMaterial): void {
  const original = material.copyCameraSettings.bind(material);
  const cameraPosition = new Vector3();
  material.copyCameraSettings = (camera: Camera): void => {
    original(camera);
    camera
      .getWorldPosition(cameraPosition)
      .applyMatrix4(material.uniforms.worldToECEFMatrix.value)
      .add(material.uniforms.altitudeCorrection.value);
    material.uniforms.cameraHeight.value =
      material.uniforms.cylinderRadius.value -
      Math.hypot(cameraPosition.y, cameraPosition.z);
  };
}

function patchVertexShader(source: string): string {
  return replaceFunction(
    source,
    'void sampleSunSkyIrradiance',
    `void sampleSunSkyIrradiance(const vec3 positionECEF) {
  // Bruneton's LUTs are spherical. Use stable artistic irradiance for the POC.
  vGroundIrradiance.sun = vec3(1.0);
  vGroundIrradiance.sky = vec3(0.35, 0.45, 0.65);
  vCloudsIrradiance.minSun = vec3(1.0);
  vCloudsIrradiance.maxSun = vec3(1.0);
  vCloudsIrradiance.minSky = vec3(0.35, 0.45, 0.65);
  vCloudsIrradiance.maxSky = vec3(0.35, 0.45, 0.65);
}`,
  );
}

function patchFragmentShader(source: string): string {
  source = injectAfter(
    source,
    'uniform float bottomRadius;',
    '\nuniform float cylinderRadius;\nuniform int cylinderHazeModel;\nuniform float sunLightScale;',
  );

  source = replaceFunction(
    source,
    'vec2 getGlobeUv',
    `vec2 getGlobeUv(const vec3 position) {
  float angle = atan(position.z, position.y);
  return vec2(angle * RECIPROCAL_PI2 + 0.5, position.x / (cylinderRadius * PI2));
}

float getCloudHeight(const vec3 position) {
  return cylinderRadius - length(position.yz);
}

vec3 getCloudSurfaceNormal(const vec3 position) {
  return normalize(vec3(0.0, -position.y, -position.z));
}`,
  );

  source = injectAfter(
    source,
    'vec2 ddy = dFdy(coord);',
    `
#ifdef CYLINDRICAL
  // Keep derivatives continuous where cylindrical weather UVs wrap.
  float periodX = localWeatherRepeat.x * resolution.x;
  ddx.x -= periodX * round(ddx.x / periodX);
  ddy.x -= periodX * round(ddy.x / periodX);
#endif`,
  );

  source = source.replaceAll(
    'length(position) - bottomRadius',
    'getCloudHeight(position)',
  );
  source = source.replaceAll(
    'vec3 surfaceNormal = normalize(position);',
    'vec3 surfaceNormal = getCloudSurfaceNormal(position);',
  );
  source = injectBefore(
    source,
    'MediaSample media;\n  float densitySum',
    `// The POC cylinder is five radii long; soften cloud termination at its ends.
  float cylinderHalfLength = 2.5 * cylinderRadius;
  density *= 1.0 - smoothstep(
    cylinderHalfLength * 0.9,
    cylinderHalfLength,
    abs(position.x)
  );

  `,
  );
  source = source.replace(
    'sunIrradiance * approximateMultipleScattering(opticalDepth, cosTheta)',
    'sunIrradiance * sunLightScale * approximateMultipleScattering(opticalDepth, cosTheta)',
  );

  source = replaceFunction(
    source,
    'IntersectionResult getIntersections',
    `IntersectionResult getIntersections(const vec3 cameraPosition, const vec3 rayDirection) {
  IntersectionResult intersections;
  vec2 origin = cameraPosition.yz;
  vec2 direction = rayDirection.yz;
  float a = dot(direction, direction);
  if (a < 1e-8) {
    intersections.first = vec4(-1.0);
    intersections.second = vec4(-1.0);
    intersections.ground = false;
    return intersections;
  }
  vec4 radii = cylinderRadius - vec4(0.0, minHeight, maxHeight, shadowTopHeight);
  float originDirection = dot(origin, direction);
  vec4 roots = sqrt(max(
    vec4(0.0),
    vec4(originDirection * originDirection) -
      a * (vec4(dot(origin, origin)) - radii * radii)
  ));
  intersections.first = (vec4(-originDirection) - roots) / a;
  intersections.second = (vec4(-originDirection) + roots) / a;
  intersections.ground = false;
  return intersections;
}`,
  );

  source = injectAfter(
    source,
    'vec2 hazeRayNearFar = getHazeRayNearFar(intersections);',
    `
#ifdef CYLINDRICAL
  // Clip haze at the physical open ends. Axis-parallel rays do not intersect
  // the cylindrical wall and otherwise tint the entire frame indefinitely.
  if (abs(rayDirection.x) > 1e-6) {
    float endX = rayDirection.x > 0.0
      ? 2.5 * cylinderRadius
      : -2.5 * cylinderRadius;
    float distanceToEnd = (endX - cameraPosition.x) / rayDirection.x;
    if (distanceToEnd > cameraNear) {
      if (hazeRayNearFar.y < cameraNear) {
        hazeRayNearFar.y = distanceToEnd;
      } else {
        hazeRayNearFar.y = min(hazeRayNearFar.y, distanceToEnd);
      }
    }
  }
#endif`,
  );

  source = replaceFunction(
    source,
    'vec2 getRayNearFar',
    `vec2 getRayNearFar(const IntersectionResult intersections) {
  if (cameraHeight >= maxHeight) {
    return vec2(max(cameraNear, intersections.second.z), intersections.second.y);
  }
  return vec2(cameraNear, max(cameraNear, intersections.second.y));
}`,
  );

  source = replaceFunction(
    source,
    'vec2 getHazeRayNearFar',
    `vec2 getHazeRayNearFar(const IntersectionResult intersections) {
  if (cylinderHazeModel == 1 && cameraHeight < 0.0) {
    return vec2(max(cameraNear, intersections.first.x), intersections.second.x);
  }
  return vec2(cameraNear, intersections.second.x);
}`,
  );

  source = replaceFunction(
    source,
    'vec4 approximateHaze',
    `vec4 approximateHaze(
  const vec3 rayOrigin,
  const vec3 rayDirection,
  const float maxRayDistance,
  const float cosTheta,
  const float shadowLength
) {
  float modulation = remapClamped(coverage, 0.2, 0.4);
  const int SAMPLE_COUNT = 12;
  float stepSize = maxRayDistance / float(SAMPLE_COUNT);
  float opticalDepth = 0.0;
  float shadowOpticalDepth = 0.0;
  for (int i = 0; i < SAMPLE_COUNT; ++i) {
    float distance = (float(i) + 0.5) * stepSize;
    vec3 position = rayOrigin + rayDirection * distance;
    float signedHeight = cylinderRadius - length(position.yz);
    float height = max(0.0, signedHeight);
    float halfLength = 2.5 * cylinderRadius;
    float endFade = 1.0 - smoothstep(halfLength * 0.82, halfLength, abs(position.x));
    float habitatMask = 1.0;
    if (cylinderHazeModel == 1) {
      habitatMask = step(0.0, signedHeight) * step(abs(position.x), halfLength);
    }
    float density = modulation * hazeDensityScale * exp(-height * hazeExponent) * endFade * habitatMask;
    opticalDepth += density * stepSize;
    if (distance >= shadowLength) shadowOpticalDepth += density * stepSize;
  }
  float transmittance = saturate(1.0 - exp(-opticalDepth));
  float shadowTransmittance = saturate(1.0 - exp(-shadowOpticalDepth));
  vec3 skyIrradiance = vec3(0.16, 0.42, 1.0);
  vec3 sunIrradiance = vec3(1.0, 0.68, 0.32);
  float albedo = hazeScatteringCoefficient /
    (hazeAbsorptionCoefficient + hazeScatteringCoefficient);
  vec3 inscatter = skyIrradiance * skyLightScale;
  inscatter += sunIrradiance * sunLightScale * phaseFunction(cosTheta) *
    shadowTransmittance * 0.35;
  return vec4(inscatter * albedo, transmittance);
}`,
  );

  source = source.replace(
    'applyAerialPerspective(cameraPosition, frontPosition, shadowLength, color);',
    '// Spherical aerial perspective is intentionally disabled for cylinder mode.',
  );
  return source;
}

function replaceFunction(
  source: string,
  signatureStart: string,
  replacement: string,
): string {
  const start = source.indexOf(signatureStart);
  if (start < 0) return incompatible(signatureStart);
  const open = source.indexOf('{', start);
  if (open < 0) return incompatible(`${signatureStart} opening brace`);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') depth--;
    if (depth === 0) {
      return source.slice(0, start) + replacement + source.slice(index + 1);
    }
  }
  return incompatible(`${signatureStart} closing brace`);
}

function injectAfter(source: string, needle: string, value: string): string {
  const index = source.indexOf(needle);
  if (index < 0) return incompatible(needle);
  const end = index + needle.length;
  return source.slice(0, end) + value + source.slice(end);
}

function injectBefore(source: string, needle: string, value: string): string {
  const index = source.indexOf(needle);
  if (index < 0) return incompatible(needle);
  return source.slice(0, index) + value + source.slice(index);
}

function incompatible(anchor: string): never {
  throw new Error(
    `Unsupported @takram/three-clouds shader: missing cylinder patch anchor "${anchor}".`,
  );
}
