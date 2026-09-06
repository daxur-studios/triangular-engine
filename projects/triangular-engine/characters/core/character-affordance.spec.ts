import {
  validateDoorAffordance,
  validateReachAffordance,
  validateSitAffordance,
  type CharacterDoorAffordance,
  type CharacterReachAffordance,
  type CharacterSitAffordance,
} from './character-affordance';
import { characterVector3 } from './character-vector';

describe('Character Affordances', () => {
  describe('validateSitAffordance', () => {
    it('accepts a valid sit affordance', () => {
      const affordance: CharacterSitAffordance = {
        id: 'chair-1-sit',
        seatPosition: characterVector3(0, 0.45, 0),
        seatHeight: 0.45,
        approachPosition: characterVector3(0, 0, 0.55),
        facingDirection: characterVector3(0, 0, 1),
        clearanceRadius: 0.6,
      };
      expect(() => validateSitAffordance(affordance)).not.toThrow();
    });

    it('throws on empty ID', () => {
      const affordance: CharacterSitAffordance = {
        id: '',
        seatPosition: characterVector3(0, 0.45, 0),
        seatHeight: 0.45,
        approachPosition: characterVector3(0, 0, 0.55),
        facingDirection: characterVector3(0, 0, 1),
        clearanceRadius: 0.6,
      };
      expect(() => validateSitAffordance(affordance)).toThrowError(/ID must be a non-empty string/);
    });

    it('throws on non-finite seatPosition', () => {
      const affordance: CharacterSitAffordance = {
        id: 'chair-bad',
        seatPosition: characterVector3(Number.NaN, 0.45, 0),
        seatHeight: 0.45,
        approachPosition: characterVector3(0, 0, 0.55),
        facingDirection: characterVector3(0, 0, 1),
        clearanceRadius: 0.6,
      };
      expect(() => validateSitAffordance(affordance)).toThrowError(/seatPosition must be finite/);
    });

    it('throws on non-positive seatHeight', () => {
      const affordance: CharacterSitAffordance = {
        id: 'chair-bad',
        seatPosition: characterVector3(0, 0.45, 0),
        seatHeight: 0,
        approachPosition: characterVector3(0, 0, 0.55),
        facingDirection: characterVector3(0, 0, 1),
        clearanceRadius: 0.6,
      };
      expect(() => validateSitAffordance(affordance)).toThrowError(/seatHeight must be positive/);
    });

    it('throws on zero facingDirection vector', () => {
      const affordance: CharacterSitAffordance = {
        id: 'chair-bad',
        seatPosition: characterVector3(0, 0.45, 0),
        seatHeight: 0.45,
        approachPosition: characterVector3(0, 0, 0.55),
        facingDirection: characterVector3(0, 0, 0),
        clearanceRadius: 0.6,
      };
      expect(() => validateSitAffordance(affordance)).toThrowError(/facingDirection must be non-zero/);
    });
  });

  describe('validateReachAffordance', () => {
    it('accepts a valid reach affordance', () => {
      const affordance: CharacterReachAffordance = {
        id: 'door-knob-reach',
        targetPosition: characterVector3(0.75, 0.98, 0.05),
        approachPosition: characterVector3(0.6, 0, 0.4),
        gripType: 'knob',
        handPreference: 'right',
      };
      expect(() => validateReachAffordance(affordance)).not.toThrow();
    });

    it('throws on empty ID or non-finite position', () => {
      expect(() =>
        validateReachAffordance({
          id: '',
          targetPosition: characterVector3(0, 1, 0),
          approachPosition: characterVector3(0, 0, 0),
        }),
      ).toThrowError(/ID must be a non-empty string/);

      expect(() =>
        validateReachAffordance({
          id: 'reach-1',
          targetPosition: characterVector3(0, Number.POSITIVE_INFINITY, 0),
          approachPosition: characterVector3(0, 0, 0),
        }),
      ).toThrowError(/targetPosition must be finite/);
    });
  });

  describe('validateDoorAffordance', () => {
    it('accepts a valid door affordance', () => {
      const affordance: CharacterDoorAffordance = {
        id: 'door-1',
        knobPosition: characterVector3(0.75, 0.98, 0.05),
        approachPosition: characterVector3(0.6, 0, 0.4),
        hingeSide: 'left',
        isOpen: false,
        openAngleRad: 0,
        maxAngleRad: Math.PI / 2,
      };
      expect(() => validateDoorAffordance(affordance)).not.toThrow();
    });

    it('throws on non-positive maxAngleRad', () => {
      expect(() =>
        validateDoorAffordance({
          id: 'door-bad',
          knobPosition: characterVector3(0.75, 0.98, 0.05),
          approachPosition: characterVector3(0.6, 0, 0.4),
          hingeSide: 'left',
          isOpen: false,
          openAngleRad: 0,
          maxAngleRad: 0,
        }),
      ).toThrowError(/maxAngleRad must be positive/);
    });
  });
});
