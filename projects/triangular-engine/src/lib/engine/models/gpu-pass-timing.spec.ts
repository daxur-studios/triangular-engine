import { classifyRenderPass, GpuPassRecorder, timestampResolution, timestampUidFrame } from './gpu-pass-timing';
import { FrameSampler, summarizeGpuPasses } from './frame-sampler';

const scene = { name: 'Lab' };
const shadowScene = { name: 'Shadow Map [ sun ]' };
const output = { name: 'Output Color Transform', isQuadMesh: true };

/** Records one frame the way Three.js names it: scene, one shadow map, output transform. */
function renderFrame(recorder: GpuPassRecorder, frame: number): string[] {
  const uids = [`r:1:7:f${frame}`, `r:2:3:f${frame}`, `r:3:9:f${frame}`];
  recorder.record(uids[0], shadowScene, { texture: { name: 'ShadowMap' } });
  recorder.record(uids[1], scene, null);
  recorder.record(uids[2], output, null);
  return uids;
}

describe('classifyRenderPass', () => {
  it('names shadow, scene, output and other full-screen passes', () => {
    expect(classifyRenderPass(shadowScene, null)).toEqual({ kind: 'shadow', label: 'Shadow Map [ sun ]' });
    expect(classifyRenderPass({ name: '' }, { depthTexture: { name: 'ShadowDepthTexture' } }).kind).toBe('shadow');
    expect(classifyRenderPass(scene, null)).toEqual({ kind: 'scene', label: 'Lab' });
    expect(classifyRenderPass({}, null)).toEqual({ kind: 'scene', label: 'scene' });
    expect(classifyRenderPass(output, null)).toEqual({ kind: 'output', label: 'Output Color Transform' });
    expect(classifyRenderPass({ name: 'Bloom', isQuadMesh: true }, null)).toEqual({ kind: 'fullscreen', label: 'Bloom' });
  });
});

describe('timestampUidFrame', () => {
  it('reads the renderer frame from a Three.js timestamp uid', () => {
    expect(timestampUidFrame('r:3:12:f450')).toBe(450);
    expect(timestampUidFrame('nonsense')).toBeNull();
  });
});

describe('GpuPassRecorder', () => {
  it('splits a batch of several frames into per-kind and per-label sums', () => {
    const recorder = new GpuPassRecorder();
    const a = renderFrame(recorder, 10);
    const b = renderFrame(recorder, 11);
    const batch = recorder.attribute(new Map([[a[0], 0.2], [a[1], 1], [a[2], 0.05], [b[0], 0.3], [b[1], 2], [b[2], 0.05]]));
    expect(batch.frames.map((frame) => frame.frame)).toEqual([10, 11]);
    expect(batch.frames[1].byKind).toEqual({ shadow: 0.3, scene: 2, output: 0.05 });
    expect(batch.frames[1].byLabel['Lab']).toBe(2);
    expect(batch.frames[1].totalMs).toBeCloseTo(2.35, 12);
    expect(batch.passDurationsMs.length).toBe(6);
    expect(batch.lastBatchFrame).toBe(11);
    expect([batch.unattributedPasses, batch.incompleteFrames, batch.staleFrames]).toEqual([0, 0, 0]);
  });

  it('drops a frame that is missing a pass instead of under-counting it', () => {
    const recorder = new GpuPassRecorder();
    const a = renderFrame(recorder, 5);
    const batch = recorder.attribute(new Map([[a[0], 0.2], [a[1], 1]]));
    expect(batch.frames).toEqual([]);
    expect(batch.incompleteFrames).toBe(1);
  });

  it('counts a timestamp whose pass was never recorded and drops its frame', () => {
    const recorder = new GpuPassRecorder();
    const a = renderFrame(recorder, 5);
    const batch = recorder.attribute(new Map([[a[0], 0.2], [a[1], 1], [a[2], 0.1], ['r:4:2:f5', 0.4]]));
    expect(batch.frames).toEqual([]);
    expect(batch.unattributedPasses).toBe(1);
  });

  it('flags a batch that repeats frames already counted (a failed readback keeps the old map)', () => {
    const recorder = new GpuPassRecorder();
    const a = renderFrame(recorder, 5);
    const map = new Map([[a[0], 0.2], [a[1], 1], [a[2], 0.1]]);
    expect(recorder.attribute(map).frames.length).toBe(1);
    const again = recorder.attribute(map);
    expect(again.frames).toEqual([]);
    expect(again.staleFrames).toBe(1);
  });

  it('keeps passes of frames rendered after the readback for the next batch', () => {
    const recorder = new GpuPassRecorder();
    const a = renderFrame(recorder, 5);
    const b = renderFrame(recorder, 6);
    expect(recorder.attribute(new Map([[a[0], 0.2], [a[1], 1], [a[2], 0.1]])).frames.length).toBe(1);
    const next = recorder.attribute(new Map([[b[0], 0.2], [b[1], 1], [b[2], 0.1]]));
    expect(next.frames.map((frame) => frame.frame)).toEqual([6]);
  });
});

