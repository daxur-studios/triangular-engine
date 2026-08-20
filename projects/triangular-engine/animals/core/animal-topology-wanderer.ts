import { animalHash, animalUnit } from './animal-hash';
import type { AnimalTime, AnimalVector3 } from './animal-types';
import type { AnimalWorldSurface } from './animal-world-surface';

export type AnimalWanderActivity = 'dwell' | 'travel';

export interface AnimalWanderHabitat {
  readonly id: string;
  readonly position: AnimalVector3;
  readonly radiusM?: number;
  readonly capacity?: number;
  readonly suitability01?: number;
  readonly kind?: 'meadow' | 'grove' | 'reef' | 'generic';
}

export interface AnimalTopologyWandererDefinition {
  readonly groupId: string;
  readonly groupSeed: number;
  readonly habitats: readonly AnimalWanderHabitat[];
  readonly surface: AnimalWorldSurface;
  readonly travelSpeedMps: number;
  readonly minDwellDurationS?: number;
  readonly maxDwellDurationS?: number;
  readonly travelArcHeightM?: number;
  readonly epoch?: AnimalTime;
}

export interface AnimalTopologyWanderSnapshot {
  readonly groupId: string;
  readonly universalTime: AnimalTime;
  readonly legIndex: number;
  readonly activity: AnimalWanderActivity;
  readonly activityProgress: number;
  readonly position: AnimalVector3;
  readonly forward: AnimalVector3;
  readonly velocity: AnimalVector3;
  readonly currentHabitat: AnimalWanderHabitat;
  readonly nextHabitat: AnimalWanderHabitat;
}

/**
 * Computes a smooth geodesic path on Plane, Sphere, or Cylinder surfaces.
 * Respects terrain topology, spherical great-circles, and cylinder circumferential wrapping.
 */
export function sampleSurfaceGeodesic(
  surface: AnimalWorldSurface,
  from: AnimalVector3,
  to: AnimalVector3,
  progress: number,
  arcHeightM = 0,
): { readonly position: AnimalVector3; readonly forward: AnimalVector3; readonly velocity: AnimalVector3 } {
  validateVector(from, 'Geodesic from');
  validateVector(to, 'Geodesic to');
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const eased = easeSmoothstep(clampedProgress);
  const easedRate = easeSmoothstepRate(clampedProgress);

  if (surface.kind === 'sphere') {
    return sampleSphereGeodesic(surface, from, to, eased, easedRate, arcHeightM);
  }
  if (surface.kind === 'cylinder') {
    return sampleCylinderGeodesic(surface, from, to, eased, easedRate, arcHeightM);
  }
  return samplePlaneGeodesic(surface, from, to, eased, easedRate, arcHeightM);
}

function samplePlaneGeodesic(
  surface: AnimalWorldSurface,
  from: AnimalVector3,
  to: AnimalVector3,
  eased: number,
  easedRate: number,
  arcHeightM: number,
) {
  const x = from.x + (to.x - from.x) * eased;
  const z = from.z + (to.z - from.z) * eased;
  const sampled = surface.sample({ x, y: 0, z });
  const arc = 4 * arcHeightM * eased * (1 - eased);
  const position: AnimalVector3 = {
    x: sampled.position.x + sampled.surfaceUp.x * arc,
    y: sampled.position.y + sampled.surfaceUp.y * arc,
    z: sampled.position.z + sampled.surfaceUp.z * arc,
  };

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  const forward: AnimalVector3 = dist > 1e-6
    ? { x: dx / dist, y: 0, z: dz / dist }
    : sampled.tangentU;

  const velocity: AnimalVector3 = {
    x: dx * easedRate,
    y: (to.y - from.y + 4 * arcHeightM * (1 - 2 * eased)) * easedRate,
    z: dz * easedRate,
  };

  return { position, forward, velocity };
}

