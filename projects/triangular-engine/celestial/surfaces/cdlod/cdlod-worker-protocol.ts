import { ICelestialBody } from '../../bodies/celestial-body';
import { Vec3d } from '../../math/vec3';
import { IPlanetPatchAddress } from './cdlod-quadtree';
import { ICdlodRawPatchBuffers } from './cdlod-patch-mesher';

export type CdlodPatchType = 'terrain' | 'ocean';

export interface ICdlodWorkerRequest {
  requestId: string;
  id: string;
  type: CdlodPatchType;
  body: ICelestialBody;
  address: IPlanetPatchAddress;
  resolution: number;
  centerBodyFixedM: Vec3d;
}

export interface ICdlodWorkerResponse {
  requestId: string;
  id: string;
  type: CdlodPatchType;
  success: boolean;
  raw?: ICdlodRawPatchBuffers;
  errorMessage?: string;
}
