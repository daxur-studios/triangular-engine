/**
 * Flat features (Plan 063): runways, aprons, roads and taxiways drawn only by the planet surface material, on terrain
 * flattened in the height source. Framework-free maths shared by the mesh worker (the height stamp), the material
 * (per-page feature lists, see `flat-feature-pages.ts`) and scatter (the clearance query).
 *
 * Every function here works on unit directions from the planet centre (body-fixed), never on mesh vertices, so every
 * terrain LOD that samples the same direction gets the same height.
 */

/** A unit direction from the planet centre, in the body frame (+Y north, +Z prime meridian). */
export type FlatFeatureVec3 = readonly [number, number, number];

/** Paint drawn on a flat feature by the `planet-material` flat-feature layer. */
export type FlatFeatureMarkings = 'none' | 'runway' | 'taxiway' | 'road';

/** Base colour of a flat feature in the material: dark asphalt or light concrete. */
export type FlatFeatureSurface = 'asphalt' | 'concrete';

/** Shader codes for {@link FlatFeatureMarkings}; the `planet-material` layer reads these numbers. */
export const FLAT_FEATURE_MARKINGS: Readonly<Record<FlatFeatureMarkings, number>> = { none: 0, runway: 1, taxiway: 2, road: 3 };

/** Shader codes for {@link FlatFeatureSurface}. */
export const FLAT_FEATURE_SURFACES: Readonly<Record<FlatFeatureSurface, number>> = { asphalt: 0, concrete: 1 };

/** Fields shared by every flat feature. All distances are metres along the ground. */
export interface IFlatFeatureCommon {
  /** Optional name, for debugging and stats only. */
  readonly id?: string;
  /**
   * Where features overlap or cross, the higher priority wins: its height is applied last by the stamp and its
   * markings are drawn on top. Equal priorities are resolved by list order for the height (later wins) and by depth
   * inside the feature for the paint. Default 0.
   */
  readonly priority?: number;
  /** Paint pattern. Default `'none'`. */
  readonly markings?: FlatFeatureMarkings;
  /** Base colour. Default `'asphalt'`. */
  readonly surface?: FlatFeatureSurface;
  /** Flat plateau beyond the feature edge before the blend back to natural terrain. Default: the feature width. */
  readonly apronM?: number;
  /** Width of the smooth blend from the plateau back to natural terrain. Default: ten times the feature width. */
  readonly shoulderM?: number;
  /** Distance beyond the edge that {@link FlatFeatureSet.isInClearance} reports as clear ground. Default: `apronM`. */
  readonly clearanceM?: number;
}

/**
 * A straight segment of a road or taxiway along the great circle from `start` to `end`, with round ends so a
 * polyline of segments joins without gaps.
 */
export interface IFlatSegmentFeature extends IFlatFeatureCommon {
  readonly kind: 'segment';
  readonly start: FlatFeatureVec3;
  readonly end: FlatFeatureVec3;
  readonly widthM: number;
  /**
   * Flattened surface height above the sea datum (the units `modifyElevation` receives): one value, or the heights
   * at `start` and `end`, interpolated along the segment. Omit it to paint the segment on natural terrain.
   */
  readonly heightM?: number | readonly [number, number];
}

/** A rectangle (runway, apron) centred on `centre`, its length along `headingRad` measured from east towards north. */
export interface IFlatRectangleFeature extends IFlatFeatureCommon {
  readonly kind: 'rectangle';
  readonly centre: FlatFeatureVec3;
  readonly headingRad: number;
  readonly lengthM: number;
  readonly widthM: number;
  /** Flattened surface height above the sea datum. Omit it to paint the rectangle on natural terrain. */
  readonly heightM?: number;
}

/** A flat feature definition. Plain data, so it can be posted to a worker. */
export type FlatFeature = IFlatSegmentFeature | IFlatRectangleFeature;

/** SDF shape code: 0 = box (rectangle), 1 = capsule (segment). */
export type FlatFeatureShape = 0 | 1;

/**
 * A feature resolved to a tangent frame at its centre. `along` and `across` are perpendicular to `centre`, so for a
 * unit direction `d`, `dot(d, along) * radiusM` and `dot(d, across) * radiusM` are its along and across coordinates
 * with no subtraction of the centre. Across distance is exact to a great circle; along distance is the sine measure,
 * within centimetres of arc length for features shorter than a few percent of the radius.
 */