function sampleSphereGeodesic(
  surface: AnimalWorldSurface,
  from: AnimalVector3,
  to: AnimalVector3,
  eased: number,
  easedRate: number,
  arcHeightM: number,
) {
  const fromLen = Math.hypot(from.x, from.y, from.z) || 1;
  const toLen = Math.hypot(to.x, to.y, to.z) || 1;
  const uA = { x: from.x / fromLen, y: from.y / fromLen, z: from.z / fromLen };
  const uB = { x: to.x / toLen, y: to.y / toLen, z: to.z / toLen };

  const dot = Math.min(1, Math.max(-1, uA.x * uB.x + uA.y * uB.y + uA.z * uB.z));
  const omega = Math.acos(dot);

  let uInterp: AnimalVector3;
  let tangentDir: AnimalVector3;

  if (omega < 1e-6) {
    uInterp = uA;
    tangentDir = { x: 0, y: 1, z: 0 };
  } else {
    const sinOmega = Math.sin(omega);
    const scaleA = Math.sin((1 - eased) * omega) / sinOmega;
    const scaleB = Math.sin(eased * omega) / sinOmega;
    uInterp = {
      x: uA.x * scaleA + uB.x * scaleB,
      y: uA.y * scaleA + uB.y * scaleB,
      z: uA.z * scaleA + uB.z * scaleB,
    };
    const diffScaleA = -omega * Math.cos((1 - eased) * omega) / sinOmega;
    const diffScaleB = omega * Math.cos(eased * omega) / sinOmega;
    const rawTangent = {
      x: uA.x * diffScaleA + uB.x * diffScaleB,
      y: uA.y * diffScaleA + uB.y * diffScaleB,
      z: uA.z * diffScaleA + uB.z * diffScaleB,
    };
    const tLen = Math.hypot(rawTangent.x, rawTangent.y, rawTangent.z) || 1;
    tangentDir = { x: rawTangent.x / tLen, y: rawTangent.y / tLen, z: rawTangent.z / tLen };
  }

  const radius = fromLen + (toLen - fromLen) * eased;
  const basePos: AnimalVector3 = { x: uInterp.x * radius, y: uInterp.y * radius, z: uInterp.z * radius };
  const sampled = surface.sample(basePos);
  const arc = 4 * arcHeightM * eased * (1 - eased);

  const position: AnimalVector3 = {
    x: sampled.position.x + sampled.surfaceUp.x * arc,
    y: sampled.position.y + sampled.surfaceUp.y * arc,
    z: sampled.position.z + sampled.surfaceUp.z * arc,
  };

  const speed = omega * radius * easedRate;
  const velocity: AnimalVector3 = {
    x: tangentDir.x * speed,
    y: tangentDir.y * speed,
    z: tangentDir.z * speed,
  };

  return { position, forward: tangentDir, velocity };
}

function sampleCylinderGeodesic(
  surface: AnimalWorldSurface,
  from: AnimalVector3,
  to: AnimalVector3,
  eased: number,
  easedRate: number,
  arcHeightM: number,
) {
  // Longitudinal axis is X, radial circle is in (Y, Z)
  const angleA = Math.atan2(from.z, from.y);
  const angleB = Math.atan2(to.z, to.y);
  let deltaAngle = Math.atan2(Math.sin(angleB - angleA), Math.cos(angleB - angleA));

  const currentAngle = angleA + deltaAngle * eased;
  const currentX = from.x + (to.x - from.x) * eased;

  const radiusA = Math.hypot(from.y, from.z) || 1;
  const radiusB = Math.hypot(to.y, to.z) || 1;
  const currentRadius = radiusA + (radiusB - radiusA) * eased;

  const basePos: AnimalVector3 = {
    x: currentX,
    y: Math.cos(currentAngle) * currentRadius,
    z: Math.sin(currentAngle) * currentRadius,
  };
  const sampled = surface.sample(basePos);
  const arc = 4 * arcHeightM * eased * (1 - eased);

  const position: AnimalVector3 = {
    x: sampled.position.x + sampled.surfaceUp.x * arc,
    y: sampled.position.y + sampled.surfaceUp.y * arc,
    z: sampled.position.z + sampled.surfaceUp.z * arc,
  };

  const axialVel = (to.x - from.x) * easedRate;
  const angularVel = deltaAngle * currentRadius * easedRate;
  const tangentU = sampled.tangentU;
  const tangentV = sampled.tangentV;

  const totalSpeed = Math.hypot(axialVel, angularVel);
  const forward: AnimalVector3 = totalSpeed > 1e-6
    ? {
      x: (tangentU.x * axialVel + tangentV.x * angularVel) / totalSpeed,
      y: (tangentU.y * axialVel + tangentV.y * angularVel) / totalSpeed,
      z: (tangentU.z * axialVel + tangentV.z * angularVel) / totalSpeed,
    }
    : sampled.tangentU;

  const velocity: AnimalVector3 = {
    x: forward.x * totalSpeed,
    y: forward.y * totalSpeed,
    z: forward.z * totalSpeed,
  };

  return { position, forward, velocity };
}

