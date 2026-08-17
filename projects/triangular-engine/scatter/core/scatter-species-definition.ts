/**
 * Definitions carry asset keys, never Three.js objects, so they stay usable
 * in workers and save files. A runtime resolver (scatter/three) maps keys to
 * geometries, materials, billboard atlases, and collider shapes.
 */

export type ScatterAlignmentMode =
  | 'align-to-normal'
  | 'align-to-surface-up'
  | 'random-tumble';

export interface ScatterPlacementRules {
  readonly alignment: ScatterAlignmentMode;
  /** Fixed sink depth in meters — e.g. boulders half-sunk into the ground. */
  readonly embedDepthM?: number;
  readonly slopeMin01?: number;
  readonly slopeMax01?: number;
}

export type ScatterLodKind = 'mesh' | 'billboard' | 'impostor';

export interface ScatterLodDefinition {
  readonly kind: ScatterLodKind;
  /** This tier is active out to this camera distance; the next tier takes over beyond it. */
  readonly maxDistanceM: number;
  readonly castShadow: boolean;
  /** Asset variant for this tier; defaults to the species' assetKey when omitted. */
  readonly assetKey?: string;
}

/**
 * A curl-noise flow field layered on top of the base sway — makes wind read
 * as eddies drifting and swirling through the field rather than every
 * instance breathing in lockstep, or (an earlier version of this) a single
 * band sweeping in one fixed direction like a flat wall. Curl noise (the
 * gradient of a smooth scalar noise field, crossed with the local surface
 * normal) is divergence-free by construction, so it can only ever rotate
 * flow, never make everything drift the same way — that's what keeps it
 * from reading as a straight diagonal line. Computed from each instance's
 * *local* tangent frame (via `instanceMatrix`), so it works unmodified on a
 * flat plane, a sphere, or the inside of a cylinder — anywhere scatter's
 * placement already aligns instances to a surface normal.
 */
export interface ScatterWindGustDefinition {
  /** World-space size of a typical eddy, in meters — smaller reads as tight, choppy swirls; larger as broad, slow-turning ones. */
  readonly wavelengthM: number;
  /** How fast the underlying noise field's domain drifts — higher makes eddies visibly travel and rotate faster. */
  readonly driftSpeedMS: number;
  /** Extra sway amplitude at a gust's peak, added on top of `strength` (0 = no gust). */
  readonly amplitude: number;
}

/** Surface-relative: bending and alignment follow the instance's local surface frame, not global Y. */
export interface ScatterWindDefinition {
  readonly strength: number;
  readonly frequency: number;
  /** Optional traveling gust layered on top of the base per-instance sway. */
  readonly gust?: ScatterWindGustDefinition;
}

export interface ScatterColliderDefinition {
  /** No 'mesh' shape — Jolt mesh shapes are static-only and scatter colliders may need to go dynamic (falling trees). */
  readonly shape: 'box' | 'sphere' | 'capsule' | 'cylinder' | 'hull';
  readonly params: readonly number[];
  /**
   * Contact momentum (kg·m/s) above which the instance is reported as
   * destroyed. Momentum, not force, because Jolt's contact-added callback
   * has no solved impulse available yet — see estimateScatterImpactMomentumNs
   * in triangular-engine/jolt.
   */
  readonly impactThresholdNs?: number;
}

export interface ScatterInteractionDefinition {
  readonly kind: string;
}

export interface ScatterSpeciesDefinition {
  readonly id: string;
  readonly assetKey: string;
  readonly placement: ScatterPlacementRules;
  readonly lods: readonly ScatterLodDefinition[];
  readonly wind?: ScatterWindDefinition;
  readonly collider?: ScatterColliderDefinition;
  readonly interaction?: ScatterInteractionDefinition;
}
