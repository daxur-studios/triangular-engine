import {
  addLifeVector3,
  clampLifeVector3Length,
  lengthSquaredLifeVector3,
  normalizeLifeVector3,
  scaleLifeVector3,
  type LifeVector3,
} from './life-vector';
import type { LifeAgentState, LifeInfluence, LifeObstacle } from './life-agent';
import { canTraverseLifeSegment, type LifeHabitatQuery } from './life-habitat';
import { sampleLifeRouteAtTime, type LifeDeterministicRoute } from './life-deterministic-route';

export interface LifeBehaviorContext {
  readonly agent: LifeAgentState;
  readonly neighbors: readonly LifeAgentState[];
  readonly obstacles: readonly LifeObstacle[];
  readonly influences: readonly LifeInfluence[];
  readonly timeSeconds: number;
}

export type LifeBehavior = (context: LifeBehaviorContext, out: LifeVector3) => void;

export function separation(distance = 4, strength = 8): LifeBehavior {
  return ({ agent, neighbors }, out) => {
    const distanceSquared = distance * distance;
    for (const neighbor of neighbors) {
      if (neighbor.id === agent.id) continue;
      const dx = agent.position.x - neighbor.position.x;
      const dy = agent.position.y - neighbor.position.y;
      const dz = agent.position.z - neighbor.position.z;
      const squared = dx * dx + dy * dy + dz * dz;
      if (squared <= 1e-8 || squared > distanceSquared) continue;
      const amount = (distance - Math.sqrt(squared)) / distance;
      out.x += (dx / Math.sqrt(squared)) * amount * strength;
      out.y += (dy / Math.sqrt(squared)) * amount * strength;
      out.z += (dz / Math.sqrt(squared)) * amount * strength;
    }
  };
}

export function alignment(strength = 2): LifeBehavior {
  return ({ agent, neighbors }, out) => {
    if (!neighbors.length) return;
    for (const neighbor of neighbors) {
      out.x += (neighbor.velocity.x - agent.velocity.x) * strength;
      out.y += (neighbor.velocity.y - agent.velocity.y) * strength;
      out.z += (neighbor.velocity.z - agent.velocity.z) * strength;
    }
    scaleLifeVector3(out, 1 / neighbors.length);
  };
}

export function cohesion(strength = 1.2): LifeBehavior {
  return ({ agent, neighbors }, out) => {
    if (!neighbors.length) return;
    for (const neighbor of neighbors) {
      out.x += neighbor.position.x - agent.position.x;
      out.y += neighbor.position.y - agent.position.y;
      out.z += neighbor.position.z - agent.position.z;
    }
    scaleLifeVector3(out, strength / neighbors.length);
  };
}

export function fleeInfluences(strength = 12): LifeBehavior {
  return ({ agent, influences }, out) => {
    for (const influence of influences) {
      const away = {
        x: agent.position.x - influence.position.x,
        y: agent.position.y - influence.position.y,
        z: agent.position.z - influence.position.z,
      };
      const distanceSquared = lengthSquaredLifeVector3(away);
      const range = influence.radius + 18;
      if (distanceSquared <= 1e-8 || distanceSquared > range * range) continue;
      normalizeLifeVector3(away);
      const distance = Math.sqrt(distanceSquared);
      addLifeVector3(out, scaleLifeVector3(away, ((range - distance) / range) * strength));
    }
  };
}

export function avoidObstacles(strength = 14): LifeBehavior {
  return ({ agent, obstacles }, out) => {
    for (const obstacle of obstacles) {
      const away = {
        x: agent.position.x - obstacle.position.x,
        y: agent.position.y - obstacle.position.y,
        z: agent.position.z - obstacle.position.z,
      };
      const distanceSquared = lengthSquaredLifeVector3(away);
      const range = obstacle.radius + 8;
      if (distanceSquared <= 1e-8 || distanceSquared > range * range) continue;
      normalizeLifeVector3(away);
      const distance = Math.sqrt(distanceSquared);
      addLifeVector3(out, scaleLifeVector3(away, ((range - distance) / range) * strength));
    }
  };
}

export function keepAbove(minY: number, strength = 10): LifeBehavior {
  return ({ agent }, out) => {
    if (agent.position.y < minY) out.y += (minY - agent.position.y) * strength;
  };
}

export interface LifeHabitatFollowOptions {
  readonly clearance?: number;
  readonly strength?: number;
  readonly lookAheadSeconds?: number;
  readonly segmentSamples?: number;
}

/** Keeps a local agent on its species domain while following sampled terrain. */
export function followLifeHabitat(
  query: LifeHabitatQuery,
  allowedKinds: readonly string[],
  options: LifeHabitatFollowOptions = {},
): LifeBehavior {
  const clearance = options.clearance ?? 0.15;
  const strength = options.strength ?? 12;
  const lookAheadSeconds = options.lookAheadSeconds ?? 0.35;
  const segmentSamples = options.segmentSamples ?? 4;
  return ({ agent }, out) => {
    const sample = query.sampleHabitat(agent.position);
    if (allowedKinds.includes(sample.kind) && sample.suitability01 > 0) {
      out.y += (sample.surfaceY + clearance - agent.position.y) * strength;
    }
    const ahead = {
      x: agent.position.x + agent.velocity.x * lookAheadSeconds,
      y: agent.position.y + agent.velocity.y * lookAheadSeconds,
      z: agent.position.z + agent.velocity.z * lookAheadSeconds,
    };
    if (!canTraverseLifeSegment(query, agent.position, ahead, allowedKinds, segmentSamples)) {
      out.x -= agent.velocity.x * strength;
      out.y -= agent.velocity.y * strength;
      out.z -= agent.velocity.z * strength;
    }
  };
}

/** Steers a materialized agent toward the position of a universal-time route. */
export function followLifeRoute(
  route: LifeDeterministicRoute,
  strength = 8,
  arrivalRadius = 3,
): LifeBehavior {
  return ({ agent, timeSeconds }, out) => {
    const target = sampleLifeRouteAtTime(route, timeSeconds).position;
    const dx = target.x - agent.position.x;
    const dy = target.y - agent.position.y;
    const dz = target.z - agent.position.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= 1e-6) return;
    const speed = agent.maxSpeed * Math.min(1, distance / Math.max(1e-3, arrivalRadius));
    const desired = { x: (dx / distance) * speed, y: (dy / distance) * speed, z: (dz / distance) * speed };
    out.x += (desired.x - agent.velocity.x) * strength;
    out.y += (desired.y - agent.velocity.y) * strength;
    out.z += (desired.z - agent.velocity.z) * strength;
  };
}

export function keepWithinBounds(
  min: LifeVector3,
  max: LifeVector3,
  strength = 4,
): LifeBehavior {
  return ({ agent }, out) => {
    if (agent.position.x < min.x) out.x += (min.x - agent.position.x) * strength;
    if (agent.position.x > max.x) out.x -= (agent.position.x - max.x) * strength;
    if (agent.position.y < min.y) out.y += (min.y - agent.position.y) * strength;
    if (agent.position.y > max.y) out.y -= (agent.position.y - max.y) * strength;
    if (agent.position.z < min.z) out.z += (min.z - agent.position.z) * strength;
    if (agent.position.z > max.z) out.z -= (agent.position.z - max.z) * strength;
  };
}

export function limitAcceleration(out: LifeVector3, maxAcceleration: number): LifeVector3 {
  return clampLifeVector3Length(out, maxAcceleration);
}
