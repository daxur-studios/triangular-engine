/** Pluggable lon/lat <-> canvas-space projections shared by `<cellPlanetMap>` (and any future flat-
 * map renderer in this sublibrary) - factored out so the component picks a projection by name
 * instead of hardcoding one map-point formula. Every projection works in the same canvas-space
 * convention: `x` in `0..width`, `y` in `0..height`, y-down, origin top-left - the exact space
 * `<cellPlanetMap>`'s own `mapPoint()`/`#directionToCanvasPoint()` already produced when only
 * equirectangular existed. */

export type MapProjectionKind = 'equirectangular' | 'equalEarth';

export interface IMapProjection {
  /** lon in `(-pi, pi]`, lat in `[-pi/2, pi/2]` -> canvas-space `{x, y}`. Always succeeds - every
   * point on the sphere has a well-defined projected position. */
  project(lon: number, lat: number, width: number, height: number): { x: number; y: number };
  /** Inverse of `project()`. Returns `null` if `(x, y)` falls outside this projection's valid
   * area - e.g. the rectangular corners around a pseudocylindrical projection's lens-shaped
   * boundary - rather than an out-of-domain lon/lat. */
  unproject(x: number, y: number, width: number, height: number): { lon: number; lat: number } | null;
}

/** The flat map's original (and still default) projection - linear in both axes, so straight up
 * the antimeridian seam scan (`SEAM_THRESHOLD` in `cell-planet-map.component.ts`) already assumes.
 * Distorts area heavily near the poles (Greenland/Antarctica read far larger than they are) - the
 * exact distortion the UN's 2026 "Correct the Map" resolution asks institutions to move away from
 * in favor of `EQUAL_EARTH_PROJECTION` below. */
export const EQUIRECTANGULAR_PROJECTION: IMapProjection = {
  project(lon, lat, width, height) {
    return {
      x: ((lon / Math.PI) * 0.5 + 0.5) * width,
      y: (1 - ((lat / (Math.PI / 2)) * 0.5 + 0.5)) * height,
    };
  },
  unproject(x, y, width, height) {
    return {
      lon: ((x / width) * 2 - 1) * Math.PI,
      lat: (1 - (2 * y) / height) * (Math.PI / 2),
    };
  },
};

// ==========================================================================
// Equal Earth (Šavrič/Patterson/Jenny, 2018) - the equal-area pseudocylindrical projection the UN
// General Assembly's September 2026 "Correct the Map" resolution encourages as the Mercator/
// equirectangular default's replacement. Closed-form forward projection; the inverse solves a 1D
// Newton iteration for latitude (the forward `y` formula depends only on latitude, never
// longitude), then recovers longitude algebraically - same approach as d3-geo-projection's
// reference implementation, which these constants and formulas match.
// ==========================================================================

const EE_A1 = 1.340264;
const EE_A2 = -0.081106;
const EE_A3 = 0.000893;
const EE_A4 = 0.003796;
/** sin(60deg) - the parametric-latitude scale factor from the original paper. */
const EE_M = Math.sqrt(3) / 2;
const EE_NEWTON_ITERATIONS = 12;
const EE_NEWTON_EPSILON = 1e-9;

/** Raw (unnormalized) forward projection - `lon`/`lat` in radians in, plane units out, centered on
 * `(0, 0)`. `EQUAL_EARTH_PROJECTION.project()` below just rescales this into canvas space. */
function equalEarthRaw(lon: number, lat: number): { x: number; y: number } {
  const theta = Math.asin(Math.max(-1, Math.min(1, EE_M * Math.sin(lat))));
  const theta2 = theta * theta;
  const theta6 = theta2 * theta2 * theta2;
  const x = (lon * Math.cos(theta)) / (EE_M * (EE_A1 + 3 * EE_A2 * theta2 + theta6 * (7 * EE_A3 + 9 * EE_A4 * theta2)));
  const y = theta * (EE_A1 + EE_A2 * theta2 + theta6 * (EE_A3 + EE_A4 * theta2));
  return { x, y };
}

/** Half-extent of `equalEarthRaw()`'s output at the equator (`lon = pi, lat = 0`) - used to scale
 * the raw projection to fill `width` exactly (see `EQUAL_EARTH_PROJECTION.project()`). Computed
 * once at module load, not hardcoded, so a future constant tweak above can't silently desync it. */
const EE_RAW_X_MAX = equalEarthRaw(Math.PI, 0).x;

export const EQUAL_EARTH_PROJECTION: IMapProjection = {
  project(lon, lat, width, height) {
    const raw = equalEarthRaw(lon, lat);
    const scale = width / (2 * EE_RAW_X_MAX);
    return {
      x: width / 2 + raw.x * scale,
      y: height / 2 - raw.y * scale,
    };
  },
  unproject(x, y, width, height) {
    const scale = width / (2 * EE_RAW_X_MAX);
    const rx = (x - width / 2) / scale;
    const ry = (height / 2 - y) / scale;

    // Newton's method on the `y = f(theta)` formula alone - it never depends on longitude, so this
    // is a 1D root-find, not a 2D one. Starting guess `ry` itself (as d3-geo-projection does) is
    // already close since `f` is nearly linear over its domain.
    let theta = ry;
    let derivative = EE_A1;
    for (let i = 0; i < EE_NEWTON_ITERATIONS; i++) {
      const theta2 = theta * theta;
      const theta6 = theta2 * theta2 * theta2;
      derivative = EE_A1 + 3 * EE_A2 * theta2 + theta6 * (7 * EE_A3 + 9 * EE_A4 * theta2);
      const fy = theta * (EE_A1 + EE_A2 * theta2 + theta6 * (EE_A3 + EE_A4 * theta2)) - ry;
      const delta = fy / derivative;
      theta -= delta;
      if (Math.abs(delta) < EE_NEWTON_EPSILON) break;
    }
    if (!Number.isFinite(theta)) return null;

    const lat = Math.asin(Math.sin(theta) / EE_M);
    if (!Number.isFinite(lat)) return null;

    const lon = (EE_M * rx * derivative) / Math.cos(theta);
    if (!Number.isFinite(lon) || Math.abs(lon) > Math.PI) return null;

    return { lon, lat };
  },
};

export const MAP_PROJECTIONS: Record<MapProjectionKind, IMapProjection> = {
  equirectangular: EQUIRECTANGULAR_PROJECTION,
  equalEarth: EQUAL_EARTH_PROJECTION,
};

export const MAP_PROJECTION_KINDS: readonly MapProjectionKind[] = ['equirectangular', 'equalEarth'];

export const MAP_PROJECTION_LABELS: Record<MapProjectionKind, string> = {
  equirectangular: 'Equirectangular',
  equalEarth: 'Equal Earth (UN-recommended)',
};
