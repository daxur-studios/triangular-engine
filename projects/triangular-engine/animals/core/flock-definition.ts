import { AnimalVector3 } from './animal-types';

export interface FlockDefinition {
  id: string;
  seed: number;
  origin: AnimalVector3;
  count: number;
  spacing: number;
  speed: number;
  cullDistance: number;
  hysteresis: number;
  /** Broad direction the flock favours while travelling. Defaults to +Z. */
  travelDirection?: AnimalVector3;
  /** Maximum horizontal steering acceleration in world units / s². Defaults to 3. */
  steeringAcceleration?: number;
  /** Maximum turn rate in radians / s. Defaults to 1.8. */
  turnRate?: number;
  /** Nearby-member distance used by the lightweight boid steering. Defaults to 10. */
  neighbourDistance?: number;
  /** Height limits relative to the habitat origin. */
  habitatMinHeight?: number;
  habitatMaxHeight?: number;
}
