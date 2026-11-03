/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fn, If, abs, cameraPosition, cos, dFdx, dFdy, dot, float, length, mat3, mix, normalize, select, sin, smoothstep, sub, uniform, varying, vec3 } from 'three/tsl';
import type { HeightSource, Vec3 } from 'triangular-engine/lod-surface/core';
import { SEA_LEVEL_M, shoreWeight } from './water-lod-spike-land';
import { anchorPhaseOffset, sphereWaves, type ISphereWave } from './water-lod-spike-precision';
import { SPHERE_HOME, sphereLandHeightNode, sphereWaterDepthM } from './water-lod-spike-sphere-land';
import {
  FOOTPRINT_FADE_END,
  FOOTPRINT_FADE_START,
  WATER_LOD_SPIKE_UNIFORMS,
  WATER_LOD_SPIKE_WAVES,
} from './water-lod-spike-waves';

/**
 * Plan 080, water on a planet (stage A): the plane spike's wave field on a sphere.
 *
 * The 64 waves are plane waves with fixed 3D unit directions (`sphereWaves`, a spherical Fibonacci spread), so the height at a
 * point p of the sphere is `sum a sin(k p.d + phi - omega t)`, the same maths as the plane and nothing to patch at a pole or a
 * face edge. Wavelengths, amplitudes, phases and speeds are the plane's table, and the uniforms are the plane's (they are
 * one set: the sphere page and the plane page are never open together).
 *
 * Two precisions, because float32 cannot hold a 600 km position to the millimetre (plan 080 Q5):
 * - Vertices (geometry) use the undisplaced float32 point `up * radius` and a naive phase. Its error, tenths of a radian on the
 *   shortest waves, is millimetres of height there (their amplitude), and it is the same for every leaf that draws a vertex.
 * - Shading rebuilds each wave's phase from the position relative to the camera plus a per-wave offset computed in doubles on the
 *   CPU each frame (`updateSphereWaterAnchor`): the anchor path of Q5, error under 1e-3 rad. Plan 080 W1a would move this into
 *   the lod-surface vertex stage; the spike does it in the material because the library hook does not exist yet.
 */

/** A wave with its amplitude. */
export interface ISphereWaterWave extends ISphereWave {
  readonly amplitudeM: number;
}

/** The sphere's spectrum: the plane table's wavelengths, amplitudes, phases and speeds on spherical Fibonacci directions. */
export const SPHERE_WATER_WAVES: readonly ISphereWaterWave[] = sphereWaves().map((wave, i) => ({
  ...wave,
  amplitudeM: WATER_LOD_SPIKE_WAVES[i].amplitudeM,
}));

/** Per-wave phase at the camera, wrapped to [-pi, pi], doubles on the CPU: the shading phase is `k (p - camera).d + offset`. */
const ANCHOR_OFFSETS = SPHERE_WATER_WAVES.map(() => uniform(0));

/**
 * Sets every wave's phase offset for a camera at `cameraWorld` (the body's frame) and wave time `timeS`. Call once per frame
 * after the camera has settled and before the render, with the same position the lod-surface mesh is placed at.
 */
export function updateSphereWaterAnchor(cameraWorld: Vec3, timeS: number): void {
  for (let i = 0; i < SPHERE_WATER_WAVES.length; i++) ANCHOR_OFFSETS[i].value = anchorPhaseOffset(SPHERE_WATER_WAVES[i], cameraWorld, timeS);
}

/** The wave field's height at a point of the sphere frame, metres, in doubles: every wave, times the shore weight when the shore is on. CPU twin of the vertex stage without the mesh-spacing filter. */
export function sphereWaterHeightM(x: number, y: number, z: number, timeS: number = WATER_LOD_SPIKE_UNIFORMS.time.value as number): number {
  let h = 0;
  for (const wave of SPHERE_WATER_WAVES) {
    h += wave.amplitudeM * Math.sin(wave.k * (x * wave.dir[0] + y * wave.dir[1] + z * wave.dir[2]) + wave.phase - wave.angularSpeed * timeS);
  }
  if ((WATER_LOD_SPIKE_UNIFORMS.shore.value as number) > 0) {
    h *= shoreWeight(sphereWaterDepthM(x, y, z), WATER_LOD_SPIKE_UNIFORMS.shoreRampM.value as number);
  }
  return h;
}

