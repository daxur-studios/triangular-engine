/**
 * Supported transit agent and vehicle types across city networks.
 */
export type CityTransitType =
  | 'pedestrian'
  | 'car'
  | 'truck'
  | 'rail'
  | 'tram'
  | 'utility';

/**
 * Vertical transit layer index:
 * - -1: Sub-surface (tunnels, underground metro, utility conduits)
 * -  0: Surface level (streets, paths, boulevards)
 * -  1: Elevated (bridges, skyways, raised viaducts)
 */
export type CityTransitLayer = -1 | 0 | 1;

/**
 * Junction and termination taxonomy for transit nodes.
 */
export type CityJunctionType =
  | 'endpoint'
  | 'intersection'
  | 'roundabout'
  | 'bridge-abutment'
  | 'tunnel-portal'
  | 'station-dock'
  | 'dead-end';

/**
 * Transverse cross-section profile for a road, path, or rail corridor.
 */
export interface ICityCrossSection {
  /** Width of the roadway/rail running surface in meters. */
  readonly roadwayWidthM: number;
  /** Width of the raised pedestrian sidewalk on each side in meters (0 for highways/rails). */
  readonly sidewalkWidthM: number;
  /** Height of the raised curb above the asphalt surface in meters (e.g. 0.15m). */
  readonly curbHeightM: number;
  /** Width of green planting verge between curb and sidewalk in meters (0 if none). */
  readonly greenVergeWidthM: number;
  /** Width of central divider/median in meters (0 if single carriageway). */
  readonly medianWidthM: number;
}

/**
 * Computes total envelope width of a cross-section profile.
 */
export function computeCrossSectionTotalWidth(profile: ICityCrossSection): number {
  return (
    profile.roadwayWidthM +
    2 * profile.sidewalkWidthM +
    2 * profile.greenVergeWidthM +
    profile.medianWidthM
  );
}

/**
 * Standard preset cross-section profiles.
 */
export const CITY_CROSS_SECTION_PRESETS: Record<
  'pedestrianPath' | 'localStreet' | 'avenue' | 'arterialBoulevard' | 'railway' | 'highway',
  ICityCrossSection
> = {
  pedestrianPath: {
    roadwayWidthM: 0,
    sidewalkWidthM: 1.5,
    curbHeightM: 0.05,
    greenVergeWidthM: 0.5,
    medianWidthM: 0,
  },
  localStreet: {
    roadwayWidthM: 6.0,
    sidewalkWidthM: 1.8,
    curbHeightM: 0.15,
    greenVergeWidthM: 1.0,
    medianWidthM: 0,
  },
  avenue: {
    roadwayWidthM: 10.0,
    sidewalkWidthM: 2.5,
    curbHeightM: 0.15,
    greenVergeWidthM: 1.5,
    medianWidthM: 1.5,
  },
  arterialBoulevard: {
    roadwayWidthM: 14.0,
    sidewalkWidthM: 3.0,
    curbHeightM: 0.15,
    greenVergeWidthM: 2.0,
    medianWidthM: 3.0,
  },
  railway: {
    roadwayWidthM: 4.5,
    sidewalkWidthM: 0,
    curbHeightM: 0.3,
    greenVergeWidthM: 0.8,
    medianWidthM: 0,
  },
  highway: {
    roadwayWidthM: 16.0,
    sidewalkWidthM: 0,
    curbHeightM: 0.2,
    greenVergeWidthM: 1.5,
    medianWidthM: 2.5,
  },
};

/**
 * 3D transit node representing an intersection, waypoint, or terminus.
 */
export interface ICityTransitNode {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly layer: CityTransitLayer;
  readonly junctionType: CityJunctionType;
  readonly tag?: string;
}

/**
 * Directed/undirected transit corridor link connecting two nodes.
 */
export interface ICityTransitEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly layer: CityTransitLayer;
  readonly allowedTransitTypes: readonly CityTransitType[];
  readonly speedLimitKmh: number;
  readonly crossSection: ICityCrossSection;
  /** Optional intermediate control points for non-linear splines (in world coordinates). */
  readonly controlPoints?: readonly (readonly [number, number, number])[];
  /** Maximum allowable grade slope percentage (e.g. 12 = 12%). */
  readonly maxGradePercent?: number;
  /** Whether travel is strictly one-way from fromNodeId to toNodeId. */
  readonly isOneWay?: boolean;
  readonly name?: string;
}

/**
 * Complete immutable city transit graph representation.
 */
export interface ICityTransitGraph {
  readonly nodes: readonly ICityTransitNode[];
  readonly edges: readonly ICityTransitEdge[];
}
