import { Vector3 } from 'three';

function fract(x: number): number {
  return x - Math.floor(x);
}

/** Deterministic 3D pseudo-random hash. */
export function hash31(x: number, y: number, z: number): number {
  const px = fract(x * 123.34);
  const py = fract(y * 456.21);
  const pz = fract(z * 789.53);
  const dot = px * py + py * pz + pz * 45.32;
  const pxx = px + dot;
  const pyy = py + dot;
  const pzz = pz + dot;
  return fract(pxx * pyy * pzz);
}

export function hash2(n: number): { x: number; y: number } {
  const x = fract(Math.sin(n * 12.9898) * 43758.5453123);
  const y = fract(Math.sin(n * 78.233) * 12345.6789);
  return { x, y };
}

/** Smooth 3D value noise with quintic interpolation. */
export function valueNoise3D(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;

  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);
  const uz = fz * fz * (3.0 - 2.0 * fz);

  const n000 = hash31(ix, iy, iz);
  const n100 = hash31(ix + 1, iy, iz);
  const n010 = hash31(ix, iy + 1, iz);
  const n110 = hash31(ix + 1, iy + 1, iz);
  const n001 = hash31(ix, iy, iz + 1);
  const n101 = hash31(ix + 1, iy, iz + 1);
  const n011 = hash31(ix, iy + 1, iz + 1);
  const n111 = hash31(ix + 1, iy + 1, iz + 1);

  const nx00 = n000 + ux * (n100 - n000);
  const nx10 = n010 + ux * (n110 - n010);
  const nx01 = n001 + ux * (n101 - n001);
  const nx11 = n011 + ux * (n111 - n011);

  const nxy0 = nx00 + uy * (nx10 - nx00);
  const nxy1 = nx01 + uy * (nx11 - nx01);

  return nxy0 + uz * (nxy1 - nxy0);
}

const EPS = 0.04;
const INV_TWO_EPS = 1.0 / (2.0 * EPS);

export function uvToDir(u: number, v: number, out: Vector3 = new Vector3()): Vector3 {
  const theta = u * 2.0 * Math.PI;
  const phi = v * Math.PI;
  out.set(
    -Math.cos(theta) * Math.sin(phi),
    Math.cos(phi),
    Math.sin(theta) * Math.sin(phi),
  );
  return out;
}

export function dirToUv(dir: Vector3): { u: number; v: number } {
  const v = Math.acos(Math.max(-1, Math.min(1, dir.y))) / Math.PI;
  let u = Math.atan2(dir.z, -dir.x) / (2.0 * Math.PI);
  u = u - Math.floor(u);
  return { u, v };
}

// ---------------------------------------------------------------------------
// Spherical Wind Field & 16-Step RK2 Streamline Advection
// ---------------------------------------------------------------------------

export interface ISphereWindFieldParams {
  zonalSpeed: number;
  zonalFrequency: number;
  curlFrequency: number;
  curlStrength: number;
}

/**
 * Evaluates the 3D instantaneous velocity vector strictly tangential to the unit sphere.
 * Combines latitude-banded zonal jets + multi-octave 3D spherical curl noise.
 */
export function windFieldSphere3D(
  P: Vector3,
  t: number,
  params: ISphereWindFieldParams,
  out: Vector3 = new Vector3(),
): Vector3 {
  const lat = Math.asin(Math.max(-1, Math.min(1, P.y)));
  const eastX = -P.z;
  const eastY = 0;
  const eastZ = P.x;
  const eastLen = Math.hypot(eastX, eastZ);
  const normEastX = eastLen > 1e-5 ? eastX / eastLen : 0;
  const normEastZ = eastLen > 1e-5 ? eastZ / eastLen : 0;

  // Zonal factor: alternating east/west jets with latitude (trade winds / jet streams)
  const zonalFactor = Math.sin(params.zonalFrequency * lat);
  const baseSpeed = params.zonalSpeed * zonalFactor;
  let flowX = normEastX * baseSpeed;
  let flowY = 0;
  let flowZ = normEastZ * baseSpeed;

  // Spherical curl noise (creates swirling cyclonic vortices & atmospheric eddies)
  if (params.curlStrength > 0.0001) {
    const qx = P.x * params.curlFrequency + t * 0.04;
    const qy = P.y * params.curlFrequency + t * 0.017;
    const qz = P.z * params.curlFrequency + t * 0.011;

    const nx = valueNoise3D(qx + EPS, qy, qz) - valueNoise3D(qx - EPS, qy, qz);
    const ny = valueNoise3D(qx, qy + EPS, qz) - valueNoise3D(qx, qy - EPS, qz);
    const nz = valueNoise3D(qx, qy, qz + EPS) - valueNoise3D(qx, qy, qz - EPS);

    const gradX = nx * INV_TWO_EPS;
    const gradY = ny * INV_TWO_EPS;
    const gradZ = nz * INV_TWO_EPS;

    // cross(P, grad) is mathematically guaranteed tangential to P
    const curlX = (P.y * gradZ - P.z * gradY) * params.curlStrength;
    const curlY = (P.z * gradX - P.x * gradZ) * params.curlStrength;
    const curlZ = (P.x * gradY - P.y * gradX) * params.curlStrength;

    flowX += curlX;
    flowY += curlY;
    flowZ += curlZ;
  }

  // Strictly project onto sphere tangent plane: flow -= P * dot(flow, P)
  const dot = flowX * P.x + flowY * P.y + flowZ * P.z;
  out.set(flowX - P.x * dot, flowY - P.y * dot, flowZ - P.z * dot);
  return out;
}