export interface IResolvedFlatFeature {
  /** Position in {@link FlatFeatureSet.features}, and the row the material reads. */
  readonly index: number;
  readonly source: FlatFeature;
  readonly shape: FlatFeatureShape;
  readonly centre: FlatFeatureVec3;
  readonly along: FlatFeatureVec3;
  readonly across: FlatFeatureVec3;
  readonly halfLengthM: number;
  readonly halfWidthM: number;
  readonly priority: number;
  readonly markings: number;
  readonly surface: number;
  /** Stamp heights at the `-along` and `+along` ends, or `null` when the feature does not flatten the ground. */
  readonly heightM: readonly [number, number] | null;
  readonly apronM: number;
  readonly shoulderM: number;
  readonly clearanceM: number;
  /** Cosine of the angle from `centre` beyond which the feature and its shoulder cannot reach. */
  readonly cosReach: number;
}

/** Lat/lon bounds of a material page and its bounding cap. See {@link flatFeaturePageBounds}. */
export interface IFlatFeaturePageBounds {
  readonly level: number;
  readonly x: number;
  readonly y: number;
  /** Unit direction of the page centre. */
  readonly centre: FlatFeatureVec3;
  /** Great-circle angle from the centre that contains the whole page. */
  readonly radiusRad: number;
}

/** What {@link FlatFeatureSet.selectForPage} returns. */
export interface IFlatFeaturePageSelection {
  /** Feature indices, highest priority first, at most `maxCount`. */
  readonly indices: readonly number[];
  /** Overlapping features left out because the list was full (the lowest priorities, then the farthest). */
  readonly dropped: number;
}

const dot = (a: FlatFeatureVec3, b: FlatFeatureVec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: FlatFeatureVec3, b: FlatFeatureVec3): FlatFeatureVec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalise = (a: FlatFeatureVec3): FlatFeatureVec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Hermite falloff: 1 at `t <= 0`, 0 at `t >= 1`, smooth between. */
const falloff = (t: number): number => (t <= 0 ? 1 : t >= 1 ? 0 : 1 - t * t * (3 - 2 * t));

/**
 * Tangent frame at `centre` for a heading measured from east towards north. Near a pole, where east is undefined,
 * east falls back to +X.
 */
export function flatFeatureFrame(centre: FlatFeatureVec3, headingRad: number): { along: FlatFeatureVec3; across: FlatFeatureVec3 } {
  const c = normalise(centre);
  let east = cross([0, 1, 0], c);
  east = Math.hypot(east[0], east[1], east[2]) < 1e-9 ? [1, 0, 0] : normalise(east);
  const north = cross(c, east);
  const ch = Math.cos(headingRad);
  const sh = Math.sin(headingRad);
  const along = normalise([east[0] * ch + north[0] * sh, east[1] * ch + north[1] * sh, east[2] * ch + north[2] * sh]);
  return { along, across: cross(c, along) };
}

/**
 * Unit direction `alongM` metres along and `acrossM` metres across a tangent frame from `centre`. Handy for laying
 * out features relative to a site.
 */
export function flatFeatureOffset(
  centre: FlatFeatureVec3,
  frame: { along: FlatFeatureVec3; across: FlatFeatureVec3 },
  alongM: number,
  acrossM: number,
  radiusM: number,
): FlatFeatureVec3 {
  const { along, across } = frame;
  return normalise([
    centre[0] + (along[0] * alongM + across[0] * acrossM) / radiusM,
    centre[1] + (along[1] * alongM + across[1] * acrossM) / radiusM,
    centre[2] + (along[2] * alongM + across[2] * acrossM) / radiusM,
  ]);
}

