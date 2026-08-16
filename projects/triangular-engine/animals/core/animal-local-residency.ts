import type { AnimalGroupSnapshot } from './animal-group-timeline';
import {
  materializeLocalAnimalGroup,
  type AnimalLocalIndividual,
  type AnimalLocalMaterializationDefinition,
} from './animal-local-materialization';
import type { AnimalObserver } from './animal-types';

export type AnimalLocalResidencyMode = 'aggregate' | 'materialized' | 'interacting' | 'tracked';

export interface AnimalLocalResidencyRequest {
  readonly group: AnimalGroupSnapshot;
  readonly observer: AnimalObserver;
  readonly materialization: AnimalLocalMaterializationDefinition;
  readonly cullDistanceM: number;
  readonly hysteresisM?: number;
  readonly previousMode?: AnimalLocalResidencyMode;
  readonly interacting?: boolean;
  readonly tracked?: boolean;
}

export interface AnimalLocalResidencyHandoff {
  readonly mode: AnimalLocalResidencyMode;
  readonly group: AnimalGroupSnapshot;
  readonly sourceMemberCount: number;
  readonly individuals: readonly AnimalLocalIndividual[];
}

/** Discards local members outside residency and reconstructs them on demand. */
export function handoffLocalAnimalGroupResidency(
  request: AnimalLocalResidencyRequest,
): AnimalLocalResidencyHandoff {
  validateDistance(request.cullDistanceM, 'Animal local cull distance');
  validateDistance(request.hysteresisM ?? 0, 'Animal local hysteresis');
  const retainedMode: AnimalLocalResidencyMode | undefined = request.interacting
    ? 'interacting'
    : request.tracked
      ? 'tracked'
      : undefined;
  if (retainedMode) return materializedHandoff(request, retainedMode);

  const surface = request.materialization.domain === 'water'
    ? request.materialization.water
    : request.materialization.surface;
  const rawDistance = surface.surfaceDistance(request.group.position, request.observer.position);
  const distance = Math.max(0, rawDistance - Math.max(0, request.observer.radius));
  const threshold = request.cullDistanceM
    + (request.previousMode === 'materialized' ? request.hysteresisM ?? 0 : 0);
  return distance <= threshold
    ? materializedHandoff(request, 'materialized')
    : { mode: 'aggregate', group: request.group, sourceMemberCount: request.group.memberCount, individuals: [] };
}

function materializedHandoff(
  request: AnimalLocalResidencyRequest,
  mode: AnimalLocalResidencyMode,
): AnimalLocalResidencyHandoff {
  return {
    mode,
    group: request.group,
    sourceMemberCount: request.group.memberCount,
    individuals: materializeLocalAnimalGroup(request.group, request.materialization),
  };
}

function validateDistance(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and non-negative.`);
}
