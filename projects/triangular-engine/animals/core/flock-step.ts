import { AnimalDisturbance, AnimalTerrainSampler, FlockState } from './animal-types';
import { clamp, horizontalUnit, rotateTowards } from './animal-math';
import { FlockDefinition } from './flock-definition';

/** Steps a flock from one immutable snapshot. Neighbour steering always reads the old snapshot. */
export function stepFlock(
  flock: readonly FlockState[],
  dt: number,
  speed: number,
  terrain: AnimalTerrainSampler,
  disturbance?: AnimalDisturbance,
  definition: Partial<Pick<FlockDefinition, 'travelDirection' | 'steeringAcceleration' | 'turnRate' | 'neighbourDistance' | 'habitatMinHeight' | 'habitatMaxHeight'>> = {},
): FlockState[] {
  const minimumFleeDuration = 0.5;
  const minimumRecoverDuration = 0.75;
  const travel = horizontalUnit(definition.travelDirection ?? { x: 0, y: 0, z: 1 });
  const neighbourDistance = Math.max(0.1, definition.neighbourDistance ?? 10);
  const steeringAcceleration = Math.max(0, definition.steeringAcceleration ?? 3);
  const turnRate = Math.max(0, definition.turnRate ?? 1.8);
  return flock.map((animal) => {
    let vx = animal.velocity.x;
    let vy = animal.velocity.y;
    let vz = animal.velocity.z;
    let activity = animal.activity;
    let activityTime = Math.max(0, animal.activityTime ?? 0) + Math.max(0, dt);
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
      const disturbanceVelocity = disturbance.velocity ?? { x: 0, y: 0, z: 0 };
      const relativeVx = vx - disturbanceVelocity.x;
      const relativeVz = vz - disturbanceVelocity.z;
      const relativeSpeedSquared = relativeVx * relativeVx + relativeVz * relativeVz;
      const closestTime = relativeSpeedSquared > 0
        ? clamp(-(dx * relativeVx + dz * relativeVz) / relativeSpeedSquared, 0, 1.5)
        : 0;
      const closestX = dx + relativeVx * closestTime;
      const closestZ = dz + relativeVz * closestTime;
      const closestDistance = Math.hypot(closestX, closestZ);
      const threatDistance = Math.min(d, closestDistance);
      if (threatDistance < disturbance.radius) {
        const fleeX = closestDistance < d ? closestX : dx;
        const fleeZ = closestDistance < d ? closestZ : dz;
        const scale = (1 - threatDistance / disturbance.radius) * disturbance.strength;
        vx += (fleeX / (threatDistance || 1)) * scale;
        vz += (fleeZ / (threatDistance || 1)) * scale;
        activity = 'flee';
        activityTime = 0;
      } else if (activity === 'flee' && activityTime >= minimumFleeDuration) {
        activity = 'recover';
        activityTime = 0;
      } else if (activity === 'recover' && activityTime >= minimumRecoverDuration) {
        activity = 'travel';
        activityTime = 0;
      }
    } else if (activity === 'flee' && activityTime >= minimumFleeDuration) {
      activity = 'recover';
      activityTime = 0;
    } else if (activity === 'recover' && activityTime >= minimumRecoverDuration) {
      activity = 'travel';
      activityTime = 0;
    }
    // A disturbance may request a strong escape, but it must not create a
    // rocket. Keep the response bounded before applying normal acceleration
    // and turn-rate limits.
    const disturbanceSpeedLimit = Math.max(0, speed) * 1.25;
    const disturbedSpeed = Math.hypot(vx, vz);
    if (disturbedSpeed > disturbanceSpeedLimit && disturbedSpeed > 0) {
      const scale = disturbanceSpeedLimit / disturbedSpeed;
      vx *= scale;
      vz *= scale;
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
    return { ...animal, position: next, velocity: { x: vx, y: vy, z: vz }, activity, activityTime };
  });
}
