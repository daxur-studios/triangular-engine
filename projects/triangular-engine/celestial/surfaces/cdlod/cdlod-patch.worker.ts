import { ICelestialBody } from '../../bodies/celestial-body';
import { ISurfaceSampler } from '../surface-sampler';
import { createSurfaceSampler } from '../surface-query';
import {
  generateCdlodOceanPatchRawBuffers,
  generateCdlodPatchRawBuffers,
} from './cdlod-patch-mesher';
import {
  ICdlodWorkerRequest,
  ICdlodWorkerResponse,
} from './cdlod-worker-protocol';

let currentBodyId = '';
let currentBodySeed = 0;
let sampler: ISurfaceSampler | undefined;

export function handleCdlodWorkerMessage(
  data: ICdlodWorkerRequest,
  customSamplerFactory?: (body: ICelestialBody) => ISurfaceSampler,
): { response: ICdlodWorkerResponse; transfer?: Transferable[] } {
  try {
    if (data.type === 'terrain') {
      const bodySeed = data.body.terrain?.seed ?? 0;
      if (!sampler || currentBodyId !== data.body.id || currentBodySeed !== bodySeed) {
        currentBodyId = data.body.id;
        currentBodySeed = bodySeed;
        sampler = customSamplerFactory
          ? customSamplerFactory(data.body)
          : createSurfaceSampler(data.body);
      }

      const activeSampler = sampler;
      if (!activeSampler) {
        throw new Error(`Failed to create surface sampler for body: ${data.body.id}`);
      }

      const raw = generateCdlodPatchRawBuffers(
        data.body,
        activeSampler,
        data.address,
        data.resolution,
        data.centerBodyFixedM,
      );

      const response: ICdlodWorkerResponse = {
        requestId: data.requestId,
        id: data.id,
        type: 'terrain',
        raw,
        success: true,
      };

      const transfer: Transferable[] = [
        raw.positions.buffer,
        raw.coarsePositions.buffer,
        raw.normals.buffer,
        raw.uvs.buffer,
      ];
      if (raw.colors) transfer.push(raw.colors.buffer);
      if (raw.elevations) transfer.push(raw.elevations.buffer);

      return { response, transfer };
    } else {
      const raw = generateCdlodOceanPatchRawBuffers(
        data.body,
        data.address,
        data.resolution,
        data.centerBodyFixedM,
      );

      const response: ICdlodWorkerResponse = {
        requestId: data.requestId,
        id: data.id,
        type: 'ocean',
        raw,
        success: true,
      };

      const transfer: Transferable[] = [
        raw.positions.buffer,
        raw.coarsePositions.buffer,
        raw.normals.buffer,
        raw.uvs.buffer,
      ];

      return { response, transfer };
    }
  } catch (err: unknown) {
    const response: ICdlodWorkerResponse = {
      requestId: data.requestId,
      id: data.id,
      type: data.type,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
    return { response };
  }
}
