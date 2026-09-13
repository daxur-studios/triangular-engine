import type { EngineService } from 'triangular-engine';
import {
  CLIPMAP_TERRAIN_KIND,
  clipmapBenchmarkMapName,
  clipmapTerrainKindName,
  evaluateClipmapTerrainHeight,
  getBenchmarkCalibrationPoints,
  type ClipmapBenchmarkKindName,
  type ClipmapTerrainKindName,
  type IClipmapBenchmarkCalibrationPoint,
} from './clipmap-benchmark-fixtures';
import {
  probeSeamsAndGaps,
  type ISeamProbeOptions,
  type ISeamProbeResult,
} from './clipmap-probe';

export interface IClipmapBenchmarkOptions {
  /** Benchmark terrain to evaluate. Name or numeric `uTerrainKind`. Default peaks. */
  readonly terrainKind?: ClipmapBenchmarkKindName | number;
  readonly levelCount?: number;
  readonly baseTileSizeM?: number;
  readonly blockRadiusTiles?: number;
  readonly gridResolution?: number;
  readonly finestSwitchDistanceM?: number;
  readonly heightScaleM?: number;
  readonly morphEnabled?: boolean;
  /** LOD focus the runtime scene is centred on. Default the world origin. */
  readonly cameraX?: number;
  readonly cameraZ?: number;

  /** Camera translation step for the popping sweep. Default 1 m. */
  readonly poppingStepM?: number;
  /** Total camera recede distance for the popping sweep. Default 20000 m. */
  readonly poppingSpanM?: number;
  readonly poppingToleranceMPerStep2?: number;

  /** Max absolute / relative height error tolerated at a calibration point. */
  readonly retentionToleranceM?: number;
  readonly retentionToleranceRatio?: number;

  /** Actual draw calls observed from the renderer, when available. */
  readonly maxObservedDrawCalls?: number;

  readonly runSeamProbe?: boolean;
  readonly seamProbeRenderTargetResolution?: number;

  /**
   * Switch the live material to the benchmark terrain before probing and back
   * afterwards. Supplied by the consumer (the harness cannot reach the
   * material handle itself).
   */
  readonly setTerrainKind?: (kind: ClipmapTerrainKindName) => void;
  /** Injectable probe for headless tests; defaults to `probeSeamsAndGaps`. */
  readonly probe?: (
    engine: EngineService,
    options?: ISeamProbeOptions,
  ) => Promise<ISeamProbeResult>;
}

export interface IClipmapRetentionSample {
  readonly name: string;
  readonly distanceM: number;
  /** Discrete clipmap level that renders this coordinate. -1 if uncovered. */
  readonly level: number;
  readonly xM: number;
  readonly zM: number;
  readonly trueHeightM: number;
  readonly runtimeHeightM: number;
  readonly errorM: number;
  readonly errorRatio: number;
  readonly passed: boolean;
}

export interface IClipmapPoppingSample {
  readonly name: string;
  readonly maxAccelerationMPerStep2: number;
  readonly maxAccelerationAtXM: number;
  readonly popCount: number;
}

export interface IClipmapBenchmarkEvaluation {
  readonly mapName: string;
  readonly terrainKind: number;
  readonly retention: readonly IClipmapRetentionSample[];
  readonly popping: readonly IClipmapPoppingSample[];
  readonly maxPoppingAccelerationMPerStep2: number;
  readonly poppingToleranceMPerStep2: number;
  readonly maxDrawCalls: number;
  readonly drawCallBound: number;
  readonly retentionPassed: boolean;
  readonly poppingPassed: boolean;
  readonly drawCallsPassed: boolean;
  readonly passed: boolean;
}

export interface IClipmapBenchmarkSuiteResult {
  readonly evaluation: IClipmapBenchmarkEvaluation;
  readonly seam?: ISeamProbeResult;
  readonly scorecard: string;
}

interface IClipmapMorphContext {
  readonly kind: number;
  readonly levelCount: number;
  readonly maxLevel: number;
  readonly baseTileSizeM: number;
  readonly blockRadiusTiles: number;
  readonly gridResolution: number;
  readonly finestSwitchDistanceM: number;
  readonly heightScaleM: number;
  readonly morphEnabled: boolean;
  readonly cameraX: number;
  readonly cameraZ: number;
}

