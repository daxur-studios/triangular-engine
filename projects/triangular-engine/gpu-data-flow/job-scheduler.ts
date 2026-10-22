export type JobLane = 'gpu' | 'worker';

export interface JobLaneBudget {
  /** Total `cost` that may be started per frame. A job dearer than this runs alone, first in its frame. */
  costPerFrame: number;
  /** Jobs allowed to be unfinished at once (async jobs). Default unlimited. */
  maxInFlight?: number;
}

export interface ScheduledJob {
  lane: JobLane;
  /** Estimated cost in the lane's own unit (milliseconds of GPU time, a count of blocks, ...). Default 1. */
  cost?: number;
  /** Higher runs first. Default 0. Equal priorities run in the order they were added. */
  priority?: number;
  label?: string;
  /** Start the work. Return a promise for async work: it counts as in flight until it settles. */
  run: () => void | Promise<void>;
}

export interface JobSchedulerOptions {
  gpu: JobLaneBudget;
  worker: JobLaneBudget;
  /** Called when a job throws or rejects. The scheduler keeps going. */
  onError?: (error: unknown, job: ScheduledJob) => void;
}

export interface LaneTelemetry {
  costPerFrame: number;
  queued: number;
  inFlight: number;
  started: number;
  completed: number;
  failed: number;
  costLastFrame: number;
  startedLastFrame: number;
}

export interface SchedulerTelemetry {
  gpu: LaneTelemetry;
  worker: LaneTelemetry;
}

interface Entry {
  job: ScheduledJob;
  cost: number;
  priority: number;
}

class Lane {
  queue: Entry[] = [];
  inFlight = 0;
  started = 0;
  completed = 0;
  failed = 0;
  costLast = 0;
  startedLast = 0;
  constructor(readonly budget: JobLaneBudget) {}
}

/**
 * Starts queued jobs under a per-frame cost budget for each lane, and never waits for them. The page and the worker
 * lane therefore run side by side instead of in lockstep: `tick()` starts what fits and returns.
 */
export class JobScheduler {
  private readonly lanes: Record<JobLane, Lane>;

  constructor(private readonly options: JobSchedulerOptions) {
    this.lanes = { gpu: new Lane(options.gpu), worker: new Lane(options.worker) };
  }

  add(job: ScheduledJob): void {
    const lane = this.lanes[job.lane];
    const cost = job.cost ?? 1;
    if (!(cost >= 0)) throw new RangeError('job cost must be 0 or more');
    const entry: Entry = { job, cost, priority: job.priority ?? 0 };
    // Ordered insert: higher priority first, arrival order within a priority.
    let i = lane.queue.length;
    while (i > 0 && lane.queue[i - 1].priority < entry.priority) i--;
    lane.queue.splice(i, 0, entry);
  }

  /** Start the jobs that fit this frame's budgets. Call once per frame. Returns the number started. */
  tick(): number {
    return this.tickLane(this.lanes.gpu) + this.tickLane(this.lanes.worker);
  }

  private tickLane(lane: Lane): number {
    let spent = 0;
    let started = 0;
    const max = lane.budget.maxInFlight ?? Infinity;
    while (lane.queue.length > 0 && lane.inFlight < max) {
      const next = lane.queue[0];
      if (started > 0 && spent + next.cost > lane.budget.costPerFrame) break;
      lane.queue.shift();
      spent += next.cost;
      started++;
      this.start(lane, next);
    }
    lane.costLast = spent;
    lane.startedLast = started;
    return started;
  }

  private start(lane: Lane, entry: Entry): void {
    lane.started++;
    lane.inFlight++;
    const settle = (error?: unknown, failed = false) => {
      lane.inFlight--;
      if (failed) {
        lane.failed++;
        this.options.onError?.(error, entry.job);
      } else lane.completed++;
    };
    try {
      const result = entry.job.run();
      if (result && typeof result.then === 'function') {
        result.then(
          () => settle(),
          (e) => settle(e, true),
        );
      } else settle();
    } catch (e) {
      settle(e, true);
    }
  }

  telemetry(): SchedulerTelemetry {
    const t = (l: Lane): LaneTelemetry => ({
      costPerFrame: l.budget.costPerFrame,
      queued: l.queue.length,
      inFlight: l.inFlight,
      started: l.started,
      completed: l.completed,
      failed: l.failed,
      costLastFrame: l.costLast,
      startedLastFrame: l.startedLast,
    });
    return { gpu: t(this.lanes.gpu), worker: t(this.lanes.worker) };
  }
}