/**
 * Covariance tensor of the slopes of every wave, `sum (a k)^2 / 2 * d d^T`, as three rows. Contracted with a tangent basis it is
 * the lost slope covariance when every wave is dropped; each wave that stays in the shading takes its own part back.
 */
export const SPHERE_SLOPE_TENSOR: readonly [Vec3, Vec3, Vec3] = (() => {
  const t = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const wave of SPHERE_WATER_WAVES) {
    const slope = wave.amplitudeM * wave.k;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) t[r][c] += 0.5 * slope * slope * wave.dir[r] * wave.dir[c];
  }
  return [[t[0][0], t[0][1], t[0][2]], [t[1][0], t[1][1], t[1][2]], [t[2][0], t[2][1], t[2][2]]];
})();

/**
 * CPU twin of {@link sphereTangentBasis}: a right-handed orthonormal tangent pair at a unit direction, branch-free, built in the
 * home frame (Duff et al. 2017). It is continuous everywhere except the great circle 90 degrees from home, far from any view the
 * page frames. Used for the shading slopes, so it never depends on screen derivatives.
 */
export function sphereTangentBasisAt(up: Vec3): { t1: Vec3; t2: Vec3 } {
  const { east, north, up: home } = SPHERE_HOME;
  const x = up[0] * east[0] + up[1] * east[1] + up[2] * east[2];
  const y = up[0] * north[0] + up[1] * north[1] + up[2] * north[2];
  const z = up[0] * home[0] + up[1] * home[1] + up[2] * home[2];
  const s = z >= 0 ? 1 : -1;
  const a = -1 / (s + z);
  const b = x * y * a;
  const f1: Vec3 = [1 + s * x * x * a, s * b, -s * x];
  const f2: Vec3 = [b, s + y * y * a, -y];
  const world = (f: Vec3): Vec3 => [
    east[0] * f[0] + north[0] * f[1] + home[0] * f[2],
    east[1] * f[0] + north[1] * f[1] + home[1] * f[2],
    east[2] * f[0] + north[2] * f[1] + home[2] * f[2],
  ];
  return { t1: world(f1), t2: world(f2) };
}

/** TSL twin of {@link sphereTangentBasisAt} at a unit direction node. */
export function sphereTangentBasis(up: any): { t1: any; t2: any } {
  const east = vec3(...SPHERE_HOME.east);
  const north = vec3(...SPHERE_HOME.north);
  const home = vec3(...SPHERE_HOME.up);
  const x = dot(up, east);
  const y = dot(up, north);
  const z = dot(up, home);
  const s = select(z.greaterThanEqual(0), float(1), float(-1));
  const a = float(-1).div(s.add(z));
  const b = x.mul(y).mul(a);
  const f1 = vec3(float(1).add(s.mul(x).mul(x).mul(a)), s.mul(b), s.mul(x).negate());
  const f2 = vec3(b, s.add(y.mul(y).mul(a)), y.negate());
  const world = (f: any) => east.mul(f.x).add(north.mul(f.y)).add(home.mul(f.z));
  return { t1: world(f1), t2: world(f2) };
}

/** Phase of one wave at a float32 planet-centred point node (vertex stage, naive). */
function vertexPhase(global: any, wave: ISphereWaterWave): any {
  return dot(global, vec3(...wave.dir)).mul(wave.k).add(wave.phase).sub(WATER_LOD_SPIKE_UNIFORMS.time.mul(wave.angularSpeed));
}

