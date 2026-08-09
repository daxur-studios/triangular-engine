import type { LifeVector3 } from './life-vector';
import type { LifeGroupDisturbance } from './life-group';

export interface LifeDisturbanceEvent extends LifeGroupDisturbance {
  readonly id: number | string;
  readonly kind: 'disturbance';
  readonly sourceId?: number | string;
}

export interface LifePredationEvent {
  readonly id: number | string;
  readonly kind: 'predation';
  readonly predatorId: number | string;
  readonly preyId: number | string;
  readonly timeSeconds: number;
  readonly position: LifeVector3;
}

export type LifeInteractionEvent = LifeDisturbanceEvent | LifePredationEvent;

/**
 * Ordered, serializable interaction history. Baseline life remains derived
 * from seed + UT; this log is the explicit exception layer for player/world
 * actions and can be saved, replicated, or replayed.
 */
export class LifeEventLog {
  private readonly events: LifeInteractionEvent[] = [];

  record(event: LifeInteractionEvent): void {
    this.events.push(event.kind === 'disturbance'
      ? { ...event, center: { ...event.center } }
      : { ...event, position: { ...event.position } });
    this.events.sort((a, b) => eventTime(a) - eventTime(b) || String(a.id).localeCompare(String(b.id)));
  }

  recordDisturbance(options: {
    readonly id: number | string;
    readonly sourceId?: number | string;
    readonly center: LifeVector3;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly radius: number;
    readonly strength: number;
  }): void {
    this.record({ ...options, kind: 'disturbance' });
  }

  recordPredation(options: Omit<LifePredationEvent, 'kind'>): void {
    this.record({ ...options, kind: 'predation' });
  }

  activeDisturbancesAt(universalTimeSeconds: number): readonly LifeGroupDisturbance[] {
    return this.events
      .filter((event): event is LifeDisturbanceEvent => event.kind === 'disturbance')
      .filter((event) => universalTimeSeconds >= event.startTimeSeconds
        && universalTimeSeconds <= event.startTimeSeconds + Math.max(0, event.durationSeconds))
      .map(({ center, startTimeSeconds, durationSeconds, radius, strength }) => ({
        center: { ...center }, startTimeSeconds, durationSeconds, radius, strength,
      }));
  }

  predationsThrough(universalTimeSeconds: number): readonly LifePredationEvent[] {
    return this.events
      .filter((event): event is LifePredationEvent => event.kind === 'predation')
      .filter((event) => event.timeSeconds <= universalTimeSeconds)
      .map((event) => ({ ...event, position: { ...event.position } }));
  }

  snapshot(): readonly LifeInteractionEvent[] {
    return this.events.map((event) => event.kind === 'disturbance'
      ? { ...event, center: { ...event.center } }
      : { ...event, position: { ...event.position } });
  }
}

function eventTime(event: LifeInteractionEvent): number {
  return event.kind === 'disturbance' ? event.startTimeSeconds : event.timeSeconds;
}
