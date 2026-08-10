import { NavigationLocation, NavigationVector3 } from './navigation-types';

/** The initial terrain contract uses Y-up world coordinates and X/Z ground axes. */
export interface NavigationCoordinateContract {
  readonly frameId: string;
  readonly version: number;
  readonly units: 'world';
  readonly upAxis: 'y';
  readonly horizontalAxes: readonly ['x', 'z'];
}

export function createNavigationCoordinateContract(
  frameId = 'world',
  version = 1,
): NavigationCoordinateContract {
  if (!frameId.trim()) {
    throw new Error('Navigation coordinate frame ID must not be empty.');
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('Navigation coordinate contract version must be a positive integer.');
  }

  return { frameId, version, units: 'world', upAxis: 'y', horizontalAxes: ['x', 'z'] };
}

export function assertNavigationVector3(value: NavigationVector3, label = 'Navigation vector'): void {
  if (![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new Error(`${label} components must be finite.`);
  }
}

export function assertNavigationLocation(
  location: NavigationLocation,
  expectedFrameId?: string,
  label = 'Navigation location',
): void {
  if (!location.frameId.trim()) {
    throw new Error(`${label} frame ID must not be empty.`);
  }
  if (expectedFrameId !== undefined && location.frameId !== expectedFrameId) {
    throw new Error(`${label} belongs to frame "${location.frameId}", expected "${expectedFrameId}".`);
  }
  assertNavigationVector3(location.position, `${label} position`);
}

export function assertSameNavigationFrame(
  left: NavigationLocation,
  right: NavigationLocation,
): void {
  assertNavigationLocation(left, undefined, 'Start location');
  assertNavigationLocation(right, left.frameId, 'Goal location');
}

export function navigationDistanceSquared(
  left: NavigationLocation,
  right: NavigationLocation,
): number {
  assertSameNavigationFrame(left, right);
  const dx = left.position.x - right.position.x;
  const dy = left.position.y - right.position.y;
  const dz = left.position.z - right.position.z;
  return dx * dx + dy * dy + dz * dz;
}
