import type { Vector3Tuple } from 'three';
import type { WaterSample } from 'triangular-engine/water';

/** Matches the JoltPhysics.js buoyancy example defaults (`Examples/buoyancy.html`). */
export const DEFAULT_WATER_BUOYANCY_SETTINGS: WaterBuoyancySettings = {
  buoyancy: 1.1,
  linearDrag: 0.3,
  angularDrag: 0.05,
};

export interface WaterBuoyancySettings {
  /** >1 floats, <1 sinks, 1 is neutral relative to the body's own gravity response. */
  readonly buoyancy: number;
  readonly linearDrag: number;
  readonly angularDrag: number;
}

/** The exact argument shape `Jolt.Body#ApplyBuoyancyImpulse` consumes. */
export interface WaterBuoyancyImpulseInput {
  readonly surfacePosition: Vector3Tuple;
  readonly surfaceNormal: Vector3Tuple;
  readonly fluidVelocity: Vector3Tuple;
  readonly gravity: Vector3Tuple;
  readonly buoyancy: number;
  readonly linearDrag: number;
  readonly angularDrag: number;
  readonly deltaTime: number;
}

/**
 * Pure mapping from a `WaterSample` + settings to `ApplyBuoyancyImpulse`'s
 * argument tuple. Framework- and Jolt-runtime-free so it is unit-testable and
 * reusable by any physics adapter — a game's own `PhysicsWorld` boundary
 * should call through this, never construct the Jolt call inline itself
 * (docs/runbook/002_water_sublibrary.md, "Jolt buoyancy" design constraints).
 */
export function resolveWaterBuoyancyImpulseInput(
  sample: Pick<WaterSample, 'position' | 'normal' | 'flow'>,
  gravity: Vector3Tuple,
  deltaTime: number,
  settings: WaterBuoyancySettings = DEFAULT_WATER_BUOYANCY_SETTINGS,
): WaterBuoyancyImpulseInput {
  return {
    surfacePosition: [sample.position.x, sample.position.y, sample.position.z],
    surfaceNormal: [sample.normal.x, sample.normal.y, sample.normal.z],
    fluidVelocity: [sample.flow.x, sample.flow.y, sample.flow.z],
    gravity,
    buoyancy: settings.buoyancy,
    linearDrag: settings.linearDrag,
    angularDrag: settings.angularDrag,
    deltaTime,
  };
}
