/** A metric, structurally a `TestMetric` (this entry cannot import the Angular one). */
export interface CpuMetric {
  readonly name: string;
  readonly unit: string;
  readonly source: string;
  readonly samples: readonly number[];
  readonly unavailableReason?: string;
  readonly optional?: boolean;
  readonly group?: string;
  readonly share?: number;
}

/** `{ name, unit, source, samples, ...extra }`: the one-liner every test file used to define for itself. */
export function metric(
  name: string, unit: string, source: string, samples: readonly number[], extra: Partial<CpuMetric> = {},
): CpuMetric {
  return { name, unit, source, samples, ...extra };
}

/** A millisecond metric. */
export function timeMetric(name: string, source: string, samples: readonly number[], extra: Partial<CpuMetric> = {}): CpuMetric {
  return metric(name, 'ms', source, samples, extra);
}

/** Resolves once `test()` holds, polling every `pollMs` through `context.wait`; rejects on abort. */
export async function waitFor(
  context: { readonly signal: AbortSignal; wait(milliseconds: number): Promise<void> }, test: () => boolean, pollMs = 16,
): Promise<void> {
  while (!test()) {
    context.signal.throwIfAborted();
    await context.wait(pollMs);
  }
}
