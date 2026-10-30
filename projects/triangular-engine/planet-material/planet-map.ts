/**
 * The planet material's map, on the CPU in double precision (Plan 059, step G6a).
 *
 * `planetBentSurfaceNodes` (`planet-morph-nodes.ts`) builds the map the globe flattens to in dynamic mode as
 * `mix((projLon R, projLat R), flat, morph)`, where `flat` is `equirectangularFlat` or `equalEarthFlat` (picked by
 * `uProjectionType`) over a `2 pi R` by `pi R` extent (`setPlanetMapExtent`). This file is that same definition as
 * plain numbers, so anything that has to agree with the globe material (a terrain's vertex stage, a cut or outline
 * clip, a picking ray, a marker) can ask here instead of keeping a second copy of the map.
 *
 * Pure TypeScript, no three: it is safe in any entry that may import `triangular-engine/planet-material`.
 */

/** The projection the globe flattens to. Matches `<planet [projection]>`; `uProjectionType` is 0 for equirectangular, 1 for Equal Earth. */
export type PlanetMapProjection = 'equirectangular' | 'equal-earth';

const EE_A1 = 1.340264;
const EE_A2 = -0.081106;
const EE_A3 = 0.000893;
const EE_A4 = 0.003796;
const EE_M = Math.sqrt(3) / 2;

/** Raw Equal Earth x at the equator for `lon = pi`: the same constant `equalEarthFlat` scales the map width by. */
const EE_RAW_X_MAX = Math.PI / (EE_M * EE_A1);

/**
 * How much wider (and taller) the material's Equal Earth map is than the unit-sphere form of the projection
 * ({@link planetEqualEarthRow}) at the same radius: `pi / rawXMax`, about 1.1607 (which is `sqrt(3)/2 * 1.340264`).
 * The material fits the equator to `2 pi R`, as the equirectangular map is, so Equal Earth is `R * scale` per unit of
 * the unit form in both x and y. A map built from the unit form directly (as the atmosphere's `blendedProjection` is)
 * is this factor narrower and shorter; the ratio is the same constant everywhere.
 */
export const PLANET_MAP_EQUAL_EARTH_SCALE = Math.PI / EE_RAW_X_MAX;

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/**
 * Equal Earth on the unit sphere, as `x = lon * c(lat)` and `y`. The meridians are straight, so a row's full width is
 * `2 pi c(lat)` and the outline is a function of the row alone. `c(0)` is about 0.8616 and `y(pi / 2)` about 1.3173.
 * The material's own map is this times {@link PLANET_MAP_EQUAL_EARTH_SCALE} (and the radius).
 */
export function planetEqualEarthRow(lat: number): { readonly c: number; readonly y: number } {
  const theta = Math.asin(Math.max(-1, Math.min(1, EE_M * Math.sin(lat))));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  return {
    c: Math.cos(theta) / (EE_M * (EE_A1 + 3 * EE_A2 * t2 + t6 * (7 * EE_A3 + 9 * EE_A4 * t2))),
    y: theta * (EE_A1 + EE_A2 * t2 + t6 * (EE_A3 + EE_A4 * t2)),
  };
}

/**
 * Where the globe material puts the point at projected `lon`/`lat` (radians, in the projection's own frame, so
 * relative to `projectionCentre`) on its map, in metres from the map centre.
 *
 * It is the material's `mapXY` exactly: `mix((R lon, R lat), flat, morph)`, with `flat` the equirectangular map
 * (`(R lon, R lat)` itself, so there is no blend at all) or the Equal Earth map fitted to `2 pi R` at the equator.
 * Morph 0 is `(R lon, R lat)`, the globe's own parameterisation. `morph` is clamped to 0..1.
 *
 * Feed `x`, `y` to the bend (`k = (1 - morph) / R`) for the surface point. Pass `out` to avoid an allocation.
 *
 * @param lon projected longitude, radians (the material uses -pi..pi)
 * @param lat projected latitude, radians (-pi/2..pi/2)
 * @param morph 0 = globe, 1 = flat map
 * @param projection the target projection (`<planet [projection]>`)
 * @param radius planet radius, metres
 */