const ADVECT_STEPS = 16;
const ADVECT_MAX_STEP = 0.12;

/**
 * 16-step Runge-Kutta 2nd-order (RK2) streamline integrator for spherical planetary surfaces.
 * Integrates the velocity field from spawnDir over localT to trace true continuous whirly streamlines.
 */
export function advectSphereAlongWind(
  spawnDir: Vector3,
  cycleStartTime: number,
  localT: number,
  lifespan: number,
  params: ISphereWindFieldParams,
  outPos: Vector3 = new Vector3(),
): Vector3 {
  outPos.copy(spawnDir);
  const fixedDt = lifespan / ADVECT_STEPS;
  const k1 = new Vector3();
  const midPos = new Vector3();
  const step = new Vector3();

  for (let i = 0; i < ADVECT_STEPS; i++) {
    const stepStart = i * fixedDt;
    const dt = Math.max(0, Math.min(localT - stepStart, fixedDt));
    if (dt <= 0) continue;
    const ti = cycleStartTime + stepStart;

    windFieldSphere3D(outPos, ti, params, k1);
    midPos.copy(outPos).addScaledVector(k1, dt * 0.5).normalize();
    windFieldSphere3D(midPos, ti + dt * 0.5, params, step);
    step.multiplyScalar(dt);

    const stepLen = step.length();
    if (stepLen > ADVECT_MAX_STEP) {
      step.multiplyScalar(ADVECT_MAX_STEP / stepLen);
    }
    outPos.add(step).normalize();
  }
  return outPos;
}

// ---------------------------------------------------------------------------
// Cylindrical Wind Field & RK2 Streamline Advection
// ---------------------------------------------------------------------------

export interface ICylinderWindFieldParams {
  circumferentialSpeed: number;
  curlFrequency: number;
  curlStrength: number;
  lengthM: number;
}

/**
 * Evaluates instantaneous velocity (dPhi/dt, dZ/dt) along a cylinder's inner surface.
 * Enforces boundary conditions at closed end caps (dZ/dt -> 0 at +/- length/2).
 */
export function windFieldCylinder(
  phi: number,
  z: number,
  t: number,
  params: ICylinderWindFieldParams,
): { dPhi: number; dZ: number } {
  const halfLen = params.lengthM / 2;
  const zNorm = Math.max(-0.99, Math.min(0.99, z / halfLen));

  // Circumferential flow matching cylinder rotation / artificial gravity
  let dPhi = params.circumferentialSpeed;
  let dZ = 0;

  if (params.curlStrength > 0.0001) {
    const qx = Math.cos(phi) * params.curlFrequency + t * 0.05;
    const qy = Math.sin(phi) * params.curlFrequency + t * 0.03;
    const qz = zNorm * params.curlFrequency + t * 0.02;

    const nx = valueNoise3D(qx + EPS, qy, qz) - valueNoise3D(qx - EPS, qy, qz);
    const nz = valueNoise3D(qx, qy, qz + EPS) - valueNoise3D(qx, qy, qz - EPS);

    const eddyPhi = -nz * INV_TWO_EPS * params.curlStrength * 0.2;
    // Axial eddy is dampened near end caps: (1 - zNorm^4)
    const capGate = Math.max(0, 1.0 - Math.pow(zNorm, 4));
    const eddyZ = nx * INV_TWO_EPS * params.curlStrength * (params.lengthM * 0.08) * capGate;

    dPhi += eddyPhi;
    dZ += eddyZ;
  }

  return { dPhi, dZ };
}

/**
 * 16-step RK2 streamline integrator for cylindrical interior habitats.
 * Clouds circulate circumferentially around the curve with bounded internal eddies.
 */
export function advectCylinderAlongWind(
  spawnPhi: number,
  spawnZ: number,
  cycleStartTime: number,
  localT: number,
  lifespan: number,
  params: ICylinderWindFieldParams,
): { phi: number; z: number } {
  let phi = spawnPhi;
  let z = spawnZ;
  const fixedDt = lifespan / ADVECT_STEPS;
  const halfLen = (params.lengthM / 2) * 0.85;

  for (let i = 0; i < ADVECT_STEPS; i++) {
    const stepStart = i * fixedDt;
    const dt = Math.max(0, Math.min(localT - stepStart, fixedDt));
    if (dt <= 0) continue;
    const ti = cycleStartTime + stepStart;

    const k1 = windFieldCylinder(phi, z, ti, params);
    const midPhi = phi + k1.dPhi * dt * 0.5;
    const midZ = Math.max(-halfLen, Math.min(halfLen, z + k1.dZ * dt * 0.5));

    const k2 = windFieldCylinder(midPhi, midZ, ti + dt * 0.5, params);
    phi += k2.dPhi * dt;
    z = Math.max(-halfLen, Math.min(halfLen, z + k2.dZ * dt));
  }

  return { phi, z };
}

