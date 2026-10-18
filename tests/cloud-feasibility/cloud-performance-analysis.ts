export interface PerformanceReading {
  profileKey: string;
  gpuRenderMsPerFrame: number;
  knownContention: boolean;
  valid: boolean;
}

export function summarize(values: number[]) {
  if (!values.length || values.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error('INVALID_PERFORMANCE_SAMPLES');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { median, min: sorted[0], max: sorted.at(-1)!, spread: (sorted.at(-1)! - sorted[0]) / median };
}

/** U0P provisional policy. A stable laptop result still does not prove machine isolation. */
export function comparePerformance(reference: PerformanceReading[], candidate: PerformanceReading[]) {
  const all = [...reference, ...candidate];
  const reasons: string[] = [];
  if (reference.length < 3 || candidate.length < 3) reasons.push('insufficient-rounds');
  if (all.some((r) => !r.valid || !Number.isFinite(r.gpuRenderMsPerFrame) || r.gpuRenderMsPerFrame <= 0)) reasons.push('invalid-measurement');
  if (new Set(all.map((r) => r.profileKey)).size !== 1) reasons.push('profile-mismatch');
  if (all.some((r) => r.knownContention)) reasons.push('known-contention');
  if (reasons.includes('invalid-measurement') || !reference.length || !candidate.length) return { verdict: 'inconclusive', reasons, reference: null, candidate: null, ratio: null };
  const a = summarize(reference.map((r) => r.gpuRenderMsPerFrame));
  const b = summarize(candidate.map((r) => r.gpuRenderMsPerFrame));
  if (a.spread > .15 || b.spread > .15) reasons.push('noisy');
  const ratio = b.median / a.median;
  const detected = ratio > 1.25 && b.min > a.max;
  return { verdict: reasons.length ? 'inconclusive' : detected ? 'slowdown-detected' : 'unresolved', reasons, reference: a, candidate: b, ratio };
}
