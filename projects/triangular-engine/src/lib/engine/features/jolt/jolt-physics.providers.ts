import { provideAppInitializer } from '@angular/core';
import { JoltPhysicsService } from './jolt-physics/jolt-physics.service';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  CanActivateFn,
} from '@angular/router';

/**
 * Ensure Jolt is loaded before the application starts.
 * Use this in your bootstrap providers array.
 */
export function provideJoltPhysicsInitializer() {
  return provideAppInitializer(() => JoltPhysicsService.load());
}

/**
 * Guard to ensure Jolt is loaded before the page loads.
 * Use this in your route configuration.
 *
 * @example
 * ```typescript
 * {
 *   path: 'physics-page',
 *   canActivate: [canActivateJoltPhysics],
 *   component: PhysicsComponent
 * }
 * ```
 */
export const canActivateJoltPhysics: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
): Promise<boolean | UrlTree> => {
  // Check if Jolt is already loaded by checking if window.Jolt exists
  // (this is set during JoltPhysicsService.load())
  if (
    (window as any).Jolt &&
    typeof (window as any).Jolt.Vec3 !== 'undefined'
  ) {
    return Promise.resolve(true);
  }

  // Load Jolt if not already loaded
  return JoltPhysicsService.load().then(() => true);
};
