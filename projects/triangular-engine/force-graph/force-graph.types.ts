/** Visual shape and hierarchy of a node in the force graph. */
export type ForceGraphNodeVariant = 'repo' | 'session' | 'pill' | 'point';

/** Lifecycle visibility state of a node or link in the graph. */
export type ForceGraphNodeState = 'active' | 'lingering';

/** Input node model passed into `<tri-force-graph>`. */
export interface ForceGraphNode {
  /** Stable unique identifier across frames and scrub jumps. */
  readonly id: string;
  /** Primary display text rendered inside the card or pill. */
  readonly label: string;
  /** Optional secondary line (e.g. live message and tool counts). */
  readonly subtitle?: string;
  /** Optional short tag or provider badge. */
  readonly badge?: string;
  /** Optional right-aligned metric badge (e.g. repo touch count). */
  readonly metric?: string;
  /** Visual style: rectangular repo card, capsule session pill, generic pill, or compact point. */
  readonly variant: ForceGraphNodeVariant;
  /** Active nodes render full contrast; lingering nodes render in a calm translucent afterglow. */
  readonly state: ForceGraphNodeState;
  /** CSS hex or rgb accent colour (provider colour for sessions, neutral/accent for repos). */
  readonly accentColor: string;
  /** Optional explicit collision & card width in world pixels; auto-estimated from text when omitted. */
  readonly width?: number;
  /** Optional explicit collision & card height in world pixels; auto-estimated from variant when omitted. */
  readonly height?: number;
  /** When true, physics skips moving this node. */
  readonly pinned?: boolean;
  /** Optional initial world X coordinate when first spawned. */
  readonly x?: number;
  /** Optional initial world Y coordinate when first spawned. */
  readonly y?: number;
}

/** Input edge connecting two nodes in the force graph. */
export interface ForceGraphLink {
  /** Stable unique link identifier. */
  readonly id: string;
  /** Source node ID. */
  readonly source: string;
  /** Target node ID. */
  readonly target: string;
  /** Relative activity weight (influences stroke emphasis and spring tension). */
  readonly weight: number;
  /** Active vs lingering afterglow rendering. */
  readonly state: ForceGraphNodeState;
  /** Cumulative file-read count on this link. */
  readonly readCount?: number;
  /** Cumulative file-write/edit count on this link. */
  readonly writeCount?: number;
  /** Optional stroke tint override. */
  readonly accentColor?: string;
}

/** Transient visual pulse emitted on an edge or node when events fire during replay. */
export interface ForceGraphPulse {
  /** Unique pulse ID so the renderer spawns each pulse once. */
  readonly id: string;
  /** Origin node ID (or node ID for ring pulses). */
  readonly source: string;
  /** Destination node ID (ignored for ring pulses). */
  readonly target: string;
  /** Glow colour (e.g. light blue for reads, emerald for edits, crimson for failures). */
  readonly color: string;
  /** Travel moves a glowing dot along the link; ring expands a soft halo around source. */
  readonly kind: 'travel' | 'ring';
  /** Optional creation timestamp in `performance.now()` ms. */
  readonly createdAtMs?: number;
  /** Duration of the pulse animation in milliseconds. */
  readonly durationMs?: number;
  /** Optional particle radius multiplier. */
  readonly size?: number;
}

/** Optional layout and visual tuning parameters for `<tri-force-graph>`. */
export interface ForceGraphConfig {
  readonly backgroundColor?: string;
  readonly gridColor?: string;
  readonly nodePadding?: number;
  readonly linkGap?: number;
  readonly repulsion?: number;
  readonly gravity?: number;
  readonly damping?: number;
  readonly showGrid?: boolean;
}

/** Internal physics state retained across timeline scrubs for one node. */
export interface SimNodeState {
  readonly id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  variant: ForceGraphNodeVariant;
  pinned: boolean;
}
