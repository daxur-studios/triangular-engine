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

const DEFAULT_COUNT = 6;
const DEFAULT_CANDIDATE_COUNT = 2000;
const DEFAULT_RADIUS_M = 120;
const DEFAULT_BLEND_RADIUS_MULTIPLE = 5;
const DEFAULT_MAX_SLOPE_RADIANS = (15 * Math.PI) / 180;
const DEFAULT_MIN_SEPARATION_RADIANS = (15 * Math.PI) / 180;
const DEFAULT_RING_SAMPLE_COUNT = 8;

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

function clampDot(dot: number): number {
  return Math.max(-1, Math.min(1, dot));
}