/** Mesh spacing estimate at a point (vertex stage): cellPixels x pixel angle x camera distance, as the plane's. */
function meshSpacingNode(global: any): any {
  return length(sub(global, cameraPosition)).mul(WATER_LOD_SPIKE_UNIFORMS.pixelAngle).mul(WATER_LOD_SPIKE_UNIFORMS.cellPixels);
}

function spacingWeightNode(spacing: any, wave: ISphereWaterWave): any {
  return mix(float(1), smoothstep(spacing.mul(4), spacing.mul(8), float(wave.wavelengthM)), WATER_LOD_SPIKE_UNIFORMS.filter);
}

/** Shore weight at a planet-centred point node: 1 while the shore is off, else `smoothstep(0, ramp, D)` with D from the land under the point. */
function sphereShoreWeightNode(global: any): any {
  return (Fn(() => {
    const weight = float(1).toVar();
    If(WATER_LOD_SPIKE_UNIFORMS.shore.greaterThan(0), () => {
      weight.assign(smoothstep(0, WATER_LOD_SPIKE_UNIFORMS.shoreRampM, float(SEA_LEVEL_M).sub(sphereLandHeightNode(normalize(global)))));
    });
    return weight;
  }) as any)();
}

/** A `HeightSource` that also exposes the vertex height as a varying, so the fragment stage can find the undisplaced point. */
export interface ISphereWaterHeights extends HeightSource {
  /** The height the last-built vertex stage used, as a varying node (metres), or `null` before a mesh has been built from this source. */
  vertexHeight(): any | null;
}

/**
 * `HeightSource` for `<planetTerrain [heights]>`: the sphere's water height. The vertex stage (`heightNode`) applies the
 * mesh-spacing filter and the shore weight; the CPU twin (`heightAt`) keeps every wave, so it differs from the drawn mesh by at
 * most the filtered waves' amplitudes (centimetres) and by the vertex phase's float32 error (millimetres).
 */
export function createSphereWaterHeights(): ISphereWaterHeights {
  const boundM = SPHERE_WATER_WAVES.reduce((sum, wave) => sum + wave.amplitudeM, 0);
  let vertexHeight: any = null;
  return {
    id: 'bumps',
    boundM,
    heightAt: (x, y, z) => sphereWaterHeightM(x, y, z),
    heightNode(global: any) {
      const height = (Fn(() => {
        const spacing = meshSpacingNode(global);
        const h = float(0).toVar();
        for (const wave of SPHERE_WATER_WAVES) {
          const weight = spacingWeightNode(spacing, wave).toVar();
          If(weight.greaterThan(0), () => {
            h.addAssign(sin(vertexPhase(global, wave)).mul(wave.amplitudeM).mul(weight));
          });
        }
        return h.mul(sphereShoreWeightNode(global)).mul(WATER_LOD_SPIKE_UNIFORMS.vertexHeightScale);
      }) as any)();
      // One varying for the position and for the fragment stage: the height is computed once per vertex.
      vertexHeight = varying(height, 'vSphereWaterHeight');
      return vertexHeight;
    },
    gradientNode(global: any) {
      return (Fn(() => {
        const spacing = meshSpacingNode(global);
        const g = vec3(0, 0, 0).toVar();
        for (const wave of SPHERE_WATER_WAVES) {
          const weight = spacingWeightNode(spacing, wave).toVar();
          If(weight.greaterThan(0), () => {
            g.addAssign(vec3(...wave.dir).mul(cos(vertexPhase(global, wave)).mul(wave.amplitudeM * wave.k).mul(weight)));
          });
        }
        return g.mul(sphereShoreWeightNode(global));
      }) as any)();
    },
    vertexHeight: () => vertexHeight,
  } as ISphereWaterHeights;
}

/** What the fragment stage needs from the mesh: the camera-relative displaced position, the unit direction of the base point, and the vertex height. */
export interface ISphereShadingInputs {
  /** Camera-relative position of the displaced point (varying). */
  readonly position: any;
  /** Unit direction from the centre to the base point (varying). */
  readonly up: any;
  /** The vertex height in metres (varying), the displacement along `up` that `position` includes. */
  readonly height: any;
}

