/// <reference lib="webworker" />

import { buildCellBorderLineGeometry } from 'triangular-engine/worldgen/render';
import {
  defaultCellPlanetWorldCache,
  handleCellPlanetWorkerMessage,
  type CellPlanetWorkerMessage,
} from 'triangular-engine/worldgen/render/core';
import type { WorldProfileKind } from 'triangular-engine/worldgen';
import { findRunwaySite, runwayHeightStamp, type IRunwaySite, type ModifyElevation } from './runway-site';

/**
 * Plan 063 spike S1: the cell-planet worker with one extra hook. Mesh requests flagged `runwayStamp` get the
 * runway's height stamp through the pipeline's `modifyElevation`; a `runwaySite` message returns the site so the
 * page can drive the material layer from the same numbers. The material tile path is untouched.
 */
export interface IRunwaySiteRequest {
  readonly kind: 'runwaySite';
  readonly id: number;
  readonly radiusM: number;
  readonly heightScaleM: number;
  readonly worldProfile: WorldProfileKind;
  readonly seed: number;
}

export type SpikeWorkerRequest = CellPlanetWorkerMessage | IRunwaySiteRequest;

const sites = new Map<string, IRunwaySite | null>();

function siteFor(request: IRunwaySiteRequest): IRunwaySite | null {
  const key = `${request.worldProfile}:${request.seed}:${request.radiusM}:${request.heightScaleM}`;
  if (!sites.has(key)) {
    const world = defaultCellPlanetWorldCache.getOrCreateWorld(request.worldProfile, request.seed);
    const site = findRunwaySite(
      {
        heightM: (direction) => {
          const sample = world.sampler.sample({ x: direction[0], y: direction[1], z: direction[2] });
          if (sample.isIce) return null;
          const surface = sample.elevation - sample.seaLevel;
          return surface <= 0 ? null : surface * request.heightScaleM;
        },
      },
      request.radiusM,
    );
    sites.set(key, site);
  }
  return sites.get(key) ?? null;
}

addEventListener('message', async ({ data }: MessageEvent<SpikeWorkerRequest>) => {
  if (data.kind === 'runwaySite') {
    postMessage({ id: data.id, runwaySite: siteFor(data) ?? null });
    return;
  }
  let modifyElevation: ModifyElevation | undefined;
  const flagged = data as {
    runwayStamp?: boolean;
    radius?: number;
    radiusM?: number;
    heightScaleM?: number;
    heightScale?: number;
    worldProfile?: WorldProfileKind;
    seed?: number;
  };
  if (flagged.runwayStamp) {
    const site = siteFor({
      kind: 'runwaySite',
      id: 0,
      radiusM: flagged.radiusM ?? flagged.radius ?? 1,
      heightScaleM: flagged.heightScaleM ?? flagged.heightScale ?? 160,
      worldProfile: flagged.worldProfile ?? 'volcanic',
      seed: flagged.seed ?? 1,
    });
    if (site) modifyElevation = runwayHeightStamp(site);
  }
  const { response, transfer } = await handleCellPlanetWorkerMessage(data, {
    buildCellBorderGeometry: buildCellBorderLineGeometry,
    modifyElevation,
  });
  postMessage(response, transfer);
});
