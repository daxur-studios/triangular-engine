import {
  AnimalGroupMaterialization,
  materializeAnimalGroup,
} from './animal-group-materialization';
import { AnimalGroupSnapshot } from './animal-group-timeline';
import { AnimalObserver, FlockState } from './animal-types';

export type AnimalGroupResidencyMode =
  | 'aggregate'
  | 'materialized'
  | 'interacting'
  | 'tracked';

export interface AnimalGroupResidencyRequest {
  snapshot: AnimalGroupSnapshot;
  observer: AnimalObserver;
  materialization: AnimalGroupMaterialization;
  /** The group has an active local gameplay interaction, such as an aircraft encounter. */
  interacting?: boolean;
  /** The game explicitly needs individual members even when no observer is nearby. */
  tracked?: boolean;
  /** Previous handoff mode, used only for observer-distance hysteresis. */
  previousMode?: AnimalGroupResidencyMode;
}

export interface AnimalGroupResidencyHandoff {
  mode: AnimalGroupResidencyMode;
  snapshot: AnimalGroupSnapshot;
  members: readonly FlockState[];
}

/**
 * Chooses the detail level for one reconstructed group. Aggregate state remains
 * authoritative; local members are derived whenever nearby gameplay needs them.
 */
export function handoffAnimalGroupResidency(
  request: AnimalGroupResidencyRequest,
): AnimalGroupResidencyHandoff {
  const { snapshot, observer, materialization } = request;
  const retainedMode: AnimalGroupResidencyMode | undefined = request.interacting
    ? 'interacting'
    : request.tracked
      ? 'tracked'
      : undefined;

  if (retainedMode) {
    return {
      mode: retainedMode,
      snapshot,
      members: materializeAnimalGroup(
        snapshot,
        { position: snapshot.position, radius: 0 },
        materialization,
      ),
    };
  }

  const wasObserverResident = request.previousMode === 'materialized';
  const members = materializeAnimalGroup(
    snapshot,
    observer,
    materialization,
    wasObserverResident,
  );
  return {
    mode: members.length > 0 ? 'materialized' : 'aggregate',
    snapshot,
    members,
  };
}
