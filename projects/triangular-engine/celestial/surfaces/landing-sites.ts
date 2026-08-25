import { ICelestialBody } from '../bodies/celestial-body';
import {
  Vec3d,
  vec3Cross,
  vec3Dot,
  vec3Normalize,
  vec3Scale,
} from '../math/vec3';
import { ILocalFlattenTerrainModifierDef } from './terrain-def';
import { createSurfaceSampler } from './surface-query';

/** Tunable knobs for `landingSitesFor` — defaults are a first pass, not a playtested table (plan `landing-sites.md` open question 2). */
export interface LandingSitesOptions {
  /** How many sites to try to place on the body. */
  count?: number;
  /** Size of the deterministic candidate sweep — bounds the search; never "every direction." */
  candidateCount?: number;
  /** Flat plateau radius. */
  radiusM?: number;
  /** Additional smoothstep width back to generated terrain — kept large on purpose so the plateau reads as a natural clearing, not a stamped pad. */
  blendRadiusM?: number;
  /** A candidate is rejected if its worst edge-to-centre slope exceeds this. */
  maxSlopeRadians?: number;
  /** Minimum great-circle angle enforced between any two selected sites, so picks don't cluster on one flat feature. */
  minSeparationRadians?: number;
  /** Ring points sampled around each candidate's rim to estimate worst-case slope. */
  ringSampleCount?: number;
}

/** One generated site, ready for `LandingSiteRepositoryService.saveGeneratedSites`. */
export interface GeneratedLandingSite {
  name: string;
  /** Body-fixed metres, on the flattened surface (`direction * (body.radiusM + elevationM)`). */
  positionBodyFrameM: Vec3d;
  def: ILocalFlattenTerrainModifierDef;
}

/** Tunable knobs for the deterministic two-stage coastal-base search. */
export interface CoastalSitesOptions {
  /** Number of coastal sites to return. */
  count?: number;
  /** Number of evenly distributed centre samples in the cheap first stage. */
  candidateCount?: number;
  /** Radius of buildable ground checked around each base centre. */
  radiusM?: number;
  /** Smooth grading distance outside the buildable centre. */
  blendRadiusM?: number;
  /** Maximum centre-to-rim slope allowed across the buildable footprint. */
  maxSlopeRadians?: number;
  /** Minimum angular separation between returned sites. */
  minSeparationRadians?: number;
  /** Number of samples around the buildable footprint. */
  ringSampleCount?: number;
  /** Lowest permitted base-centre elevation above sea level. */
  minElevationAboveSeaM?: number;
  /** Highest permitted base-centre elevation above sea level. */
  maxElevationAboveSeaM?: number;
  /** Furthest distance searched from the base centre for navigable water. */
  waterSearchRadiusM?: number;
  /** Furthest permitted great-circle distance from the base centre to the shoreline. */
  maxShoreDistanceM?: number;
  /** Furthest permitted distance from the shoreline to the first navigable-water sample. */
  maxShallowWaterWidthM?: number;
  /** Bearings checked for water around each candidate. */
  waterBearingCount?: number;
  /** Concentric rings checked between the graded footprint and the search radius. */
  waterRingCount?: number;
  /** Required water depth at the returned water-access direction. */
  minWaterDepthM?: number;
}

/** A buildable land site paired with deterministic shore and water access. */
export interface GeneratedCoastalSite extends GeneratedLandingSite {
  /** Height of the base centre above the authored ocean surface. */
  elevationAboveSeaM: number;
  /** Nearest sampled navigable-water direction from the site. */
  waterDirectionBodyFixed: Vec3d;
  /** Sea-level crossing between the base centre and `waterDirectionBodyFixed`. */
  shoreDirectionBodyFixed: Vec3d;
  /** Great-circle distance from the base centre to the refined shoreline. */
  shoreDistanceM: number;
  /** Great-circle distance from the base centre to the navigable-water sample. */
  waterDistanceM: number;
  /** Distance from the refined shoreline to the navigable-water sample. */
  shallowWaterWidthM: number;
}

