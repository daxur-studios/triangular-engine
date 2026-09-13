/**
 * Deterministic, analytic benchmark terrain fixtures with known ground-truth
 * shapes, evaluable identically on the CPU (TypeScript, for the automated
 * fidelity harness) and on the GPU (GLSL, for the live clipmap material).
 *
 * Why analytic instead of noise: randomized / fbm terrain changes everywhere
 * on every sample, so a subtle geometric collapse (a whole peak compressed
 * into one coarse quad) is indistinguishable from ordinary terrain variation.
 * These fixtures instead pin exact closed-form heights at exact coordinates —
 * compact-support peaks, knife-edge ridges, quantized plateaus and a periodic
 * multi-scale field — so the harness can assert a specific height error at a
 * specific station.
 *
 * Single source of truth: every GLSL function is generated from the same
 * numeric constants the TypeScript evaluator uses (see
 * `BENCHMARK_TERRAIN_GLSL` below), so the two implementations cannot silently
 * drift apart. If you add a feature, add the constant, use it in both the TS
 * function and the generated GLSL.
 */

/** Numeric `uTerrainKind` values understood by `clipmap-terrain-material.ts`. */
export const CLIPMAP_TERRAIN_KIND = {
  wave: 0,
  noise: 1,
  peaks: 2,
  ridges: 3,
  terraces: 4,
  field: 5,
} as const;

export type ClipmapTerrainKindName = keyof typeof CLIPMAP_TERRAIN_KIND;
export type ClipmapTerrainKindValue =
  (typeof CLIPMAP_TERRAIN_KIND)[ClipmapTerrainKindName];

export const CLIPMAP_BENCHMARK_KIND_NAMES = [
  'peaks',
  'ridges',
  'terraces',
  'field',
] as const;

export type ClipmapBenchmarkKindName =
  (typeof CLIPMAP_BENCHMARK_KIND_NAMES)[number];

export function isBenchmarkTerrainKind(kind: number): boolean {
  return kind >= CLIPMAP_TERRAIN_KIND.peaks;
}

/** Reverse lookup from numeric `uTerrainKind` to its canonical name. */
export function clipmapTerrainKindName(kind: number): ClipmapTerrainKindName {
  for (const name of Object.keys(CLIPMAP_TERRAIN_KIND) as ClipmapTerrainKindName[]) {
    if (CLIPMAP_TERRAIN_KIND[name] === kind) return name;
  }
  return 'peaks';
}

/** One calibrated compact peak whose centre height is exactly `amplitudeM`. */
export interface IClipmapBenchmarkPeakStation {
  readonly name: string;
  /** Radial station distance from the world origin, in metres. */
  readonly distanceM: number;
  readonly xM: number;
  readonly zM: number;
  /** Exact height at the centre, in metres. */
  readonly amplitudeM: number;
  /** Compact support radius; the bump is exactly zero at/after this radius. */
  readonly radiusM: number;
}

/**
 * Calibrated multi-scale peaks at graduated radial stations. Each support
 * radius is strictly smaller than the distance to every other station's
 * centre, so no other peak contributes at any centre and `amplitudeM` is the
 * exact analytic ground truth there.
 */
export const CLIPMAP_BENCHMARK_PEAK_STATIONS: readonly IClipmapBenchmarkPeakStation[] =
  [
    { name: 'd=45m', distanceM: 45, xM: 45, zM: 0, amplitudeM: 100, radiusM: 40 },
    { name: 'd=350m', distanceM: 350, xM: 350, zM: 0, amplitudeM: 300, radiusM: 180 },
    { name: 'd=1.5km', distanceM: 1500, xM: 1500, zM: 0, amplitudeM: 800, radiusM: 1100 },
    { name: 'd=12km', distanceM: 12000, xM: 12000, zM: 0, amplitudeM: 2500, radiusM: 10000 },
  ];

/** Knife-edge ridge field constants (parallel, perpendicular and 45° axes). */
export const CLIPMAP_BENCHMARK_RIDGE = {
  periodM: 2048,
  diagonalPeriodM: 2896,
  amplitudeX: 400,
  amplitudeZ: 300,
  amplitudeDiagonal: 250,
} as const;

/** Stepped plateau constants: 50 m major terraces split by 10 m sub-steps. */
export const CLIPMAP_BENCHMARK_TERRACE = {
  datumM: 220,
  majorStepM: 50,
  minorStepM: 10,
} as const;

/** Multi-scale periodic field: period, amplitude and pit ratio per octave. */
export const CLIPMAP_BENCHMARK_FIELD_SCALES = [
  { periodM: 20000, amplitudeM: 600, pitRatio: 0.4 },
  { periodM: 5000, amplitudeM: 220, pitRatio: 0.4 },
  { periodM: 1200, amplitudeM: 70, pitRatio: 0.4 },
  { periodM: 300, amplitudeM: 20, pitRatio: 0.4 },
] as const;

