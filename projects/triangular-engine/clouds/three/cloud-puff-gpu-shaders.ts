export const GPU_WIND_CORE_GLSL = /* glsl */ `
  const float PI = 3.141592653589793;

  float hash1(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  vec2 hash2(float n) {
    return vec2(
      fract(sin(n * 12.9898) * 43758.5453123),
      fract(sin(n * 78.233) * 12345.6789)
    );
  }

  vec2 hashCombine2(float a, float b) {
    vec2 ha = hash2(a);
    vec2 hb = hash2(b + 111.0);
    return vec2(fract(ha.x + hb.x * 0.618034), fract(ha.y + hb.y * 0.618034));
  }

  float hash31(vec3 p) {
    p = fract(p * vec3(123.34, 456.21, 789.53));
    p += dot(p, p.yzx + 45.32);
    return fract(p.x * p.y * p.z);
  }

  float valueNoise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);

    float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(i + vec3(1.0, 1.0, 1.0));

    float x00 = mix(n000, n100, u.x);
    float x10 = mix(n010, n110, u.x);
    float x01 = mix(n001, n101, u.x);
    float x11 = mix(n011, n111, u.x);

    float y0 = mix(x00, x10, u.y);
    float y1 = mix(x01, x11, u.y);

    return mix(y0, y1, u.z);
  }

  vec3 curlNoiseSphere(vec3 P, float freq, float t) {
    vec3 q = P * freq + vec3(t * 0.04, t * 0.017, t * 0.011);
    float eps = 0.02;
    float nx = valueNoise3D(q + vec3(eps, 0.0, 0.0)) - valueNoise3D(q - vec3(eps, 0.0, 0.0));
    float ny = valueNoise3D(q + vec3(0.0, eps, 0.0)) - valueNoise3D(q - vec3(0.0, eps, 0.0));
    float nz = valueNoise3D(q + vec3(0.0, 0.0, eps)) - valueNoise3D(q - vec3(0.0, 0.0, eps));
    vec3 grad = vec3(nx, ny, nz) / (2.0 * eps);
    return cross(P, grad);
  }

  vec3 uvToDir(vec2 uv) {
    float theta = uv.x * 2.0 * PI;
    float phi = uv.y * PI;
    return vec3(
      -cos(theta) * sin(phi),
      cos(phi),
      sin(theta) * sin(phi)
    );
  }

  vec2 pickSpawn(float particleId, float cycle) {
    vec2 randUV = hashCombine2(particleId * 7.13, cycle * 13.37 + 1.0);
    float u = randUV.x;
    float phi = acos(clamp(1.0 - 2.0 * randUV.y, -1.0, 1.0));
    float v = phi / PI;
    return vec2(u, v);
  }
`;

