import type { EngineService } from 'triangular-engine';
import {
  BENCHMARK_TERRAIN_GLSL,
  CLIPMAP_BENCHMARK_PEAK_STATIONS,
  CLIPMAP_TERRAIN_KIND,
  clipmapTerrainKindName,
  evaluateClipmapTerrainHeight,
  terrainHeightBenchmarkField,
  terrainHeightBenchmarkPeaks,
  terrainHeightBenchmarkRidges,
  terrainHeightBenchmarkTerraces,
} from './clipmap-benchmark-fixtures';
import {
  clipmapVertexSpacingM,
  evaluateClipmapFidelity,
  findRenderingLevel,
  formatClipmapBenchmarkScorecard,
  runClipmapBenchmarkSuite,
  sampleClipmapRenderedHeight,
} from './clipmap-benchmark';
import type { ISeamProbeResult } from './clipmap-probe';

const FAST_POPPING = { poppingSpanM: 1024 } as const;

describe('clipmap-benchmark-fixtures', () => {
  it('compiles the shared terrain functions in WebGL2 vertex and fragment shaders', () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    expect(gl).withContext('WebGL2 is required to verify terrain GLSL').not.toBeNull();
    if (!gl) return;

    const stages = [
      { type: gl.VERTEX_SHADER, name: 'vertex', output: '', main: 'gl_Position = vec4(0.0, h, 0.0, 1.0);' },
      { type: gl.FRAGMENT_SHADER, name: 'fragment', output: 'out vec4 color;', main: 'color = vec4(h);' },
    ];
    try {
      for (const stage of stages) {
        const shader = gl.createShader(stage.type)!;
        try {
          gl.shaderSource(shader, `#version 300 es
            precision highp float;
            ${stage.output}
            ${BENCHMARK_TERRAIN_GLSL}
            void main() {
              float h = terrainHeightBenchmarkPeaks(vec2(0.0))
                + terrainHeightBenchmarkRidges(vec2(0.0))
                + terrainHeightBenchmarkTerraces(vec2(0.0))
                + terrainHeightBenchmarkField(vec2(0.0));
              ${stage.main}
            }
          `);
          gl.compileShader(shader);
          expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            .withContext(`${stage.name}: ${gl.getShaderInfoLog(shader)}`)
            .toBeTrue();
        } finally {
          gl.deleteShader(shader);
        }
      }
    } finally {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  });

  it('places exact peak heights at their centres with compact support', () => {
    for (const station of CLIPMAP_BENCHMARK_PEAK_STATIONS) {
      const centre = terrainHeightBenchmarkPeaks(station.xM, station.zM);
      expect(centre).toBeCloseTo(station.amplitudeM, 6);
      // Strictly outside every support: no other peak contributes here.
      const outside = terrainHeightBenchmarkPeaks(
        station.xM + station.radiusM + 1,
        station.zM,
      );
      expect(outside).toBeCloseTo(0, 6);
    }
  });

  it('quantizes terraces onto exact 10 m elevation steps', () => {
    for (let x = 0; x < 5000; x += 37) {
      const h = terrainHeightBenchmarkTerraces(x, x * 0.5);
      expect(Math.abs(h - Math.round(h / 10) * 10)).toBeLessThan(1e-6);
    }
  });

  it('keeps ridges on sharp periodic crests', () => {
    const crest = terrainHeightBenchmarkRidges(1024, 0);
    const valley = terrainHeightBenchmarkRidges(0, 0);
    expect(crest).toBeGreaterThan(valley);
    expect(crest).toBeGreaterThanOrEqual(400 - 1e-6);
  });

  it('bounds the periodic field by the sum of its octave amplitudes', () => {
    let max = -Infinity;
    for (let x = -30000; x <= 30000; x += 311) {
      max = Math.max(max, terrainHeightBenchmarkField(x, x * 0.7));
    }
    expect(max).toBeLessThanOrEqual(600 + 220 + 70 + 20 + 1e-6);
  });

  it('dispatches numeric kinds and reverse-maps names', () => {
    expect(evaluateClipmapTerrainHeight(CLIPMAP_TERRAIN_KIND.peaks, 45, 0)).toBeCloseTo(100, 6);
    expect(clipmapTerrainKindName(CLIPMAP_TERRAIN_KIND.terraces)).toBe('terraces');
  });
});

