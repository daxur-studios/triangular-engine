import { FlatFeatureSet, flatFeatureOffset, type FlatFeature, type FlatFeatureVec3 } from 'triangular-engine/worldgen/render/core';
import { RUNWAY_APRON_M, RUNWAY_LENGTH_M, RUNWAY_SHOULDER_M, RUNWAY_WIDTH_M, type IRunwaySite } from './runway-site';

/**
 * Plan 063: the spike's airfield and a small road network as library flat features, laid out in the runway frame
 * (`a` metres along the runway, `b` metres across it, from the site centre). Pure: the worker builds it once per
 * world and returns the plain list to the page, so the stamp and the paint use the same features.
 */

/** Priorities: the runway over taxiways over the apron over the main road over the access road. */
export const AIRFIELD_PRIORITY = { runway: 10, taxiway: 5, apron: 4, mainRoad: 2, accessRoad: 1 } as const;

/** Longest road segment; roads follow the ground between segment ends, so shorter segments follow it more closely. */
const ROAD_SEGMENT_M = 600;

/** Polylines in the runway frame, metres. The main road crosses the access road at right angles near (1200, 2350). */
const ACCESS_ROAD: readonly [number, number][] = [[0, 380], [0, 1200], [800, 2200], [2500, 2800], [4000, 2800]];
const MAIN_ROAD: readonly [number, number][] = [[1200, 600], [1200, 4500]];

/** Natural ground height above the datum in metres, or `null` over water or ice. */
export type GroundHeight = (direction: FlatFeatureVec3) => number | null;

export function airfieldFeatures(site: IRunwaySite, radiusM: number, ground: GroundHeight): FlatFeature[] {
  const frame = { along: site.along, across: site.across };
  const at = (a: number, b: number): FlatFeatureVec3 => flatFeatureOffset(site.centre, frame, a, b, radiusM);
  const heading = Math.atan2(
    // The runway heading from east towards north, recovered from its frame (the site search used 0.4 rad).
    dotNorth(site.centre, site.along),
    dotEast(site.centre, site.along),
  );
  const flat = site.heightM;
  const taxiway = (from: [number, number], to: [number, number], id: string): FlatFeature => ({
    kind: 'segment',
    id,
    start: at(...from),
    end: at(...to),
    widthM: 18,
    heightM: flat,
    apronM: 25,
    shoulderM: 250,
    priority: AIRFIELD_PRIORITY.taxiway,
    markings: 'taxiway',
  });
  const airfield: FlatFeature[] = [
    {
      kind: 'rectangle',
      id: 'runway',
      centre: site.centre,
      headingRad: heading,
      lengthM: RUNWAY_LENGTH_M,
      widthM: RUNWAY_WIDTH_M,
      heightM: flat,
      apronM: RUNWAY_APRON_M,
      shoulderM: RUNWAY_SHOULDER_M,
      priority: AIRFIELD_PRIORITY.runway,
      markings: 'runway',
    },
    taxiway([-900, 180], [900, 180], 'taxiway-parallel'),
    taxiway([-900, 22], [-900, 180], 'taxiway-west'),
    taxiway([0, 22], [0, 180], 'taxiway-middle'),
    taxiway([900, 22], [900, 180], 'taxiway-east'),
    {
      kind: 'rectangle',
      id: 'apron',
      centre: at(0, 290),
      headingRad: heading,
      lengthM: 400,
      widthM: 180,
      heightM: flat,
      apronM: 30,
      shoulderM: 300,
      priority: AIRFIELD_PRIORITY.apron,
      surface: 'concrete',
    },
  ];
  // Roads follow the ground as the airfield leaves it: sample it with the airfield already stamped.
  const airfieldSet = new FlatFeatureSet(airfield, radiusM);
  const stamped = (d: FlatFeatureVec3): number | null => {
    const h = ground(d);
    return h === null ? null : airfieldSet.stampElevation(d, h);
  };
  return [
    ...airfield,
    ...road(MAIN_ROAD, 'main-road', AIRFIELD_PRIORITY.mainRoad, at, stamped),
    ...road(ACCESS_ROAD, 'access-road', AIRFIELD_PRIORITY.accessRoad, at, stamped),
  ];
}

/** A polyline as round-ended segments of at most {@link ROAD_SEGMENT_M}, with smoothed ground heights at the joints. */
function road(
  points: readonly [number, number][],
  id: string,
  priority: number,
  at: (a: number, b: number) => FlatFeatureVec3,
  ground: GroundHeight,
): FlatFeature[] {
  const joints: [number, number][] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const [a0, b0] = points[i - 1];
    const [a1, b1] = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(a1 - a0, b1 - b0) / ROAD_SEGMENT_M));
    for (let k = 1; k <= n; k += 1) joints.push([a0 + ((a1 - a0) * k) / n, b0 + ((b1 - b0) * k) / n]);
  }
  const raw = joints.map(([a, b]) => ground(at(a, b)));
  const heights = raw.map((h, i) => {
    if (h === null) return null;
    const near = [raw[i - 1], h, raw[i + 1]].filter((v): v is number => v !== null && v !== undefined);
    return near.reduce((s, v) => s + v, 0) / near.length;
  });
  const segments: FlatFeature[] = [];
  for (let i = 1; i < joints.length; i += 1) {
    const h0 = heights[i - 1];
    const h1 = heights[i];
    segments.push({
      kind: 'segment',
      id: `${id}-${i}`,
      start: at(...joints[i - 1]),
      end: at(...joints[i]),
      widthM: 8,
      // Over water or ice the road is painted on the natural surface.
      heightM: h0 === null || h1 === null ? undefined : [h0, h1],
      apronM: 6,
      shoulderM: 60,
      clearanceM: 12,
      priority,
      markings: 'road',
    });
  }
  return segments;
}

function dotEast(centre: FlatFeatureVec3, v: FlatFeatureVec3): number {
  const east = normalise([centre[2], 0, -centre[0]]);
  return east[0] * v[0] + east[1] * v[1] + east[2] * v[2];
}

function dotNorth(centre: FlatFeatureVec3, v: FlatFeatureVec3): number {
  const east = normalise([centre[2], 0, -centre[0]]);
  const north = [centre[1] * east[2] - centre[2] * east[1], centre[2] * east[0] - centre[0] * east[2], centre[0] * east[1] - centre[1] * east[0]];
  return north[0] * v[0] + north[1] * v[1] + north[2] * v[2];
}

function normalise(v: FlatFeatureVec3): FlatFeatureVec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