export const GPU_PUFF_CLUMP_VERTEX_SHADER = `
  precision highp float;

  attribute float aParticleId;
  attribute float aClumpIndex;

  uniform float uTime;
  uniform float uLifespan;
  uniform float uZonalSpeed;
  uniform float uZonalFrequency;
  uniform float uCurlStrength;
  uniform float uCurlFrequency;
  uniform float uPuffPixelScale;
  uniform float uClumpRadius;
  uniform float uFollowLag;
  uniform float uShellRadius;
  uniform vec3 uSunDirection;
  uniform vec3 uCameraPosition;
  uniform float uLodDistance;

  varying float vAlpha;
  varying float vSeed;
  varying vec3 vWorldNormal;
  varying vec3 vSunDir;
  varying vec3 vWorldPos;

  ${GPU_WIND_CORE_GLSL}

  vec3 windField(vec3 P, float t) {
    float lat = asin(clamp(P.y, -1.0, 1.0));
    float jet = sin(lat * uZonalFrequency) * cos(lat);
    float speed = uZonalSpeed * (0.8 + 0.4 * abs(jet));
    if (abs(lat) < 0.22) speed = -speed * 0.6;

    vec3 north = vec3(0.0, 1.0, 0.0);
    vec3 east = cross(north, P);
    float len = length(east);
    east = len > 1e-5 ? east / len : vec3(1.0, 0.0, 0.0);
    north = cross(P, east);

    vec3 baseFlow = east * speed;
    vec3 curl = curlNoiseSphere(P, uCurlFrequency, t) * uCurlStrength;
    return baseFlow + curl;
  }

  vec3 advectStepRK2(vec3 P, float t, float dt) {
    vec3 v1 = windField(P, t);
    vec3 pMid = normalize(P + v1 * (dt * 0.5));
    vec3 v2 = windField(pMid, t + dt * 0.5);
    return normalize(P + v2 * dt);
  }

  vec3 advectAlongWind(vec3 initialDir, float startTime, float localT, float lifespan) {
    const int NUM_STEPS = 16;
    float dt = lifespan / float(NUM_STEPS);
    float stepsFloat = localT / dt;
    int fullSteps = int(floor(stepsFloat));
    float stepFrac = fract(stepsFloat);

    vec3 P = initialDir;
    float t = startTime;

    for (int s = 0; s < NUM_STEPS; s++) {
      if (s >= fullSteps) break;
      P = advectStepRK2(P, t, dt);
      t += dt;
    }

    if (stepFrac > 0.001) {
      P = advectStepRK2(P, t, dt * stepFrac);
    }
    return normalize(P);
  }

  void main() {
    float lifespan = max(1.0, uLifespan);
    vec2 lagSeed = hashCombine2(aParticleId * 13.0 + aClumpIndex * 29.0, aClumpIndex * 61.0 + 5.0);
    float memberLag = (lagSeed.x - 0.5) * 2.0 * uFollowLag;
    float memberTime = uTime - memberLag;

    float birthOffset = hash2(aParticleId).x * lifespan;
    float shiftedTime = memberTime + birthOffset;
    float cycle = floor(shiftedTime / lifespan);
    float localT = shiftedTime - cycle * lifespan;
    float cycleStartTime = shiftedTime - localT;

    vec2 spawnUV = pickSpawn(aParticleId, mod(cycle, 4096.0));
    vec3 initDir = uvToDir(spawnUV);

    vec3 pos3D = advectAlongWind(initDir, cycleStartTime, localT, lifespan);

    float lifeFrac = localT / lifespan;
    vAlpha = smoothstep(0.0, 0.08, lifeFrac) * (1.0 - smoothstep(0.82, 1.0, lifeFrac));

    vec2 memberHash = hashCombine2(aParticleId * 5.0 + aClumpIndex * 17.0, aClumpIndex * 3.0 + 41.0);
    vec3 north = vec3(0.0, 1.0, 0.0);
    vec3 east = cross(north, pos3D);
    float eastLen = length(east);
    east = eastLen > 1e-5 ? east / eastLen : vec3(1.0, 0.0, 0.0);
    north = cross(pos3D, east);

    float angle = memberHash.x * 2.0 * PI;
    float radialJitter = sqrt(memberHash.y) * uClumpRadius;
    vec3 tangentOffset = (east * cos(angle) + north * sin(angle)) * radialJitter;

    vec3 memberDir = normalize(pos3D + tangentOffset);

    float altSeed = hash2(aParticleId * 31.0 + aClumpIndex * 7.0).x;
    float shellRadius = uShellRadius + (altSeed - 0.5) * (uClumpRadius * uShellRadius * 0.4);

    float sizeSeed = hash2(aParticleId * 53.0 + aClumpIndex * 91.0).x;
    float sizeMul = mix(0.7, 1.35, sizeSeed);
    float alphaSeed = hash2(aParticleId * 71.0 + aClumpIndex * 113.0).x;
    vAlpha *= mix(0.8, 1.0, alphaSeed);
    vSeed = sizeSeed;
    vWorldNormal = memberDir;
    vSunDir = normalize(uSunDirection);

    vec3 worldPos = memberDir * shellRadius;
    vWorldPos = worldPos;

    // Cross-fade close-up GPU puffs when 3D detailed meshes take over (only if lodDistance > 0)
    if (uLodDistance > 0.0) {
      float camDist = distance(worldPos, uCameraPosition);
      if (camDist < uLodDistance) {
        float fade = smoothstep(uLodDistance * 0.4, uLodDistance, camDist);
        vAlpha *= fade;
      }
    }

    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp((uPuffPixelScale * 40.0) / max(0.001, -mvPosition.z), 1.0, 800.0) * sizeMul;
  }
`;