export function planetMapXY(
  lon: number,
  lat: number,
  morph: number,
  projection: PlanetMapProjection,
  radius: number,
  out: [number, number] = [0, 0],
): [number, number] {
  if (projection === 'equirectangular') {
    out[0] = radius * lon;
    out[1] = radius * lat;
    return out;
  }
  const m = clamp01(morph);
  const row = planetEqualEarthRow(lat);
  const scale = PLANET_MAP_EQUAL_EARTH_SCALE * radius;
  out[0] = radius * lon * (1 - m) + lon * row.c * scale * m;
  out[1] = radius * lat * (1 - m) + row.y * scale * m;
  return out;
}

/**
 * Half the map's width at latitude `lat`, metres: where the cut meridian (`lon = +-pi`) sits at that row, so a point
 * is inside the map's outline when `|x| <= planetMapRowHalfWidth(lat, ...)`. `pi R` at morph 0 and for equirectangular;
 * for Equal Earth it narrows towards the poles as the morph rises (to about `0.592 pi R` at the poles at morph 1).
 */
export function planetMapRowHalfWidth(
  lat: number,
  morph: number,
  projection: PlanetMapProjection,
  radius: number,
): number {
  if (projection === 'equirectangular') return Math.PI * radius;
  const m = clamp01(morph);
  return Math.PI * radius * (1 - m + m * PLANET_MAP_EQUAL_EARTH_SCALE * planetEqualEarthRow(lat).c);
}

/** The map's size: half the width at the equator and half the height (the pole rows), metres. */
export interface PlanetMapExtents {
  readonly halfWidth: number;
  readonly halfHeight: number;
}

/**
 * The map's outline extents at `morph`: the equator's half-width and the poles' `y`. Equirectangular is
 * `pi R` by `pi R / 2` at every morph. Equal Earth goes from there to `pi R` by about `1.529 R`
 * at morph 1, a little shorter than the equirectangular map's `pi R / 2` half-height (1.571 R).
 */
export function planetMapExtents(
  morph: number,
  projection: PlanetMapProjection,
  radius: number,
): PlanetMapExtents {
  if (projection === 'equirectangular') {
    return { halfWidth: Math.PI * radius, halfHeight: 0.5 * Math.PI * radius };
  }
  const m = clamp01(morph);
  return {
    halfWidth: Math.PI * radius,
    halfHeight:
      radius * ((1 - m) * (Math.PI / 2) + m * PLANET_MAP_EQUAL_EARTH_SCALE * planetEqualEarthRow(Math.PI / 2).y),
  };
}

/** The outline by row, from {@link planetMapRows}. */
export interface PlanetMapRows {
  /** Latitude of each row, radians; row `i` sits at `y = -halfHeight + 2 halfHeight i / (n - 1)`. */
  readonly lat: Float64Array;
  /** The map's half-width at each row, metres. */
  readonly halfWidth: Float64Array;
  readonly extents: PlanetMapExtents;
}

/**
 * The map's outline by row: for `n` (at least 2) rows spread evenly over the map's height, the latitude on that row
 * and the half-width there. `y` depends on latitude alone and rises with it, so the rows are found by bisection.
 * It is the double-precision twin of the atmosphere's `projectionRows`, for the material's map.
 */
export function planetMapRows(
  morph: number,
  projection: PlanetMapProjection,
  radius: number,
  n: number,
): PlanetMapRows {
  const extents = planetMapExtents(morph, projection, radius);
  const lat = new Float64Array(n);
  const halfWidth = new Float64Array(n);
  const xy: [number, number] = [0, 0];
  for (let i = 0; i < n; i++) {
    const y = -extents.halfHeight + (2 * extents.halfHeight * i) / (n - 1);
    let lo = -Math.PI / 2;
    let hi = Math.PI / 2;
    for (let it = 0; it < 60; it++) {
      const mid = 0.5 * (lo + hi);
      if (planetMapXY(0, mid, morph, projection, radius, xy)[1] < y) lo = mid;
      else hi = mid;
    }
    const phi = 0.5 * (lo + hi);
    lat[i] = phi;
    halfWidth[i] = planetMapRowHalfWidth(phi, morph, projection, radius);
  }
  return { lat, halfWidth, extents };
}
