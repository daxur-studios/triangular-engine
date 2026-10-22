import {
  bendCurvature,
  bendFrame,
  bentMapCoords,
  blendedExtents,
  mapMaskFactor,
  projectionRowAt,
  projectionRows,
  rayAtAltitude,
  type Vec3,
} from 'triangular-engine/atmosphere';
import type { AtmosphereImageExpectations, AtmosphereLabState } from './atmosphere-lab-tests';

/**
 * Image checks for the atmosphere lab (Plan 049). The page reads a frame back and reduces it to about 256 cells across;
 * everything here is pure, so the maths is specified without a GPU.
 *
 * Two frames per case. The normal frame is what a person sees. The coverage frame is the same view with the sky pass
 * replaced by a probe that paints the sentinel colour wherever the sky pass's analytic ground sphere is hit inside the map
 * (`BentPlanetLab.setCoverageProbe`) and black elsewhere, with the ground mesh drawn over it as usual. A sentinel pixel is
 * therefore a place where the atmosphere expects ground and the mesh is not.
 */

/** Width of the reduced frame, in cells. A cell is about 6 px of a 1500 px wide canvas. */
export const CHECK_FRAME_WIDTH = 256;

/** Vertical field of view of the lab camera, degrees (set by the page). */
export const LAB_CAMERA_FOV_DEG = 75;

/** Falloff of the map mask at the map's edge, metres (`BentAtmosphere.uSoftness`' default, which the lab keeps). */
export const LAB_MASK_SOFTNESS_M = 8000;

/** A frame reduced to cells: per cell the mean and darkest luma of its source pixels, and the share that is sentinel. */
export interface CheckFrame {
  /** Cells across and down. */
  readonly width: number;
  readonly height: number;
  /** The canvas size that was read, pixels. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Luma (Rec. 709 weights on the sRGB-encoded bytes), 0..1. */
  readonly lumaMean: Float32Array;
  readonly lumaMin: Float32Array;
  /** Fraction (0..1) of the cell's source pixels that are the sentinel colour. All zero for a normal frame. */
  readonly sentinel: Float32Array;
  /** Mean colour per cell, RGBA bytes: the thumbnail. */
  readonly rgba: Uint8ClampedArray;
}

/** The two frames of a case plus the facts about the view that the pure maths cannot read from the state. */
export interface CheckFrames {
  readonly normal: CheckFrame;
  readonly coverage: CheckFrame;
  /** The air's top, metres above the ground (it depends on the preset and size). */
  readonly airTopM: number;
}

/** Magenta, however the output pass tinted it: strong red and blue, almost no green. */
export function isSentinelPixel(r: number, g: number, b: number): boolean {
  return r > 100 && b > 100 && g * 4 < Math.min(r, b);
}

/**
 * Reduces `rgba` (`sourceWidth` x `sourceHeight`) to `outWidth` cells across. Reading every source pixel keeps a band a
 * pixel or two thick: the cell's minimum luma and sentinel share still see it where a plain downscale would average it away.
 */
export function reduceFrame(
  rgba: Uint8ClampedArray, sourceWidth: number, sourceHeight: number, outWidth = CHECK_FRAME_WIDTH,
): CheckFrame {
  const width = Math.max(1, Math.min(outWidth, sourceWidth));
  const height = Math.max(1, Math.round((sourceHeight * width) / sourceWidth));
  const cells = width * height;
  const sumR = new Float64Array(cells);
  const sumG = new Float64Array(cells);
  const sumB = new Float64Array(cells);
  const count = new Float64Array(cells);
  const sentinelCount = new Float64Array(cells);
  const lumaMin = new Float32Array(cells).fill(1);
  const lumaSum = new Float64Array(cells);
  for (let y = 0; y < sourceHeight; y++) {
    const cy = Math.min(height - 1, Math.floor((y * height) / sourceHeight));
    for (let x = 0; x < sourceWidth; x++) {
      const cell = cy * width + Math.min(width - 1, Math.floor((x * width) / sourceWidth));
      const i = (y * sourceWidth + x) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      sumR[cell] += r;
      sumG[cell] += g;
      sumB[cell] += b;
      lumaSum[cell] += luma;
      count[cell]++;
      if (luma < lumaMin[cell]) lumaMin[cell] = luma;
      if (isSentinelPixel(r, g, b)) sentinelCount[cell]++;
    }
  }
  const lumaMean = new Float32Array(cells);
  const sentinel = new Float32Array(cells);
  const out = new Uint8ClampedArray(cells * 4);
  for (let c = 0; c < cells; c++) {
    const n = Math.max(1, count[c]);
    lumaMean[c] = lumaSum[c] / n;
    sentinel[c] = sentinelCount[c] / n;
    out[c * 4] = sumR[c] / n;
    out[c * 4 + 1] = sumG[c] / n;
    out[c * 4 + 2] = sumB[c] / n;
    out[c * 4 + 3] = 255;
  }
  return { width, height, sourceWidth, sourceHeight, lumaMean, lumaMin, sentinel, rgba: out };
}