export const GPU_PUFF_FRAGMENT_SHADER = `
  precision highp float;

  #define MAX_POINT_LIGHTS 4

  varying float vAlpha;
  varying float vSeed;
  varying vec3 vWorldNormal;
  varying vec3 vSunDir;
  varying vec3 vWorldPos;

  uniform vec3 uPuffColor;
  uniform float uRimStrength;
  uniform vec3 uCameraPosition;

  uniform vec3 uPointLightPositions[MAX_POINT_LIGHTS];
  uniform vec3 uPointLightColors[MAX_POINT_LIGHTS];
  uniform float uPointLightIntensities[MAX_POINT_LIGHTS];
  uniform int uPointLightCount;

  float hash1(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  void main() {
    if (vAlpha < 0.01) discard;

    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    float angle = atan(c.y, c.x);

    // Procedural multi-lobed cumulus puff silhouette
    float freqA = mix(3.0, 6.0, hash1(vSeed * 17.0 + 1.0));
    float freqB = mix(7.0, 11.0, hash1(vSeed * 29.0 + 4.0));
    float ampA = mix(0.025, 0.065, hash1(vSeed * 53.0 + 2.0));
    float ampB = mix(0.01, 0.035, hash1(vSeed * 71.0 + 6.0));
    float bump = ampA * sin(angle * freqA + vSeed * 6.2831853)
               + ampB * sin(angle * freqB + vSeed * 11.0);
    float dEff = d - bump;
    if (dEff > 0.5) discard;

    float edge = 1.0 - smoothstep(0.42, 0.5, dEff);

    // Reconstruct 3D spherical dome normal with organic billow variation
    float zHemi = sqrt(max(0.0, 1.0 - 4.0 * d * d));
    vec3 spriteNormal = normalize(vec3(c.x * 2.0, -c.y * 2.0, zHemi));
    vec3 N = normalize(mix(vWorldNormal, spriteNormal, 0.65));

    // 1. Sunlight & Planetary Shadow (Day / Night Terminator)
    float planetSunDot = dot(vWorldNormal, vSunDir);
    float dayFactor = smoothstep(-0.25, 0.15, planetSunDot);

    // Direct sun illumination on cloud face
    float NdotL = max(0.0, dot(N, vSunDir));

    // Cloud self-shadowing (ambient occlusion from base of cloud)
    float baseOcclusion = smoothstep(-0.3, 0.4, dot(N, vWorldNormal));

    // Forward scatter / Silver lining when looking toward the sun
    vec3 viewDir = normalize(uCameraPosition - vWorldPos);
    float viewDotSun = dot(viewDir, vSunDir);
    float silverLining = pow(max(0.0, viewDotSun * 0.5 + 0.5), 3.0) * pow(1.0 - max(0.0, dot(vec3(0.0, 0.0, 1.0), spriteNormal)), 2.0) * uRimStrength;

    // Sunset / Sunrise warm atmospheric scattering tint
    float sunsetFactor = exp(-planetSunDot * planetSunDot * 18.0) * (1.0 - abs(planetSunDot));
    vec3 sunColor = mix(vec3(1.0, 0.98, 0.94), vec3(1.0, 0.55, 0.25), sunsetFactor * 0.85);

    // Day light vs Night ambient
    vec3 dayAmbient = vec3(0.28, 0.35, 0.45) * uPuffColor * baseOcclusion;
    vec3 directSunLight = sunColor * uPuffColor * (NdotL * 0.75 + silverLining * 0.5);
    vec3 dayColor = dayAmbient + directSunLight;

    vec3 nightAmbient = vec3(0.03, 0.05, 0.09) * uPuffColor;
    vec3 litColor = mix(nightAmbient, dayColor, dayFactor);

    // 2. Dynamic Point Lights (Rocket engine & storm lightning)
    vec3 pointLightContrib = vec3(0.0);
    for (int i = 0; i < MAX_POINT_LIGHTS; i++) {
      if (i >= uPointLightCount) break;
      vec3 toLight = uPointLightPositions[i] - vWorldPos;
      float dist = length(toLight);
      vec3 lightDir = toLight / max(dist, 0.001);
      float attenuation = uPointLightIntensities[i] / (1.0 + dist * dist * 0.02);
      
      float lambert = max(0.0, dot(N, lightDir));
      float insideGlow = pow(1.0 - max(0.0, dot(-N, lightDir)), 1.5);
      pointLightContrib += uPointLightColors[i] * attenuation * (lambert * 0.7 + insideGlow * 0.9);
    }

    litColor += pointLightContrib;

    gl_FragColor = vec4(litColor, edge * vAlpha * 0.95);
  }
`;