/**
 * Fragment-stage shading nodes: the filtered mean slopes along a tangent pair (`t1`, `t2`) and the covariance of the slopes the
 * filter removed (`lostXX`, `lostXZ`, `lostZZ` in that pair, named after the plane's x and z). Each wave's weight comes from the pixel
 * footprint along its own direction, as the plane's; the phase is `k (base - camera).d + offset`, with the base point found by
 * taking the vertex height off the position.
 */
export function createSphereWaterShadingNodes(inputs: ISphereShadingInputs): { t1: any; t2: any; slopeX: any; slopeZ: any; lostXX: any; lostXZ: any; lostZZ: any } {
  const [row0, row1, row2] = SPHERE_SLOPE_TENSOR.map((row) => vec3(...row));
  const shading: any = Fn(() => {
    const up = normalize(inputs.up);
    const { t1, t2 } = sphereTangentBasis(up);
    const baseRel = inputs.position.sub(up.mul(inputs.height));
    const ddx: any = dFdx(inputs.position);
    const ddy: any = dFdy(inputs.position);
    const gradient = vec3(0, 0, 0).toVar();
    // The lost covariance starts at its total and each wave still in the shading takes its part back (see the plane's version).
    const tensorT1 = vec3(dot(row0, t1), dot(row1, t1), dot(row2, t1));
    const tensorT2 = vec3(dot(row0, t2), dot(row1, t2), dot(row2, t2));
    const lostXX = dot(t1, tensorT1).toVar();
    const lostXZ = dot(t2, tensorT1).toVar();
    const lostZZ = dot(t2, tensorT2).toVar();
    SPHERE_WATER_WAVES.forEach((wave, i) => {
      const direction = vec3(...wave.dir);
      const alongX: any = dot(ddx, direction);
      const alongY: any = dot(ddy, direction);
      const ratio = abs(alongX).add(abs(alongY)).mul(1 / wave.wavelengthM);
      const slope = wave.amplitudeM * wave.k;
      const gate = ratio.mul(WATER_LOD_SPIKE_UNIFORMS.filter).mul(WATER_LOD_SPIKE_UNIFORMS.lodBias);
      If(gate.lessThan(FOOTPRINT_FADE_END), () => {
        const phase = dot(baseRel, direction).mul(wave.k).add(ANCHOR_OFFSETS[i]);
        const crest = cos(phase).mul(slope).toVar();
        const keptVariance = 0.5 * slope * slope;
        const d1 = dot(t1, direction);
        const d2 = dot(t2, direction);
        If(gate.lessThan(FOOTPRINT_FADE_START), () => {
          gradient.addAssign(direction.mul(crest));
          lostXX.subAssign(d1.mul(d1).mul(keptVariance));
          lostXZ.subAssign(d1.mul(d2).mul(keptVariance));
          lostZZ.subAssign(d2.mul(d2).mul(keptVariance));
        }).Else(() => {
          const weight = float(1).sub(smoothstep(FOOTPRINT_FADE_START, FOOTPRINT_FADE_END, gate));
          gradient.addAssign(direction.mul(crest.mul(weight)));
          const kept = weight.mul(weight).mul(keptVariance);
          lostXX.subAssign(kept.mul(d1).mul(d1));
          lostXZ.subAssign(kept.mul(d1).mul(d2));
          lostZZ.subAssign(kept.mul(d2).mul(d2));
        });
      });
    });
    return mat3(vec3(dot(gradient, t1), dot(gradient, t2), 0), vec3(lostXX, lostXZ, lostZZ), vec3(0, 0, 0));
  })();
  const slopes = shading.element(0);
  const lost = shading.element(1);
  const { t1, t2 } = sphereTangentBasis(normalize(inputs.up));
  return { t1, t2, slopeX: slopes.x, slopeZ: slopes.y, lostXX: lost.x, lostXZ: lost.y, lostZZ: lost.z };
}