/** Known feature coordinates used to compare runtime mesh vs ground truth. */
export interface IClipmapBenchmarkCalibrationPoint {
  readonly name: string;
  readonly xM: number;
  readonly zM: number;
  readonly expectedHeightM: number;
  /** Nominal feature amplitude, for relative-error reporting. */
  readonly amplitudeM: number;
}

// ---------------------------------------------------------------------------
// CPU analytic evaluator
// ---------------------------------------------------------------------------

function fract(value: number): number {
  return value - Math.floor(value);
}

/** Compact-support C1 bump `(1 - (r/R)^2)^2`, exactly zero for r >= R. */
export function clipmapSoftBump(r: number, radius: number): number {
  if (radius <= 0) return 0;
  const t = Math.min(1, Math.max(0, r / radius));
  const q = 1 - t * t;
  return q * q;
}

/** Periodic compact bump centred in each square cell; zero on cell edges. */
export function clipmapPeriodicBump(x: number, z: number, period: number): number {
  const centerX = (Math.floor(x / period) + 0.5) * period;
  const centerZ = (Math.floor(z / period) + 0.5) * period;
  const dx = x - centerX;
  const dz = z - centerZ;
  return clipmapSoftBump(Math.hypot(dx, dz), period * 0.5);
}

/** Triangular knife ridge: 1 on the crest line, 0 on the cell boundary. */
export function clipmapTriangularRidge(u: number, period: number): number {
  const f = Math.abs(fract(u / period) - 0.5) * 2;
  return 1 - f;
}

/** Original smooth wave terrain (mirrors the GLSL `terrainHeightWave`). */
export function terrainHeightWave(x: number, z: number): number {
  const continental = Math.sin(x / 340) * 6 + Math.cos(z / 260) * 5;
  const ridges = Math.abs(Math.sin(x / 55 + z / 70)) * 14;
  return continental + ridges;
}

function terrainHash(x: number, y: number): number {
  let px = fract(x * 123.34);
  let py = fract(y * 456.21);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d;
  py += d;
  return fract(px * py);
}

function terrainValueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fract(x);
  const fy = fract(y);
  const a = terrainHash(ix, iy);
  const b = terrainHash(ix + 1, iy);
  const c = terrainHash(ix, iy + 1);
  const d = terrainHash(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (c - a) * uy * (1 - ux) + (d - b) * ux * uy;
}

function terrainFbm(x: number, y: number): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  for (let i = 0; i < 5; i++) {
    value += amplitude * terrainValueNoise(x * frequency, y * frequency);
    frequency *= 2.02;
    amplitude *= 0.5;
  }
  return value;
}

/** Original fbm/hash terrain (mirrors the GLSL `terrainHeightNoise`). */
export function terrainHeightNoise(x: number, z: number): number {
  const continental = terrainFbm(x / 400, z / 400) * 26 - 13;
  const ridgeNoise = terrainFbm(x / 90 + 31.7, z / 90 - 14.2);
  const ridges = Math.pow(1 - Math.abs(ridgeNoise * 2 - 1), 2) * 18;
  return continental + ridges;
}

/** Calibrated multi-scale compact peaks (exact heights at their centres). */
export function terrainHeightBenchmarkPeaks(x: number, z: number): number {
  let h = 0;
  for (const station of CLIPMAP_BENCHMARK_PEAK_STATIONS) {
    h +=
      station.amplitudeM *
      clipmapSoftBump(
        Math.hypot(x - station.xM, z - station.zM),
        station.radiusM,
      );
  }
  return h;
}

/** Sharp knife-edge ridges on parallel, perpendicular and 45° axes. */
export function terrainHeightBenchmarkRidges(x: number, z: number): number {
  const r = CLIPMAP_BENCHMARK_RIDGE;
  let h = 0;
  h += r.amplitudeX * clipmapTriangularRidge(x, r.periodM);
  h += r.amplitudeZ * clipmapTriangularRidge(z, r.periodM);
  h += r.amplitudeDiagonal * clipmapTriangularRidge(x + z, r.diagonalPeriodM);
  h += r.amplitudeDiagonal * clipmapTriangularRidge(x - z, r.diagonalPeriodM);
  return h;
}

/** Quantized stepped plateaus: 50 m major terraces split by 10 m sub-steps. */
export function terrainHeightBenchmarkTerraces(x: number, z: number): number {
  const t = CLIPMAP_BENCHMARK_TERRACE;
  const smooth =
    t.datumM +
    160 * Math.sin(x / 2200) +
    120 * Math.cos(z / 1700) +
    60 * Math.sin((x - z) / 900);
  const major = Math.floor(smooth / t.majorStepM) * t.majorStepM;
  const minor = Math.floor((smooth - major) / t.minorStepM) * t.minorStepM;
  return major + minor;
}

