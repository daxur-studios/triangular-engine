import { AnimalGroupSnapshot } from './animal-group-timeline';
import { AnimalTime } from './animal-types';

/** A permanent, authoritative loss recorded by the consuming game. */
export interface AnimalGroupMemberLossEvent {
  id: string;
  type: 'member-loss';
  targetGroupId: string;
  effectiveTime: AnimalTime;
  memberCountLoss: number;
}

export type AnimalGroupEvent = AnimalGroupMemberLossEvent;

/**
 * Applies sparse authoritative consequences to a reconstructable baseline.
 * The baseline and event history are never mutated. Event input order does not
 * affect the result; event IDs must be unique within the supplied history.
 */
export function applyAnimalGroupEvents(
  baseline: AnimalGroupSnapshot,
  events: readonly AnimalGroupEvent[],
): AnimalGroupSnapshot {
  const seenIds = new Set<string>();
  const orderedEvents = [...events].sort(
    (a, b) => a.effectiveTime - b.effectiveTime || a.id.localeCompare(b.id),
  );

  let memberCount = baseline.memberCount;
  for (const event of orderedEvents) {
    if (seenIds.has(event.id)) {
      throw new Error(`Animal group event ID must be unique: ${event.id}`);
    }
    seenIds.add(event.id);
    validateEvent(event);

    if (
      event.targetGroupId === baseline.id &&
      event.effectiveTime <= baseline.time
    ) {
      memberCount = Math.max(0, memberCount - event.memberCountLoss);
    }
  }

  return { ...baseline, memberCount };
}

function validateEvent(event: AnimalGroupEvent): void {
  if (event.id.length === 0) {
    throw new Error('Animal group event ID cannot be empty.');
  }
  if (!Number.isFinite(event.effectiveTime)) {
    throw new Error('Animal group event effectiveTime must be finite.');
  }
  if (
    !Number.isSafeInteger(event.memberCountLoss) ||
    event.memberCountLoss < 0
  ) {
    throw new Error(
      'Animal group memberCountLoss must be a non-negative safe integer.',
    );
  }
}
