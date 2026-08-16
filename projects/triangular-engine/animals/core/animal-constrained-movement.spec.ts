import {
  stepConstrainedAnimalMovement,
  type AnimalAirMovement,
  type AnimalLandMovement,
  type AnimalMovementState,
  type AnimalWaterMovement,
} from './animal-constrained-movement';
import type { AnimalTime, AnimalVector3 } from './animal-types';
import type { AnimalWaterVolume, AnimalWaterVolumeSample } from './animal-water-volume';
import type { AnimalWorldSurface, AnimalWorldSurfaceSample } from './animal-world-surface';

describe('stepConstrainedAnimalMovement', () => {
  const still: AnimalMovementState = {
    position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
  };

  it('is deterministic and respects acceleration and speed caps on a plane', () => {
    const definition = landDefinition();
    const first = stepConstrainedAnimalMovement(still, { x: 100, y: 0, z: 0 }, 1, 10, definition);
    const second = stepConstrainedAnimalMovement(still, { x: 100, y: 0, z: 0 }, 1, 10, definition);

    expect(first).toEqual(second);
    expect(first.blocked).toBeFalse();
    expect(first.velocity).toEqual({ x: 2, y: 0, z: 0 });
    expect(Math.hypot(first.velocity.x, first.velocity.y, first.velocity.z)).toBeLessThanOrEqual(3);
    expect(first.position.x).toBe(2);
  });

  it('leaves the exact input state unchanged when its bounded-work limit would be exceeded', () => {
    const state: AnimalMovementState = {
      position: { x: 4, y: 0, z: -2 }, velocity: { x: 2, y: 0, z: 0 },
    };
    const result = stepConstrainedAnimalMovement(state, { x: 0, y: 0, z: 0 }, 10, 3, {
      ...landDefinition(), maximumSubsteps: 2,
    });

    expect(result).toEqual({ ...state, blocked: true, blockReason: 'substep-bound', substeps: 0 });
    expect(result.position).not.toBe(state.position);
    expect(result.velocity).not.toBe(state.velocity);
  });

  it('rejects invalid movement limits and time input', () => {
    expect(() => stepConstrainedAnimalMovement(still, still.velocity, 1, 0, {
      ...landDefinition(), maximumSubstepDistanceM: 0,
    })).toThrowError(/movement limits/);
    expect(() => stepConstrainedAnimalMovement(still, still.velocity, -1, 0, landDefinition()))
      .toThrowError(/delta time/);
    expect(() => stepConstrainedAnimalMovement(still, still.velocity, 1, Number.NaN, landDefinition()))
      .toThrowError(/Universal Time/);
  });

  it('blocks land before entering an unwalkable surface', () => {
    const result = stepConstrainedAnimalMovement(still, { x: 2, y: 0, z: 0 }, 1, 0, landDefinition((position) => position.x < 1));

    expect(result.blocked).toBeTrue();
    expect(result.blockReason).toBe('blocked-surface');
    expect(result.position).toEqual(still.position);
    expect(result.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('enforces the optional land slope limit even when the surface says the ground is walkable', () => {
    const result = stepConstrainedAnimalMovement(still, { x: 2, y: 0, z: 0 }, 1, 0, landDefinition(
      () => true,
      (position) => position.x >= 1 ? 0.7 : 0,
      0.5,
    ));

    expect(result.blocked).toBeTrue();
    expect(result.blockReason).toBe('blocked-surface');
    expect(result.position).toEqual(still.position);
  });

  it('rejects an air start outside its altitude band', () => {
    const result = stepConstrainedAnimalMovement({
      position: { x: 0, y: 11, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    }, { x: 1, y: 0, z: 0 }, 1, 0, airDefinition());

    expect(result).toEqual({
      position: { x: 0, y: 11, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      blocked: true, blockReason: 'invalid-start', substeps: 0,
    });
  });

  it('rejects an invalid water start and a water segment refused by its volume', () => {
    const invalidStart = stepConstrainedAnimalMovement({
      position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    }, { x: 1, y: 0, z: 0 }, 1, 0, waterDefinition());
    const blockedSegment = stepConstrainedAnimalMovement({
      position: { x: 0, y: -5, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    }, { x: 2, y: 0, z: 0 }, 1, 0, waterDefinition(false));

    expect(invalidStart.blockReason).toBe('invalid-start');
    expect(blockedSegment.blockReason).toBe('outside-water');
    expect(blockedSegment.position).toEqual({ x: 0, y: -5, z: 0 });
    expect(blockedSegment.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('enforces the optional maximum water surface clearance as a depth band', () => {
    const definition = { ...waterDefinition(), maximumSurfaceClearanceM: 6 };
    const tooDeep = stepConstrainedAnimalMovement({
      position: { x: 0, y: -7, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    }, { x: 0, y: 0, z: 0 }, 1, 0, definition);
    const clamped = stepConstrainedAnimalMovement({
      position: { x: 0, y: -5, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    }, { x: 0, y: -3, z: 0 }, 1, 0, definition);

    expect(tooDeep.blockReason).toBe('invalid-start');
    expect(clamped.blocked).toBeFalse();
    expect(clamped.position.y).toBeGreaterThanOrEqual(-6);
    expect(clamped.position.y).toBeLessThanOrEqual(-1);
  });
});

function landDefinition(
  walkable: (position: AnimalVector3) => boolean = () => true,
  slope: (position: AnimalVector3) => number = () => 0,
  maximumSlope01?: number,
): AnimalLandMovement {
  return {
    domain: 'land', surface: planeSurface(walkable, slope), maximumSpeedMps: 3,
    maximumAccelerationMps2: 2, maximumSubstepDistanceM: 10, maximumSubsteps: 4,
    ...(maximumSlope01 === undefined ? {} : { maximumSlope01 }),
  };
}

function airDefinition(): AnimalAirMovement {
  return {
    domain: 'air', surface: planeSurface(), minimumAltitudeM: 2, maximumAltitudeM: 8,
    maximumSpeedMps: 3, maximumAccelerationMps2: 2, maximumSubstepDistanceM: 10, maximumSubsteps: 4,
  };
}

function waterDefinition(allowSegments = true): AnimalWaterMovement {
  return {
    domain: 'water', water: water(allowSegments), minimumSurfaceClearanceM: 1,
    minimumBottomClearanceM: 1, maximumSpeedMps: 3, maximumAccelerationMps2: 2,
    maximumSubstepDistanceM: 10, maximumSubsteps: 4,
  };
}

function planeSurface(
  walkable: (position: AnimalVector3) => boolean = () => true,
  slope: (position: AnimalVector3) => number = () => 0,
): AnimalWorldSurface {
  return {
    kind: 'plane',
    sample: (position) => planeSample(position, walkable(position), slope(position)),
    projectToSurface: (position) => ({ x: position.x, y: 0, z: position.z }),
    moveAlongSurface: (position, velocity, seconds) => ({
      x: position.x + velocity.x * seconds, y: 0, z: position.z + velocity.z * seconds,
    }),
    surfaceDistance: (from, to) => Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z),
  };
}

function planeSample(position: AnimalVector3, walkable = true, slope01 = 0): AnimalWorldSurfaceSample {
  const surfacePosition = { x: position.x, y: 0, z: position.z };
  return {
    position: surfacePosition, anchorRelativePosition: surfacePosition, normal: { x: 0, y: 1, z: 0 },
    surfaceUp: { x: 0, y: 1, z: 0 }, tangentU: { x: 1, y: 0, z: 0 }, tangentV: { x: 0, y: 0, z: 1 },
    elevationM: 0, slope01, walkable,
  };
}

function water(allowSegments: boolean): AnimalWaterVolume {
  return {
    sample(position: AnimalVector3, _time: AnimalTime): AnimalWaterVolumeSample {
      const containsWater = position.y <= -1 && position.y >= -9;
      return {
        location: containsWater ? 'water' : position.y > -1 ? 'above-surface' : 'below-bottom',
        containsWater, hasWaterBody: true, aboveSurface: position.y > -1, belowBottom: position.y < -9,
        dry: false, land: false, waterColumnDepthM: 10,
        surfaceClearanceM: containsWater ? -position.y : 0,
        bottomClearanceM: containsWater ? position.y + 10 : 0,
        surface: { bodyId: 'sea', position: { x: position.x, y: 0, z: position.z }, normal: { x: 0, y: 1, z: 0 }, flow: { x: 0, y: 0, z: 0 } },
        bottom: planeSample({ x: position.x, y: -10, z: position.z }),
      };
    },
    isSegmentValid: () => allowSegments,
    moveAlongSurface(position, velocity, seconds, _time) {
      return {
        bodyId: 'sea', position: { x: position.x + velocity.x * seconds, y: 0, z: position.z + velocity.z * seconds },
        normal: { x: 0, y: 1, z: 0 }, flow: { x: 0, y: 0, z: 0 },
      };
    },
    surfaceDistance: (from, to) => Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z),
  };
}