/** Infinite repeating multi-scale peaks-and-pits field (no flat expanse). */
export function terrainHeightBenchmarkField(x: number, z: number): number {
  let h = 0;
  for (const scale of CLIPMAP_BENCHMARK_FIELD_SCALES) {
    h += scale.amplitudeM * clipmapPeriodicBump(x, z, scale.periodM);
    h -=
      scale.amplitudeM *
      scale.pitRatio *
      clipmapPeriodicBump(
        x + scale.periodM * 0.5,
        z + scale.periodM * 0.5,
        scale.periodM,
      );
  }
  return h;
}

/** Ground-truth evaluator dispatched on the numeric terrain kind. */
export function evaluateClipmapTerrainHeight(
  kind: number,
  x: number,
  z: number,
): number {
  if (kind < 0.5) return terrainHeightWave(x, z);
  if (kind < 1.5) return terrainHeightNoise(x, z);
  if (kind < 2.5) return terrainHeightBenchmarkPeaks(x, z);
  if (kind < 3.5) return terrainHeightBenchmarkRidges(x, z);
  if (kind < 4.5) return terrainHeightBenchmarkTerraces(x, z);
  return terrainHeightBenchmarkField(x, z);
}

export function clipmapBenchmarkMapName(kind: number): string {
  if (kind < 2.5) return 'Calibrated Multi-Scale Peaks (v1)';
  if (kind < 3.5) return 'Knife-Edge Ridges (v1)';
  if (kind < 4.5) return 'Stepped Plateaus (v1)';
  return 'Periodic Multi-Scale Field (v1)';
}

// ---------------------------------------------------------------------------
// Calibration points
// ---------------------------------------------------------------------------

const RIDGE_CALIBRATION_POINTS: readonly {
  readonly name: string;
  readonly xM: number;
  readonly zM: number;
}[] = [
  { name: 'ridge-x crest @ x=1024m', xM: 1024, zM: 0 },
  { name: 'ridge-x crest @ x=3072m', xM: 3072, zM: 0 },
  { name: 'ridge-z crest @ z=1024m', xM: 0, zM: 1024 },
  { name: 'ridge crossing @ (1024,1024)m', xM: 1024, zM: 1024 },
  { name: 'ridge 45° crossing @ (1536,512)m', xM: 1536, zM: 512 },
];

const FIELD_CALIBRATION_POINTS: readonly {
  readonly name: string;
  readonly xM: number;
  readonly zM: number;
}[] = [
  { name: 'field peak @ (10000,10000)m', xM: 10000, zM: 10000 },
  { name: 'field peak @ (2500,2500)m', xM: 2500, zM: 2500 },
  { name: 'field peak @ (600,600)m', xM: 600, zM: 600 },
  { name: 'field peak @ (150,150)m', xM: 150, zM: 150 },
];

function buildTerraceCalibrationPoints(): IClipmapBenchmarkCalibrationPoint[] {
  const points: IClipmapBenchmarkCalibrationPoint[] = [];
  const z = 0;
  let previous = terrainHeightBenchmarkTerraces(0, z);
  let runStartX = 0;
  for (let x = 1; x <= 8000 && points.length < 6; x++) {
    const h = terrainHeightBenchmarkTerraces(x, z);
    if (h !== previous) {
      const runLength = x - runStartX;
      if (runLength >= 20) {
        const midX = runStartX + runLength / 2;
        points.push({
          name: `plateau @ x≈${Math.round(midX)}m`,
          xM: midX,
          zM: z,
          expectedHeightM: terrainHeightBenchmarkTerraces(midX, z),
          amplitudeM: CLIPMAP_BENCHMARK_TERRACE.majorStepM,
        });
      }
      runStartX = x;
      previous = h;
    }
  }
  return points;
}

const TERRACE_CALIBRATION_POINTS = buildTerraceCalibrationPoints();

/**
 * Known-feature coordinates for a benchmark terrain kind. Returned points have
 * exact analytic `expectedHeightM`, so the harness only has to reproduce them.
 */