// -- what each cell should show ----------------------------------------------------------------------

/** `sky`: no ground in that direction. `ground`: the analytic ground inside the map. `beyond`: ground sphere past the map's edge. */
export type Surface = 'sky' | 'ground' | 'beyond';

export interface ViewPrediction {
  readonly width: number;
  readonly height: number;
  /** One per cell, row 0 at the top. */
  readonly surface: readonly Surface[];
  /** The sun's elevation in the camera's local frame, as `sin`; above 0 the sun is over the horizon. */
  readonly sunUp: number;
  readonly insideAir: boolean;
}

/** The sun in the camera's local frame (east, up, south), as the sky pass uses it for the phase function. */
export function sunLocalDirection(state: AtmosphereLabState, k: number, anchorXM: number, anchorYM: number): Vec3 {
  const dir = (elevationDeg: number, azimuthDeg: number): Vec3 => {
    const e = (elevationDeg * Math.PI) / 180;
    const a = (azimuthDeg * Math.PI) / 180;
    return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
  };
  // `BentPlanetLab.setDayNight` hands the model its always-day sun: 50 degrees up at azimuth 135.
  if (state.dayNight === 'alwaysDay') return dir(50, 135);
  const c = dir(state.sunElevationDeg, state.sunAzimuthDeg);
  // The real sun is fixed in the body frame: the map centre's local frame is (x, z, -y) of the map frame.
  const s: Vec3 = [c[0], -c[2], c[1]];
  const f = bendFrame(anchorXM, anchorYM, k);
  const dot = (v: Vec3): number => v[0] * s[0] + v[1] * s[1] + v[2] * s[2];
  return [dot(f.east), dot(f.up), -dot(f.north)];
}

/**
 * Casts a ray through the centre of every cell with the CPU bent-planet maths (the twin of `BentAtmosphere.skyGate`'s
 * ground test) and says what it meets. This is the analytic planet the sky pass assumes, not the ground mesh.
 */
