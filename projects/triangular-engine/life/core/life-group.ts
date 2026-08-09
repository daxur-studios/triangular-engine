import { sampleLifeRouteAtTime, type LifeDeterministicRoute, type LifeRouteSample } from './life-deterministic-route';
import { sampleLifeLifecycleAtTime, type LifeLifecycleDefinition, type LifeLifecycleSample } from './life-lifecycle';
import type { LifeVector3 } from './life-vector';

export interface LifeGroupDefinition {
  readonly seed: number;
  readonly count: number;
  readonly route: LifeDeterministicRoute;
  readonly spread?: number;
  readonly wanderAmplitude?: number;
  readonly wanderPeriodSeconds?: number;
  /** Spreads members along the route using deterministic time lag. */
  readonly routeLagSeconds?: number;
  readonly lifecycle?: LifeLifecycleDefinition & { readonly birthSpreadSeconds?: number };
  readonly verticalSpread?: number;
  /** Reconstructable player/world events layered over the baseline route. */
  readonly disturbances?: readonly LifeGroupDisturbance[];
}

export interface LifeGroupDisturbance {
  readonly center: LifeVector3;
  readonly startTimeSeconds: number;
  readonly durationSeconds: number;
  readonly radius: number;
  readonly strength: number;
}

export interface LifeGroupMemberSample {
  readonly position: LifeVector3;
  readonly heading: LifeVector3;
  readonly disturbed01: number;
  readonly lifecycle?: LifeLifecycleSample;
}

export interface LifeGroupObstacle {
  readonly position: LifeVector3;
  readonly radius: number;
  readonly strength?: number;
}

export interface LifeGroupSample {
  readonly anchor: LifeRouteSample;
  readonly members: readonly LifeGroupMemberSample[];
}

/** Applies local obstacle pushes without introducing hidden simulation state. */
export function applyLifeGroupObstacleAvoidance(
  sample: LifeGroupSample,
  obstacles: readonly LifeGroupObstacle[],
  clearance = 0.5,
): LifeGroupSample {
  const safeClearance = Math.max(0, clearance);
  return {
    ...sample,
    members: sample.members.map((member) => {
      const position = { ...member.position };
      for (const obstacle of obstacles) {
        const radius = Math.max(0, obstacle.radius) + safeClearance;
        const dx = position.x - obstacle.position.x;
        const dy = position.y - obstacle.position.y;
        const dz = position.z - obstacle.position.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance >= radius) continue;
        const inverse = distance > 1e-6 ? 1 / distance : 1;
        const push = (radius - distance) * Math.max(0, obstacle.strength ?? 1);
        position.x += dx * inverse * push;
        position.y += dy * inverse * push;
        position.z += dz * inverse * push;
      }
      return { ...member, position };
    }),
  };
}

/** Keeps a materialized group readable without integrating a global boid sim. */
export function applyLifeGroupSeparation(
  sample: LifeGroupSample,
  radius = 1,
  strength = 0.5,
): LifeGroupSample {
  const safeRadius = Math.max(0, radius);
  const safeStrength = Math.max(0, strength);
  if (safeRadius <= 0 || safeStrength <= 0) return sample;
  return {
    ...sample,
    members: sample.members.map((member, index) => {
      const position = { ...member.position };
      for (let otherIndex = 0; otherIndex < sample.members.length; otherIndex++) {
        if (otherIndex === index) continue;
        const other = sample.members[otherIndex].position;
        const dx = position.x - other.x;
        const dy = position.y - other.y;
        const dz = position.z - other.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance <= 1e-6 || distance >= safeRadius) continue;
        const push = ((safeRadius - distance) / safeRadius) * safeStrength;
        position.x += (dx / distance) * push;
        position.y += (dy / distance) * push;
        position.z += (dz / distance) * push;
      }
      return { ...member, position };
    }),
  };
}

/**
 * Materializes a nearby flock/herd/school from a deterministic group anchor.
 * Member offsets are pure functions of group seed, member index, and universal
 * time; no per-frame integration or hidden state is required.
 */
