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

/** Surface-relative: bending and alignment follow the instance's local surface frame, not global Y. */
export interface ScatterWindDefinition {
  readonly strength: number;
  readonly frequency: number;
}

export interface ScatterColliderDefinition {
  /** No 'mesh' shape — Jolt mesh shapes are static-only and scatter colliders may need to go dynamic (falling trees). */
  readonly shape: 'box' | 'sphere' | 'capsule' | 'cylinder' | 'hull';
  readonly params: readonly number[];
  readonly impactThresholdN?: number;
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