/**
 * Deterministically determines which habitat to visit on leg k.
 * Uses a pseudo-random Markov selection that prefers traveling to nearby habitats
 * and avoids immediately backtracking to the previous habitat.
 */
export function selectWanderHabitatIndex(
  seed: number,
  legIndex: number,
  habitats: readonly AnimalWanderHabitat[],
  surface: AnimalWorldSurface,
): number {
  if (habitats.length <= 1) return 0;
  if (legIndex === 0) return 0;

  // Compute sequence up to legIndex using bounded recurrence
  // For any legIndex, we can compute step-by-step from base
  let currentIdx = 0;
  let prevIdx = -1;

  const startLeg = Math.max(0, legIndex - 16);
  if (startLeg > 0) {
    // Fast forward seed hash
    currentIdx = Math.floor(animalUnit(seed, `leg:${startLeg}:curr`) * habitats.length);
    prevIdx = Math.floor(animalUnit(seed, `leg:${startLeg}:prev`) * habitats.length);
  }

  for (let step = startLeg; step < legIndex; step++) {
    const fromHabitat = habitats[currentIdx];
    // Score all other habitats by distance and suitability
    const candidates: { idx: number; weight: number }[] = [];
    for (let i = 0; i < habitats.length; i++) {
      if (i === currentIdx) continue;
      const dist = surface.surfaceDistance(fromHabitat.position, habitats[i].position);
      const suitability = habitats[i].suitability01 ?? 0.8;
      // Penalize immediate backtrack
      const backtrackPenalty = i === prevIdx ? 0.2 : 1.0;
      const distanceFactor = 1.0 / Math.max(1, dist * 0.1);
      const weight = suitability * backtrackPenalty * distanceFactor;
      candidates.push({ idx: i, weight });
    }

    const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
    const pickRoll = animalUnit(seed, `step:${step}`) * totalWeight;

    let accum = 0;
    let nextIdx = candidates[0].idx;
    for (const c of candidates) {
      accum += c.weight;
      if (pickRoll <= accum) {
        nextIdx = c.idx;
        break;
      }
    }

    prevIdx = currentIdx;
    currentIdx = nextIdx;
  }

  return currentIdx;
}

/**
 * Computes dwell and travel timing for leg k.
 */
export function getLegTiming(
  def: AnimalTopologyWandererDefinition,
  legIndex: number,
): {
  readonly fromHabitat: AnimalWanderHabitat;
  readonly toHabitat: AnimalWanderHabitat;
  readonly dwellDurationS: number;
  readonly travelDurationS: number;
  readonly totalDurationS: number;
} {
  const fromIdx = selectWanderHabitatIndex(def.groupSeed, legIndex, def.habitats, def.surface);
  const toIdx = selectWanderHabitatIndex(def.groupSeed, legIndex + 1, def.habitats, def.surface);

  const fromHabitat = def.habitats[fromIdx];
  const toHabitat = def.habitats[toIdx];

  const minDwell = def.minDwellDurationS ?? 8;
  const maxDwell = def.maxDwellDurationS ?? 16;
  const dwellRoll = animalUnit(def.groupSeed, `dwell:${legIndex}`);
  const dwellDurationS = minDwell + dwellRoll * (maxDwell - minDwell);

  const distanceM = def.surface.surfaceDistance(fromHabitat.position, toHabitat.position);
  const speed = Math.max(0.5, def.travelSpeedMps);
  const travelDurationS = Math.max(2, distanceM / speed);
  const totalDurationS = dwellDurationS + travelDurationS;

  return { fromHabitat, toHabitat, dwellDurationS, travelDurationS, totalDurationS };
}

/**
 * Samples the continuous topology wanderer at any arbitrary Universal Time t.
 * Completely free of modulo resets, snaps, or teleportation.
 */
