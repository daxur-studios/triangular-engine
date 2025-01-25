import { PhysicsService } from '../services';

export function getWorld(context: { physicsService: PhysicsService }) {
  return context.physicsService.world$.value!;
}