export function sampleLifeGroupAtTime(
  definition: LifeGroupDefinition,
  universalTimeSeconds: number,
): LifeGroupSample {
  const anchor = sampleLifeRouteAtTime(definition.route, universalTimeSeconds);
  const count = Math.max(0, Math.floor(definition.count));
  const spread = Math.max(0, definition.spread ?? 4);
  const wander = Math.max(0, definition.wanderAmplitude ?? spread * 0.16);
  const period = Math.max(1e-3, definition.wanderPeriodSeconds ?? 12);
  const verticalSpread = Math.max(0, definition.verticalSpread ?? 0);
  const routeLagSeconds = Math.max(0, definition.routeLagSeconds ?? 0);
  const members: LifeGroupMemberSample[] = [];

  for (let index = 0; index < count; index++) {
    const memberAnchor = routeLagSeconds > 0
      ? sampleLifeRouteAtTime(
        definition.route,
        universalTimeSeconds - (index % 7) * routeLagSeconds,
      )
      : anchor;
    const right = horizontalRight(memberAnchor.heading);
    const phase = unitNoise(definition.seed, index, 1) * Math.PI * 2;
    const radius = spread * (0.35 + unitNoise(definition.seed, index, 2) * 0.65);
    const angle = phase + index * 2.3999632297;
    const oscillation = (universalTimeSeconds / period + unitNoise(definition.seed, index, 3)) * Math.PI * 2;
    const offset = {
      x: right.x * Math.cos(angle) * radius + Math.sin(oscillation) * wander,
      y: verticalSpread ? Math.sin(angle * 1.7 + oscillation) * verticalSpread : 0,
      z: right.z * Math.cos(angle) * radius + Math.cos(oscillation * 0.83) * wander,
    };
    const position = {
      x: memberAnchor.position.x + offset.x,
      y: memberAnchor.position.y + offset.y,
      z: memberAnchor.position.z + offset.z,
    };
    const disturbance = disturbanceOffset(position, definition.disturbances ?? [], universalTimeSeconds);
    position.x += disturbance.x;
    position.y += disturbance.y;
    position.z += disturbance.z;
    const lifecycle = definition.lifecycle
      ? sampleLifeLifecycleAtTime({
        birthTimeSeconds: definition.lifecycle.birthTimeSeconds
          + (definition.lifecycle.birthSpreadSeconds ?? 0) * unitNoise(definition.seed, index, 4),
        juvenileDurationSeconds: definition.lifecycle.juvenileDurationSeconds,
        lifespanSeconds: definition.lifecycle.lifespanSeconds,
      }, universalTimeSeconds)
      : undefined;
    members.push({ position, heading: memberAnchor.heading, disturbed01: disturbance.amount, lifecycle });
  }
  return { anchor, members };
}

function disturbanceOffset(
  position: LifeVector3,
  disturbances: readonly LifeGroupDisturbance[],
  timeSeconds: number,
): { x: number; y: number; z: number; amount: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  let amount = 0;
  for (const disturbance of disturbances) {
    const duration = Math.max(1e-3, disturbance.durationSeconds);
    const age = timeSeconds - disturbance.startTimeSeconds;
    if (age < 0 || age > duration) continue;
    const dx = position.x - disturbance.center.x;
    const dy = position.y - disturbance.center.y;
    const dz = position.z - disturbance.center.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance >= disturbance.radius) continue;
    const direction = distance > 1e-6 ? 1 / distance : 0;
    const spatial = 1 - distance / Math.max(1e-3, disturbance.radius);
    const phase = Math.min(1, age / duration);
    const temporal = Math.sin(Math.PI * phase);
    const offset = Math.max(0, disturbance.strength) * spatial * temporal;
    x += dx * direction * offset;
    y += dy * direction * offset;
    z += dz * direction * offset;
    amount = Math.max(amount, Math.min(1, spatial * temporal));
  }
  return { x, y, z, amount };
}

function horizontalRight(heading: LifeVector3): LifeVector3 {
  const length = Math.hypot(heading.x, heading.z);
  if (length <= 1e-8) return { x: 1, y: 0, z: 0 };
  return { x: -heading.z / length, y: 0, z: heading.x / length };
}

function unitNoise(seed: number, index: number, salt: number): number {
  const value = Math.sin((seed + 1) * 12.9898 + (index + 1) * 78.233 + salt * 37.719) * 43758.5453;
  return value - Math.floor(value);
}
