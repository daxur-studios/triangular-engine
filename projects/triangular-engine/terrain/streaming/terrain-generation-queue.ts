export interface ITerrainGenerationRequest<T> {
  readonly key: string;
  readonly value: T;
  /** Lower values are generated first. */
  readonly priority: number;
}

/**
 * Maintains a cancellable, priority-ordered queue of terrain generation work.
 * The owner decides how much work to drain each frame and when stale resident
 * patches can be removed, keeping this package independent of render engines.
 */
export class TerrainGenerationQueue<T> {
  private pending: ITerrainGenerationRequest<T>[] = [];
  private desiredKeys = new Set<string>();

  get pendingCount(): number {
    return this.pending.length;
  }

  get desired(): ReadonlySet<string> {
    return this.desiredKeys;
  }

  reconcile(
    desired: readonly ITerrainGenerationRequest<T>[],
    residentKeys: ReadonlySet<string>,
  ): void {
    this.desiredKeys = new Set(desired.map(({ key }) => key));
    this.pending = desired
      .filter(({ key }) => !residentKeys.has(key))
      .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  }

  drain(
    maxJobs: number,
    generate: (request: ITerrainGenerationRequest<T>) => void,
  ): number {
    if (!Number.isInteger(maxJobs) || maxJobs < 0) {
      throw new RangeError(
        'Terrain generation maxJobs must be a non-negative integer.',
      );
    }
    let completed = 0;
    while (completed < maxJobs) {
      const request = this.pending.shift();
      if (request === undefined) break;
      if (!this.desiredKeys.has(request.key)) continue;
      generate(request);
      completed++;
    }
    return completed;
  }

  clear(): void {
    this.pending = [];
    this.desiredKeys.clear();
  }
}
