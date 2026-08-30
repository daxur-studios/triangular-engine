import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { Vector3, type Object3D } from 'three';
import {
  sampleWaterBody,
  type WaterBody,
  type WaterSample,
} from './water-sampling';

export { sampleWaterBody } from './water-sampling';
export type { WaterBody, WaterSample } from './water-sampling';

export interface WaterTrackedState {
  readonly sample: WaterSample | null;
  readonly underwater: boolean;
}

export interface WaterCrossingEvent {
  readonly type: 'enter' | 'exit';
  readonly state: WaterTrackedState;
}

export interface WaterTrackOptions {
  /** Prevents chatter near a wave crest. Defaults to 0.1 world units. */
  readonly hysteresis?: number;
}

export interface WaterTracker {
  readonly state$: BehaviorSubject<WaterTrackedState>;
  readonly crossings$: Subject<WaterCrossingEvent>;
  dispose(): void;
}

type PositionSource = Object3D | (() => Vector3);

interface ActiveTracker extends WaterTracker {
  readonly source: PositionSource;
  readonly hysteresis: number;
}

@Injectable({ providedIn: 'root' })
export class WaterService {
  private readonly bodies = new Map<string, WaterBody>();
  private readonly trackers = new Set<ActiveTracker>();
  private lastUpdateTime = Number.NaN;

  register(body: WaterBody): () => void {
    this.bodies.set(body.id, body);
    return () => {
      if (this.bodies.get(body.id) === body) this.bodies.delete(body.id);
    };
  }

  unregister(id: string): void {
    this.bodies.delete(id);
  }

  has(id: string): boolean {
    return this.bodies.has(id);
  }

  sample(worldPosition: Vector3, elapsedSeconds: number): WaterSample | null {
    const candidates = [...this.bodies.values()]
      .filter((body) => body.contains?.(worldPosition) ?? true)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return candidates.length
      ? sampleWaterBody(candidates[0], worldPosition, elapsedSeconds)
      : null;
  }

  track(source: PositionSource, options: WaterTrackOptions = {}): WaterTracker {
    const state$ = new BehaviorSubject<WaterTrackedState>({
      sample: null,
      underwater: false,
    });
    const crossings$ = new Subject<WaterCrossingEvent>();
    const tracker: ActiveTracker = {
      source,
      hysteresis: Math.max(0, options.hysteresis ?? 0.1),
      state$,
      crossings$,
      dispose: () => {
        this.trackers.delete(tracker);
        state$.complete();
        crossings$.complete();
      },
    };
    this.trackers.add(tracker);
    return tracker;
  }

  /** Called from the engine's ordered before-render phase. */
  updateTracked(elapsedSeconds: number): void {
    if (elapsedSeconds === this.lastUpdateTime) return;
    this.lastUpdateTime = elapsedSeconds;
    for (const tracker of this.trackers) {
      const worldPosition =
        typeof tracker.source === 'function'
          ? tracker.source()
          : tracker.source.getWorldPosition(scratchWorldPosition);
      const sample = this.sample(worldPosition, elapsedSeconds);
      const previous = tracker.state$.value;
      let underwater = previous.underwater;
      if (!sample) {
        underwater = false;
      } else if (previous.underwater) {
        if (sample.signedDistance > tracker.hysteresis) underwater = false;
      } else if (sample.signedDistance < -tracker.hysteresis) {
        underwater = true;
      }
      const state = { sample, underwater };
      tracker.state$.next(state);
      if (underwater !== previous.underwater) {
        tracker.crossings$.next({
          type: underwater ? 'enter' : 'exit',
          state,
        });
      }
    }
  }
}

const scratchWorldPosition = new Vector3();