export function predictView(state: AtmosphereLabState, airTopM: number, cellsWide: number, cellsHigh: number): ViewPrediction {
  const R = state.planetRadiusM;
  const k = bendCurvature(state.morph, R);
  const p = state.projection === 'equalEarth' ? Math.min(1, Math.max(0, state.morph)) : 0;
  const extents = blendedExtents(p, R);
  const rows = p > 0 ? projectionRows(p, R, 256) : null;
  // `BentPlanetLab.setAnchor`: fractions of pi R and pi R / 2.
  const anchorXM = state.anchor[0] * Math.PI * R;
  const anchorYM = state.anchor[1] * 0.5 * Math.PI * R;
  const frame = bendFrame(anchorXM, anchorYM, k);
  const altitude = Math.max(state.altitudeM, 0);
  // The map frame is east, up and -north in the local frame's columns.
  const toMap = (v: Vec3): Vec3 => [
    frame.east[0] * v[0] + frame.up[0] * v[1] - frame.north[0] * v[2],
    frame.east[1] * v[0] + frame.up[1] * v[1] - frame.north[1] * v[2],
    frame.east[2] * v[0] + frame.up[2] * v[1] - frame.north[2] * v[2],
  ];
  const upMap = toMap([0, 1, 0]);
  const origin: Vec3 = [
    frame.origin[0] + upMap[0] * altitude, frame.origin[1] + upMap[1] * altitude, frame.origin[2] + upMap[2] * altitude,
  ];

  // The page's camera: yaw and pitch (pitch clamped), y up, looking along `forward`.
  const pitch = (Math.max(-89.5, Math.min(89.5, state.pitchDeg)) * Math.PI) / 180;
  const yaw = (state.yawDeg * Math.PI) / 180;
  const forward: Vec3 = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
  const rightLength = Math.hypot(forward[2], forward[0]) || 1;
  const right: Vec3 = [-forward[2] / rightLength, 0, forward[0] / rightLength];
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const tanHalf = Math.tan((LAB_CAMERA_FOV_DEG * Math.PI) / 360);
  const aspect = cellsWide / cellsHigh;

  const surface: Surface[] = new Array(cellsWide * cellsHigh);
  for (let cy = 0; cy < cellsHigh; cy++) {
    const ny = 1 - 2 * ((cy + 0.5) / cellsHigh);
    for (let cx = 0; cx < cellsWide; cx++) {
      const nx = 2 * ((cx + 0.5) / cellsWide) - 1;
      const sx = nx * tanHalf * aspect;
      const sy = ny * tanHalf;
      const local: Vec3 = [
        forward[0] + right[0] * sx + up[0] * sy,
        forward[1] + right[1] * sx + up[1] * sy,
        forward[2] + right[2] * sx + up[2] * sy,
      ];
      const length = Math.hypot(local[0], local[1], local[2]);
      const d = toMap([local[0] / length, local[1] / length, local[2] / length]);
      let result: Surface = 'sky';
      const hit = rayAtAltitude(origin, d, k, 0);
      if (hit) {
        // The camera is above the ground, so the nearer positive root is the ground the ray reaches first.
        const t = [hit.near, hit.far].filter((root) => Number.isFinite(root) && root > 1e-9).sort((a, b) => a - b)[0];
        if (t !== undefined) {
          const point: Vec3 = [origin[0] + d[0] * t, origin[1] + d[1] * t, origin[2] + d[2] * t];
          const [mx, my] = bentMapCoords(point, k);
          const halfWidth = rows ? projectionRowAt(rows, my).halfWidth : extents.halfWidth;
          const mask = state.maskEnabled
            ? mapMaskFactor(mx, my, k, halfWidth, extents.halfHeight, LAB_MASK_SOFTNESS_M)
            : 1;
          result = mask > 0.5 ? 'ground' : 'beyond';
        }
      }
      surface[cy * cellsWide + cx] = result;
    }
  }
  return {
    width: cellsWide, height: cellsHigh, surface,
    sunUp: sunLocalDirection(state, k, anchorXM, anchorYM)[1],
    insideAir: altitude < airTopM,
  };
}

// -- the checks --------------------------------------------------------------------------------------

export interface ImageCheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface ImageCheckOutcome {
  readonly checks: readonly ImageCheckResult[];
  /** Metric values; `null` where the check does not apply to this view. */
  readonly uncoveredPixels: number;
  readonly skyMedianLuma: number | null;
  readonly horizonBandPixels: number | null;
  readonly horizonColumns: number;
  readonly details: Readonly<Record<string, number | string | null>>;
}

/**
 * Sentinel area (in cells of the 256 px wide frame) the coverage check lets through. Where the mesh and the analytic
 * sphere agree the probe leaves exactly 0 (measured 2026-10-21 at 2 m and from space), so one cell's worth is already
 * a sliver along the horizon; the real gaps measured 4 to 35.
 */
export const UNCOVERED_TOLERANCE_PX = 1;
/**
 * The sky counts as lit when its median luma (tone-mapped sRGB bytes, 0..1) is above this. It tells a black or missing
 * atmosphere (0.000) from a dark one: the thin air at 25 km measured 0.08, a sun-lit sky at 5 km 0.39.
 */
