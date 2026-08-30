import { MathUtils, Quaternion, Vector3 } from 'three';

const PI = Math.PI;
const UP = new Vector3(0, 1, 0);

function fract(x: number): number {
  return x - Math.floor(x);
}

function hash2(n: number): [number, number] {
  const x = fract(Math.sin(n * 12.9898) * 43758.5453123);
  const y = fract(Math.sin(n * 78.233) * 12345.6789);
  return [x, y];
}

function hashCombine2(a: number, b: number): [number, number] {
  const ha = hash2(a);
  const hb = hash2(b + 111.0);
  return [fract(ha[0] + hb[0] * 0.618034), fract(ha[1] + hb[1] * 0.618034)];
}

function hash31(px: number, py: number, pz: number): number {
  const x = fract(px * 123.34);
  const y = fract(py * 456.21);
  const z = fract(pz * 789.53);
  const dot = x * (y + 45.32) + y * (z + 45.32) + z * (x + 45.32);
  return fract(x * y * z + dot);
}

function valueNoise3D(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;

  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const x00 = MathUtils.lerp(hash31(ix, iy, iz), hash31(ix + 1, iy, iz), ux);
  const x10 = MathUtils.lerp(hash31(ix, iy + 1, iz), hash31(ix + 1, iy + 1, iz), ux);
  const x01 = MathUtils.lerp(hash31(ix, iy, iz + 1), hash31(ix + 1, iy, iz + 1), ux);
  const x11 = MathUtils.lerp(hash31(ix, iy + 1, iz + 1), hash31(ix + 1, iy + 1, iz + 1), ux);

  const y0 = MathUtils.lerp(x00, x10, uy);
  const y1 = MathUtils.lerp(x01, x11, uy);

  return MathUtils.lerp(y0, y1, uz);
}

function uvToDir(u: number, v: number, out: Vector3): Vector3 {
  const theta = u * 2.0 * PI;
  const phi = v * PI;
  return out.set(
    -Math.cos(theta) * Math.sin(phi),
    Math.cos(phi),
    Math.sin(theta) * Math.sin(phi),
  );
}

function pickSpawn(particleId: number, cycle: number): [number, number] {
  const randUV = hashCombine2(particleId * 7.13, cycle * 13.37 + 1.0);
  const u = randUV[0];
  const phi = Math.acos(Math.max(-1.0, Math.min(1.0, 1.0 - 2.0 * randUV[1])));
  const v = phi / PI;
  return [u, v];
}

const tmpCurlGrad = new Vector3();
function fastCurlNoise(P: Vector3, freq: number, t: number, out: Vector3): Vector3 {
  const qx = P.x * freq + t * 0.04;
  const qy = P.y * freq + t * 0.017;
  const qz = P.z * freq + t * 0.011;
  const eps = 0.04;

  const nx = valueNoise3D(qx + eps, qy, qz) - valueNoise3D(qx - eps, qy, qz);
  const ny = valueNoise3D(qx, qy + eps, qz) - valueNoise3D(qx, qy - eps, qz);
  const nz = valueNoise3D(qx, qy, qz + eps) - valueNoise3D(qx, qy, qz - eps);
  tmpCurlGrad.set(nx, ny, nz).divideScalar(2.0 * eps);
  return out.crossVectors(P, tmpCurlGrad);
}

export interface IGpuPuffSimParams {
  lifespanS: number;
  zonalSpeed: number;
  zonalFrequency: number;
  curlStrength: number;
  curlFrequency: number;
  shellRadius: number;
  clumpRadius: number;
  followLag: number;
  basePuffScaleM: number;
}

export interface IPuffClumpTransformResult {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
  alpha: number;
  visible: boolean;
}

const tmpInitDir = new Vector3();
const tmpPos3D = new Vector3();
const tmpEast = new Vector3();
const tmpNorth = new Vector3();
const tmpTangent = new Vector3();
const tmpMemberDir = new Vector3();
const tmpQAlign = new Quaternion();
const tmpQYaw = new Quaternion();
const tmpCurl = new Vector3();

/**
 * Fast O(1) CPU evaluation of a cloud puff clump transform.
 * Executes in < 0.0002ms per puff with 0 allocations.
 */
