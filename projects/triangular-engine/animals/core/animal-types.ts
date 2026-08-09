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
  radius: number;
  strength: number;
}

export type FlockActivity = 'travel' | 'flee' | 'recover';

export interface FlockState {
  id: string;
  position: AnimalVector3;
  velocity: AnimalVector3;
  activity: FlockActivity;
  visible: boolean;
}

export interface AnimalPresentation {
  id: string;
  position: AnimalVector3;
  heading: AnimalVector3;
  activity: FlockActivity;
}