const DEFAULT_COUNT = 6;
const DEFAULT_CANDIDATE_COUNT = 2000;
const DEFAULT_RADIUS_M = 120;
const DEFAULT_BLEND_RADIUS_MULTIPLE = 5;
const DEFAULT_MAX_SLOPE_RADIANS = (15 * Math.PI) / 180;
const DEFAULT_MIN_SEPARATION_RADIANS = (15 * Math.PI) / 180;
const DEFAULT_RING_SAMPLE_COUNT = 8;
const DEFAULT_COASTAL_CANDIDATE_COUNT = 12_000;
const DEFAULT_COASTAL_RADIUS_M = 180;
const DEFAULT_COASTAL_BLEND_RADIUS_M = 360;
const DEFAULT_COASTAL_MAX_SLOPE_RADIANS = (8 * Math.PI) / 180;
const DEFAULT_COASTAL_MIN_ELEVATION_M = 15;
const DEFAULT_COASTAL_MAX_ELEVATION_M = 300;
const DEFAULT_WATER_SEARCH_RADIUS_M = 6_000;
const DEFAULT_MAX_SHORE_DISTANCE_M = 3_000;
const DEFAULT_MAX_SHALLOW_WATER_WIDTH_M = 1_500;
const DEFAULT_WATER_BEARING_COUNT = 16;
const DEFAULT_WATER_RING_COUNT = 4;
const DEFAULT_MIN_WATER_DEPTH_M = 20;

/** Golden-angle increment for an even, deterministic Fibonacci-sphere sweep — same formula `estimateTerrainElevationSaturation` already uses for deterministic direction coverage. */
const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5));

/** Even, deterministic directions over the whole sphere — count is fixed by construction, never "every direction." */
function fibonacciSphereDirections(count: number): Vec3d[] {
  const directions: Vec3d[] = new Array(count);
  for (let index = 0; index < count; index += 1) {
    const t = (index + 0.5) / count;
    const inclination = Math.acos(1 - 2 * t);
    const azimuth = GOLDEN_ANGLE_RAD * index;
    directions[index] = [
      Math.sin(inclination) * Math.cos(azimuth),
      Math.sin(inclination) * Math.sin(azimuth),
      Math.cos(inclination),
    ];
  }
  return directions;
}

/** An orthonormal tangent basis at `dir`, picking a reference axis that's never near-parallel to it. */
function tangentBasis(dir: Vec3d): { tangent1: Vec3d; tangent2: Vec3d } {
  const reference: Vec3d = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const tangent1 = vec3Normalize(vec3Cross(reference, dir));
  const tangent2 = vec3Cross(dir, tangent1);
  return { tangent1, tangent2 };
}

/** A point at great-circle angular distance `angularRadiusRad` from `dir`, at rim angle `rimAngleRad` around it. */
function ringDirection(
  dir: Vec3d,
  tangent1: Vec3d,
  tangent2: Vec3d,
  angularRadiusRad: number,
  rimAngleRad: number,
): Vec3d {
  const cosA = Math.cos(angularRadiusRad);
  const sinA = Math.sin(angularRadiusRad);
  const rim = vec3Scale(
    [
      tangent1[0] * Math.cos(rimAngleRad) + tangent2[0] * Math.sin(rimAngleRad),
      tangent1[1] * Math.cos(rimAngleRad) + tangent2[1] * Math.sin(rimAngleRad),
      tangent1[2] * Math.cos(rimAngleRad) + tangent2[2] * Math.sin(rimAngleRad),
    ],
    sinA,
  );
  return vec3Normalize([
    dir[0] * cosA + rim[0],
    dir[1] * cosA + rim[1],
    dir[2] * cosA + rim[2],
  ]);
}

/** Stable spherical interpolation, including the very-short-arc case. */
function interpolateDirection(from: Vec3d, to: Vec3d, amount: number): Vec3d {
  const angle = Math.acos(clampDot(vec3Dot(from, to)));
  if (angle < 1e-9) return from;
  const sinAngle = Math.sin(angle);
  const fromWeight = Math.sin((1 - amount) * angle) / sinAngle;
  const toWeight = Math.sin(amount * angle) / sinAngle;
  return vec3Normalize([
    from[0] * fromWeight + to[0] * toWeight,
    from[1] * fromWeight + to[1] * toWeight,
    from[2] * fromWeight + to[2] * toWeight,
  ]);
}

interface ScoredCandidate {
  index: number;
  direction: Vec3d;
  centerElevationM: number;
  worstSlopeRadians: number;
  qualifies: boolean;
}