export function getBenchmarkCalibrationPoints(
  kind: number,
): readonly IClipmapBenchmarkCalibrationPoint[] {
  if (kind < 2.5) {
    return CLIPMAP_BENCHMARK_PEAK_STATIONS.map((station) => ({
      name: station.name,
      xM: station.xM,
      zM: station.zM,
      expectedHeightM: evaluateClipmapTerrainHeight(kind, station.xM, station.zM),
      amplitudeM: station.amplitudeM,
    }));
  }
  if (kind < 3.5) {
    return RIDGE_CALIBRATION_POINTS.map((point) => ({
      name: point.name,
      xM: point.xM,
      zM: point.zM,
      expectedHeightM: evaluateClipmapTerrainHeight(kind, point.xM, point.zM),
      amplitudeM:
        CLIPMAP_BENCHMARK_RIDGE.amplitudeX +
        CLIPMAP_BENCHMARK_RIDGE.amplitudeZ,
    }));
  }
  if (kind < 4.5) {
    return TERRACE_CALIBRATION_POINTS;
  }
  return FIELD_CALIBRATION_POINTS.map((point) => ({
    name: point.name,
    xM: point.xM,
    zM: point.zM,
    expectedHeightM: evaluateClipmapTerrainHeight(kind, point.xM, point.zM),
    amplitudeM: CLIPMAP_BENCHMARK_FIELD_SCALES[0].amplitudeM,
  }));
}

// ---------------------------------------------------------------------------
// GLSL (generated from the constants above; keep in lockstep with the CPU side)
// ---------------------------------------------------------------------------

function glslFloat(value: number): string {
  const text = value.toFixed(1);
  return text === '-0.0' ? '0.0' : text;
}

function buildBenchmarkTerrainGLSL(): string {
  const peakTerms = CLIPMAP_BENCHMARK_PEAK_STATIONS.map(
    (station) =>
      `    h += ${glslFloat(station.amplitudeM)} * clipmapSoftBump(distance(xz, vec2(${glslFloat(station.xM)}, ${glslFloat(station.zM)})), ${glslFloat(station.radiusM)});`,
  ).join('\n');

  const fieldTerms = CLIPMAP_BENCHMARK_FIELD_SCALES.map(
    (scale) =>
      `    h += ${glslFloat(scale.amplitudeM)} * clipmapPeriodicBump(xz, ${glslFloat(scale.periodM)});\n` +
      `    h -= ${glslFloat(scale.amplitudeM * scale.pitRatio)} * clipmapPeriodicBump(xz + vec2(${glslFloat(scale.periodM * 0.5)}, ${glslFloat(scale.periodM * 0.5)}), ${glslFloat(scale.periodM)});`,
  ).join('\n');

  const r = CLIPMAP_BENCHMARK_RIDGE;
  const t = CLIPMAP_BENCHMARK_TERRACE;

  return `
  float clipmapSoftBump(float r, float radius) {
    if (radius <= 0.0) return 0.0;
    float t = clamp(r / radius, 0.0, 1.0);
    float q = 1.0 - t * t;
    return q * q;
  }

  float clipmapPeriodicBump(vec2 xz, float period) {
    vec2 center = (floor(xz / period) + 0.5) * period;
    return clipmapSoftBump(distance(xz, center), period * 0.5);
  }

  float clipmapTriangularRidge(float u, float period) {
    float f = abs(fract(u / period) - 0.5) * 2.0;
    return 1.0 - f;
  }

  float terrainHeightBenchmarkPeaks(vec2 xz) {
    float h = 0.0;
${peakTerms}
    return h;
  }

  float terrainHeightBenchmarkRidges(vec2 xz) {
    float h = 0.0;
    h += ${glslFloat(r.amplitudeX)} * clipmapTriangularRidge(xz.x, ${glslFloat(r.periodM)});
    h += ${glslFloat(r.amplitudeZ)} * clipmapTriangularRidge(xz.y, ${glslFloat(r.periodM)});
    h += ${glslFloat(r.amplitudeDiagonal)} * clipmapTriangularRidge(xz.x + xz.y, ${glslFloat(r.diagonalPeriodM)});
    h += ${glslFloat(r.amplitudeDiagonal)} * clipmapTriangularRidge(xz.x - xz.y, ${glslFloat(r.diagonalPeriodM)});
    return h;
  }

  float terrainHeightBenchmarkTerraces(vec2 xz) {
    float smoothHeight = ${glslFloat(t.datumM)} + 160.0 * sin(xz.x / 2200.0) + 120.0 * cos(xz.y / 1700.0) + 60.0 * sin((xz.x - xz.y) / 900.0);
    float major = floor(smoothHeight / ${glslFloat(t.majorStepM)}) * ${glslFloat(t.majorStepM)};
    float minor = floor((smoothHeight - major) / ${glslFloat(t.minorStepM)}) * ${glslFloat(t.minorStepM)};
    return major + minor;
  }

  float terrainHeightBenchmarkField(vec2 xz) {
    float h = 0.0;
${fieldTerms}
    return h;
  }
`;
}

export const BENCHMARK_TERRAIN_GLSL = buildBenchmarkTerrainGLSL();
