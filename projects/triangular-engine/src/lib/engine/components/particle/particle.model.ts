import { Vector3Tuple } from 'three';

export interface IParticle {
  position: Vector3Tuple;
  velocity: Vector3Tuple;
  life: number;
}
