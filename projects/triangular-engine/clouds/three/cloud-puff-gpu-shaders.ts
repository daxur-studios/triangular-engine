export const GPU_WIND_CORE_GLSL = `
  #define PI 3.14159265359

  vec3 uvToDir(vec2 uv) {
    float theta = uv.x * 2.0 * PI;
    float phi = uv.y * PI;
    return vec3(
      -cos(theta) * sin(phi),
      cos(phi),
      sin(theta) * sin(phi)
    );
  }

  vec2 dirToUv(vec3 dir) {
    float v = acos(clamp(dir.y, -1.0, 1.0)) / PI;
    float u = fract(atan(dir.z, -dir.x) / (2.0 * PI));
    return vec2(u, v);
  }

  vec2 hash2(float n) {
    return fract(sin(vec2(n * 12.9898, n * 78.233)) * vec2(43758.5453123, 12345.6789));
  }

  vec2 hashCombine2(float a, float b) {
    vec2 ha = hash2(a);
    vec2 hb = hash2(b + 111.0);
    return fract(ha + hb * 0.618034);
  }

  float hash31(vec3 p) {
    p = fract(p * vec3(123.34, 456.21, 789.53));
    p += dot(p, p.yxz + 45.32);
    return fract(p.x * p.y * p.z);
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

  vec3 curlNoiseSphere(vec3 P, float freq, float t) {
    vec3 q = P * freq + vec3(t * 0.04, t * 0.017, t * 0.011);
    const float eps = 0.02;
    float nx = valueNoise3D(q + vec3(eps,0,0)) - valueNoise3D(q - vec3(eps,0,0));
    float ny = valueNoise3D(q + vec3(0,eps,0)) - valueNoise3D(q - vec3(0,eps,0));
    float nz = valueNoise3D(q + vec3(0,0,eps)) - valueNoise3D(q - vec3(0,0,eps));
    vec3 grad = vec3(nx, ny, nz) / (2.0 * eps);
    return cross(P, grad);
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

  vec2 pickSpawn(float particleId, float cycle) {
    vec2 randUV = hashCombine2(particleId * 7.13, cycle * 13.37 + 1.0);
    float u = randUV.x;
    float phi = acos(clamp(1.0 - 2.0 * randUV.y, -1.0, 1.0));
    float v = phi / PI;
    return vec2(u, v);
  }

  void main() {
    float lifespan = max(1.0, uLifespan);
    vec2 lagSeed = hashCombine2(
      aParticleId * 13.0 + aClumpIndex * 29.0,
      aClumpIndex * 61.0 + 5.0
    );
    float memberLag = (lagSeed.x - 0.5) * 2.0 * uFollowLag;
    float memberTime = uTime - memberLag;

    float birthOffset = hash2(aParticleId).x * lifespan;
    float shiftedTime = memberTime + birthOffset;
    float cycle = floor(shiftedTime / lifespan);
    float localT = shiftedTime - cycle * lifespan;
    float cycleStartTime = shiftedTime - localT;

    vec2 spawnUV = pickSpawn(aParticleId, mod(cycle, 4096.0));
    vec3 pos3D = advectAlongWind(uvToDir(spawnUV), cycleStartTime, localT, lifespan);

    float lifeFrac = localT / lifespan;
    vAlpha = smoothstep(0.0, 0.08, lifeFrac) * (1.0 - smoothstep(0.82, 1.0, lifeFrac));

    vec2 memberHash = hashCombine2(
      aParticleId * 5.0 + aClumpIndex * 17.0,
      aClumpIndex * 3.0 + 41.0
    );
    vec3 east = cross(vec3(0.0, 1.0, 0.0), pos3D);
    float eastLen = length(east);
    east = eastLen > 1e-5 ? east / eastLen : vec3(1.0, 0.0, 0.0);
    vec3 north = cross(pos3D, east);

    float angle = memberHash.x * 2.0 * PI;
    float radialJitter = sqrt(memberHash.y) * uClumpRadius;
    vec3 tangentOffset = (east * cos(angle) + north * sin(angle)) * radialJitter;
    vec3 memberDir = normalize(pos3D + tangentOffset);

    float altSeed = hash2(aParticleId * 31.0 + aClumpIndex * 7.0).x;
    float shellRadius = uShellRadius + (altSeed - 0.5) * (uClumpRadius * uShellRadius * 0.4);

    float sizeSeed = hash2(aParticleId * 53.0 + aClumpIndex * 91.0).x;
    float sizeMul = mix(0.7, 1.35, sizeSeed);
    float alphaSeed = hash2(aParticleId * 71.0 + aClumpIndex * 113.0).x;
    vAlpha *= mix(0.75, 1.0, alphaSeed);
    vSeed = sizeSeed;
    vWorldNormal = memberDir;
    vSunDir = normalize(uSunDirection);

    vec3 worldPos = memberDir * shellRadius;

    // Cross-fade close-up GPU puffs when 3D detailed meshes take over
    if (uLodDistance > 0.0) {
      float camDist = distance(worldPos, uCameraPosition);
      if (camDist < uLodDistance) {
        float fade = smoothstep(uLodDistance * 0.7, uLodDistance, camDist);
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
  varying float vAlpha;
  varying float vSeed;
  varying vec3 vWorldNormal;
  varying vec3 vSunDir;
  uniform vec3 uPuffColor;
  uniform float uRimStrength;

  float hash1(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  void main() {
    if (vAlpha < 0.01) discard;

    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    float angle = atan(c.y, c.x);

    // Procedural multi-lobed cloud puff silhouette
    float freqA = mix(3.0, 6.0, hash1(vSeed * 17.0 + 1.0));
    float freqB = mix(7.0, 11.0, hash1(vSeed * 29.0 + 4.0));
    float ampA = mix(0.02, 0.07, hash1(vSeed * 53.0 + 2.0));
    float ampB = mix(0.01, 0.04, hash1(vSeed * 71.0 + 6.0));
    float bump = ampA * sin(angle * freqA + vSeed * 6.2831853)
               + ampB * sin(angle * freqB + vSeed * 11.0);
    float dEff = d - bump;
    if (dEff > 0.5) discard;

    // Crisp edge with anti-aliasing
    float edge = 1.0 - smoothstep(0.40, 0.5, dEff);

    // Spherical billboard normal approximation for lighting
    vec3 spriteNormal = normalize(vec3(c.x * 2.0, -c.y * 2.0, sqrt(max(0.0, 1.0 - 4.0 * d * d))));
    vec3 N = normalize(mix(vWorldNormal, spriteNormal, 0.65));

    // Sun directional lighting + ambient + rim
    float NdotL = max(0.0, dot(N, vSunDir));
    float rim = pow(1.0 - max(0.0, dot(vec3(0.0, 0.0, 1.0), N)), 2.0) * uRimStrength;
    vec3 litColor = uPuffColor * (0.45 + 0.55 * NdotL + rim * 0.3);

    gl_FragColor = vec4(litColor, edge * vAlpha * 0.92);
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

  vec2 pickSpawn(float particleId, float cycle) {
    vec2 randUV = hashCombine2(particleId * 11.17, cycle * 17.29 + 3.0);
    float u = randUV.x;
    float phi = acos(clamp(1.0 - 2.0 * randUV.y, -1.0, 1.0));
    float v = phi / PI;
    return vec2(u, v);
  }

  void main() {
    float lifespan = max(1.0, uLifespan * 1.5);
    float birthOffset = hash2(aParticleId * 19.0).x * lifespan;
    float shiftedTime = uTime + birthOffset;
    float cycle = floor(shiftedTime / lifespan);
    float localT = shiftedTime - cycle * lifespan;
    float cycleStartTime = shiftedTime - localT;

    vec2 spawnUV = pickSpawn(aParticleId, mod(cycle, 4096.0));
    vec3 pos3D = advectAlongWind(uvToDir(spawnUV), cycleStartTime, localT, lifespan);

    float lifeFrac = localT / lifespan;
    vAlpha = smoothstep(0.0, 0.12, lifeFrac) * (1.0 - smoothstep(0.78, 1.0, lifeFrac)) * 0.55;

    vWorldNormal = pos3D;
    vSunDir = normalize(uSunDirection);

    vec3 worldPos = pos3D * uShellRadius;
    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp((uPuffPixelScale * 25.0) / max(0.001, -mvPosition.z), 1.0, 400.0);
  }
`;

export const GPU_CIRRUS_FRAGMENT_SHADER = `
  precision highp float;
  varying float vAlpha;
  varying vec3 vWorldNormal;
  varying vec3 vSunDir;
  uniform vec3 uCirrusColor;

  void main() {
    if (vAlpha < 0.01) discard;

    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;

    float edge = 1.0 - smoothstep(0.1, 0.5, d);
    float NdotL = max(0.0, dot(vWorldNormal, vSunDir));
    vec3 litColor = uCirrusColor * (0.6 + 0.4 * NdotL);

    gl_FragColor = vec4(litColor, edge * vAlpha);
  }
`;
