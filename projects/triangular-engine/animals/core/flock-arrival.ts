import { clamp, horizontalUnit, rotateTowards } from './animal-math';
import { AnimalVector3 } from './animal-types';

export type ArrivalActivity = 'seek' | 'landed';

export interface ArrivalState {
  id: string;
  position: AnimalVector3;
  velocity: AnimalVector3;
  activity: ArrivalActivity;
  /** Deterministic time spent in the current activity. */
  activityTime?: number;
}

export interface ArrivalDefinition {
  /** Maximum flight speed in world units/s while seeking. */
  speed: number;
  /** Maximum steering acceleration in world units/s². Defaults to 6. */
  steeringAcceleration?: number;
  /** Maximum horizontal turn rate in radians/s. Defaults to 2.4. */
  turnRate?: number;
  /** Distance from target at which speed begins decaying (Reynolds arrival). Defaults to 4. */
  arrivalRadiusM?: number;
  /** Distance from target within which the agent is considered landed. Defaults to 0.15. */
  landingDistanceM?: number;
}

/**
 * Steers one agent toward a target point in 3D and marks it 'landed' once
 * within landingDistanceM — the minimal "fly to and land on a socket" slice
 * of triangular-engine/animals Milestone 2 (see
 * docs/runbook/011_animals_sublibrary.md), scoped to a single agent rather
 * than the full habitat/activity-selection milestone. Horizontal heading is
 * turn-rate limited the same way stepFlock limits it; horizontal and
 * vertical speed are both acceleration-limited toward a Reynolds-arrival
 * target speed that decays inside arrivalRadiusM, so the agent slows into
 * the landing instead of snapping to a stop. Once landed, the state is
 * returned unchanged (besides activityTime) — callers restart a new seek by
 * building a fresh ArrivalState.
 */
export function stepArrival(
  state: ArrivalState,
  target: AnimalVector3,
  dt: number,
  definition: ArrivalDefinition,
): ArrivalState {
  const activityTime = Math.max(0, state.activityTime ?? 0) + Math.max(0, dt);
  if (state.activity === 'landed') return { ...state, activityTime };

  const dx = target.x - state.position.x;
  const dy = target.y - state.position.y;
  const dz = target.z - state.position.z;
  const distance = Math.hypot(dx, dy, dz);
  const landingDistanceM = Math.max(0, definition.landingDistanceM ?? 0.15);

  if (distance <= landingDistanceM) {
    return {
      ...state,
      position: { ...target },
      velocity: { x: 0, y: 0, z: 0 },
      activity: 'landed',
      activityTime: 0,
    };
  }

  const speed = Math.max(0, definition.speed);
  const steeringAcceleration = Math.max(0, definition.steeringAcceleration ?? 6);
  const turnRate = Math.max(0, definition.turnRate ?? 2.4);
  const arrivalRadiusM = Math.max(0.01, definition.arrivalRadiusM ?? 4);

  const desiredSpeed = speed * clamp(distance / arrivalRadiusM, 0, 1);
  const desiredVx = (dx / distance) * desiredSpeed;
  const desiredVy = (dy / distance) * desiredSpeed;
  const desiredVz = (dz / distance) * desiredSpeed;

  const desiredHeading = horizontalUnit({ x: desiredVx, y: 0, z: desiredVz });
  const turned = rotateTowards(
    state.velocity.x,
    state.velocity.z,
    desiredHeading.x,
    desiredHeading.z,
    turnRate * Math.max(0, dt),
  );
  const currentHorizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z);
  const desiredHorizontalSpeed = Math.hypot(desiredVx, desiredVz);
  const horizontalSpeedDelta = clamp(
    desiredHorizontalSpeed - currentHorizontalSpeed,
    -steeringAcceleration * dt,
    steeringAcceleration * dt,
  );
  const nextHorizontalSpeed = Math.max(0, currentHorizontalSpeed + horizontalSpeedDelta);
  const vx = turned.x * nextHorizontalSpeed;
  const vz = turned.z * nextHorizontalSpeed;

  const verticalDelta = clamp(desiredVy - state.velocity.y, -steeringAcceleration * dt, steeringAcceleration * dt);
  const vy = state.velocity.y + verticalDelta;

  const position = {
    x: state.position.x + vx * dt,
    y: state.position.y + vy * dt,
    z: state.position.z + vz * dt,
  };

  return { ...state, position, velocity: { x: vx, y: vy, z: vz }, activity: 'seek', activityTime };
}
