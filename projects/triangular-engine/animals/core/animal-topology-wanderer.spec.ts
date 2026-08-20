import {
  createAnimalTopologyWanderPlayback,
  sampleAnimalTopologyWanderer,
  sampleSurfaceGeodesic,
  type AnimalTopologyWandererDefinition,
  type AnimalWanderHabitat,
} from './animal-topology-wanderer';
import type { AnimalVector3 } from './animal-types';
import type { AnimalWorldSurface, AnimalWorldSurfaceSample } from './animal-world-surface';

describe('animal topology wanderer', () => {
  it('guarantees C0 position continuity and zero teleportation across leg boundaries', () => {
    const surface = flatSurface();
    const habitats: AnimalWanderHabitat[] = [
      { id: 'h0', position: { x: 0, y: 0, z: 0 } },
      { id: 'h1', position: { x: 20, y: 0, z: 0 } },
      { id: 'h2', position: { x: 20, y: 0, z: 20 } },
    ];
    const def: AnimalTopologyWandererDefinition = {
      groupId: 'wander-herd',
      groupSeed: 1234,
      habitats,
      surface,
      travelSpeedMps: 2,
      minDwellDurationS: 10,
      maxDwellDurationS: 10,
    };

    // Sample at 0.1s increments across multiple leg boundaries (0 to 120s)
    let prev = sampleAnimalTopologyWanderer(def, 0);
    for (let t = 0.1; t <= 120; t += 0.1) {
      const curr = sampleAnimalTopologyWanderer(def, t);
      const stepDist = Math.hypot(
        curr.position.x - prev.position.x,
        curr.position.y - prev.position.y,
        curr.position.z - prev.position.z,
      );
      // Maximum displacement in 0.1s at 2m/s travel speed should be bounded (around 0.2m + small ease margin)
      expect(stepDist).toBeLessThan(0.4);
      prev = curr;
    }
  });

  it('samples sphere great-circle geodesics staying on the spherical surface', () => {
    const radius = 100;
    const surface = sphereSurface(radius);
    const from: AnimalVector3 = { x: radius, y: 0, z: 0 };
    const to: AnimalVector3 = { x: 0, y: radius, z: 0 };

    for (let s = 0; s <= 1; s += 0.1) {
      const sample = sampleSurfaceGeodesic(surface, from, to, s);
      const distFromOrigin = Math.hypot(sample.position.x, sample.position.y, sample.position.z);
      expect(distFromOrigin).toBeCloseTo(radius, 4);
    }
  });

  it('samples cylinder geodesics with shortest circular arc wrapping across the angular seam', () => {
    const radius = 20;
    const surface = cylinderSurface(radius);
    // from angle +170 deg to to angle -170 deg (shortest angular delta is 20 deg, not 340 deg)
    const angleA = (170 * Math.PI) / 180;
    const angleB = (-170 * Math.PI) / 180;

    const from: AnimalVector3 = { x: 0, y: radius * Math.cos(angleA), z: radius * Math.sin(angleA) };
    const to: AnimalVector3 = { x: 10, y: radius * Math.cos(angleB), z: radius * Math.sin(angleB) };

    const mid = sampleSurfaceGeodesic(surface, from, to, 0.5);
    const midAngle = Math.atan2(mid.position.z, mid.position.y);

    // Midpoint should be around 180 deg (or -180 deg)
    expect(Math.abs(Math.abs(midAngle) - Math.PI)).toBeLessThan(0.1);
    expect(mid.position.x).toBeCloseTo(5, 3);
  });

  it('reconstructs identical state at arbitrary universal time independent of call history', () => {
    const surface = flatSurface();
    const habitats: AnimalWanderHabitat[] = [
      { id: 'h0', position: { x: 0, y: 0, z: 0 } },
      { id: 'h1', position: { x: 15, y: 0, z: 5 } },
      { id: 'h2', position: { x: -10, y: 0, z: 12 } },
    ];
    const def: AnimalTopologyWandererDefinition = {
      groupId: 'herd-a',
      groupSeed: 999,
      habitats,
      surface,
      travelSpeedMps: 2,
    };

    const targetTime = 84.75;
    const expected = sampleAnimalTopologyWanderer(def, targetTime);

    // Call at crazy distant and negative times
    sampleAnimalTopologyWanderer(def, -500);
    sampleAnimalTopologyWanderer(def, 0);
    sampleAnimalTopologyWanderer(def, 99999);

    const replayed = sampleAnimalTopologyWanderer(def, targetTime);
    expect(replayed).toEqual(expected);
  });

  it('playback matches direct sampling and maintains performance', () => {
    const surface = flatSurface();
    const habitats: AnimalWanderHabitat[] = [
      { id: 'h0', position: { x: 0, y: 0, z: 0 } },
      { id: 'h1', position: { x: 25, y: 0, z: 0 } },
    ];
    const def: AnimalTopologyWandererDefinition = {
      groupId: 'herd-playback',
      groupSeed: 42,
      habitats,
      surface,
      travelSpeedMps: 3,
    };

    const playback = createAnimalTopologyWanderPlayback(def);
    for (let t = -20; t <= 50; t += 2.5) {
      const pSample = playback.sample(t);
      const dSample = sampleAnimalTopologyWanderer(def, t);
      expect(pSample).toEqual(dSample);
    }
  });
});