describe('clipmap-benchmark fidelity', () => {
  it('samples a rendered height at the finest covering ring', () => {
    const context = {
      kind: CLIPMAP_TERRAIN_KIND.peaks,
      levelCount: 12,
      maxLevel: 11,
      baseTileSizeM: 16,
      blockRadiusTiles: 4,
      gridResolution: 32,
      finestSwitchDistanceM: 64,
      heightScaleM: 1,
      morphEnabled: true,
      cameraX: 0,
      cameraZ: 0,
    };
    expect(findRenderingLevel(45, 0, context)).toBe(0);
    expect(findRenderingLevel(300, 0, context)).toBe(3);
    expect(findRenderingLevel(12000, 0, context)).toBe(8);
    expect(Number.isFinite(sampleClipmapRenderedHeight(45, 0, context))).toBeTrue();
    expect(clipmapVertexSpacingM(0, 16, 32)).toBeCloseTo(0.5, 6);
    expect(clipmapVertexSpacingM(8, 16, 32)).toBeCloseTo(4096, 6);
  });

  it('retains near-field peaks and does not flatten far-field peaks', () => {
    const evaluation = evaluateClipmapFidelity({
      terrainKind: 'peaks',
      ...FAST_POPPING,
    });
    expect(evaluation.retention.length).toBe(
      CLIPMAP_BENCHMARK_PEAK_STATIONS.length,
    );

    const near = evaluation.retention[0]!;
    expect(near.errorM).toBeLessThan(3);

    const far = evaluation.retention[evaluation.retention.length - 1]!;
    expect(far.runtimeHeightM).toBeGreaterThan(far.trueHeightM * 0.5);
    expect(far.level).toBe(8);
  });

  it('produces a consistent pass flag across metrics', () => {
    const evaluation = evaluateClipmapFidelity({
      terrainKind: 'peaks',
      ...FAST_POPPING,
      poppingToleranceMPerStep2: 100,
    });
    expect(evaluation.retentionPassed).toBe(
      evaluation.retention.every((sample) => sample.passed),
    );
    expect(evaluation.drawCallBound).toBe(12);
    expect(evaluation.maxDrawCalls).toBe(12);
    expect(evaluation.drawCallsPassed).toBeTrue();
    expect(evaluation.passed).toBeTrue();
  });

  it('reports finite, modest popping for every calibration station', () => {
    const evaluation = evaluateClipmapFidelity({
      terrainKind: 'peaks',
      ...FAST_POPPING,
      poppingToleranceMPerStep2: 100,
    });
    for (const sample of evaluation.popping) {
      expect(Number.isFinite(sample.maxAccelerationMPerStep2)).toBeTrue();
      expect(sample.maxAccelerationMPerStep2).toBeLessThan(50);
    }
    console.log(
      `[benchmark] max pop acceleration = ${evaluation.maxPoppingAccelerationMPerStep2.toFixed(4)} m/frame`,
    );
  });
});

describe('clipmap-benchmark scorecard', () => {
  it('formats a compact scorecard with all metric sections', () => {
    const evaluation = evaluateClipmapFidelity({
      terrainKind: 'peaks',
      ...FAST_POPPING,
      poppingToleranceMPerStep2: 100,
    });
    const scorecard = formatClipmapBenchmarkScorecard(evaluation);
    expect(scorecard).toContain('=== CLIPMAP TERRAIN BENCHMARK SCORECARD ===');
    expect(scorecard).toContain('Feature Height Retention:');
    expect(scorecard).toContain('Boundary Watertightness: NOT RUN');
    expect(scorecard).toContain('Max Draw Calls: 12 / 12 (PASS)');
    expect(scorecard).toContain('Status: PASS');
  });

  it('runs the suite with an injected seam probe and surfaces its verdict', async () => {
    const fakeSeam: ISeamProbeResult = {
      passed: true,
      totalLeakPixels: 0,
      stationsChecked: 16,
      stationsFailed: 0,
      stationReports: [],
      textReport: 'fake',
    };
    let probeCallCount = 0;
    const result = await runClipmapBenchmarkSuite(
      {} as unknown as EngineService,
      {
        terrainKind: 'peaks',
        ...FAST_POPPING,
        poppingToleranceMPerStep2: 100,
        setTerrainKind: () => undefined,
        probe: async () => {
          probeCallCount++;
          return fakeSeam;
        },
      },
    );
    expect(probeCallCount).toBe(1);
    expect(result.seam).toBe(fakeSeam);
    expect(result.scorecard).toContain(
      'Boundary Watertightness: PASS (0 leak px across 16 stations)',
    );
    expect(result.scorecard).toContain('Status: PASS');
  });

  it('can skip the seam probe entirely', async () => {
    const result = await runClipmapBenchmarkSuite(
      {} as unknown as EngineService,
      {
        terrainKind: 'ridges',
        ...FAST_POPPING,
        poppingToleranceMPerStep2: 100,
        runSeamProbe: false,
      },
    );
    expect(result.seam).toBeUndefined();
    expect(result.scorecard).toContain('Boundary Watertightness: NOT RUN');
  });
});