export const GPU_CIRRUS_VERTEX_SHADER = `
  precision highp float;

  attribute float aParticleId;
  attribute float aClumpIndex;

  uniform float uTime;
  uniform float uLifespan;
  uniform float uZonalSpeed;
  uniform float uZonalFrequency;
  uniform float uCurlStrength;
  uniform float uCurlFrequency;
  uniform float uPuffPixelScale;
  uniform float uShellRadius;
  uniform vec3 uSunDirection;

  varying float vAlpha;
  varying vec3 vWorldNormal;
  varying vec3 vSunDir;

  ${GPU_WIND_CORE_GLSL}

  vec3 windField(vec3 P, float t) {
    float lat = asin(clamp(P.y, -1.0, 1.0));
    float jet = sin(lat * uZonalFrequency) * cos(lat);
    float speed = uZonalSpeed * (0.9 + 0.5 * abs(jet));
    if (abs(lat) < 0.22) speed = -speed * 0.6;

    vec3 north = vec3(0.0, 1.0, 0.0);
    vec3 east = cross(north, P);
    float len = length(east);
    east = len > 1e-5 ? east / len : vec3(1.0, 0.0, 0.0);
    north = cross(P, east);

    vec3 baseFlow = east * speed;
    vec3 curl = curlNoiseSphere(P, uCurlFrequency, t) * uCurlStrength;
    return baseFlow + curl;
  }

  vec3 advectStepRK2(vec3 P, float t, float dt) {
    vec3 v1 = windField(P, t);
    vec3 pMid = normalize(P + v1 * (dt * 0.5));
    vec3 v2 = windField(pMid, t + dt * 0.5);
    return normalize(P + v2 * dt);
  }

  vec3 advectAlongWind(vec3 initialDir, float startTime, float localT, float lifespan) {
    const int NUM_STEPS = 16;
    float dt = lifespan / float(NUM_STEPS);
    float stepsFloat = localT / dt;
    int fullSteps = int(floor(stepsFloat));
    float stepFrac = fract(stepsFloat);

    vec3 P = initialDir;
    float t = startTime;

    for (int s = 0; s < NUM_STEPS; s++) {
      if (s >= fullSteps) break;
      P = advectStepRK2(P, t, dt);
      t += dt;
    }

    if (stepFrac > 0.001) {
      P = advectStepRK2(P, t, dt * stepFrac);
    }
    return normalize(P);
  }

  void main() {
    float lifespan = max(1.0, uLifespan);
    float birthOffset = hash2(aParticleId * 17.0).x * lifespan;
    float shiftedTime = uTime + birthOffset;
    float cycle = floor(shiftedTime / lifespan);
    float localT = shiftedTime - cycle * lifespan;
    float cycleStartTime = shiftedTime - localT;

    vec2 spawnUV = pickSpawn(aParticleId + 5000.0, mod(cycle, 4096.0));
    vec3 initDir = uvToDir(spawnUV);

    vec3 pos3D = advectAlongWind(initDir, cycleStartTime, localT, lifespan);

    float lifeFrac = localT / lifespan;
    vAlpha = smoothstep(0.0, 0.15, lifeFrac) * (1.0 - smoothstep(0.75, 1.0, lifeFrac)) * 0.35;

    vec3 worldPos = pos3D * uShellRadius;
    vWorldNormal = pos3D;
    vSunDir = normalize(uSunDirection);

    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp((uPuffPixelScale * 60.0) / max(0.001, -mvPosition.z), 1.0, 600.0);
  }
`;

export const GPU_CIRRUS_FRAGMENT_SHADER = `
  precision highp float;
  varying float vAlpha;
  varying vec3 vWorldNormal;
  varying vec3 vSunDir;
  uniform vec3 uCirrusColor;

  void main() {
    if (vAlpha < 0.005) discard;
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;

    float edge = 1.0 - smoothstep(0.1, 0.5, d);
    float dayFactor = smoothstep(-0.25, 0.15, dot(vWorldNormal, vSunDir));
    vec3 color = uCirrusColor * (0.15 + 0.85 * dayFactor);
    gl_FragColor = vec4(color, edge * vAlpha);
  }
`;
