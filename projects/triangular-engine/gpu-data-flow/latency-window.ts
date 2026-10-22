export interface LatencySummary {
  /** Samples ever recorded. */
  count: number;
  /** The newest sample. The rest are over the most recent window. */
  last: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
}

/** Rolling window of samples with nearest-rank percentiles. */
export class LatencyWindow {
  private readonly samples: number[] = [];
  private total = 0;
  private next = 0;
  private newest = 0;

  constructor(private readonly size = 128) {
    if (size < 1) throw new RangeError('window size must be at least 1');
  }

  record(value: number): void {
    if (this.samples.length < this.size) this.samples.push(value);
    else this.samples[this.next] = value;
    this.next = (this.next + 1) % this.size;
    this.newest = value;
    this.total++;
  }

  summary(): LatencySummary {
    const n = this.samples.length;
    if (n === 0) return { count: 0, last: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = (p: number) => sorted[Math.max(0, Math.ceil(p * n) - 1)];
    return {
      count: this.total,
      last: this.newest,
      min: sorted[0],
      max: sorted[n - 1],
      mean: sorted.reduce((a, b) => a + b, 0) / n,
      p50: rank(0.5),
      p95: rank(0.95),
    };
  }
}
