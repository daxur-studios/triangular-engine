import { ICelestialBody } from '../../bodies/celestial-body';
import { Vec3d } from '../../math/vec3';
import { IPlanetPatchAddress } from './cdlod-quadtree';
import { IPlanePatchAddress } from './cdlod-plane-quadtree';
import { ICdlodRawPatchBuffers } from './cdlod-patch-mesher';

export type CdlodPatchType = 'terrain' | 'ocean' | 'plane';

export interface ICdlodWorkerRequest {
  requestId: string;
  id: string;
  type: CdlodPatchType;
  body?: ICelestialBody;
  address: IPlanetPatchAddress | IPlanePatchAddress;
  resolution: number;
  centerBodyFixedM: Vec3d;
  rootPatchSizeM?: number;
}

export interface ICdlodWorkerResponse {
  requestId: string;
  id: string;
  type: CdlodPatchType;
  success: boolean;
  raw?: ICdlodRawPatchBuffers;
  errorMessage?: string;
}
