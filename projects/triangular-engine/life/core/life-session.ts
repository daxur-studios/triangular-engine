import { LifeEventLog, type LifeInteractionEvent } from './life-events';

export interface LifeSessionOptions {
  readonly seed: number;
  readonly universalTimeSeconds?: number;
}

export interface LifeSessionSnapshot {
  readonly seed: number;
  readonly universalTimeSeconds: number;
  readonly events: readonly LifeInteractionEvent[];
}

/**
 * Small shared state boundary for a life-enabled world. It owns only the
 * reconstructable clock, seed, and explicit interaction history; terrain,
 * residency, rendering, and species behavior remain replaceable providers.
 */
export class LifeSession {
  readonly seed: number;
  readonly events = new LifeEventLog();
  private _universalTimeSeconds: number;

  constructor(options: LifeSessionOptions) {
    this.seed = options.seed;
    this._universalTimeSeconds = Number.isFinite(options.universalTimeSeconds ?? 0)
      ? options.universalTimeSeconds ?? 0
      : 0;
  }

  get universalTimeSeconds(): number {
    return this._universalTimeSeconds;
  }

  setUniversalTimeSeconds(value: number): number {
    if (Number.isFinite(value)) this._universalTimeSeconds = value;
    return this._universalTimeSeconds;
  }

  advance(deltaSeconds: number): number {
    if (Number.isFinite(deltaSeconds)) this._universalTimeSeconds += deltaSeconds;
    return this._universalTimeSeconds;
  }

  snapshot(): LifeSessionSnapshot {
    return {
      seed: this.seed,
      universalTimeSeconds: this._universalTimeSeconds,
      events: this.events.snapshot(),
    };
  }
}
