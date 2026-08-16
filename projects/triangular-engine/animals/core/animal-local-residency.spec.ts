import { handoffLocalAnimalGroupResidency } from './animal-local-residency';
import type { AnimalWorldSurface } from './animal-world-surface';

describe('local animal residency', () => {
  const surface: AnimalWorldSurface = {
    kind: 'sphere',
    sample: (position) => ({
      position: { ...position }, anchorRelativePosition: { x: 0, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 }, surfaceUp: { x: 1, y: 0, z: 0 },
      tangentU: { x: 0, y: 1, z: 0 }, tangentV: { x: 0, y: 0, z: 1 },
      elevationM: 0, slope01: 0, walkable: true,
    }),
    projectToSurface: (position) => ({ ...position }),
    moveAlongSurface: (position) => ({ ...position }),
    surfaceDistance: (from, to) => Math.abs(Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x)) * 100,
  };
  const group = {
    id: 'group', seed: 1, time: 0, position: { x: 100, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 }, activity: 'rest' as const,
    destinationId: 'habitat', progress: 0, memberCount: 20,
  };
  const materialization = { domain: 'land' as const, surface, spreadRadiusM: 0, maximumMembers: 4 };

  it('uses topology distance, caps local detail, unloads, and reconstructs exactly', () => {
    const request = {
      group, observer: { position: { x: 100 * Math.cos(0.05), y: 100 * Math.sin(0.05), z: 0 }, radius: 0 },
      materialization, cullDistanceM: 6,
    };
    const resident = handoffLocalAnimalGroupResidency(request);
    expect(resident.mode).toBe('materialized');
    expect(resident.sourceMemberCount).toBe(20);
    expect(resident.individuals.length).toBe(4);
    expect(handoffLocalAnimalGroupResidency(request)).toEqual(resident);

    const unloaded = handoffLocalAnimalGroupResidency({
      ...request, observer: { position: { x: -100, y: 0, z: 0 }, radius: 0 },
    });
    expect(unloaded.mode).toBe('aggregate');
    expect(unloaded.individuals).toEqual([]);
  });
});
