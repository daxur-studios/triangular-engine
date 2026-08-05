import { lifeVector3, type LifeVector3 } from './life-vector';

export interface LifeAgentState {
  readonly id: number;
  position: LifeVector3;
  velocity: LifeVector3;
  maxSpeed: number;
  maxAcceleration: number;
  radius: number;
}

export interface LifeObstacle {
  readonly id: number | string;
  readonly position: LifeVector3;
  readonly radius: number;
  readonly height?: number;
  readonly tags?: readonly string[];
}

export interface LifeInfluence {
  readonly id: number | string;
  readonly position: LifeVector3;
  readonly velocity?: LifeVector3;
  readonly radius: number;
  readonly tags?: readonly string[];
}

export interface LifeAgentOptions {
  readonly id: number;
  readonly position?: LifeVector3;
  readonly velocity?: LifeVector3;
  readonly maxSpeed?: number;
  readonly maxAcceleration?: number;
  readonly radius?: number;
}

export function createLifeAgent(options: LifeAgentOptions): LifeAgentState {
  return {
    id: options.id,
    position: options.position ? { ...options.position } : lifeVector3(),
    velocity: options.velocity ? { ...options.velocity } : lifeVector3(),
    maxSpeed: options.maxSpeed ?? 5,
    maxAcceleration: options.maxAcceleration ?? 10,
    radius: options.radius ?? 0.5,
  };
}
