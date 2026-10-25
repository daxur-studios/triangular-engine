/* eslint-disable @typescript-eslint/no-explicit-any */
import { cos, dot, float, sin, vec3 } from 'three/tsl';
import type { DomainKind, Vec3 } from './lod-domain';

/**
 * Plan 059 M1 height sources: flat, and static bumps (a fixed sum of directional sines of the base-surface position).
 * Each has a CPU twin (`heightAt`) and a TSL height and gradient for the vertex stage, built from the same table, so the
 * two agree to float32 rounding. The bound is the sum of amplitudes; the selector widens every node by it.
 */

export type HeightSourceId = 'flat' | 'bumps';
export const HEIGHT_SOURCES: readonly HeightSourceId[] = ['flat', 'bumps'];

export interface Bump {
  readonly axis: Vec3;
  readonly wavelengthM: number;
  readonly amplitudeM: number;
  readonly phase: number;
}

/** Wavelengths from 4 km down to 7 m, so every level from orbit to 2 m eye height has relief of its own scale. */
const BUMP_SCALES: readonly { wavelengthM: number; amplitudeM: number }[] = [
  { wavelengthM: 4000, amplitudeM: 30 },
  { wavelengthM: 910, amplitudeM: 8 },
  { wavelengthM: 170, amplitudeM: 2 },
  { wavelengthM: 31, amplitudeM: 0.4 },
  { wavelengthM: 7, amplitudeM: 0.08 },
];

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Two crossing sines per scale; plane axes lie in the plane (y = 0), sphere axes are general 3D directions. */
export function bumpsFor(kind: DomainKind): readonly Bump[] {
  const out: Bump[] = [];
  BUMP_SCALES.forEach(({ wavelengthM, amplitudeM }, k) => {
    const angle = 0.7 + 1.3 * k;
    const first: Vec3 = kind === 'plane' ? [Math.cos(angle), 0, Math.sin(angle)] : normalise([Math.cos(angle), 0.6 * Math.sin(2 * angle), Math.sin(angle)]);
    const second: Vec3 = kind === 'plane' ? [-Math.sin(angle), 0, Math.cos(angle)] : normalise([-Math.sin(angle), Math.cos(angle), 0.5 * Math.cos(angle)]);
    out.push({ axis: first, wavelengthM, amplitudeM: amplitudeM / 2, phase: 0.3 * k });
    out.push({ axis: second, wavelengthM: wavelengthM * 1.17, amplitudeM: amplitudeM / 2, phase: 1.1 + 0.5 * k });
  });
  return out;
}

export interface HeightSource {
  readonly id: HeightSourceId;
  readonly boundM: number;
  /** Height at a base-surface position (domain frame, doubles). */
  heightAt(x: number, y: number, z: number): number;
  /** TSL height at a base-surface position node (float32). */
  heightNode(position: any): any;
  /** TSL 3D gradient of the height at a base-surface position node. */
  gradientNode(position: any): any;
}

export function createHeightSource(id: HeightSourceId, kind: DomainKind): HeightSource {
  if (id === 'flat') {
    return { id, boundM: 0, heightAt: () => 0, heightNode: () => float(0), gradientNode: () => vec3(0, 0, 0) };
  }
  const bumps = bumpsFor(kind);
  return {
    id,
    boundM: bumps.reduce((sum, bump) => sum + bump.amplitudeM, 0),
    heightAt(x, y, z) {
      let h = 0;
      for (const { axis, wavelengthM, amplitudeM, phase } of bumps) {
        h += amplitudeM * Math.sin(((2 * Math.PI) / wavelengthM) * (x * axis[0] + y * axis[1] + z * axis[2]) + phase);
      }
      return h;
    },
    heightNode(position) {
      let h: any = float(0);
      for (const { axis, wavelengthM, amplitudeM, phase } of bumps) {
        h = h.add(sin(dot(position, vec3(...axis)).mul((2 * Math.PI) / wavelengthM).add(phase)).mul(amplitudeM));
      }
      return h;
    },
    gradientNode(position) {
      let g: any = vec3(0, 0, 0);
      for (const { axis, wavelengthM, amplitudeM, phase } of bumps) {
        const k = (2 * Math.PI) / wavelengthM;
        g = g.add(vec3(...axis).mul(cos(dot(position, vec3(...axis)).mul(k).add(phase)).mul(amplitudeM * k)));
      }
      return g;
    },
  };
}
