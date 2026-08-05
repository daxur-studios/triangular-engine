import {
  addLifeVector3,
  clampLifeVector3Length,
  lengthSquaredLifeVector3,
  normalizeLifeVector3,
  scaleLifeVector3,
  type LifeVector3,
} from './life-vector';
import type { LifeAgentState, LifeInfluence, LifeObstacle } from './life-agent';

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

export function limitAcceleration(out: LifeVector3, maxAcceleration: number): LifeVector3 {
  return clampLifeVector3Length(out, maxAcceleration);
}
