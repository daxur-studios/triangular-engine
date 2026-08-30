import { evaluateEdgePoints } from '../core/city-transit-graph';
import { ICityTransitEdge, ICityTransitGraph } from '../core/city-transit-types';
import { ITerrainModificationIntent } from './terrain-modification-intent';

export type RoadSpanType = 'surface' | 'bridge' | 'tunnel';

export interface IRoadTerrainAdaptOptions {
  /** Height in meters road must be above ground before triggering a bridge span (default: 3.5m). */
  readonly bridgeElevationThresholdM?: number;
  /** Depth in meters ground must be above road before triggering a tunnel span (default: 6.0m). */
  readonly tunnelDepthThresholdM?: number;
  /** Max spacing between vertical bridge support piers in meters (default: 20m). */
  readonly bridgePierSpacingM?: number;
  /** Number of sampling points along edge (default: 25). */
  readonly samples?: number;
}

/**
 * A classified contiguous section of a transit edge adapted to terrain elevation.
 */
export interface IClassifiedRoadSpan {
  readonly spanId: string;
  readonly edgeId: string;
  readonly type: RoadSpanType;
  readonly startT: number;
  readonly endT: number;
  /** 3D points along the road corridor centerline. */
  readonly roadPoints: readonly (readonly [number, number, number])[];
  /** Corresponding 3D points on the native terrain ground surface directly below/above the road. */
  readonly groundPoints: readonly (readonly [number, number, number])[];
  /** Recommended 3D locations for bridge support piers (bottom-of-deck to ground). */
  readonly pierPositions?: readonly {
    readonly deckPosition: readonly [number, number, number];
    readonly groundPosition: readonly [number, number, number];
    readonly heightM: number;
  }[];
}

/**
 * Result of adapting a complete city transit graph against terrain elevation.
 */
export interface ICityTerrainAdaptationResult {
  readonly spans: readonly IClassifiedRoadSpan[];
  readonly modificationIntents: readonly ITerrainModificationIntent[];
}

/**
 * Classifies an edge into surface, bridge, and tunnel spans based on terrain height difference.
 */
export function classifyEdgeTerrainSpans(
  edge: ICityTransitEdge,
  graph: ICityTransitGraph,
  sampleTerrainElevation: (x: number, z: number) => number,
  options: IRoadTerrainAdaptOptions = {},
): readonly IClassifiedRoadSpan[] {
  const bridgeThreshold = options.bridgeElevationThresholdM ?? 3.5;
  const tunnelThreshold = options.tunnelDepthThresholdM ?? 6.0;
  const pierSpacing = options.bridgePierSpacingM ?? 20.0;
  const samples = Math.max(5, options.samples ?? 25);

  const roadPoints = evaluateEdgePoints(edge, graph, samples);
  if (roadPoints.length < 2) return [];

  // Forced layer overrides if explicitly set in edge
  if (edge.layer === 1) {
    return [
      createSpan(
        `${edge.id}_bridge_0`,
        edge.id,
        'bridge',
        0,
        1,
        roadPoints,
        sampleTerrainElevation,
        pierSpacing,
      ),
    ];
  }
  if (edge.layer === -1) {
    return [
      createSpan(
        `${edge.id}_tunnel_0`,
        edge.id,
        'tunnel',
        0,
        1,
        roadPoints,
        sampleTerrainElevation,
        pierSpacing,
      ),
    ];
  }

  // Sample elevation deltas: delta = roadY - groundY
  const pointTypes: RoadSpanType[] = roadPoints.map((pt) => {
    const groundY = sampleTerrainElevation(pt[0], pt[2]);
    const delta = pt[1] - groundY;
    if (delta >= bridgeThreshold) {
      return 'bridge';
    } else if (delta <= -tunnelThreshold) {
      return 'tunnel';
    }
    return 'surface';
  });

  // Group into contiguous spans
  const spans: IClassifiedRoadSpan[] = [];
  let currentType = pointTypes[0];
  let startIndex = 0;

  for (let i = 1; i < roadPoints.length; i++) {
    if (pointTypes[i] !== currentType || i === roadPoints.length - 1) {
      const endIndex = pointTypes[i] !== currentType ? i - 1 : i;
      const spanPoints = roadPoints.slice(startIndex, endIndex + 1);

      if (spanPoints.length >= 2) {
        const startT = startIndex / (roadPoints.length - 1);
        const endT = endIndex / (roadPoints.length - 1);
        spans.push(
          createSpan(
            `${edge.id}_${currentType}_${spans.length}`,
            edge.id,
            currentType,
            startT,
            endT,
            spanPoints,
            sampleTerrainElevation,
            pierSpacing,
          ),
        );
      }

      currentType = pointTypes[i];
      startIndex = i - 1; // overlap 1 point for mesh continuity
    }
  }

  return spans.length > 0
    ? spans
    : [
        createSpan(
          `${edge.id}_surface_0`,
          edge.id,
          'surface',
          0,
          1,
          roadPoints,
          sampleTerrainElevation,
          pierSpacing,
        ),
      ];
}

