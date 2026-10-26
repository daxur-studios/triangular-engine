/* eslint-disable @typescript-eslint/no-explicit-any */
import { cos, dot, float, sin, vec3 } from 'three/tsl';
import type { DomainKind, Vec3 } from './lod-domain';

/**
 * Plan 059 M1 height sources: flat, and static bumps (a fixed sum of directional sines of the base-surface position).
 * Each has a CPU twin (`heightAt`) and a TSL height and gradient for the vertex stage, built from the same table, so the
 * two agree to float32 rounding. The bound is the sum of amplitudes; the selector widens every node by it.
 */

export type HeightSourceId = 'flat' | 'bumps' | 'noise' | 'bumps-baked' | 'cell-planet' | 'cliff' | 'biome-mix';
export const HEIGHT_SOURCES: readonly HeightSourceId[] = ['flat', 'bumps', 'noise', 'bumps-baked', 'cell-planet', 'cliff', 'biome-mix'];

/** Sources read from a baked texture; they need a bake (`lod-height-bake.ts`) before they can be made. */
export const BAKED_SOURCES: readonly HeightSourceId[] = ['noise', 'bumps-baked', 'cell-planet', 'cliff', 'biome-mix'];
export const isBakedSource = (id: HeightSourceId): boolean => BAKED_SOURCES.includes(id);

/** Menu text of a source. */
export const HEIGHT_SOURCE_LABELS: Readonly<Record<HeightSourceId, string>> = {
  flat: 'flat', bumps: 'static bumps', noise: 'baked noise', 'bumps-baked': 'bumps, baked', 'cell-planet': 'cell planet', cliff: 'cliff fixture', 'biome-mix': 'biome mix',
};

/** The cell planet is a sphere (its surface sampler has no plane); every other source works on both domains. */
export const sourceSupports = (id: HeightSourceId, kind: DomainKind): boolean => id !== 'cell-planet' || kind === 'sphere';

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

/**
 * Height by lattice point, for sources baked into a per-face texture: the vertex stage knows each vertex's face and
 * integer lattice coordinates (U, V, exact in float32), so these need no position and make seam vertices bit-identical
 * by construction. Face is an int node, lattice a vec2 node.
 */
export interface LatticeHeightNodes {
  /** TSL height at (face, lattice). */
  heightNode(face: any, lattice: any): any;
  /** TSL vec2 of dh/dU and dh/dV, metres per lattice step, at (face, lattice). */
  slopeNode(face: any, lattice: any): any;
}

/** Conservative height range of a quadtree node, from a source that knows more than one global bound. */
export interface NodeHeightRanges {
  /** Writes [min, max] of the heights over node (root, level, i, j) into `out`, metres. */
  nodeRange(root: number, level: number, i: number, j: number, out: [number, number]): void;
}

export interface HeightSource extends Partial<NodeHeightRanges> {
  readonly id: HeightSourceId;
  /** Largest |height| anywhere; the selector's fallback when the source gives no per-node range. */
  readonly boundM: number;
  /** Set for baked sources: the vertex stage uses this instead of {@link heightNode} and {@link gradientNode}. */
  readonly lattice?: LatticeHeightNodes;
  /** Releases GPU resources, if any. */
  dispose?(): void;
  /** Height at a base-surface position (domain frame, doubles). */
  heightAt(x: number, y: number, z: number): number;
  /** TSL height at a base-surface position node (float32). */
  heightNode(position: any): any;
  /** TSL 3D gradient of the height at a base-surface position node. */
  gradientNode(position: any): any;
}

/** Analytic sources only; baked ones come from `createTextureHeightSource` once their bake is done. */
export function createHeightSource(id: HeightSourceId, kind: DomainKind): HeightSource {
  if (isBakedSource(id)) throw new Error(`Height source ${id} is baked: bake it, then use createTextureHeightSource`);
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
