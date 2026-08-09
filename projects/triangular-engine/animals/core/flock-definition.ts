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
}