/**
 * Deterministically generates a body's pre-made safe-landing zones (plan
 * `landing-sites.md`). Pure function of `body` (and `options`) — same
 * `body.terrain.seed`, generators, and `radiusM` always produce the exact
 * same sites, since the only randomness anywhere in this stack lives in the
 * seeded terrain generators `createSurfaceSampler` already compiles; the
 * candidate sweep itself is a fixed, seed-independent Fibonacci-sphere
 * lattice, deliberately simpler than an authored icosahedron+jitter scheme
 * for the same deterministic-coverage guarantee.
 *
 * Bodies with no `terrain` (e.g. a gas giant) have no surface to land sites
 * on and yield an empty array.
 */
export function landingSitesFor(
  body: ICelestialBody,
  options?: LandingSitesOptions,
): GeneratedLandingSite[] {
  if (!body.terrain) return [];

  const count = options?.count ?? DEFAULT_COUNT;
  const candidateCount = options?.candidateCount ?? DEFAULT_CANDIDATE_COUNT;
  const radiusM = options?.radiusM ?? DEFAULT_RADIUS_M;
  const blendRadiusM =
    options?.blendRadiusM ?? radiusM * DEFAULT_BLEND_RADIUS_MULTIPLE;
  const maxSlopeRadians = options?.maxSlopeRadians ?? DEFAULT_MAX_SLOPE_RADIANS;
  const minSeparationRadians =
    options?.minSeparationRadians ?? DEFAULT_MIN_SEPARATION_RADIANS;
  const ringSampleCount = options?.ringSampleCount ?? DEFAULT_RING_SAMPLE_COUNT;

  const sampler = createSurfaceSampler(body);
  const angularRadiusRad = radiusM / body.radiusM;
  const directions = fibonacciSphereDirections(candidateCount);

  // Pack every centre + ring sample for every candidate into one batched
  // call — the plan's efficiency requirement, matching `sampleDominantBiomeBatch`'s
  // batched-sampling precedent instead of one `sample()` call per point.
  const samplesPerCandidate = 1 + ringSampleCount;
  const packed = new Float64Array(candidateCount * samplesPerCandidate * 3);
  const ringBases = directions.map((dir) => tangentBasis(dir));
  for (let c = 0; c < candidateCount; c += 1) {
    const dir = directions[c];
    const base = c * samplesPerCandidate * 3;
    packed[base] = dir[0];
    packed[base + 1] = dir[1];
    packed[base + 2] = dir[2];
    const { tangent1, tangent2 } = ringBases[c];
    for (let r = 0; r < ringSampleCount; r += 1) {
      const rimAngleRad = (2 * Math.PI * r) / ringSampleCount;
      const ringDir = ringDirection(
        dir,
        tangent1,
        tangent2,
        angularRadiusRad,
        rimAngleRad,
      );
      const offset = base + (1 + r) * 3;
      packed[offset] = ringDir[0];
      packed[offset + 1] = ringDir[1];
      packed[offset + 2] = ringDir[2];
    }
  }
  const elevations = sampler.sampleBatch(packed);

  const candidates: ScoredCandidate[] = new Array(candidateCount);
  for (let c = 0; c < candidateCount; c += 1) {
    const sampleBase = c * samplesPerCandidate;
    const centerElevationM = elevations[sampleBase];
    let worstSlopeRadians = 0;
    for (let r = 0; r < ringSampleCount; r += 1) {
      const ringElevationM = elevations[sampleBase + 1 + r];
      const slopeRadians = Math.atan2(
        Math.abs(ringElevationM - centerElevationM),
        radiusM,
      );
      if (slopeRadians > worstSlopeRadians) worstSlopeRadians = slopeRadians;
    }
    candidates[c] = {
      index: c,
      direction: directions[c],
      centerElevationM,
      worstSlopeRadians,
      qualifies: worstSlopeRadians <= maxSlopeRadians,
    };
  }

  // Flattest first; stable tie-break on original index keeps this exact
  // ordering deterministic across engines rather than trusting sort stability.
  const byFlatness = (a: ScoredCandidate, b: ScoredCandidate): number =>
    a.worstSlopeRadians - b.worstSlopeRadians || a.index - b.index;

  const qualifying = candidates.filter((c) => c.qualifies).sort(byFlatness);
  const allByFlatness = [...candidates].sort(byFlatness);

  const selected: ScoredCandidate[] = [];
  const isFarEnough = (candidate: ScoredCandidate): boolean =>
    selected.every(
      (s) =>
        Math.acos(clampDot(vec3Dot(s.direction, candidate.direction))) >=
        minSeparationRadians,
    );

  for (const candidate of qualifying) {
    if (selected.length >= count) break;
    if (isFarEnough(candidate)) selected.push(candidate);
  }
  // Fewer than N qualified (an especially cratered body): relax the
  // threshold and take the flattest remaining ground anyway, per the plan —
  // a site on the least-bad ground beats no site.
  if (selected.length < count) {
    for (const candidate of allByFlatness) {
      if (selected.length >= count) break;
      if (selected.includes(candidate)) continue;
      if (isFarEnough(candidate)) selected.push(candidate);
    }
  }

  return selected.map((candidate, siteIndex) => {
    const surfaceRadiusM = body.radiusM + candidate.centerElevationM;
    const [dx, dy, dz] = candidate.direction;
    return {
      name: `Site ${siteIndex + 1}`,
      positionBodyFrameM: vec3Scale(candidate.direction, surfaceRadiusM),
      def: {
        kind: 'circle',
        directionBodyFixed: [dx, dy, dz],
        radiusM,
        blendRadiusM,
        elevationM: candidate.centerElevationM,
      },
    };
  });
}