export const LIT_SKY_MIN_LUMA = 0.02;
/** A sun with `sin(elevation)` above this is over the horizon with margin. */
export const SUN_UP_MIN = 0.05;
/** Sky cells needed for the lit-sky median to mean anything. */
export const LIT_SKY_MIN_CELLS = 40;
/** The band window reaches this many cells above and below the predicted boundary. */
export const BAND_HALF_CELLS = 3;
/** A cell is a dark band cell when its darkest pixel is below this share of the dimmer of the sky above and ground below. */
export const BAND_DARK_RATIO = 0.15;
/** Neither reference may be darker than this (a black sky, the lit-sky check's business), or "much darker than" says nothing. */
export const BAND_REFERENCE_FLOOR = 0.02;
/** Share of examined boundary columns that may hold a dark cell. */
export const BAND_COLUMN_TOLERANCE = 0.02;
/** Fewer judged columns than this is a sliver of a limb or an edge, not a horizon: the check does not apply (seen from space, one column). */
export const BAND_MIN_COLUMNS = 8;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

export function runImageChecks(
  state: AtmosphereLabState, frames: CheckFrames, expectations: AtmosphereImageExpectations,
): ImageCheckOutcome {
  const { normal, coverage } = frames;
  const checks: ImageCheckResult[] = [];

  // 1. Coverage: the sentinel the probe leaves must be covered by the mesh. Counted in cells of the reduced frame.
  let uncovered = 0;
  for (let c = 0; c < coverage.sentinel.length; c++) uncovered += coverage.sentinel[c];
  checks.push({
    name: 'Ground mesh covers the atmosphere\'s ground',
    passed: uncovered <= UNCOVERED_TOLERANCE_PX,
    detail: `${uncovered.toFixed(2)} px of ${coverage.width} x ${coverage.height} left uncovered (limit ${UNCOVERED_TOLERANCE_PX})`,
  });

  const prediction = predictView(state, frames.airTopM, normal.width, normal.height);

  // 2. A lit sky: the predicted sky cells are not dark when the sun is up and the camera is in the air.
  let skyMedianLuma: number | null = null;
  const skyLuma: number[] = [];
  prediction.surface.forEach((surface, i) => { if (surface === 'sky') skyLuma.push(normal.lumaMean[i]); });
  const litReason = !prediction.insideAir ? 'the camera is above the air'
    : prediction.sunUp <= SUN_UP_MIN ? 'the sun is not over the horizon'
      : skyLuma.length < LIT_SKY_MIN_CELLS ? `only ${skyLuma.length} sky cells in view` : '';
  if (!litReason) {
    skyMedianLuma = median(skyLuma);
    checks.push({
      name: 'Sky is lit', passed: skyMedianLuma > LIT_SKY_MIN_LUMA,
      detail: `median luma ${skyMedianLuma.toFixed(3)} over ${skyLuma.length} sky cells (needs > ${LIT_SKY_MIN_LUMA})`,
    });
  } else if (expectations.litSky) {
    checks.push({ name: 'Sky is lit', passed: false, detail: `scenario expects a lit sky, but ${litReason}` });
  }

  // 3. The band between the predicted boundary and the ground: dark cells that neither neighbour explains.
  const band = horizonBand(normal, prediction);
  const bandNote = `${band.boundaries} predicted boundaries, ${band.skippedDark} skipped because the sky above or the ground below was darker than ${BAND_REFERENCE_FLOOR}, ${band.skippedNeighbours} for lack of neighbours`
    + (band.columns > 0 && band.columns < BAND_MIN_COLUMNS ? `, and only ${band.columns} columns left (needs ${BAND_MIN_COLUMNS})` : '');
  const bandJudged = band.columns >= BAND_MIN_COLUMNS;
  if (bandJudged) {
    const darkColumns = band.darkColumns;
    checks.push({
      name: 'No dark band at the horizon',
      passed: darkColumns <= Math.floor(band.columns * BAND_COLUMN_TOLERANCE),
      detail: `${darkColumns} of ${band.columns} boundary columns have a cell much darker than the sky above and the ground below `
        + `(${band.darkCells} cells, darkest ${band.darkestRatio.toFixed(3)} of the reference; tolerance ${(BAND_COLUMN_TOLERANCE * 100).toFixed(0)}%)`,
    });
  } else if (expectations.horizon) {
    checks.push({
      name: 'No dark band at the horizon', passed: false,
      detail: band.boundaries === 0
        ? 'scenario expects a horizon, but the predicted view has no ground/sky boundary to follow'
        : `scenario expects a horizon, but none could be judged: ${bandNote}`,
    });
  }

  return {
    checks,
    uncoveredPixels: uncovered,
    skyMedianLuma,
    horizonBandPixels: bandJudged ? band.darkCells : null,
    horizonColumns: band.columns,
    details: {
      uncoveredPixels: uncovered, skyMedianLuma, skyCells: skyLuma.length, horizonColumns: band.columns,
      horizonDarkColumns: band.darkColumns, horizonDarkCells: band.darkCells, horizonBoundaries: band.boundaries,
      horizonSkippedDark: band.skippedDark, litSkySkipped: litReason || null,
      checkFrame: `${normal.width} x ${normal.height} from ${normal.sourceWidth} x ${normal.sourceHeight}`,
    },
  };
}

