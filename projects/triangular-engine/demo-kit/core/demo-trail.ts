import type { Vector3Tuple } from 'three';

export interface IDemoTrailPoint {
  readonly positionM: Vector3Tuple;
  readonly speedMps: number;
  readonly timeS: number;
}

export interface IDemoTrailOptions {
  /** A new point is stored once the subject has moved this far (metres) since the last one. */
  readonly minStepM?: number;
  /** Oldest points are dropped past this count. */
  readonly maxPoints?: number;
}

const DEFAULT_MIN_STEP_M = 2;
const DEFAULT_MAX_POINTS = 4000;

/** World-space history of a subject's path. Stored in world metres so a floating-origin rebase never smears it. */
export class DemoTrail {
  readonly #points: IDemoTrailPoint[] = [];
  readonly #minStepM: number;
  readonly #maxPoints: number;

  constructor(options: IDemoTrailOptions = {}) {
    this.#minStepM = options.minStepM ?? DEFAULT_MIN_STEP_M;
    this.#maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;
  }

  get points(): readonly IDemoTrailPoint[] { return this.#points; }

  /** Stores the sample when it is far enough from the last one. Returns true when a point was added. */
  record(positionM: Vector3Tuple, speedMps: number, timeS: number): boolean {
    const last = this.#points[this.#points.length - 1];
    if (last && Math.hypot(positionM[0] - last.positionM[0], positionM[1] - last.positionM[1], positionM[2] - last.positionM[2]) < this.#minStepM) return false;
    this.#points.push({ positionM, speedMps, timeS });
    if (this.#points.length > this.#maxPoints) this.#points.shift();
    return true;
  }

  clear(): void { this.#points.length = 0; }

  /** Points whose time crosses a whole multiple of `everyS`, for tick marks that keep time warp readable. */
  tickPoints(everyS: number): readonly IDemoTrailPoint[] {
    if (!(everyS > 0)) return [];
    const ticks: IDemoTrailPoint[] = [];
    let lastBucket = Number.NEGATIVE_INFINITY;
    for (const p of this.#points) {
      const bucket = Math.floor(p.timeS / everyS);
      if (bucket !== lastBucket) { ticks.push(p); lastBucket = bucket; }
    }
    return ticks;
  }
}

/** Speed → colour ramp (slow blue, fast red) as 0..1 rgb. */
export function speedColor(speedMps: number, maxMps: number): Vector3Tuple {
  const t = Math.min(1, Math.max(0, maxMps > 0 ? speedMps / maxMps : 0));
  return [t, 0.35 + 0.4 * (1 - Math.abs(2 * t - 1)), 1 - t];
}