interface ScoredCoastalCandidate extends ScoredCandidate {
  waterDirectionBodyFixed: Vec3d;
  waterDistanceM: number;
  shoreDirectionBodyFixed: Vec3d;
  shoreDistanceM: number;
  shallowWaterWidthM: number;
}

/**
 * Finds flat land close to navigable water without scanning the full detailed
 * neighbourhood of every sphere sample. Stage one batches centre elevations
 * and rejects everything outside a narrow above-sea band. Stage two checks
 * footprint slope and concentric water rings only for that shortlist.
 *
 * This is suitable for new-game placement tools and offline stock-site
 * authoring. A caller can orient a port toward `waterDirectionBodyFixed` and
 * place inland structures around `def.directionBodyFixed`.
 */
export function coastalSitesFor(
  body: ICelestialBody,
  options?: CoastalSitesOptions,
): GeneratedCoastalSite[] {
  const ocean = body.terrain?.ocean;
  if (!body.terrain || !ocean) return [];

  const count = options?.count ?? DEFAULT_COUNT;
  const candidateCount =
    options?.candidateCount ?? DEFAULT_COASTAL_CANDIDATE_COUNT;
  const radiusM = options?.radiusM ?? DEFAULT_COASTAL_RADIUS_M;
  const blendRadiusM = options?.blendRadiusM ?? DEFAULT_COASTAL_BLEND_RADIUS_M;
  const maxSlopeRadians =
    options?.maxSlopeRadians ?? DEFAULT_COASTAL_MAX_SLOPE_RADIANS;
  const minSeparationRadians =
    options?.minSeparationRadians ?? DEFAULT_MIN_SEPARATION_RADIANS;
  const ringSampleCount = options?.ringSampleCount ?? DEFAULT_RING_SAMPLE_COUNT;
  const minElevationAboveSeaM =
    options?.minElevationAboveSeaM ?? DEFAULT_COASTAL_MIN_ELEVATION_M;
  const maxElevationAboveSeaM =
    options?.maxElevationAboveSeaM ?? DEFAULT_COASTAL_MAX_ELEVATION_M;
  const waterSearchRadiusM =
    options?.waterSearchRadiusM ?? DEFAULT_WATER_SEARCH_RADIUS_M;
  const maxShoreDistanceM =
    options?.maxShoreDistanceM ??
    Math.min(DEFAULT_MAX_SHORE_DISTANCE_M, waterSearchRadiusM);
  const maxShallowWaterWidthM =
    options?.maxShallowWaterWidthM ?? DEFAULT_MAX_SHALLOW_WATER_WIDTH_M;
  const waterBearingCount =
    options?.waterBearingCount ?? DEFAULT_WATER_BEARING_COUNT;
  const waterRingCount = options?.waterRingCount ?? DEFAULT_WATER_RING_COUNT;
  const minWaterDepthM = options?.minWaterDepthM ?? DEFAULT_MIN_WATER_DEPTH_M;

  if (
    !Number.isInteger(count) ||
    count < 1 ||
    !Number.isInteger(candidateCount) ||
    candidateCount < 1 ||
    !Number.isInteger(ringSampleCount) ||
    ringSampleCount < 1 ||
    !Number.isInteger(waterBearingCount) ||
    waterBearingCount < 1 ||
    !Number.isInteger(waterRingCount) ||
    waterRingCount < 1 ||
    radiusM <= 0 ||
    blendRadiusM <= 0 ||
    waterSearchRadiusM <= radiusM + blendRadiusM ||
    maxShoreDistanceM <= 0 ||
    maxShoreDistanceM > waterSearchRadiusM ||
    maxShallowWaterWidthM < 0 ||
    minElevationAboveSeaM < 0 ||
    maxElevationAboveSeaM < minElevationAboveSeaM ||
    minWaterDepthM < 0
  ) {
    throw new RangeError('Invalid coastal-site search options.');
  }

  const sampler = createSurfaceSampler(body);
  const seaLevelM = ocean.seaLevelM;
  const directions = fibonacciSphereDirections(candidateCount);
  const packedCenters = new Float64Array(candidateCount * 3);
  for (let index = 0; index < candidateCount; index += 1) {
    packedCenters.set(directions[index], index * 3);
  }
  const centerElevations = sampler.sampleBatch(packedCenters);
  const shortlist: Array<{
    index: number;
    direction: Vec3d;
    centerElevationM: number;
  }> = [];
  for (let index = 0; index < candidateCount; index += 1) {
    const elevationAboveSeaM = centerElevations[index] - seaLevelM;
    if (
      elevationAboveSeaM >= minElevationAboveSeaM &&
      elevationAboveSeaM <= maxElevationAboveSeaM
    ) {
      shortlist.push({
        index,
        direction: directions[index],
        centerElevationM: centerElevations[index],
      });
    }
  }
  if (shortlist.length === 0) return [];

  const waterSampleCount = waterBearingCount * waterRingCount;
  const samplesPerCandidate = ringSampleCount + waterSampleCount;
  const packedDetail = new Float64Array(
    shortlist.length * samplesPerCandidate * 3,
  );
  const bases = shortlist.map((candidate) => tangentBasis(candidate.direction));
  for (
    let candidateIndex = 0;
    candidateIndex < shortlist.length;
    candidateIndex += 1
  ) {
    const candidate = shortlist[candidateIndex];
    const { tangent1, tangent2 } = bases[candidateIndex];
    const sampleBase = candidateIndex * samplesPerCandidate;
    for (let ringIndex = 0; ringIndex < ringSampleCount; ringIndex += 1) {
      const direction = ringDirection(
        candidate.direction,
        tangent1,
        tangent2,
        radiusM / body.radiusM,
        (2 * Math.PI * ringIndex) / ringSampleCount,
      );
      packedDetail.set(direction, (sampleBase + ringIndex) * 3);
    }
    for (
      let waterRingIndex = 0;
      waterRingIndex < waterRingCount;
      waterRingIndex += 1
    ) {
      const waterDistanceM =
        radiusM +
        blendRadiusM +
        ((waterRingIndex + 1) / waterRingCount) *
          (waterSearchRadiusM - radiusM - blendRadiusM);
      for (
        let bearingIndex = 0;
        bearingIndex < waterBearingCount;
        bearingIndex += 1
      ) {
        const direction = ringDirection(
          candidate.direction,
          tangent1,
          tangent2,
          waterDistanceM / body.radiusM,
          (2 * Math.PI * bearingIndex) / waterBearingCount,
        );
        const offset =
          sampleBase +
          ringSampleCount +
          waterRingIndex * waterBearingCount +
          bearingIndex;
        packedDetail.set(direction, offset * 3);
      }
    }
  }
  const detailElevations = sampler.sampleBatch(packedDetail);

  const candidates: ScoredCoastalCandidate[] = [];
  for (
    let candidateIndex = 0;
    candidateIndex < shortlist.length;
    candidateIndex += 1
  ) {
    const candidate = shortlist[candidateIndex];
    const sampleBase = candidateIndex * samplesPerCandidate;
    let worstSlopeRadians = 0;
    for (let ringIndex = 0; ringIndex < ringSampleCount; ringIndex += 1) {
      const slopeRadians = Math.atan2(
        Math.abs(
          detailElevations[sampleBase + ringIndex] - candidate.centerElevationM,
        ),
        radiusM,
      );
      if (slopeRadians > worstSlopeRadians) worstSlopeRadians = slopeRadians;
    }
    if (worstSlopeRadians > maxSlopeRadians) continue;

    let waterDirectionBodyFixed: Vec3d | undefined;
    let waterDistanceM = Number.POSITIVE_INFINITY;
    const { tangent1, tangent2 } = bases[candidateIndex];
    for (
      let waterRingIndex = 0;
      waterRingIndex < waterRingCount;
      waterRingIndex += 1
    ) {
      const ringDistanceM =
        radiusM +
        blendRadiusM +
        ((waterRingIndex + 1) / waterRingCount) *
          (waterSearchRadiusM - radiusM - blendRadiusM);
      for (
        let bearingIndex = 0;
        bearingIndex < waterBearingCount;
        bearingIndex += 1
      ) {
        const offset =
          sampleBase +
          ringSampleCount +
          waterRingIndex * waterBearingCount +
          bearingIndex;
        if (detailElevations[offset] > seaLevelM - minWaterDepthM) continue;
        waterDirectionBodyFixed = ringDirection(
          candidate.direction,
          tangent1,
          tangent2,
          ringDistanceM / body.radiusM,
          (2 * Math.PI * bearingIndex) / waterBearingCount,
        );
        waterDistanceM = ringDistanceM;
        break;
      }
      if (waterDirectionBodyFixed) break;
    }
    if (!waterDirectionBodyFixed) continue;

    let landDirection = candidate.direction;
    let waterDirection = waterDirectionBodyFixed;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const midpoint = interpolateDirection(landDirection, waterDirection, 0.5);
      if (sampler.sample(midpoint).elevationM > seaLevelM) {
        landDirection = midpoint;
      } else {
        waterDirection = midpoint;
      }
    }
    const shoreDirectionBodyFixed = interpolateDirection(
      landDirection,
      waterDirection,
      0.5,
    );
    const shoreDistanceM =
      Math.acos(
        clampDot(vec3Dot(candidate.direction, shoreDirectionBodyFixed)),
      ) * body.radiusM;
    const shallowWaterWidthM = waterDistanceM - shoreDistanceM;
    if (
      shoreDistanceM > maxShoreDistanceM ||
      shallowWaterWidthM > maxShallowWaterWidthM
    ) {
      continue;
    }
    candidates.push({
      ...candidate,
      worstSlopeRadians,
      qualifies: true,
      waterDirectionBodyFixed,
      waterDistanceM,
      shoreDirectionBodyFixed,
      shoreDistanceM,
      shallowWaterWidthM,
    });
  }

  candidates.sort(
    (a, b) =>
      a.worstSlopeRadians - b.worstSlopeRadians ||
      a.shallowWaterWidthM - b.shallowWaterWidthM ||
      a.shoreDistanceM - b.shoreDistanceM ||
      a.centerElevationM - b.centerElevationM ||
      a.index - b.index,
  );
  const selected: ScoredCoastalCandidate[] = [];
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    if (
      selected.every(
        (other) =>
          Math.acos(clampDot(vec3Dot(other.direction, candidate.direction))) >=
          minSeparationRadians,
      )
    ) {
      selected.push(candidate);
    }
  }

  return selected.map((candidate, siteIndex) => {
    const surfaceRadiusM = body.radiusM + candidate.centerElevationM;
    return {
      name: `Coastal Site ${siteIndex + 1}`,
      positionBodyFrameM: vec3Scale(candidate.direction, surfaceRadiusM),
      def: {
        kind: 'circle',
        directionBodyFixed: [
          candidate.direction[0],
          candidate.direction[1],
          candidate.direction[2],
        ],
        radiusM,
        blendRadiusM,
        elevationM: candidate.centerElevationM,
      },
      elevationAboveSeaM: candidate.centerElevationM - seaLevelM,
      waterDirectionBodyFixed: candidate.waterDirectionBodyFixed,
      shoreDirectionBodyFixed: candidate.shoreDirectionBodyFixed,
      shoreDistanceM: candidate.shoreDistanceM,
      waterDistanceM: candidate.waterDistanceM,
      shallowWaterWidthM: candidate.shallowWaterWidthM,
    };
  });
}

function clampDot(dot: number): number {
  return Math.max(-1, Math.min(1, dot));
}