function createSpan(
  spanId: string,
  edgeId: string,
  type: RoadSpanType,
  startT: number,
  endT: number,
  roadPoints: readonly (readonly [number, number, number])[],
  sampleTerrainElevation: (x: number, z: number) => number,
  pierSpacingM: number,
): IClassifiedRoadSpan {
  const groundPoints = roadPoints.map(
    (pt) => [pt[0], sampleTerrainElevation(pt[0], pt[2]), pt[2]] as const,
  );

  let pierPositions:
    | {
        readonly deckPosition: readonly [number, number, number];
        readonly groundPosition: readonly [number, number, number];
        readonly heightM: number;
      }[]
    | undefined = undefined;

  if (type === 'bridge' && roadPoints.length >= 2) {
    pierPositions = [];
    let accumulatedDist = 0;

    for (let i = 0; i < roadPoints.length - 1; i++) {
      const p0 = roadPoints[i];
      const p1 = roadPoints[i + 1];
      const g0 = groundPoints[i];
      const g1 = groundPoints[i + 1];

      const segLen = Math.sqrt(
        (p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2 + (p1[2] - p0[2]) ** 2,
      );

      accumulatedDist += segLen;
      if (accumulatedDist >= pierSpacingM && i > 0 && i < roadPoints.length - 2) {
        accumulatedDist = 0;
        const heightM = p0[1] - g0[1];
        if (heightM > 1.5) {
          pierPositions.push({
            deckPosition: p0,
            groundPosition: g0,
            heightM,
          });
        }
      }
    }
  }

  return {
    spanId,
    edgeId,
    type,
    startT,
    endT,
    roadPoints,
    groundPoints,
    pierPositions,
  };
}

/**
 * Processes an entire CityTransitGraph against a terrain elevation function,
 * classifying spans and synthesizing terrain grading intents.
 */
export function adaptTransitGraphToTerrain(
  graph: ICityTransitGraph,
  sampleTerrainElevation: (x: number, z: number) => number,
  options: IRoadTerrainAdaptOptions = {},
): ICityTerrainAdaptationResult {
  const allSpans: IClassifiedRoadSpan[] = [];
  const modificationIntents: ITerrainModificationIntent[] = [];

  for (const edge of graph.edges) {
    const spans = classifyEdgeTerrainSpans(
      edge,
      graph,
      sampleTerrainElevation,
      options,
    );
    allSpans.push(...spans);

    // Surface spans generate cut-and-fill grading intents
    for (const span of spans) {
      if (span.type === 'surface') {
        modificationIntents.push({
          id: `cut_fill_${span.spanId}`,
          kind: 'cut-and-fill',
          corridorCenterline: span.roadPoints,
          corridorWidthM: edge.crossSection.roadwayWidthM + 2 * edge.crossSection.sidewalkWidthM,
          blendDistanceM: 6.0,
        });
      }
    }
  }

  return {
    spans: allSpans,
    modificationIntents,
  };
}
