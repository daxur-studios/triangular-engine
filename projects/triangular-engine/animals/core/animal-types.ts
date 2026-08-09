export type AnimalTime = number;
export type AnimalVector3 = { x: number; y: number; z: number };

export interface AnimalObserver {
  position: AnimalVector3;
  radius: number;
}

export interface AnimalTerrainSample {
  height: number;
  normal: AnimalVector3;
  walkable?: boolean;
}

export interface AnimalTerrainSampler {
  sample(position: AnimalVector3): AnimalTerrainSample;
}

export interface AnimalDisturbance {
  id: string;
  position: AnimalVector3;
  /** Optional world velocity used for predictive approach detection. */
  velocity?: AnimalVector3;
  radius: number;
  strength: number;
}

export type FlockActivity = 'travel' | 'flee' | 'recover';

export interface FlockState {
  id: string;
  position: AnimalVector3;
  velocity: AnimalVector3;
  activity: FlockActivity;
  /** Deterministic time spent in the current activity. */
  activityTime?: number;
  visible: boolean;
}

export interface AnimalPresentation {
  id: string;
  position: AnimalVector3;
  /** Normalized forward direction; falls back to +Z when stationary. */
  heading: AnimalVector3;
  /** Magnitude of the simulation velocity in world units per second. */
  speed: number;
  activity: FlockActivity;
  /** Renderer-neutral roll hint in radians, derived only from motion. */
  bank: number;
}