// ---------------------------------------------------------------------------
// 3D Cartesian Wind Field & RK2 Streamline Advection
// ---------------------------------------------------------------------------

export interface IBoxWindFieldParams {
  velocity: readonly [number, number, number];
  curlFrequency: number;
  curlStrength: number;
  regionSizeM: readonly [number, number, number];
}

export function windFieldBox3D(
  pos: Vector3,
  t: number,
  params: IBoxWindFieldParams,
  out: Vector3 = new Vector3(),
): Vector3 {
  const [vx, vy, vz] = params.velocity;
  let flowX = vx;
  let flowY = vy;
  let flowZ = vz;

  if (params.curlStrength > 0.0001) {
    const qx = pos.x * params.curlFrequency + t * 0.05;
    const qy = pos.y * params.curlFrequency + t * 0.03;
    const qz = pos.z * params.curlFrequency + t * 0.02;

    const psiX = valueNoise3D(qx, qy + 17.1, qz + 31.4);
    const psiY = valueNoise3D(qx + 43.7, qy, qz + 11.9);
    const psiZ = valueNoise3D(qx + 29.3, qy + 57.2, qz);

    const dPsiZ_dy = (valueNoise3D(qx + 29.3, qy + 57.2 + EPS, qz) - valueNoise3D(qx + 29.3, qy + 57.2 - EPS, qz)) * INV_TWO_EPS;
    const dPsiY_dz = (valueNoise3D(qx + 43.7, qy, qz + 11.9 + EPS) - valueNoise3D(qx + 43.7, qy, qz + 11.9 - EPS)) * INV_TWO_EPS;

    const dPsiX_dz = (valueNoise3D(qx, qy + 17.1, qz + 31.4 + EPS) - valueNoise3D(qx, qy + 17.1, qz + 31.4 - EPS)) * INV_TWO_EPS;
    const dPsiZ_dx = (valueNoise3D(qx + 29.3 + EPS, qy + 57.2, qz) - valueNoise3D(qx + 29.3 - EPS, qy + 57.2, qz)) * INV_TWO_EPS;

    const dPsiY_dx = (valueNoise3D(qx + 43.7 + EPS, qy, qz + 11.9) - valueNoise3D(qx + 43.7 - EPS, qy, qz + 11.9)) * INV_TWO_EPS;
    const dPsiX_dy = (valueNoise3D(qx, qy + 17.1 + EPS, qz + 31.4) - valueNoise3D(qx, qy + 17.1 - EPS, qz + 31.4)) * INV_TWO_EPS;

    const scale = params.curlStrength * 6.0;
    flowX += (dPsiZ_dy - dPsiY_dz) * scale;
    flowY += (dPsiX_dz - dPsiZ_dx) * scale;
    flowZ += (dPsiY_dx - dPsiX_dy) * scale;
  }

  out.set(flowX, flowY, flowZ);
  return out;
}

export function wrapAxisValue(val: number, halfRange: number): number {
  if (halfRange <= 0) return 0;
  const range = halfRange * 2;
  let wrapped = (val + halfRange) % range;
  if (wrapped < 0) wrapped += range;
  return wrapped - halfRange;
}

export function advectBoxAlongWind(
  spawnPos: Vector3,
  cycleStartTime: number,
  localT: number,
  lifespan: number,
  params: IBoxWindFieldParams,
  outPos: Vector3 = new Vector3(),
): Vector3 {
  outPos.copy(spawnPos);
  const fixedDt = lifespan / ADVECT_STEPS;
  const k1 = new Vector3();
  const midPos = new Vector3();
  const step = new Vector3();

  for (let i = 0; i < ADVECT_STEPS; i++) {
    const stepStart = i * fixedDt;
    const dt = Math.max(0, Math.min(localT - stepStart, fixedDt));
    if (dt <= 0) continue;
    const ti = cycleStartTime + stepStart;

    windFieldBox3D(outPos, ti, params, k1);
    midPos.copy(outPos).addScaledVector(k1, dt * 0.5);
    windFieldBox3D(midPos, ti + dt * 0.5, params, step);
    step.multiplyScalar(dt);

    outPos.add(step);
    outPos.x = wrapAxisValue(outPos.x, params.regionSizeM[0]);
    outPos.y = wrapAxisValue(outPos.y, params.regionSizeM[1]);
    outPos.z = wrapAxisValue(outPos.z, params.regionSizeM[2]);
  }
  return outPos;
}