interface HorizonBand {
  readonly columns: number;
  readonly darkColumns: number;
  readonly darkCells: number;
  /** Smallest `lumaMin / reference` among dark cells (1 when none). */
  readonly darkestRatio: number;
  /** Predicted sky-over-ground boundaries found, and how many were left out of `columns` (and why). */
  readonly boundaries: number;
  readonly skippedDark: number;
  readonly skippedNeighbours: number;
}

/**
 * For every column, each place where predicted sky is directly above predicted ground is a boundary. Cells within
 * {@link BAND_HALF_CELLS} of it are the window; the three rows above the window give the sky reference and the three below
 * give the ground reference (mean luma of their cells, when they are still sky and ground). A window cell whose darkest
 * pixel is under {@link BAND_DARK_RATIO} of the dimmer reference is dark.
 */
export function horizonBand(frame: CheckFrame, prediction: ViewPrediction): HorizonBand {
  const { width, height, surface } = prediction;
  const at = (x: number, y: number) => y * width + x;
  let columns = 0;
  let darkColumns = 0;
  let darkCells = 0;
  let darkestRatio = 1;
  let boundaries = 0;
  let skippedDark = 0;
  let skippedNeighbours = 0;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height - 1; y++) {
      if (surface[at(x, y)] !== 'sky' || surface[at(x, y + 1)] !== 'ground') continue;
      const reference = (from: number, to: number, kind: Surface): number | null => {
        const values: number[] = [];
        for (let r = from; r <= to; r++) if (r >= 0 && r < height && surface[at(x, r)] === kind) values.push(frame.lumaMean[at(x, r)]);
        return values.length >= 2 ? values.reduce((a, b) => a + b, 0) / values.length : null;
      };
      const sky = reference(y - BAND_HALF_CELLS - 2, y - BAND_HALF_CELLS, 'sky');
      const ground = reference(y + 1 + BAND_HALF_CELLS + 1, y + 1 + BAND_HALF_CELLS + 3, 'ground');
      boundaries++;
      if (sky === null || ground === null) { skippedNeighbours++; continue; }
      const dimmer = Math.min(sky, ground);
      if (dimmer < BAND_REFERENCE_FLOOR) { skippedDark++; continue; }
      columns++;
      let dark = 0;
      for (let r = Math.max(0, y - BAND_HALF_CELLS); r <= Math.min(height - 1, y + 1 + BAND_HALF_CELLS); r++) {
        const ratio = frame.lumaMin[at(x, r)] / dimmer;
        if (ratio < BAND_DARK_RATIO) { dark++; darkestRatio = Math.min(darkestRatio, ratio); }
      }
      if (dark > 0) { darkColumns++; darkCells += dark; }
    }
  }
  return { columns, darkColumns, darkCells, darkestRatio, boundaries, skippedDark, skippedNeighbours };
}
