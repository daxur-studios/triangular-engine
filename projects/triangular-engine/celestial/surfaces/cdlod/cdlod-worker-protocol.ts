import { ICelestialBody } from '../../bodies/celestial-body';
import { Vec3d } from '../../math/vec3';
import { IPlanetPatchAddress } from './cdlod-quadtree';
import { IPlanePatchAddress } from './cdlod-plane-quadtree';
import { ICylinderPatchAddress } from './cdlod-cylinder-quadtree';
import { ICdlodRawPatchBuffers } from './cdlod-patch-mesher';

export type CdlodPatchType = 'terrain' | 'ocean' | 'plane' | 'cylinder';

export interface ICdlodWorkerRequest {
  requestId: string;
  id: string;
  type: CdlodPatchType;
  body?: ICelestialBody;
  address: IPlanetPatchAddress | IPlanePatchAddress | ICylinderPatchAddress;
  resolution: number;
  centerBodyFixedM: Vec3d;
  rootPatchSizeM?: number;
  radiusM?: number;
  rootSectors?: number;
  rootPatchLengthM?: number;
}

export interface ICdlodWorkerResponse {
  requestId: string;
  id: string;
  type: CdlodPatchType;
  success: boolean;
  raw?: ICdlodRawPatchBuffers;
  errorMessage?: string;
}