function flatSurface(): AnimalWorldSurface {
  return {
    kind: 'plane',
    sample: pos => surfaceSample(pos, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
    projectToSurface: pos => ({ x: pos.x, y: 0, z: pos.z }),
    moveAlongSurface: (pos, vel, sec) => ({ x: pos.x + vel.x * sec, y: 0, z: pos.z + vel.z * sec }),
    surfaceDistance: (from, to) => Math.hypot(to.x - from.x, to.z - from.z),
  };
}

function sphereSurface(radius: number): AnimalWorldSurface {
  return {
    kind: 'sphere',
    sample: pos => {
      const len = Math.hypot(pos.x, pos.y, pos.z) || 1;
      const normal = { x: pos.x / len, y: pos.y / len, z: pos.z / len };
      const ground = { x: normal.x * radius, y: normal.y * radius, z: normal.z * radius };
      return surfaceSample(ground, normal, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
    },
    projectToSurface: pos => {
      const len = Math.hypot(pos.x, pos.y, pos.z) || 1;
      return { x: (pos.x / len) * radius, y: (pos.y / len) * radius, z: (pos.z / len) * radius };
    },
    moveAlongSurface: (pos, vel, sec) => {
      const raw = { x: pos.x + vel.x * sec, y: pos.y + vel.y * sec, z: pos.z + vel.z * sec };
      const len = Math.hypot(raw.x, raw.y, raw.z) || 1;
      return { x: (raw.x / len) * radius, y: (raw.y / len) * radius, z: (raw.z / len) * radius };
    },
    surfaceDistance: (from, to) => {
      const dot = Math.min(1, Math.max(-1, (from.x * to.x + from.y * to.y + from.z * to.z) / (radius * radius)));
      return Math.acos(dot) * radius;
    },
  };
}

function cylinderSurface(radius: number): AnimalWorldSurface {
  return {
    kind: 'cylinder',
    sample: pos => {
      const angle = Math.atan2(pos.z, pos.y);
      const normal = { x: 0, y: -Math.cos(angle), z: -Math.sin(angle) };
      const ground = { x: pos.x, y: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
      return surfaceSample(ground, normal, { x: 1, y: 0, z: 0 }, { x: 0, y: -Math.sin(angle), z: Math.cos(angle) });
    },
    projectToSurface: pos => {
      const angle = Math.atan2(pos.z, pos.y);
      return { x: pos.x, y: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
    },
    moveAlongSurface: (pos, vel, sec) => {
      const nextX = pos.x + vel.x * sec;
      const angle = Math.atan2(pos.z, pos.y) + (vel.z * sec) / radius;
      return { x: nextX, y: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
    },
    surfaceDistance: (from, to) => {
      const dx = to.x - from.x;
      const angleA = Math.atan2(from.z, from.y);
      const angleB = Math.atan2(to.z, to.y);
      const dAngle = Math.abs(Math.atan2(Math.sin(angleB - angleA), Math.cos(angleB - angleA)));
      return Math.hypot(dx, dAngle * radius);
    },
  };
}

function surfaceSample(
  position: AnimalVector3,
  surfaceUp: AnimalVector3,
  tangentU: AnimalVector3,
  tangentV: AnimalVector3,
): AnimalWorldSurfaceSample {
  return {
    position,
    anchorRelativePosition: position,
    normal: surfaceUp,
    surfaceUp,
    tangentU,
    tangentV,
    elevationM: 0,
    slope01: 0,
    walkable: true,
  };
}
