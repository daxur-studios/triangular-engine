import {
  materializeLocalAnimalGroup,
  type AnimalLocalMaterializationDefinition,
} from './animal-local-materialization';
import type { AnimalGroupSnapshot } from './animal-group-timeline';
import type { AnimalTime, AnimalVector3 } from './animal-types';
import type { AnimalWaterVolume, AnimalWaterVolumeSample } from './animal-water-volume';
import type { AnimalWorldSurface, AnimalWorldSurfaceSample } from './animal-world-surface';

describe('materializeLocalAnimalGroup', () => {
  const group = (overrides: Partial<AnimalGroupSnapshot> = {}): AnimalGroupSnapshot => ({
    id: 'world|group-a', seed: 42, time: 123.5,
    position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    activity: 'feed', destinationId: 'meadow', progress: 0.25, memberCount: 8,
    ...overrides,
  });

  it('reconstructs stable IDs and positions after unload/reload', () => {
    const definition = landDefinition();
    const first = materializeLocalAnimalGroup(group(), definition);
    const second = materializeLocalAnimalGroup(group(), definition);
    expect(second).toEqual(first);
    expect(first.map((member) => member.id)).toEqual(
      first.map((_, index) => `world|group-a:member:${index}`),
    );
    expect(new Set(first.map((member) => member.id)).size).toBe(first.length);
  });

  it('uses a bounded land fallback and reports when no walkable placement exists', () => {
    const fallbackSurface = surface((position) => ({
      ...sample(position), walkable: Math.abs(position.x) > 1e-8,
    }));
    const members = materializeLocalAnimalGroup(group({ memberCount: 1 }), {
      domain: 'land', surface: fallbackSurface, spreadRadiusM: 4,
    });
    expect(Math.abs(members[0].position.x)).toBeGreaterThan(1e-8);
    expect(() => materializeLocalAnimalGroup(group({ memberCount: 1 }), {
      domain: 'land', surface: surface(() => ({ ...sample({ x: 0, y: 0, z: 0 }), walkable: false })),
      spreadRadiusM: 4,
    })).toThrowError(/no walkable placement/);
  });

  it('keeps air members within altitude range along adapter-provided local up', () => {
    const surface = sphericalSurface();
    const members = materializeLocalAnimalGroup(group({ memberCount: 6 }), {
      domain: 'air', surface, spreadRadiusM: 3, minimumAltitudeM: 5, maximumAltitudeM: 9,
    });
    for (const member of members) {
      const base = surface.sample(member.position);
      const clearance = dot(subtract(member.position, base.position), base.surfaceUp);
      expect(clearance).toBeGreaterThanOrEqual(5 - 1e-8);
      expect(clearance).toBeLessThanOrEqual(9 + 1e-8);
      expect(member.surfaceUp).toEqual(base.surfaceUp);
    }
  });

  it('keeps water members within both clearances and validates their segments', () => {
    const water = mockWater();
    const origin = { x: 0, y: -5, z: 0 };
    const members = materializeLocalAnimalGroup(group({ position: origin, memberCount: 8 }), {
      domain: 'water', water, spreadRadiusM: 3,
      minimumSurfaceClearanceM: 1, minimumBottomClearanceM: 1,
    });
    for (const member of members) {
      const sampled = water.sample(member.position, 123.5);
      expect(sampled.containsWater).toBeTrue();
      expect(sampled.surfaceClearanceM).toBeGreaterThanOrEqual(1 - 1e-8);
      expect(sampled.bottomClearanceM).toBeGreaterThanOrEqual(1 - 1e-8);
      expect(water.isSegmentValid(origin, member.position, 123.5, 0.5)).toBeTrue();
    }
  });

  it('rejects a water group whose origin is not inside the volume', () => {
    expect(() => materializeLocalAnimalGroup(group({ position: { x: 0, y: 10, z: 0 }, memberCount: 1 }), {
      domain: 'water', water: mockWater(), spreadRadiusM: 1,
      minimumSurfaceClearanceM: 1, minimumBottomClearanceM: 1,
    })).toThrowError(/origin must be inside/);
  });

  it('validates spread, member count, altitude, and clearance definitions', () => {
    expect(() => materializeLocalAnimalGroup(group(), { ...landDefinition(), spreadRadiusM: -1 }))
      .toThrowError(/spread radius/);
    expect(() => materializeLocalAnimalGroup(group({ memberCount: 1.5 }), landDefinition()))
      .toThrowError(/member count/);
    expect(() => materializeLocalAnimalGroup(group(), {
      domain: 'air', surface: surface(), spreadRadiusM: 1, minimumAltitudeM: 10, maximumAltitudeM: 2,
    })).toThrowError(/altitude range/);
    expect(() => materializeLocalAnimalGroup(group(), {
      domain: 'water', water: mockWater(), spreadRadiusM: 1,
      minimumSurfaceClearanceM: -1, minimumBottomClearanceM: 1,
    })).toThrowError(/clearances/);
  });
});

