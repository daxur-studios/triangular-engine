import { ICelestialBody } from '../../bodies/celestial-body';
import { ISurfaceSampler } from '../surface-sampler';
import { createSurfaceSampler } from '../surface-query';
import {
  generateCdlodOceanPatchRawBuffers,
  generateCdlodPatchRawBuffers,
} from './cdlod-patch-mesher';
import {
  generateCdlodPlanePatchRawBuffers,
  createPlaneSurfaceSampler,
} from './cdlod-plane-mesher';
import {
  generateCdlodCylinderPatchRawBuffers,
  createCylinderSurfaceSampler,
} from './cdlod-cylinder-mesher';
import { IPlanetPatchAddress } from './cdlod-quadtree';
import { IPlanePatchAddress } from './cdlod-plane-quadtree';
import { ICylinderPatchAddress } from './cdlod-cylinder-quadtree';
import {
  ICdlodWorkerRequest,
  ICdlodWorkerResponse,
} from './cdlod-worker-protocol';

// Clean isolated caches per domain type to avoid cross-contamination
let sphereBodyId = '';
let sphereBodySeed = 0;
let sphereLocalFlattenKey = '';
let sphereSampler: ISurfaceSampler | undefined;

let planeBodyId = '';
let planeBodySeed = 0;
let planeLocalFlattenKey = '';
let planeSampler: ISurfaceSampler | undefined;

let cylinderBodyId = '';
let cylinderBodySeed = 0;
let cylinderRadiusM = 0;
let cylinderLocalFlattenKey = '';
let cylinderSampler: ISurfaceSampler | undefined;

/**
 * Base-building/landing-site grading replaces `terrain.localFlatten` while
 * keeping `body.id` and `terrain.seed` unchanged (see BSP's
 * `world-session.service.ts#reapplyLocalFlattens`), so the id+seed cache key
 * alone can't detect a grading update — this closes that gap.
 */
function localFlattenKey(body: ICelestialBody | undefined): string {
  return JSON.stringify(body?.terrain?.localFlatten ?? []);
}

export function handleCdlodWorkerMessage(
  data: ICdlodWorkerRequest,
  customSamplerFactory?: (body: ICelestialBody) => ISurfaceSampler,
): { response: ICdlodWorkerResponse; transfer?: Transferable[] } {
  try {
    if (data.type === 'plane') {
      const bodySeed = data.body?.terrain?.seed ?? 0;
      const bodyId = data.body?.id ?? 'plane-world';
      const flattenKey = localFlattenKey(data.body);

      if (
        !planeSampler ||
        planeBodyId !== bodyId ||
        planeBodySeed !== bodySeed ||
        planeLocalFlattenKey !== flattenKey
      ) {
        planeBodyId = bodyId;
        planeBodySeed = bodySeed;
        planeLocalFlattenKey = flattenKey;
        planeSampler = data.body
          ? customSamplerFactory
            ? customSamplerFactory(data.body)
            : createPlaneSurfaceSampler(data.body)
          : createPlaneSurfaceSampler();
      }

      if (!planeSampler) {
        throw new Error('Surface sampler not initialized for plane CDLOD');
      }

      const rootSize = data.rootPatchSizeM ?? 2048;
      const raw = generateCdlodPlanePatchRawBuffers(
        planeSampler,
        data.address as IPlanePatchAddress,
        data.resolution,
        rootSize,
        data.centerBodyFixedM,
        bodyId,
      );

      const response: ICdlodWorkerResponse = {
        requestId: data.requestId,
        id: data.id,
        type: 'plane',
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
    }

    if (data.type === 'cylinder') {
      const bodySeed = data.body?.terrain?.seed ?? 0;
      const bodyId = data.body?.id ?? 'cylinder-world';
      const radiusM = data.radiusM ?? 4000;
      const flattenKey = localFlattenKey(data.body);

      if (
        !cylinderSampler ||
        cylinderBodyId !== bodyId ||
        cylinderBodySeed !== bodySeed ||
        cylinderRadiusM !== radiusM ||
        cylinderLocalFlattenKey !== flattenKey
      ) {
        cylinderBodyId = bodyId;
        cylinderBodySeed = bodySeed;
        cylinderRadiusM = radiusM;
        cylinderLocalFlattenKey = flattenKey;
        cylinderSampler = data.body
          ? customSamplerFactory
            ? customSamplerFactory(data.body)
            : createCylinderSurfaceSampler(data.body, radiusM)
          : createCylinderSurfaceSampler(undefined, radiusM);
      }

      if (!cylinderSampler) {
        throw new Error('Surface sampler not initialized for cylinder CDLOD');
      }

      const rootSectors = data.rootSectors ?? 8;
      const raw = generateCdlodCylinderPatchRawBuffers(
        cylinderSampler,
        data.address as ICylinderPatchAddress,
        data.resolution,
        radiusM,
        data.centerBodyFixedM,
        rootSectors,
        data.rootPatchLengthM,
      );

      const response: ICdlodWorkerResponse = {
        requestId: data.requestId,
        id: data.id,
        type: 'cylinder',
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
    }

    if (data.type === 'terrain') {
      if (!data.body) {
        throw new Error('CelestialBody is required for sphere terrain CDLOD');
      }
      const bodySeed = data.body.terrain?.seed ?? 0;
      const bodyId = data.body.id;
      const flattenKey = localFlattenKey(data.body);

      if (
        !sphereSampler ||
        sphereBodyId !== bodyId ||
        sphereBodySeed !== bodySeed ||
        sphereLocalFlattenKey !== flattenKey
      ) {
        sphereBodyId = bodyId;
        sphereBodySeed = bodySeed;
        sphereLocalFlattenKey = flattenKey;
        sphereSampler = customSamplerFactory
          ? customSamplerFactory(data.body)
          : createSurfaceSampler(data.body);
      }

      const activeSampler = sphereSampler;
      if (!activeSampler) {
        throw new Error(`Failed to create surface sampler for body: ${data.body.id}`);
      }

      const raw = generateCdlodPatchRawBuffers(
        data.body,
        activeSampler,
        data.address as IPlanetPatchAddress,
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
    }

    if (data.type === 'ocean') {
      if (!data.body) {
        throw new Error('CelestialBody is required for ocean CDLOD');
      }
      const raw = generateCdlodOceanPatchRawBuffers(
        data.body,
        data.address as IPlanetPatchAddress,
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
      if (raw.colors) transfer.push(raw.colors.buffer);
      if (raw.elevations) transfer.push(raw.elevations.buffer);

      return { response, transfer };
    }

    throw new Error(`Unsupported CDLOD patch type: ${(data as { type: string }).type}`);
  } catch (err) {
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

