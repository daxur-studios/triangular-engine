/** A position in an authoritative navigation coordinate frame. */
export interface NavigationVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A stable navigation frame plus a position local to that frame. */
export interface NavigationLocation {
  readonly frameId: string;
  readonly position: NavigationVector3;
}

export type NavigationDomain = 'ground' | 'road' | 'air' | 'water' | string;

export interface TraversalProfile {
  readonly id: string;
  readonly domains: readonly NavigationDomain[];
  readonly radius: number;
  readonly height: number;
  readonly maxSlopeRadians?: number;
  readonly minimumClearance?: number;
}

export type NavigationGoal =
  | { readonly kind: 'point'; readonly location: NavigationLocation }
  | { readonly kind: 'any-of'; readonly locations: readonly NavigationLocation[] }
  | { readonly kind: 'region'; readonly regionId: string }
  | { readonly kind: 'adjacent-to'; readonly featureId: string; readonly range: number };

export interface NavigationQuery {
  readonly id: string;
  readonly start: NavigationLocation;
  readonly goal: NavigationGoal;
  readonly profile: TraversalProfile;
  readonly maximumCost?: number;
  readonly maximumExpandedNodes?: number;
  readonly allowPartial?: boolean;
}

export interface NavigationDependency {
  readonly id: string;
  readonly version: number;
}

export interface NavigationRouteSegment {
  readonly from: NavigationLocation;
  readonly to: NavigationLocation;
  readonly domain: NavigationDomain;
  readonly tileId?: string;
  readonly portalId?: string;
  readonly corridorWidth?: number;
  readonly surfaceNormal?: NavigationVector3;
}

export type NavigationRouteStatus = 'complete' | 'partial' | 'unreachable' | 'budget-exceeded';

export interface NavigationRoute {
  readonly queryId: string;
  readonly status: NavigationRouteStatus;
  readonly segments: readonly NavigationRouteSegment[];
  readonly dependencies: readonly NavigationDependency[];
  readonly cost: number;
}

/** Immutable, serializable metadata for a locally navigable tile. */
export interface NavigationTileSnapshot {
  readonly id: string;
  readonly version: number;
  readonly frameId: string;
  readonly regionId: string;
  readonly bounds: {
    readonly minimum: NavigationVector3;
    readonly maximum: NavigationVector3;
  };
  readonly domain: NavigationDomain;
}

/** Immutable, serializable connection between navigation regions or frames. */
export interface NavigationEdgeSnapshot {
  readonly id: string;
  readonly version: number;
  readonly fromRegionId: string;
  readonly toRegionId: string;
  readonly domain: NavigationDomain;
  readonly cost: number;
  readonly portalId?: string;
}

export interface NavigationDataChangeSet {
  readonly upsertedTiles: readonly NavigationTileSnapshot[];
  readonly removedTileIds: readonly string[];
  readonly upsertedEdges: readonly NavigationEdgeSnapshot[];
  readonly removedEdgeIds: readonly string[];
}

export interface NavigationReachabilityQuery {
  readonly id: string;
  readonly start: NavigationLocation;
  readonly goal: NavigationGoal;
  readonly profile: TraversalProfile;
  readonly maximumExpandedNodes?: number;
}

export interface NavigationReachabilityResult {
  readonly queryId: string;
  readonly reachable: boolean;
  readonly dependencies: readonly NavigationDependency[];
}

export type NavigationResult = NavigationRoute | NavigationReachabilityResult;