function landDefinition(): AnimalLocalMaterializationDefinition {
  return { domain: 'land', surface: surface(), spreadRadiusM: 4 };
}

function sample(position: AnimalVector3): AnimalWorldSurfaceSample {
  return {
    position, anchorRelativePosition: position, normal: { x: 0, y: 1, z: 0 },
    surfaceUp: { x: 0, y: 1, z: 0 }, tangentU: { x: 1, y: 0, z: 0 },
    tangentV: { x: 0, y: 0, z: 1 }, elevationM: 0, slope01: 0, walkable: true,
  };
}

function surface(transform: (position: AnimalVector3) => AnimalWorldSurfaceSample = sample): AnimalWorldSurface {
  return {
    kind: 'plane', sample: (position) => transform(position),
    projectToSurface: (position) => ({ x: position.x, y: 0, z: position.z }),
    surfaceDistance: (from, to) => Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z),
    moveAlongSurface: (position, velocity, seconds) => ({
      x: position.x + velocity.x * seconds, y: 0, z: position.z + velocity.z * seconds,
    }),
  };
}

function sphericalSurface(): AnimalWorldSurface {
  return surface((position) => {
    const length = Math.hypot(position.x, position.y, position.z) || 1;
    const up = { x: position.x / length, y: position.y / length, z: position.z / length };
    return { ...sample(position), surfaceUp: up, normal: up, tangentU: { x: 0, y: 0, z: 1 }, tangentV: { x: 1, y: 0, z: 0 } };
  });
}

function mockWater(): AnimalWaterVolume {
  return {
    sample(position: AnimalVector3, _time: AnimalTime): AnimalWaterVolumeSample {
      const containsWater = position.y <= -1 && position.y >= -9;
      return {
        location: containsWater ? 'water' : position.y > -1 ? 'above-surface' : 'below-bottom',
        containsWater, hasWaterBody: true, aboveSurface: position.y > -1, belowBottom: position.y < -9,
        dry: false, land: false, waterColumnDepthM: 10,
        surfaceClearanceM: containsWater ? -position.y - 1 : 0,
        bottomClearanceM: containsWater ? position.y + 9 : 0,
        surface: { bodyId: 'sea', position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, flow: { x: 0, y: 0, z: 0 } },
        bottom: sample({ x: position.x, y: -10, z: position.z }),
      };
    },
    isSegmentValid(from, to, _time, _spacing = 1) {
      return from.y <= -1 && from.y >= -9 && to.y <= -1 && to.y >= -9;
    },
    moveAlongSurface(position, velocity, seconds, _time) {
      return {
        bodyId: 'sea',
        position: { x: position.x + velocity.x * seconds, y: 0, z: position.z + velocity.z * seconds },
        normal: { x: 0, y: 1, z: 0 },
        flow: { x: 0, y: 0, z: 0 },
      };
    },
    surfaceDistance: (from, to) => Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z),
  };
}

function subtract(a: AnimalVector3, b: AnimalVector3): AnimalVector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a: AnimalVector3, b: AnimalVector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