interface ILevelBox {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

const DEFAULT_LEVEL_COUNT = 12;
const DEFAULT_BASE_TILE_SIZE_M = 16;
const DEFAULT_BLOCK_RADIUS_TILES = 4;
const DEFAULT_GRID_RESOLUTION = 32;
const DEFAULT_POPPING_STEP_M = 1;
const DEFAULT_POPPING_SPAN_M = 20000;
const DEFAULT_POPPING_TOLERANCE_M = 0.05;
const DEFAULT_RETENTION_TOLERANCE_M = 2;
const DEFAULT_RETENTION_TOLERANCE_RATIO = 0.15;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function resolveKind(
  kind: ClipmapBenchmarkKindName | number | undefined,
): number {
  if (kind === undefined) return CLIPMAP_TERRAIN_KIND.peaks;
  if (typeof kind === 'number') return kind;
  return CLIPMAP_TERRAIN_KIND[kind];
}

/** Mirrors the vertex shader's `realVertexSpacingM`. */
export function clipmapVertexSpacingM(
  level: number,
  baseTileSizeM: number,
  gridResolution: number,
): number {
  const clampedStride = Math.min(2 ** level, gridResolution);
  return (clampedStride / gridResolution) * baseTileSizeM * 2 ** level;
}

/** Mirrors the per-level rectilinear ring boundary the shader uses. */
export function clipmapLevelBounds(
  level: number,
  cameraX: number,
  cameraZ: number,
  baseTileSizeM: number,
  blockRadiusTiles: number,
): ILevelBox {
  const tileSizeM = baseTileSizeM * 2 ** level;
  const centerTileX = Math.floor(cameraX / (2 * tileSizeM)) * 2;
  const centerTileZ = Math.floor(cameraZ / (2 * tileSizeM)) * 2;
  return {
    minX: (centerTileX - blockRadiusTiles) * tileSizeM,
    minZ: (centerTileZ - blockRadiusTiles) * tileSizeM,
    maxX: (centerTileX + blockRadiusTiles) * tileSizeM,
    maxZ: (centerTileZ + blockRadiusTiles) * tileSizeM,
  };
}

function buildMorphContext(options?: IClipmapBenchmarkOptions): IClipmapMorphContext {
  const levelCount = options?.levelCount ?? DEFAULT_LEVEL_COUNT;
  const baseTileSizeM = options?.baseTileSizeM ?? DEFAULT_BASE_TILE_SIZE_M;
  const blockRadiusTiles =
    options?.blockRadiusTiles ?? DEFAULT_BLOCK_RADIUS_TILES;
  return {
    kind: resolveKind(options?.terrainKind),
    levelCount,
    maxLevel: levelCount - 1,
    baseTileSizeM,
    blockRadiusTiles,
    gridResolution: options?.gridResolution ?? DEFAULT_GRID_RESOLUTION,
    finestSwitchDistanceM:
      options?.finestSwitchDistanceM ?? baseTileSizeM * blockRadiusTiles,
    heightScaleM: options?.heightScaleM ?? 1,
    morphEnabled: options?.morphEnabled ?? true,
    cameraX: options?.cameraX ?? 0,
    cameraZ: options?.cameraZ ?? 0,
  };
}

/**
 * CPU port of the vertex shader's `finalHeight` for one shared-grid vertex at
 * world `(x, z)` belonging to discrete `level`. Kept intentionally line-for-
 * line with `clipmap-terrain-material.ts` so a mesh regression is reflected
 * here; if the shader changes, this must change with it.
 */
export function sampleClipmapVertexHeight(
  x: number,
  z: number,
  level: number,
  context: IClipmapMorphContext,
): number {
  const dist = Math.hypot(x - context.cameraX, z - context.cameraZ);
  const fineHeight =
    evaluateClipmapTerrainHeight(context.kind, x, z) * context.heightScaleM;

  const coarseCell = clipmapVertexSpacingM(
    Math.min(level + 1, context.maxLevel),
    context.baseTileSizeM,
    context.gridResolution,
  );
  const cX0 = Math.floor(x / coarseCell) * coarseCell;
  const cX1 = cX0 + coarseCell;
  const cZ0 = Math.floor(z / coarseCell) * coarseCell;
  const cZ1 = cZ0 + coarseCell;
  const uX = clamp((x - cX0) / coarseCell, 0, 1);
  const uZ = clamp((z - cZ0) / coarseCell, 0, 1);

  const ch00 =
    evaluateClipmapTerrainHeight(context.kind, cX0, cZ0) * context.heightScaleM;
  const ch10 =
    evaluateClipmapTerrainHeight(context.kind, cX1, cZ0) * context.heightScaleM;
  const ch01 =
    evaluateClipmapTerrainHeight(context.kind, cX0, cZ1) * context.heightScaleM;
  const ch11 =
    evaluateClipmapTerrainHeight(context.kind, cX1, cZ1) * context.heightScaleM;
  const coarseInterior = mix(mix(ch00, ch10, uX), mix(ch01, ch11, uX), uZ);

  let morphAlpha = 0;
  if (context.morphEnabled && level < context.maxLevel - 0.5) {
    const rOuter = context.finestSwitchDistanceM * 2 ** level;
    const rInner =
      level > 0.5 ? context.finestSwitchDistanceM * 2 ** (level - 1) : 0;
    const rMorphStart = mix(rInner, rOuter, 0.5);
    morphAlpha = clamp(
      (dist - rMorphStart) / Math.max(rOuter - rMorphStart, 1),
      0,
      1,
    );
  }
  const interiorHeight = mix(fineHeight, coarseInterior, morphAlpha);

  let finalHeight = interiorHeight;
  if (level < context.maxLevel - 0.5 && context.morphEnabled) {
    const box = clipmapLevelBounds(
      level,
      context.cameraX,
      context.cameraZ,
      context.baseTileSizeM,
      context.blockRadiusTiles,
    );
    const distToMinX = x - box.minX;
    const distToMaxX = box.maxX - x;
    const distToMinZ = z - box.minZ;
    const distToMaxZ = box.maxZ - z;
    const distToEdgeX = Math.min(distToMinX, distToMaxX);
    const distToEdgeZ = Math.min(distToMinZ, distToMaxZ);
    const nearestEdgeDist = Math.min(distToEdgeX, distToEdgeZ);

    let coarseEdgeH = interiorHeight;
    if (distToEdgeZ < distToEdgeX) {
      const edgeZ = distToMinZ < distToMaxZ ? box.minZ : box.maxZ;
      const h0 =
        evaluateClipmapTerrainHeight(context.kind, cX0, edgeZ) *
        context.heightScaleM;
      const h1 =
        evaluateClipmapTerrainHeight(context.kind, cX1, edgeZ) *
        context.heightScaleM;
      coarseEdgeH = mix(h0, h1, uX);
    } else {
      const edgeX = distToMinX < distToMaxX ? box.minX : box.maxX;
      const h0 =
        evaluateClipmapTerrainHeight(context.kind, edgeX, cZ0) *
        context.heightScaleM;
      const h1 =
        evaluateClipmapTerrainHeight(context.kind, edgeX, cZ1) *
        context.heightScaleM;
      coarseEdgeH = mix(h0, h1, uZ);
    }

    const borderBlend = 1 - clamp(nearestEdgeDist / coarseCell, 0, 1);
    if (borderBlend > 0) {
      finalHeight = mix(interiorHeight, coarseEdgeH, borderBlend);
    }
  }

  return finalHeight;
}

/** Finest discrete level whose ring contains the coordinate, or -1. */
export function findRenderingLevel(
  x: number,
  z: number,
  context: IClipmapMorphContext,
): number {
  for (let level = 0; level < context.levelCount; level++) {
    const box = clipmapLevelBounds(
      level,
      context.cameraX,
      context.cameraZ,
      context.baseTileSizeM,
      context.blockRadiusTiles,
    );
    if (x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ) {
      return level;
    }
  }
  return -1;
}

/**
 * Rendered surface height near `(x, z)`: the maximum `finalHeight` over the
 * four vertices of the covering level's grid cell. This is the silhouette-
 * retention estimator — a peak survives LOD only if some rendered vertex
 * near it is raised, and linear interpolation between vertices cannot exceed
 * the maximum vertex height.
 */
export function sampleClipmapRenderedHeight(
  x: number,
  z: number,
  context: IClipmapMorphContext,
): number {
  const level = findRenderingLevel(x, z, context);
  if (level < 0) return Number.NaN;
  const spacing = clipmapVertexSpacingM(
    level,
    context.baseTileSizeM,
    context.gridResolution,
  );
  const cX0 = Math.floor(x / spacing) * spacing;
  const cZ0 = Math.floor(z / spacing) * spacing;
  const corners: readonly (readonly [number, number])[] = [
    [cX0, cZ0],
    [cX0 + spacing, cZ0],
    [cX0, cZ0 + spacing],
    [cX0 + spacing, cZ0 + spacing],
  ];
  let maxHeight = Number.NEGATIVE_INFINITY;
  for (const [cornerX, cornerZ] of corners) {
    maxHeight = Math.max(
      maxHeight,
      sampleClipmapVertexHeight(cornerX, cornerZ, level, context),
    );
  }
  return maxHeight;
}

function evaluateRetention(
  options: IClipmapBenchmarkOptions,
  context: IClipmapMorphContext,
): readonly IClipmapRetentionSample[] {
  const points = getBenchmarkCalibrationPoints(context.kind);
  const toleranceM = options.retentionToleranceM ?? DEFAULT_RETENTION_TOLERANCE_M;
  const toleranceRatio =
    options.retentionToleranceRatio ?? DEFAULT_RETENTION_TOLERANCE_RATIO;

  return points.map((point: IClipmapBenchmarkCalibrationPoint) => {
    const runtimeHeightM = sampleClipmapRenderedHeight(
      point.xM,
      point.zM,
      context,
    );
    const trueHeightM = point.expectedHeightM;
    const errorM = Number.isFinite(runtimeHeightM)
      ? Math.abs(runtimeHeightM - trueHeightM)
      : Number.POSITIVE_INFINITY;
    const errorRatio = errorM / Math.max(Math.abs(trueHeightM), 1);
    const allowedErrorM = Math.max(toleranceM, toleranceRatio * Math.abs(trueHeightM));
    return {
      name: point.name,
      distanceM: Math.round(Math.hypot(point.xM, point.zM)),
      level: findRenderingLevel(point.xM, point.zM, context),
      xM: point.xM,
      zM: point.zM,
      trueHeightM,
      runtimeHeightM,
      errorM,
      errorRatio,
      passed: errorM <= allowedErrorM,
    };
  });
}

function measurePopping(
  point: IClipmapBenchmarkCalibrationPoint,
  context: IClipmapMorphContext,
  stepM: number,
  spanM: number,
  tolerance: number,
): IClipmapPoppingSample {
  const sampleCount = Math.max(2, Math.floor(spanM / stepM));
  const heights = new Float64Array(sampleCount + 1);
  for (let k = 0; k <= sampleCount; k++) {
    const cameraX = point.xM - k * stepM;
    heights[k] = sampleClipmapRenderedHeight(point.xM, point.zM, {
      ...context,
      cameraX,
      cameraZ: point.zM,
    });
  }

  let maxAcceleration = 0;
  let maxAccelerationAtX = point.xM;
  let popCount = 0;
  for (let k = 1; k < sampleCount; k++) {
    const acceleration = heights[k + 1]! - 2 * heights[k]! + heights[k - 1]!;
    if (!Number.isFinite(acceleration)) continue;
    const magnitude = Math.abs(acceleration);
    if (magnitude > maxAcceleration) {
      maxAcceleration = magnitude;
      maxAccelerationAtX = point.xM - k * stepM;
    }
    if (magnitude > tolerance) popCount++;
  }

  return {
    name: point.name,
    maxAccelerationMPerStep2: maxAcceleration,
    maxAccelerationAtXM: maxAccelerationAtX,
    popCount,
  };
}

function evaluatePopping(
  options: IClipmapBenchmarkOptions,
  context: IClipmapMorphContext,
): readonly IClipmapPoppingSample[] {
  const points = getBenchmarkCalibrationPoints(context.kind).slice(0, 6);
  const stepM = options.poppingStepM ?? DEFAULT_POPPING_STEP_M;
  const spanM = options.poppingSpanM ?? DEFAULT_POPPING_SPAN_M;
  const tolerance =
    options.poppingToleranceMPerStep2 ?? DEFAULT_POPPING_TOLERANCE_M;
  return points.map((point) =>
    measurePopping(point, context, stepM, spanM, tolerance),
  );
}

/**
 * Pure, renderer-free fidelity evaluation: compares the CPU port of the GPU
 * morph against analytic ground truth at every calibration point, measures
 * temporal pop acceleration, and bounds draw calls structurally.
 */
export function evaluateClipmapFidelity(
  options?: IClipmapBenchmarkOptions,
): IClipmapBenchmarkEvaluation {
  const context = buildMorphContext(options);
  const effectiveOptions = options ?? {};
  const retention = evaluateRetention(effectiveOptions, context);
  const popping = evaluatePopping(effectiveOptions, context);
  const poppingTolerance =
    effectiveOptions.poppingToleranceMPerStep2 ?? DEFAULT_POPPING_TOLERANCE_M;

  const retentionPassed = retention.every((sample) => sample.passed);
  const maxPoppingAccelerationMPerStep2 = popping.reduce(
    (max, sample) => Math.max(max, sample.maxAccelerationMPerStep2),
    0,
  );
  const poppingPassed = maxPoppingAccelerationMPerStep2 <= poppingTolerance;

  const drawCallBound = context.levelCount;
  const maxDrawCalls = effectiveOptions.maxObservedDrawCalls ?? drawCallBound;
  const drawCallsPassed = maxDrawCalls <= drawCallBound;

  return {
    mapName: clipmapBenchmarkMapName(context.kind),
    terrainKind: context.kind,
    retention,
    popping,
    maxPoppingAccelerationMPerStep2,
    poppingToleranceMPerStep2: poppingTolerance,
    maxDrawCalls,
    drawCallBound,
    retentionPassed,
    poppingPassed,
    drawCallsPassed,
    passed: retentionPassed && poppingPassed && drawCallsPassed,
  };
}

function formatMeters(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : 'NaN';
}

/**
 * Compact, token-efficient plain-text scorecard for AI agents and CI logs.
 */
export function formatClipmapBenchmarkScorecard(
  evaluation: IClipmapBenchmarkEvaluation,
  seam?: ISeamProbeResult,
): string {
  const seamPassed = seam ? seam.passed : true;
  const overallPassed = evaluation.passed && seamPassed;

  const retentionLines = evaluation.retention.map(
    (sample) =>
      `  - ${sample.name} (d=${sample.distanceM}m, L${sample.level}, H_true=${formatMeters(sample.trueHeightM)}m): ` +
      `H_runtime=${formatMeters(sample.runtimeHeightM)}m (Error: ${formatMeters(sample.errorM)}m / ${(sample.errorRatio * 100).toFixed(1)}%)${sample.passed ? '' : ' [FAIL]'}`,
  );

  const poppingLines = evaluation.popping.map(
    (sample) =>
      `  - ${sample.name}: max |d2H/dd2| = ${sample.maxAccelerationMPerStep2.toFixed(4)} m/frame @ x=${Math.round(sample.maxAccelerationAtXM)}m (${sample.popCount} pop samples)`,
  );

  const seamLine = seam
    ? seam.passed
      ? `PASS (0 leak px across ${seam.stationsChecked} stations)`
      : `FAIL (${seam.totalLeakPixels} leak px across ${seam.stationsFailed}/${seam.stationsChecked} stations)`
    : 'NOT RUN';

  return [
    '=== CLIPMAP TERRAIN BENCHMARK SCORECARD ===',
    `Benchmark Map: ${evaluation.mapName}`,
    `Status: ${overallPassed ? 'PASS' : 'FAIL'}`,
    '',
    'Feature Height Retention:',
    ...retentionLines,
    '',
    `Boundary Watertightness: ${seamLine}`,
    `Max Draw Calls: ${evaluation.maxDrawCalls} / ${evaluation.drawCallBound} (${evaluation.drawCallsPassed ? 'PASS' : 'FAIL'})`,
    `Temporal Pop Acceleration: ${evaluation.maxPoppingAccelerationMPerStep2.toFixed(4)} m/frame ` +
      `(${evaluation.poppingPassed ? 'Within' : 'EXCEEDS'} <${evaluation.poppingToleranceMPerStep2} m tolerance)`,
    '',
    'Per-station pop breakdown:',
    ...poppingLines,
    '===========================================',
  ].join('\n');
}

/**
 * Full suite: switch the live material to the benchmark terrain, evaluate the
 * CPU fidelity metrics, run the GPU seam sentinel (unless disabled), then
 * format the scorecard. The caller owns `engine` lifecycle and camera state.
 */
export async function runClipmapBenchmarkSuite(
  engine: EngineService,
  options?: IClipmapBenchmarkOptions,
): Promise<IClipmapBenchmarkSuiteResult> {
  const context = buildMorphContext(options);
  const kindName = clipmapTerrainKindName(context.kind);

  options?.setTerrainKind?.(kindName);
  const evaluation = evaluateClipmapFidelity(options);

  let seam: ISeamProbeResult | undefined;
  if (options?.runSeamProbe !== false) {
    const probe = options?.probe ?? probeSeamsAndGaps;
    const baseTileSizeM = options?.baseTileSizeM ?? DEFAULT_BASE_TILE_SIZE_M;
    const blockRadiusTiles =
      options?.blockRadiusTiles ?? DEFAULT_BLOCK_RADIUS_TILES;
    const levelCount = options?.levelCount ?? DEFAULT_LEVEL_COUNT;
    const finestSwitchDistanceM =
      options?.finestSwitchDistanceM ?? baseTileSizeM * blockRadiusTiles;
    seam = await probe(engine, {
      renderTargetResolution: options?.seamProbeRenderTargetResolution,
      levelCount,
      baseTileSizeM,
      blockRadiusTiles,
      finestSwitchDistanceM,
      outerRadiusM: baseTileSizeM * 2 ** (levelCount - 1) * blockRadiusTiles,
    });
  }

  return {
    evaluation,
    seam,
    scorecard: formatClipmapBenchmarkScorecard(evaluation, seam),
  };
}
