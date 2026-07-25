import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { Vector2, Vector3, type Object3D } from 'three';
import type { WaterSurfaceDomain } from './water-domain';
import type { WaterSurface } from './water-surface';

export interface WaterBody {
  readonly id: string;
  readonly domain: WaterSurfaceDomain;
  readonly surface: WaterSurface;
  /** Higher-priority bodies win when multiple bodies contain the sample. */
  readonly priority?: number;
  readonly contains?: (worldPosition: Vector3) => boolean;
}

export interface WaterSample {
  readonly body: WaterBody;
  readonly position: Vector3;
  readonly normal: Vector3;
  readonly flow: Vector3;
  /** Positive above the displaced surface, negative below it. */
  readonly signedDistance: number;
  /** Zero above water; positive distance below the displaced surface. */
  readonly depth: number;
}

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
    if (this.bodies.has(body.id)) {
      throw new Error(`WaterService: body "${body.id}" is already registered.`);
    }
    this.bodies.set(body.id, body);
    return () => {
      if (this.bodies.get(body.id) === body) this.bodies.delete(body.id);
    };
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

export function sampleWaterBody(
  body: WaterBody,
  worldPosition: Vector3,
  elapsedSeconds: number,
): WaterSample {
  const frame = body.domain.getLocalFrame(worldPosition);
  const delta = scratchDelta.subVectors(worldPosition, frame.origin);
  const localX = delta.dot(frame.tangentU);
  const localZ = delta.dot(frame.tangentV);
  const surfaceXZ =
    body.domain.getSurfaceXZ?.(frame, localX, localZ, scratchSurfaceXZ) ??
    scratchSurfaceXZ.set(localX, localZ);
  const height = body.surface.getHeight(
    surfaceXZ.x,
    surfaceXZ.y,
    elapsedSeconds,
  );
  const localNormal = body.surface.getNormal(
    surfaceXZ.x,
    surfaceXZ.y,
    elapsedSeconds,
    scratchLocalNormal,
  );
  const position = body.domain.composeWorldPosition(
    frame,
    localX,
    localZ,
    height,
    new Vector3(),
  );
  const normal = new Vector3()
    .addScaledVector(frame.tangentU, localNormal.x)
    .addScaledVector(frame.normal, localNormal.y)
    .addScaledVector(frame.tangentV, localNormal.z)
    .normalize();
  const localFlow = body.surface.getFlow(
    surfaceXZ.x,
    surfaceXZ.y,
    elapsedSeconds,
    scratchLocalFlow,
  );
  const flow = new Vector3()
    .addScaledVector(frame.tangentU, localFlow.x)
    .addScaledVector(frame.normal, localFlow.y)
    .addScaledVector(frame.tangentV, localFlow.z);
  const signedDistance = scratchDelta
    .subVectors(worldPosition, position)
    .dot(normal);
  return {
    body,
    position,
    normal,
    flow,
    signedDistance,
    depth: Math.max(0, -signedDistance),
  };
}

const scratchWorldPosition = new Vector3();
const scratchDelta = new Vector3();
const scratchSurfaceXZ = new Vector2();
const scratchLocalNormal = new Vector3();
const scratchLocalFlow = new Vector3();
