import {
  characterVectorLengthSquared,
  type CharacterVector3,
} from './character-vector';

/**
 * A sit affordance exposed by furniture (e.g. chairs, benches, stools).
 * Tells a humanoid character where to stand, turn, and sit.
 */
export interface CharacterSitAffordance {
  /** Unique stable ID of the affordance or prop. */
  readonly id: string;
  /** World or local position of the seat surface where the character's hips rest. */
  readonly seatPosition: CharacterVector3;
  /** Height of the seat surface above the ground plane in meters (typically ~0.42–0.48m). */
  readonly seatHeight: number;
  /** Stand position in front of the chair before turning and sitting down. */
  readonly approachPosition: CharacterVector3;
  /** Unit horizontal direction the character faces when sitting (pointing away from backrest). */
  readonly facingDirection: CharacterVector3;
  /** Clearance radius around the chair in meters. */
  readonly clearanceRadius: number;
  /** Whether the seat is currently occupied. Defaults to false. */
  readonly occupied?: boolean;
}

/**
 * A reach/grasp affordance exposed by interactable props (e.g. door knobs, levers, buttons, tools).
 */
export interface CharacterReachAffordance {
  /** Unique stable ID of the interactable target. */
  readonly id: string;
  /** World or local position to reach or grasp. */
  readonly targetPosition: CharacterVector3;
  /** Stand position where the character should position their feet to reach comfortably. */
  readonly approachPosition: CharacterVector3;
  /** Physical grip geometry or mode. */
  readonly gripType?: 'knob' | 'handle' | 'pinch' | 'palm' | 'free';
  /** Preferred hand for interaction. Defaults to 'either'. */
  readonly handPreference?: 'left' | 'right' | 'either';
}

/**
 * A door affordance describing an articulated passage barrier with a handle/knob and hinge.
 */
export interface CharacterDoorAffordance {
  /** Unique stable ID of the door prop. */
  readonly id: string;
  /** Current position of the door knob / handle in world or parent space. */
  readonly knobPosition: CharacterVector3;
  /** Stand position where the character reaches the knob. */
  readonly approachPosition: CharacterVector3;
  /** Side where the hinge is mounted relative to door facing. */
  readonly hingeSide: 'left' | 'right';
  /** Whether the door is currently considered open (e.g. angle > 0.1 rad). */
  readonly isOpen: boolean;
  /** Current opening angle in radians (0 = closed). */
  readonly openAngleRad: number;
  /** Maximum opening swing angle in radians (typically ~Math.PI / 2). */
  readonly maxAngleRad: number;
}

function isFiniteVector3(v: CharacterVector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/**
 * Validates that a CharacterSitAffordance has valid identifiers, finite numbers,
 * positive dimensions, and a non-zero facing direction.
 */
export function validateSitAffordance(affordance: CharacterSitAffordance): void {
  if (!affordance.id || affordance.id.trim().length === 0) {
    throw new Error('CharacterSitAffordance ID must be a non-empty string.');
  }
  if (!isFiniteVector3(affordance.seatPosition)) {
    throw new Error(`Sit affordance seatPosition must be finite: ${affordance.id}`);
  }
  if (!Number.isFinite(affordance.seatHeight) || affordance.seatHeight <= 0) {
    throw new Error(`Sit affordance seatHeight must be positive and finite: ${affordance.id}`);
  }
  if (!isFiniteVector3(affordance.approachPosition)) {
    throw new Error(`Sit affordance approachPosition must be finite: ${affordance.id}`);
  }
  if (!isFiniteVector3(affordance.facingDirection)) {
    throw new Error(`Sit affordance facingDirection must be finite: ${affordance.id}`);
  }
  const facingLenSq = characterVectorLengthSquared(affordance.facingDirection);
  if (facingLenSq < 1e-6) {
    throw new Error(`Sit affordance facingDirection must be non-zero: ${affordance.id}`);
  }
  if (!Number.isFinite(affordance.clearanceRadius) || affordance.clearanceRadius <= 0) {
    throw new Error(`Sit affordance clearanceRadius must be positive and finite: ${affordance.id}`);
  }
}

/**
 * Validates that a CharacterReachAffordance has valid identifiers and finite positions.
 */
export function validateReachAffordance(affordance: CharacterReachAffordance): void {
  if (!affordance.id || affordance.id.trim().length === 0) {
    throw new Error('CharacterReachAffordance ID must be a non-empty string.');
  }
  if (!isFiniteVector3(affordance.targetPosition)) {
    throw new Error(`Reach affordance targetPosition must be finite: ${affordance.id}`);
  }
  if (!isFiniteVector3(affordance.approachPosition)) {
    throw new Error(`Reach affordance approachPosition must be finite: ${affordance.id}`);
  }
}

/**
 * Validates that a CharacterDoorAffordance has valid identifiers, finite positions,
 * and valid angles.
 */
export function validateDoorAffordance(affordance: CharacterDoorAffordance): void {
  if (!affordance.id || affordance.id.trim().length === 0) {
    throw new Error('CharacterDoorAffordance ID must be a non-empty string.');
  }
  if (!isFiniteVector3(affordance.knobPosition)) {
    throw new Error(`Door affordance knobPosition must be finite: ${affordance.id}`);
  }
  if (!isFiniteVector3(affordance.approachPosition)) {
    throw new Error(`Door affordance approachPosition must be finite: ${affordance.id}`);
  }
  if (!Number.isFinite(affordance.openAngleRad) || !Number.isFinite(affordance.maxAngleRad)) {
    throw new Error(`Door affordance angles must be finite: ${affordance.id}`);
  }
  if (affordance.maxAngleRad <= 0) {
    throw new Error(`Door affordance maxAngleRad must be positive: ${affordance.id}`);
  }
}
