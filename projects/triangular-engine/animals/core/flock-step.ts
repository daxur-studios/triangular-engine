import { AnimalDisturbance, AnimalTerrainSampler, AnimalVector3, FlockState } from './animal-types';
import { FlockDefinition } from './flock-definition';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function horizontalUnit(vector: AnimalVector3): { x: number; z: number } {
  const magnitude = Math.hypot(vector.x, vector.z) || 1;
  return { x: vector.x / magnitude, z: vector.z / magnitude };
}

function rotateTowards(vx: number, vz: number, targetX: number, targetZ: number, maxAngle: number): { x: number; z: number } {
  const current = horizontalUnit({ x: vx, y: 0, z: vz });
  const target = horizontalUnit({ x: targetX, y: 0, z: targetZ });
  const angle = Math.atan2(target.x * current.z - target.z * current.x, current.x * target.x + current.z * target.z);
  const turn = clamp(angle, -maxAngle, maxAngle);
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return { x: current.x * cos + current.z * sin, z: current.z * cos - current.x * sin };
}

/** Steps a flock from one immutable snapshot. Neighbour steering always reads the old snapshot. */
export function stepFlock(
  flock: readonly FlockState[],
  dt: number,
  speed: number,
  terrain: AnimalTerrainSampler,
  disturbance?: AnimalDisturbance,
  definition: Partial<Pick<FlockDefinition, 'travelDirection' | 'steeringAcceleration' | 'turnRate' | 'neighbourDistance' | 'habitatMinHeight' | 'habitatMaxHeight'>> = {},
): FlockState[] {
  const travel = horizontalUnit(definition.travelDirection ?? { x: 0, y: 0, z: 1 });
  const neighbourDistance = Math.max(0.1, definition.neighbourDistance ?? 10);
  const steeringAcceleration = Math.max(0, definition.steeringAcceleration ?? 3);
  const turnRate = Math.max(0, definition.turnRate ?? 1.8);
  return flock.map((animal) => {
    let vx = animal.velocity.x;
    let vy = animal.velocity.y;
    let vz = animal.velocity.z;
    let activity = animal.activity;
    let cohesionX = 0;
    let cohesionZ = 0;
    let alignmentX = 0;
    let alignmentZ = 0;
    let separationX = 0;
    let separationZ = 0;
    let neighbours = 0;
    for (const other of flock) {
      if (other.id === animal.id) continue;
      const dx = other.position.x - animal.position.x;
      const dz = other.position.z - animal.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance === 0 || distance > neighbourDistance) continue;
      neighbours += 1;
      cohesionX += dx;
      cohesionZ += dz;
      alignmentX += other.velocity.x;
      alignmentZ += other.velocity.z;
      const proximity = 1 - distance / neighbourDistance;
      separationX -= (dx / distance) * proximity * proximity;
      separationZ -= (dz / distance) * proximity * proximity;
    }
    // A shallow deterministic curve gives travelling flocks a broad route without waypoints or random wandering.
    const routeX = travel.x + Math.sin((animal.position.z * travel.z + animal.position.x * travel.x) * 0.025) * 0.22;
    let targetX = routeX;
    let targetZ = travel.z;
    if (neighbours > 0) {
      targetX += (cohesionX / neighbours) * 0.035 + (alignmentX / neighbours) * 0.12 + separationX * 0.85;
      targetZ += (cohesionZ / neighbours) * 0.035 + (alignmentZ / neighbours) * 0.12 + separationZ * 0.85;
    }
    if (disturbance) {
      const dx = animal.position.x - disturbance.position.x;
      const dz = animal.position.z - disturbance.position.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < disturbance.radius) {
        const scale = (1 - d / disturbance.radius) * disturbance.strength;
        vx += (dx / (d || 1)) * scale;
        vz += (dz / (d || 1)) * scale;
        activity = 'flee';
      } else if (activity === 'flee') activity = 'recover';
    }
    targetX += vx * 0.1;
    targetZ += vz * 0.1;
    const desired = horizontalUnit({ x: targetX, y: 0, z: targetZ });
    const currentSpeed = Math.max(0.01, Math.hypot(vx, vz));
    const turned = rotateTowards(vx, vz, desired.x, desired.z, turnRate * Math.max(0, dt));
    const targetSpeed = Math.max(0, speed);
    const speedDelta = clamp(targetSpeed - currentSpeed, -steeringAcceleration * dt, steeringAcceleration * dt);
    const nextSpeed = Math.max(0, currentSpeed + speedDelta);
    vx = turned.x * nextSpeed;
    vz = turned.z * nextSpeed;
    vy = clamp(vy, -speed, speed);
    const next = { x: animal.position.x + vx * dt, y: animal.position.y + vy * dt, z: animal.position.z + vz * dt };
    const minHeight = definition.habitatMinHeight;
    const maxHeight = definition.habitatMaxHeight;
    if (minHeight !== undefined) next.y = Math.max(next.y, minHeight);
    if (maxHeight !== undefined) next.y = Math.min(next.y, maxHeight);
    const sample = terrain.sample(next);
    next.y = Math.max(next.y, sample.height);
    return { ...animal, position: next, velocity: { x: vx, y: vy, z: vz }, activity };
  });
}
