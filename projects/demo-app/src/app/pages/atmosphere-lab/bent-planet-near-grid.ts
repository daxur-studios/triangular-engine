import { blendedProjection } from 'triangular-engine/atmosphere';

/**
 * The fine window of the bent planet's ground mesh.
 *
 * The lab's mesh is a 1 degree longitude/latitude grid with its vertices on the sphere, so each triangle is a chord that
 * sags below it: `x (L - x) / 2R` at `x` along an edge of length `L` (111 km), a plane tilted about 0.5 degrees at a
 * vertex. A camera low over the ground has its horizon only `sqrt(2 h / R)` below level (0.045 degrees at 2 m), so the
 * rays between the horizon and the tilt end on the sphere (the atmosphere's ground) but miss the mesh: a black line, up
 * to 0.7 degrees thick, with nothing to draw there but the thin haze in front of the ground.
 *
 * The tilt has to stay under the horizon's dip, which takes an edge under twice the horizon distance: 10 km at 2 m. So a
 * window of `NEAR_CELLS` x `NEAR_CELLS` coarse cells around the camera is cut out of the coarse mesh and drawn again with
 * every cell split `NEAR_SUBDIVISIONS` ways (0.04 degrees, 4.4 km; the tilt there is 0.0006 degrees). Its outer cells
 * ease from the sphere back onto the coarse mesh's own chords, so the two meet edge to edge without a step. The window
 * is as wide as the horizon is far, up to a height of about 240 m; above that the coarse mesh's tilt is under the dip.
 */
export const NEAR_CELLS = 3;
export const NEAR_SUBDIVISIONS = 25;
/** Vertices along one side of the window. */
export const NEAR_VERTICES = NEAR_CELLS * NEAR_SUBDIVISIONS + 1;

export interface NearWindow {
  /** Column and row of the window's first coarse cell (west, south). */
  readonly ix0: number;
  readonly iy0: number;
  /** Whether a coarse cell lies beyond that side. At the map's outline the window ends with the map: no easing there. */
  readonly openWest: boolean;
  readonly openEast: boolean;
  readonly openSouth: boolean;
  readonly openNorth: boolean;
}

/**
 * The window centred on the camera's coarse cell (`lonIndex` and `latIndex` are the camera's position in cells, from the
 * map's west and south edges), moved inwards where the cell is at the map's edge.
 */
export function nearWindow(lonIndex: number, latIndex: number, lonSegments: number, latSegments: number): NearWindow {
  const first = (index: number, segments: number): number => Math.min(Math.max(Math.floor(index) - 1, 0), segments - NEAR_CELLS);
  const ix0 = first(lonIndex, lonSegments);
  const iy0 = first(latIndex, latSegments);
  return {
    ix0,
    iy0,
    openWest: ix0 > 0,
    openEast: ix0 + NEAR_CELLS < lonSegments,
    openSouth: iy0 > 0,
    openNorth: iy0 + NEAR_CELLS < latSegments,
  };
}

/**
 * How much of the coarse mesh's surface a window vertex takes, 0 to 1. `wx` and `wy` are the vertex's place in the window,
 * in coarse cells from its west and south corner. 0 in the middle cell, 1 on an open edge, a smoothstep over the cell
 * between.
 */
export function nearCoarseWeight(wx: number, wy: number, window: NearWindow): number {
  let rim = Infinity;
  if (window.openWest) rim = Math.min(rim, wx);
  if (window.openEast) rim = Math.min(rim, NEAR_CELLS - wx);
  if (window.openSouth) rim = Math.min(rim, wy);
  if (window.openNorth) rim = Math.min(rim, NEAR_CELLS - wy);
  if (!Number.isFinite(rim)) return 0;
  const s = Math.min(Math.max(rim, 0), 1);
  return 1 - s * s * (3 - 2 * s);
}

/**
 * The coarse mesh's surface at a position inside its cell `(ix, iy)`, `u` east and `v` north of the cell's south-west corner
 * (0 to 1): the point on the cell's triangle, as `BentPlanetLab` splits it (south-west, south-east, north-west and
 * south-east, north-east, north-west). `positions` holds the coarse vertices, three numbers each, `row` per grid row.
 */