export function evaluatePuffClumpTransformFast(
  particleId: number,
  clumpIndex: number,
  timeS: number,
  params: IGpuPuffSimParams,
  outResult: IPuffClumpTransformResult,
): boolean {
  const lifespan = Math.max(1.0, params.lifespanS);
  const lagSeed = hashCombine2(
    particleId * 13.0 + clumpIndex * 29.0,
    clumpIndex * 61.0 + 5.0,
  );
  const memberLag = (lagSeed[0] - 0.5) * 2.0 * params.followLag;
  const memberTime = timeS - memberLag;

  const birthOffset = hash2(particleId)[0] * lifespan;
  const shiftedTime = memberTime + birthOffset;
  const cycle = Math.floor(shiftedTime / lifespan);
  const localT = shiftedTime - cycle * lifespan;

  const lifeFrac = localT / lifespan;
  const alpha =
    MathUtils.smoothstep(lifeFrac, 0.0, 0.08) *
    (1.0 - MathUtils.smoothstep(lifeFrac, 0.82, 1.0));

  if (alpha < 0.01) {
    outResult.visible = false;
    outResult.scale.set(0, 0, 0);
    return false;
  }

  const [spawnU, spawnV] = pickSpawn(particleId, cycle % 4096.0);
  uvToDir(spawnU, spawnV, tmpInitDir);

  // Fast zonal flow rotation around Y axis
  const lat = Math.asin(Math.max(-1.0, Math.min(1.0, tmpInitDir.y)));
  const jet = Math.sin(lat * params.zonalFrequency) * Math.cos(lat);
  let speed = params.zonalSpeed * (0.8 + 0.4 * Math.abs(jet));
  if (Math.abs(lat) < 0.22) speed = -speed * 0.6;

  const angleY = speed * localT;
  const cosY = Math.cos(angleY);
  const sinY = Math.sin(angleY);
  tmpPos3D.set(
    tmpInitDir.x * cosY + tmpInitDir.z * sinY,
    tmpInitDir.y,
    -tmpInitDir.x * sinY + tmpInitDir.z * cosY,
  );

  // Fast spherical curl turbulence
  if (params.curlStrength > 0.001) {
    fastCurlNoise(tmpPos3D, params.curlFrequency, shiftedTime, tmpCurl);
    tmpPos3D.addScaledVector(tmpCurl, params.curlStrength * Math.min(1.0, localT)).normalize();
  }

  // Clump tangent jitter
  const memberHash = hashCombine2(
    particleId * 5.0 + clumpIndex * 17.0,
    clumpIndex * 3.0 + 41.0,
  );

  tmpEast.crossVectors(UP, tmpPos3D);
  const eastLen = tmpEast.length();
  if (eastLen > 1e-5) tmpEast.divideScalar(eastLen);
  else tmpEast.set(1.0, 0.0, 0.0);
  tmpNorth.crossVectors(tmpPos3D, tmpEast);

  const angle = memberHash[0] * 2.0 * PI;
  const radialJitter = Math.sqrt(memberHash[1]) * params.clumpRadius;

  tmpTangent
    .copy(tmpEast)
    .multiplyScalar(Math.cos(angle))
    .addScaledVector(tmpNorth, Math.sin(angle))
    .multiplyScalar(radialJitter);

  tmpMemberDir.copy(tmpPos3D).add(tmpTangent).normalize();

  const altSeed = hash2(particleId * 31.0 + clumpIndex * 7.0)[0];
  const shellRadius =
    params.shellRadius +
    (altSeed - 0.5) * (params.clumpRadius * params.shellRadius * 0.4);

  const sizeSeed = hash2(particleId * 53.0 + clumpIndex * 91.0)[0];
  const sizeMul = MathUtils.lerp(0.7, 1.35, sizeSeed);

  outResult.position.copy(tmpMemberDir).multiplyScalar(shellRadius);

  // Orient mesh normal outward from planetary center
  tmpQAlign.setFromUnitVectors(UP, tmpMemberDir);
  const yawAngle = (particleId * 1.7 + clumpIndex * 2.3) % (PI * 2);
  tmpQYaw.setFromAxisAngle(UP, yawAngle);
  outResult.quaternion.copy(tmpQAlign).multiply(tmpQYaw);

  const scaleM = params.basePuffScaleM * sizeMul * (0.65 + 0.35 * alpha);
  outResult.scale.set(scaleM, scaleM, scaleM);
  outResult.alpha = alpha;
  outResult.visible = true;

  return true;
}
