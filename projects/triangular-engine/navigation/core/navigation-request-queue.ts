import { NavigationQuery } from './navigation-types';

export interface NavigationRequestHandle {
  readonly id: string;
  cancel(): void;
}

export interface QueuedNavigationRequest {
  readonly query: NavigationQuery;
  readonly priority: number;
}

interface QueueEntry extends QueuedNavigationRequest {
  readonly sequence: number;
}

/**
 * Deterministic bounded-work request queue for a navigation planner host.
 * Lower priorities run first; ties keep enqueue order. The queue transports
 * serializable queries only and deliberately has no terrain or engine callback.
 */
export class NavigationRequestQueue {
  private readonly entries = new Map<string, QueueEntry>();
  private nextSequence = 0;

  get size(): number {
    return this.entries.size;
  }

  enqueue(query: NavigationQuery, priority = 0): NavigationRequestHandle {
    if (!Number.isFinite(priority)) {
      throw new Error('Navigation request priority must be finite.');
    }
    if (this.entries.has(query.id)) {
      throw new Error(`Navigation request ID already exists: ${query.id}`);
    }

    const entry: QueueEntry = { query, priority, sequence: this.nextSequence++ };
    this.entries.set(query.id, entry);
    return { id: query.id, cancel: () => this.cancel(query.id) };
  }

  cancel(id: string): boolean {
    return this.entries.delete(id);
  }

  /** Removes and returns no more than `maximumRequests` requests to process. */
  take(maximumRequests: number): readonly QueuedNavigationRequest[] {
    if (!Number.isSafeInteger(maximumRequests) || maximumRequests < 0) {
      throw new Error('Navigation request work budget must be a non-negative integer.');
    }

    const ordered = [...this.entries.values()]
      .sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
    const ready: QueuedNavigationRequest[] = [];

    for (const entry of ordered) {
      this.entries.delete(entry.query.id);
      if (ready.length < maximumRequests) {
        ready.push({ query: entry.query, priority: entry.priority });
      } else {
        this.entries.set(entry.query.id, entry);
      }
    }

    return ready;
  }
}
