import { AnimalDisturbance, AnimalTerrainSampler, FlockState } from './animal-types';

const length = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z) || 1;

export function stepFlock(flock: readonly FlockState[], dt: number, speed: number, terrain: AnimalTerrainSampler, disturbance?: AnimalDisturbance): FlockState[] {
  return flock.map((animal) => {
    let vx = animal.velocity.x;
    let vy = animal.velocity.y;
    let vz = animal.velocity.z;
    let activity = animal.activity;
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
    const magnitude = length(vx, vy, vz);
    vx = (vx / magnitude) * speed;
    vy = (vy / magnitude) * speed;
    vz = (vz / magnitude) * speed;
    const next = { x: animal.position.x + vx * dt, y: animal.position.y + vy * dt, z: animal.position.z + vz * dt };
    const sample = terrain.sample(next);
    next.y = Math.max(next.y, sample.height);
    return { ...animal, position: next, velocity: { x: vx, y: vy, z: vz }, activity };
  });
}
