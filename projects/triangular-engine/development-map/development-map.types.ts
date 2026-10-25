/** Readiness from the project's structured plan review. */
export type DevelopmentMapReadiness = 'ready' | 'open-items' | 'needs-resolution' | 'unassessed';

/** A stable document relation as authored by the project adapter. */
export interface DevelopmentMapRelation {
  readonly type: 'depends-on' | 'builds-on' | 'alternative-to' | 'supersedes' | 'related-to';
  readonly title: string;
  readonly href: string;
}

/** One question or assumption copied from its source plan for display. */
export interface DevelopmentMapConcern {
  readonly id: string;
  readonly title: string;
  readonly kind: 'intent' | 'assumption' | 'investigation';
  readonly state: 'open' | 'deferred' | 'resolved';
  readonly blocks: boolean;
  readonly body: string;
  readonly sourceHref?: string;
  readonly sourceLabel?: string;
}

/** One plan phase or accepted goal. */
export interface DevelopmentMapPhase {
  readonly id: string;
  readonly title: string;
  readonly state: 'planned' | 'in_progress' | 'blocked' | 'done';
  readonly readiness: DevelopmentMapReadiness;
}

/** Progress over a defined set of stable scope IDs. */
export interface DevelopmentMapScopeProgress {
  readonly done: number;
  readonly total: number;
  readonly percent: number;
}

/** A dated scope change retained in the source Engineering Record. */
export interface DevelopmentMapScopeChange {
  readonly id: string;
  readonly date: string;
  readonly kind: 'addition' | 'removal' | 'change';
  readonly origin: 'requested' | 'discovered' | 'unplanned';
  readonly disposition: 'proposed' | 'accepted' | 'deferred' | 'rejected';
  readonly scopeIds: readonly string[];
  readonly summary: string;
  readonly reason: string;
  readonly impact: string;
}

/** Baseline and current-scope progress, calculated by the project adapter. */
export interface DevelopmentMapScope {
  readonly baselineState: 'confirmed' | 'unconfirmed';
  readonly baseline?: DevelopmentMapScopeProgress;
  readonly current: DevelopmentMapScopeProgress;
  /** Accepted additions minus accepted removals, when a confirmed baseline exists. */
  readonly acceptedGrowth?: number;
  readonly changes: readonly DevelopmentMapScopeChange[];
}

/** Summary of a measurement saved by the project's test-result receiver. */
export interface DevelopmentMapMetric {
  readonly name: string;
  readonly median: number;
  readonly p95: number;
  readonly unit: string;
  readonly samples?: number;
}

/** A test-result index row; raw samples remain in the dedicated results view. */
export interface DevelopmentMapEvidence {
  readonly id: string;
  readonly suite: string;
  readonly version: number;
  readonly savedAt: string;
  readonly profile: string;
  readonly mode: string;
  readonly automatedVerdict: string;
  readonly performanceVerdict: string;
  readonly visualReview: string;
  readonly stale?: boolean;
  readonly gpu?: string;
  readonly warnings: readonly string[];
  readonly metrics: readonly DevelopmentMapMetric[];
  readonly thumbnailUrl?: string;
  readonly href?: string;
}

/** A project document normalized for the viewer, independent of Markdown layout. */
export interface DevelopmentMapDocument {
  readonly id: string;
  readonly number?: number;
  readonly title: string;
  readonly sourceHref?: string;
  readonly readiness: DevelopmentMapReadiness;
  readonly progress?: DevelopmentMapScopeProgress;
  readonly phases: readonly DevelopmentMapPhase[];
  readonly concerns: readonly DevelopmentMapConcern[];
  readonly relations: readonly DevelopmentMapRelation[];
  readonly scope?: DevelopmentMapScope;
}

/** One runnable page, spike, feature or other project example. */
export interface DevelopmentMapExample {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly description?: string;
  readonly thumbnailUrl?: string;
  readonly documents: readonly DevelopmentMapDocument[];
  readonly evidence: readonly DevelopmentMapEvidence[];
}

/** A visual branch such as water, scatter or terrain. */
export interface DevelopmentMapBranch {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly examples: readonly DevelopmentMapExample[];
}

/** A chronological document, scope-change or evidence event. */
export interface DevelopmentMapTimelineEvent {
  readonly id: string;
  readonly date: string;
  readonly kind: 'scope' | 'evidence' | 'decision';
  readonly title: string;
  readonly detail: string;
  readonly disposition?: string;
  readonly href?: string;
}

/** Normalized input for the reusable viewer. Each app supplies its own adapter. */
export interface DevelopmentMapProject {
  readonly title: string;
  readonly description?: string;
  readonly branches: readonly DevelopmentMapBranch[];
  readonly timeline: readonly DevelopmentMapTimelineEvent[];
  readonly diagnostics?: readonly string[];
}
