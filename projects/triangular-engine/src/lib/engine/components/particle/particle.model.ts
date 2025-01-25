import { xyz } from '../../models';

export interface IParticle {
  position: xyz;
  velocity: xyz;
  life: number;
}