/** Resolves a definition to its frame. Throws on a degenerate or over-long segment. */
export function resolveFlatFeature(feature: FlatFeature, index: number, radiusM: number): IResolvedFlatFeature {
  const halfWidthM = feature.widthM / 2;
  if (!(halfWidthM > 0)) throw new Error(`flat feature ${feature.id ?? index}: widthM must be positive`);
  let shape: FlatFeatureShape;
  let centre: FlatFeatureVec3;
  let along: FlatFeatureVec3;
  let across: FlatFeatureVec3;
  let halfLengthM: number;
  let heightM: readonly [number, number] | null;
  if (feature.kind === 'segment') {
    const a = normalise(feature.start);
    const b = normalise(feature.end);
    const chord: FlatFeatureVec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const chordLength = Math.hypot(chord[0], chord[1], chord[2]);
    if (chordLength * radiusM < 1e-3) throw new Error(`flat feature ${feature.id ?? index}: segment has no length`);
    if (dot(a, b) < Math.SQRT1_2) throw new Error(`flat feature ${feature.id ?? index}: segment spans more than 45 degrees`);
    shape = 1;
    centre = normalise([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
    // |a| = |b| = 1, so b - a is already perpendicular to a + b.
    along = [chord[0] / chordLength, chord[1] / chordLength, chord[2] / chordLength];
    across = cross(centre, along);
    halfLengthM = dot(b, along) * radiusM;
    const h = feature.heightM;
    heightM = h === undefined ? null : typeof h === 'number' ? [h, h] : [h[0], h[1]];
  } else {
    shape = 0;
    centre = normalise(feature.centre);
    ({ along, across } = flatFeatureFrame(centre, feature.headingRad));
    halfLengthM = feature.lengthM / 2;
    heightM = feature.heightM === undefined ? null : [feature.heightM, feature.heightM];
  }
  const apronM = feature.apronM ?? feature.widthM;
  const shoulderM = feature.shoulderM ?? feature.widthM * 10;
  const clearanceM = feature.clearanceM ?? apronM;
  const reachM = Math.hypot(halfLengthM, halfWidthM) + Math.max(apronM + shoulderM, clearanceM);
  return {
    index,
    source: feature,
    shape,
    centre,
    along,
    across,
    halfLengthM,
    halfWidthM,
    priority: feature.priority ?? 0,
    markings: FLAT_FEATURE_MARKINGS[feature.markings ?? 'none'],
    surface: FLAT_FEATURE_SURFACES[feature.surface ?? 'asphalt'],
    heightM,
    apronM,
    shoulderM,
    clearanceM,
    cosReach: Math.cos(Math.min(reachM / radiusM, Math.PI / 2)),
  };
}

/**
 * Signed distance from the feature edge in metres (negative inside), measured in the feature's tangent frame. The
 * same formula as the material layer: box `length(max(q, 0)) + min(max(q.x, q.y), 0)`, capsule
 * `length(vec2(max(|a| - halfLength, 0), b)) - halfWidth`. Directions on the far hemisphere from the feature return
 * `Infinity` (the frame coordinates repeat there).
 */
export function flatFeatureSignedDistanceM(feature: IResolvedFlatFeature, direction: FlatFeatureVec3, radiusM: number): number {
  if (dot(direction, feature.centre) <= 0) return Infinity;
  const a = dot(direction, feature.along) * radiusM;
  const b = dot(direction, feature.across) * radiusM;
  if (feature.shape === 1) return Math.hypot(Math.max(Math.abs(a) - feature.halfLengthM, 0), b) - feature.halfWidthM;
  const qx = Math.abs(a) - feature.halfLengthM;
  const qy = Math.abs(b) - feature.halfWidthM;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}

/**
 * Stamp weight: 1 on the feature and its apron, falling smoothly (Hermite) to 0 over the shoulder. `distanceM` is
 * {@link flatFeatureSignedDistanceM}.
 */
export function flatFeatureStampWeight(feature: IResolvedFlatFeature, distanceM: number): number {
  return falloff((distanceM - feature.apronM) / feature.shoulderM);
}

/** The feature's flattened height at a direction (interpolated along a segment), or `null` when it does not stamp. */
export function flatFeatureHeightAt(feature: IResolvedFlatFeature, direction: FlatFeatureVec3, radiusM: number): number | null {
  const h = feature.heightM;
  if (!h) return null;
  if (h[0] === h[1]) return h[0];
  const a = dot(direction, feature.along) * radiusM;
  const t = Math.min(Math.max((a / feature.halfLengthM + 1) / 2, 0), 1);
  return h[0] + (h[1] - h[0]) * t;
}

/**
 * Lat/lon page `(x, y)` at `level` of the equirectangular page grid the material uses: `2^(level+1)` columns from
 * longitude -π, `2^level` rows from latitude -π/2. Longitude is `atan2(x, z)`, as everywhere in the cell planet.
 */
export function flatFeaturePageBounds(level: number, x: number, y: number): IFlatFeaturePageBounds {
  const columns = 2 ** (level + 1);
  const rows = 2 ** level;
  const lon0 = -Math.PI + (x / columns) * 2 * Math.PI;
  const lon1 = lon0 + (2 * Math.PI) / columns;
  const lat0 = -Math.PI / 2 + (y / rows) * Math.PI;
  const lat1 = lat0 + Math.PI / rows;
  const dir = (lat: number, lon: number): FlatFeatureVec3 => [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
  const centre = dir((lat0 + lat1) / 2, (lon0 + lon1) / 2);
  // The farthest point of a lat/lon rectangle is a corner or an edge midpoint (the equatorward edge bulges).
  let minDot = 1;
  for (const lat of [lat0, (lat0 + lat1) / 2, lat1]) {
    for (const lon of [lon0, (lon0 + lon1) / 2, lon1]) minDot = Math.min(minDot, dot(centre, dir(lat, lon)));
  }
  return { level, x, y, centre, radiusRad: Math.acos(Math.max(-1, Math.min(1, minDot))) * 1.01 };
}

/**
 * A resolved set of flat features on one planet: the height stamp, the nearest-feature query, page selection and
 * the clearance query. Build it once per feature list (in the worker and on the page) from the same plain data.
 *
 * Lookups test every feature against a bounding cap first (one dot product each), which suits hundreds of
 * features; a spatial index would be the next step for many thousands.
 */
export class FlatFeatureSet {
  /** Resolved features, in definition order. Row `i` of the material's feature table is `features[i]`. */
  readonly features: readonly IResolvedFlatFeature[];
  /** Stamp order: ascending priority, then definition order, so higher priority is applied last and wins. */
  private readonly stampOrder: readonly IResolvedFlatFeature[];

  constructor(
    definitions: readonly FlatFeature[],
    /** Datum radius in metres (the radius the terrain mesh uses). */
    readonly radiusM: number,
  ) {
    this.features = definitions.map((feature, index) => resolveFlatFeature(feature, index, radiusM));
    this.stampOrder = this.features
      .filter((feature) => feature.heightM !== null)
      .sort((p, q) => p.priority - q.priority || p.index - q.index);
  }

  /**
   * Applies the height stamp to a natural elevation (metres above the datum) at a direction. Features are blended
   * in ascending priority, each `h = mix(h, featureHeight, weight)`, so the result is continuous everywhere and the
   * highest priority feature holds its own height on its plateau where features cross.
   */
  stampElevation(direction: FlatFeatureVec3, elevationM: number): number {
    let h = elevationM;
    for (const feature of this.stampOrder) {
      if (dot(direction, feature.centre) < feature.cosReach) continue;
      const w = flatFeatureStampWeight(feature, flatFeatureSignedDistanceM(feature, direction, this.radiusM));
      if (w === 0) continue;
      const target = flatFeatureHeightAt(feature, direction, this.radiusM)!;
      h += (target - h) * w;
    }
    return h;
  }

  /**
   * The stamp as an `ICellPlanetWorkerPipelineOptions.modifyElevation` hook. It uses this set's radius; the
   * pipeline's radius argument is ignored, so build the set with the mesh request's radius.
   */
  heightStamp(): (direction: readonly [number, number, number], elevationM: number, radiusM: number) => number {
    return (direction, elevationM) => this.stampElevation(direction, elevationM);
  }

  /** The nearest feature edge: signed distance in metres (negative inside) and the feature, or `null` with none in reach. */
  nearest(direction: FlatFeatureVec3): { distanceM: number; feature: IResolvedFlatFeature } | null {
    let best: { distanceM: number; feature: IResolvedFlatFeature } | null = null;
    for (const feature of this.features) {
      if (dot(direction, feature.centre) < feature.cosReach) continue;
      const distanceM = flatFeatureSignedDistanceM(feature, direction, this.radiusM);
      if (!best || distanceM < best.distanceM) best = { distanceM, feature };
    }
    return best;
  }

  /**
   * True where a point is inside a feature or within its `clearanceM` of the edge, plus `marginM` (for example an
   * object's footprint radius). For scatter: skip trees and rocks where this returns true.
   */
  isInClearance(direction: FlatFeatureVec3, marginM = 0): boolean {
    for (const feature of this.features) {
      if (dot(direction, feature.centre) < feature.cosReach - marginM / this.radiusM) continue;
      if (flatFeatureSignedDistanceM(feature, direction, this.radiusM) < feature.clearanceM + marginM) return true;
    }
    return false;
  }

  /**
   * Features whose painted area may overlap a page, at most `maxCount`, highest priority first, then nearest to
   * the page centre. The test is conservative and exact for the SDF (it is 1-Lipschitz): a feature is kept when
   * its distance at the page centre is within the page's bounding radius plus `marginM`.
   */
  selectForPage(page: IFlatFeaturePageBounds, maxCount: number, marginM = 2): IFlatFeaturePageSelection {
    const pageRadiusM = page.radiusRad * this.radiusM;
    const hits: { feature: IResolvedFlatFeature; distanceM: number }[] = [];
    for (const feature of this.features) {
      let distanceM = flatFeatureSignedDistanceM(feature, page.centre, this.radiusM);
      // Very coarse pages reach past the feature's front hemisphere, where the frame repeats: fall back to caps.
      if (page.radiusRad > Math.PI / 4) {
        const angle = Math.acos(Math.max(-1, Math.min(1, dot(page.centre, feature.centre))));
        distanceM = Math.min(distanceM, (angle - Math.acos(feature.cosReach)) * this.radiusM);
      }
      if (distanceM <= pageRadiusM + marginM) hits.push({ feature, distanceM });
    }
    hits.sort((p, q) => q.feature.priority - p.feature.priority || p.distanceM - q.distanceM || p.feature.index - q.feature.index);
    const kept = hits.slice(0, maxCount).map((hit) => hit.feature.index);
    return { indices: kept, dropped: hits.length - kept.length };
  }
}