describe('timestampResolution', () => {
  const ns = (value: number) => value / 1e6;

  it('finds a rounding step from whole-nanosecond durations', () => {
    const rounded = [3, 5, 2, 7, 4, 9, 6, 8].map((n) => ns(n * 100_000));
    expect(timestampResolution(rounded)).toEqual({ resolutionNs: 100_000, quantized: true, samples: 8 });
    const fine = [91_136, 134_144, 46_080, 90_112, 135_168, 47_104, 91_136, 133_120].map(ns);
    const result = timestampResolution(fine);
    expect(result.quantized).toBeFalse();
    expect(result.resolutionNs).toBe(1024);
  });

  it('needs enough nonzero durations to say anything', () => {
    expect(timestampResolution([0, 0, ns(65_536)])).toEqual({ resolutionNs: null, quantized: false, samples: 1 });
  });
});

describe('summarizeGpuPasses', () => {
  function fineBatches(recorder: GpuPassRecorder, frames: number) {
    const records = [];
    for (let frame = 1; frame <= frames; frame++) {
      const uids = renderFrame(recorder, frame);
      const batch = recorder.attribute(new Map([[uids[0], ns(40_000 + frame * 1024)], [uids[1], ns(90_000 + frame * 1024)], [uids[2], ns(5_120)]]));
      records.push({ batch, totalMatches: true });
    }
    return records;
  }
  const ns = (value: number) => value / 1e6;

  it('returns null for a window without readbacks', () => {
    expect(summarizeGpuPasses([])).toBeNull();
  });

  it('summarizes kinds and passes the self-test on unrounded, complete batches', () => {
    const summary = summarizeGpuPasses(fineBatches(new GpuPassRecorder(), 10))!;
    expect(summary.frames).toBe(10);
    expect(summary.byKind.shadow!.count).toBe(10);
    expect(summary.byKind.output!.medianMs).toBeCloseTo(0.00512, 9);
    expect(summary.byLabel['Lab'].count).toBe(10);
    expect(summary.selfTest.passed).toBeTrue();
    expect(summary.selfTest.issues).toEqual([]);
  });

  it('fails the self-test on rounded timestamps and on a total that does not add up', () => {
    const recorder = new GpuPassRecorder();
    const records = [];
    for (let frame = 1; frame <= 4; frame++) {
      const uids = renderFrame(recorder, frame);
      records.push({ batch: recorder.attribute(new Map([[uids[0], 0.065536], [uids[1], 0.131072], [uids[2], 0.065536]])), totalMatches: frame !== 2 });
    }
    const summary = summarizeGpuPasses(records)!;
    expect(summary.resolution.quantized).toBeTrue();
    expect(summary.selfTest.passed).toBeFalse();
    expect(summary.selfTest.totalMismatches).toBe(1);
    expect(summary.selfTest.issues.join(' ')).toContain('rounded to 65536 ns');
  });

  it('is part of a FrameSampler window and resets with it', () => {
    const sampler = new FrameSampler();
    const recorder = new GpuPassRecorder();
    const [record] = fineBatches(recorder, 1);
    sampler.recordGpuPasses(record);
    sampler.start();
    expect(sampler.stop().gpuPasses).toBeNull();
    sampler.start();
    for (const next of fineBatches(new GpuPassRecorder(), 3)) sampler.recordGpuPasses(next);
    expect(sampler.stop().gpuPasses!.frames).toBe(3);
  });
});
