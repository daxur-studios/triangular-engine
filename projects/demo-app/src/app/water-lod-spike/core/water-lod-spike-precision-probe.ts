/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fn, If, dot, float, floor, instanceIndex, instancedArray, int, sin, uniform, vec4 } from 'three/tsl';
import {
  PRECISION_EYE_HEIGHT_M,
  PRECISION_LATE_TIME_S,
  PRECISION_RADIUS_M,
  PROBE_STRIDE,
  anchorPhaseOffset,
  compareProbeOutput,
  emulatedPrecision,
  precisionAnchor,
  precisionSamples,
  sphereWaves,
  type IPrecisionReport,
} from './water-lod-spike-precision';

/** The renderer calls the probe uses (three's `WebGPURenderer`). */
export interface IPrecisionProbeRenderer {
  computeAsync(node: unknown): Promise<void>;
  getArrayBufferAsync(attribute: unknown): Promise<ArrayBuffer>;
}

const TWO_PI = 2 * Math.PI;

/**
 * Plan 080 Q5 on the GPU: runs both phase paths in a WGSL compute kernel (float32 as the vertex stage has it) over the
 * samples of `precisionSamples`, reads the results back and compares them with the double reference.
 *
 * - naive: `dot(global position, direction) * k + phase - time * omega`, the flat spike's formula on the global position.
 * - anchor: `dot(relative position, direction) * k + offset`, with the offset from the CPU in doubles.
 *
 * The kernel gets the positions as float32 either way (global rounded from the exact double, relative rounded from the
 * exact difference), as a vertex buffer built relative to the anchor would. How the mesh arrives at a float32 position
 * relative to the anchor is the lod-surface vertex stage's matter; its error is measured by the morph spike's probe.
 */
export async function runWaterLodSpikePrecisionProbe(renderer: IPrecisionProbeRenderer, backend: string): Promise<IPrecisionReport> {
  const waves = sphereWaves();
  const samples = precisionSamples();
  const waveCount = waves.length;
  const pairs = samples.length * waveCount;
  const anchor = precisionAnchor();

  const waveA = instancedArray(waveCount, 'vec4') as any;
  const waveB = instancedArray(waveCount, 'vec4') as any;
  const globalBuffer = instancedArray(samples.length, 'vec4') as any;
  const relativeBuffer = instancedArray(samples.length, 'vec4') as any;
  const outBuffer = instancedArray(pairs, 'vec4') as any;
  const time = uniform(0) as any;

  const kernel = Fn(() => {
    const i = int(instanceIndex).toVar();
    If(i.lessThan(pairs), () => {
      const index = float(i);
      const s = floor(index.add(0.5).div(waveCount)).toVar();
      const w = index.sub(s.mul(waveCount));
      const a = waveA.element(int(w));
      const b = waveB.element(int(w));
      const direction = a.xyz;
      const naive = dot(globalBuffer.element(int(s)).xyz, direction).mul(a.w).add(b.x).sub(time.mul(b.y));
      const relative = dot(relativeBuffer.element(int(s)).xyz, direction).mul(a.w).add(b.z);
      const wrapped = relative.sub(relative.div(TWO_PI).add(0.5).floor().mul(TWO_PI));
      outBuffer.element(i).assign(vec4(naive, relative, sin(wrapped), 0));
    });
  });
  const kernelNode = (kernel() as any).compute(pairs, [64]);

  const waveAData = waveA.value.array as Float32Array;
  const waveBData = waveB.value.array as Float32Array;
  waves.forEach((wave, w) => {
    waveAData.set([wave.dir[0], wave.dir[1], wave.dir[2], wave.k], w * 4);
    waveBData[w * 4] = wave.phase;
    waveBData[w * 4 + 1] = wave.angularSpeed;
  });
  waveA.value.needsUpdate = true;
  const globalData = globalBuffer.value.array as Float32Array;
  const relativeData = relativeBuffer.value.array as Float32Array;
  samples.forEach((sample, s) => {
    globalData.set(sample.global, s * 4);
    relativeData.set(sample.relative, s * 4);
  });
  globalBuffer.value.needsUpdate = true;
  relativeBuffer.value.needsUpdate = true;

  const cases = [];
  for (const timeS of [0, PRECISION_LATE_TIME_S]) {
    // The anchor offset folds in the wave time, so it is recomputed (in doubles) whenever the time changes.
    waves.forEach((wave, w) => {
      waveBData[w * 4 + 2] = anchorPhaseOffset(wave, anchor, timeS);
    });
    waveB.value.needsUpdate = true;
    time.value = timeS;
    await renderer.computeAsync(kernelNode);
    const output = new Float32Array(await renderer.getArrayBufferAsync(outBuffer.value));
    if (output.length < pairs * PROBE_STRIDE) throw new Error(`Precision probe read back ${output.length} floats, expected ${pairs * PROBE_STRIDE}`);
    const emulated = emulatedPrecision(waves, samples, timeS);
    cases.push({ timeS, ...compareProbeOutput(waves, samples, timeS, output), emulatedNaive: emulated.naive, emulatedAnchor: emulated.anchor });
  }
  return { backend, radiusM: PRECISION_RADIUS_M, eyeHeightM: PRECISION_EYE_HEIGHT_M, waves: waveCount, samples: samples.length, cases };
}