export function sampleAnimalTopologyWanderer(
  def: AnimalTopologyWandererDefinition,
  time: AnimalTime,
): AnimalTopologyWanderSnapshot {
  if (!Number.isFinite(time)) throw new RangeError('Universal Time must be finite.');
  if (def.habitats.length === 0) throw new RangeError('Wanderer requires at least one habitat.');

  if (def.habitats.length === 1) {
    const single = def.habitats[0];
    const frame = def.surface.sample(single.position);
    return {
      groupId: def.groupId,
      universalTime: time,
      legIndex: 0,
      activity: 'dwell',
      activityProgress: 0.5,
      position: frame.position,
      forward: frame.tangentU,
      velocity: { x: 0, y: 0, z: 0 },
      currentHabitat: single,
      nextHabitat: single,
    };
  }

  const epoch = def.epoch ?? 0;
  const relTime = time - epoch;

  // Approximate leg index and search exact boundary
  const avgLegDuration = ((def.minDwellDurationS ?? 8) + (def.maxDwellDurationS ?? 16)) / 2 + 10;
  let leg = Math.floor(relTime / avgLegDuration);

  // Find exact leg start time T_leg
  let legStart = 0;
  if (leg >= 0) {
    for (let k = 0; k < leg; k++) {
      legStart += getLegTiming(def, k).totalDurationS;
    }
  } else {
    for (let k = -1; k >= leg; k--) {
      legStart -= getLegTiming(def, k).totalDurationS;
    }
  }

  // Adjust leg forward or backward to contain relTime
  let timing = getLegTiming(def, leg);
  while (relTime < legStart) {
    leg--;
    timing = getLegTiming(def, leg);
    legStart -= timing.totalDurationS;
  }
  while (relTime >= legStart + timing.totalDurationS) {
    legStart += timing.totalDurationS;
    leg++;
    timing = getLegTiming(def, leg);
  }

  const timeInLeg = relTime - legStart;

  if (timeInLeg < timing.dwellDurationS) {
    const activityProgress = timing.dwellDurationS > 0 ? timeInLeg / timing.dwellDurationS : 1;
    const frame = def.surface.sample(timing.fromHabitat.position);
    return {
      groupId: def.groupId,
      universalTime: time,
      legIndex: leg,
      activity: 'dwell',
      activityProgress,
      position: frame.position,
      forward: frame.tangentU,
      velocity: { x: 0, y: 0, z: 0 },
      currentHabitat: timing.fromHabitat,
      nextHabitat: timing.toHabitat,
    };
  }

  const travelElapsed = timeInLeg - timing.dwellDurationS;
  const travelProgress = timing.travelDurationS > 0 ? travelElapsed / timing.travelDurationS : 1;

  const { position, forward, velocity } = sampleSurfaceGeodesic(
    def.surface,
    timing.fromHabitat.position,
    timing.toHabitat.position,
    travelProgress,
    def.travelArcHeightM ?? 0,
  );

  return {
    groupId: def.groupId,
    universalTime: time,
    legIndex: leg,
    activity: 'travel',
    activityProgress: travelProgress,
    position,
    forward,
    velocity,
    currentHabitat: timing.fromHabitat,
    nextHabitat: timing.toHabitat,
  };
}

/**
 * Creates a stateful playback for efficient real-time stepping and forward/backward seeks.
 */
export function createAnimalTopologyWanderPlayback(
  definition: AnimalTopologyWandererDefinition,
) {
  let lastTime: number | null = null;
  let lastSnapshot: AnimalTopologyWanderSnapshot | null = null;

  return {
    sample(time: AnimalTime): AnimalTopologyWanderSnapshot {
      if (lastTime !== null && lastSnapshot !== null && Math.abs(time - lastTime) < 1e-9) {
        return lastSnapshot;
      }
      lastTime = time;
      lastSnapshot = sampleAnimalTopologyWanderer(definition, time);
      return lastSnapshot;
    },
  };
}

function easeSmoothstep(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

function easeSmoothstepRate(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 6 * clamped * (1 - clamped);
}

function validateVector(value: AnimalVector3, label: string): void {
  if (![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new RangeError(`${label} must contain finite coordinates.`);
  }
}