export function coarseSurfacePoint(
  positions: ArrayLike<number>,
  row: number,
  ix: number,
  iy: number,
  u: number,
  v: number,
  out: number[],
): void {
  const a = (iy * row + ix) * 3;
  const b = a + 3;
  const c = a + row * 3;
  const d = c + 3;
  if (u + v <= 1) {
    for (let i = 0; i < 3; i++) out[i] = positions[a + i] + u * (positions[b + i] - positions[a + i]) + v * (positions[c + i] - positions[a + i]);
  } else {
    for (let i = 0; i < 3; i++) out[i] = positions[d + i] + (1 - u) * (positions[c + i] - positions[d + i]) + (1 - v) * (positions[b + i] - positions[d + i]);
  }
}

export interface NearGridBuffers {
  /** Three numbers per vertex, in the same frame as the coarse positions. */
  readonly positions: { [i: number]: number };
  /** Map x and y, metres. */
  readonly mapXY: { [i: number]: number };
  /** Longitude and latitude, degrees. */
  readonly lonLat: { [i: number]: number };
}

/**
 * Fills the window's vertex buffers. `project` gives the map point of a longitude and latitude (radians), `place` writes the
 * point of the bent surface above a map point (three numbers at `at`), and `coarsePositions` and `coarseRow` are the coarse
 * mesh's vertices that the outer cells ease onto.
 */
export function fillNearGrid(
  window: NearWindow,
  lonSegments: number,
  latSegments: number,
  coarsePositions: ArrayLike<number>,
  coarseRow: number,
  project: (lon: number, lat: number) => readonly [number, number],
  place: (x: number, y: number, out: { [i: number]: number }, at: number) => void,
  out: NearGridBuffers,
): void {
  const coarse: number[] = [0, 0, 0];
  const surface: number[] = [0, 0, 0];
  for (let j = 0; j < NEAR_VERTICES; j++) {
    const wy = j / NEAR_SUBDIVISIONS;
    const lat = -Math.PI / 2 + (Math.PI * (window.iy0 + wy)) / latSegments;
    for (let i = 0; i < NEAR_VERTICES; i++) {
      const wx = i / NEAR_SUBDIVISIONS;
      const lon = -Math.PI + (2 * Math.PI * (window.ix0 + wx)) / lonSegments;
      const [x, y] = project(lon, lat);
      const v = j * NEAR_VERTICES + i;
      place(x, y, surface, 0);
      const weight = nearCoarseWeight(wx, wy, window);
      if (weight > 0) {
        const cx = Math.min(Math.floor(wx), NEAR_CELLS - 1);
        const cy = Math.min(Math.floor(wy), NEAR_CELLS - 1);
        coarseSurfacePoint(coarsePositions, coarseRow, window.ix0 + cx, window.iy0 + cy, wx - cx, wy - cy, coarse);
        for (let c = 0; c < 3; c++) surface[c] += (coarse[c] - surface[c]) * weight;
      }
      out.positions[v * 3] = surface[0];
      out.positions[v * 3 + 1] = surface[1];
      out.positions[v * 3 + 2] = surface[2];
      out.mapXY[v * 2] = x;
      out.mapXY[v * 2 + 1] = y;
      out.lonLat[v * 2] = (lon * 180) / Math.PI;
      out.lonLat[v * 2 + 1] = (lat * 180) / Math.PI;
    }
  }
}

/** Triangles of the window: two per fine cell, the same split as the coarse mesh. */
export function nearIndices(): Uint32Array {
  const index = new Uint32Array((NEAR_VERTICES - 1) * (NEAR_VERTICES - 1) * 6);
  let n = 0;
  for (let iy = 0; iy < NEAR_VERTICES - 1; iy++) {
    for (let ix = 0; ix < NEAR_VERTICES - 1; ix++) {
      const a = iy * NEAR_VERTICES + ix;
      index.set([a, a + 1, a + NEAR_VERTICES, a + 1, a + NEAR_VERTICES + 1, a + NEAR_VERTICES], n);
      n += 6;
    }
  }
  return index;
}

/**
 * The longitude and latitude (radians) of a point of the blended map: `blendedProjection` read backwards. `y` grows with the
 * latitude alone, so that is found by bisection, and `x` is the longitude times the row's width.
 */
export function mapToLonLat(x: number, y: number, projectionBlend: number, radius: number): { readonly lon: number; readonly lat: number } {
  let lo = -Math.PI / 2;
  let hi = Math.PI / 2;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (blendedProjection(0, mid, projectionBlend, radius)[1] < y) lo = mid;
    else hi = mid;
  }
  const lat = (lo + hi) / 2;
  const width = blendedProjection(1, lat, projectionBlend, radius)[0];
  const lon = Math.abs(width) > 1e-9 ? x / width : 0;
  return { lon: Math.min(Math.max(lon, -Math.PI), Math.PI), lat };
}
