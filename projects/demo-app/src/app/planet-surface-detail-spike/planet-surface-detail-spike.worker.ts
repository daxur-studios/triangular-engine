/// <reference lib="webworker" />

import { buildCellBorderLineGeometry } from 'triangular-engine/worldgen/render';
import {
  defaultCellPlanetWorldCache,
  handleCellPlanetWorkerMessage,
  type CellPlanetWorkerMessage,
} from 'triangular-engine/worldgen/render/core';
import type { WorldProfileKind } from 'triangular-engine/worldgen';
import { forestClearance, forestFieldDensity, scatterForest } from './forest-field';
import { scatterRocks } from './rock-field';
import { findRunwaySite, runwayHeightStamp, type IRunwaySite, type ModifyElevation, type Vec3 } from './runway-site';

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

/** Q1/Q3: instances for the forest near `centre`, scattered from the density field at the sampler's ground height. */
export interface IForestScatterRequest {
  readonly kind: 'forestScatter';
  readonly id: number;
  readonly radiusM: number;
  readonly heightScaleM: number;
  readonly worldProfile: WorldProfileKind;
  readonly seed: number;
  readonly centre: Vec3;
  /** Object class: trees (forest field) or rocks (rock field, own seed and spacing). */
  readonly objectClass: 'tree' | 'rock';
  readonly areaRadiusM: number;
  readonly spacingM: number;
  /** Instance buffer size: the nearest this many are kept, so a shortfall is lost at the window's far edge. */
  readonly maxCount: number;
  readonly densityScale: number;
  readonly site: IRunwaySite | null;
  /** Ground carries the runway stamp (the mesh does), so trees at the plateau stand on it. */
  readonly stamp: boolean;
}

/** Q1/Q3: the nearest solid forest to `site`, for the camera presets. */
export interface IForestSpotRequest {
  readonly kind: 'forestSpot';
  readonly id: number;
  readonly radiusM: number;
  readonly heightScaleM: number;
  readonly worldProfile: WorldProfileKind;
  readonly seed: number;
  readonly site: IRunwaySite;
  readonly densityScale: number;
  readonly stamp: boolean;
}

export type SpikeWorkerRequest = CellPlanetWorkerMessage | IRunwaySiteRequest | IForestScatterRequest | IForestSpotRequest;

const sites = new Map<string, IRunwaySite | null>();

/** Ground height above the datum in metres at a direction, or `null` over water or ice. */
function groundHeight(request: IForestScatterRequest | IForestSpotRequest): (direction: Vec3) => number | null {
  const world = defaultCellPlanetWorldCache.getOrCreateWorld(request.worldProfile, request.seed);
  const stamp = request.stamp && request.site ? runwayHeightStamp(request.site) : null;
  return (direction) => {
    const sample = world.sampler.sample({ x: direction[0], y: direction[1], z: direction[2] });
    if (sample.isIce) return null;
    const surface = sample.elevation - sample.seaLevel;
    if (surface <= 0) return null;
    const heightM = surface * request.heightScaleM;
    return stamp ? stamp(direction, heightM, request.radiusM) : heightM;
  };
}

function forestSpot(request: IForestSpotRequest): { centre: Vec3; heightM: number } | null {
  const ground = groundHeight(request);
  const { site, radiusM } = request;
  const at = (a: number, b: number): Vec3 => {
    const x = site.centre[0] + (site.along[0] * a + site.across[0] * b) / radiusM;
    const y = site.centre[1] + (site.along[1] * a + site.across[1] * b) / radiusM;
    const z = site.centre[2] + (site.along[2] * a + site.across[2] * b) / radiusM;
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  };
  const density = (direction: Vec3): number => {
    const heightM = ground(direction);
    if (heightM === null) return 0;
    const r = radiusM + heightM;
    return Math.min(forestFieldDensity(direction[0] * r, direction[1] * r, direction[2] * r, heightM) * request.densityScale, 1) * forestClearance(site, direction, radiusM);
  };
  for (let distance = 400; distance <= 20_000; distance += 250) {
    for (let k = 0; k < 24; k += 1) {
      const angle = (k / 24) * Math.PI * 2;
      const centre = at(Math.cos(angle) * distance, Math.sin(angle) * distance);
      // Solid forest all round: 8 points on a 300 m ring and the centre.
      let ok = density(centre) >= 0.98;
      for (let m = 0; ok && m < 8; m += 1) {
        const a = (m / 8) * Math.PI * 2;
        const around: Vec3 = [
          centre[0] + (site.along[0] * Math.cos(a) * 300 + site.across[0] * Math.sin(a) * 300) / radiusM,
          centre[1] + (site.along[1] * Math.cos(a) * 300 + site.across[1] * Math.sin(a) * 300) / radiusM,
          centre[2] + (site.along[2] * Math.cos(a) * 300 + site.across[2] * Math.sin(a) * 300) / radiusM,
        ];
        ok = density(around) >= 0.6;
      }
      const heightM = ground(centre);
      if (ok && heightM !== null) return { centre, heightM };
    }
  }
  return null;
}

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
  if (data.kind === 'forestScatter') {
    const common = { centre: data.centre, radiusM: data.radiusM, areaRadiusM: data.areaRadiusM, maxCount: data.maxCount, site: data.site, heightAt: groundHeight(data) };
    const { instances, accepted } =
      data.objectClass === 'rock'
        ? scatterRocks(common)
        : scatterForest({ ...common, spacingM: data.spacingM, densityScale: data.densityScale });
    postMessage({ id: data.id, trees: instances, accepted }, [instances.buffer]);
    return;
  }
  if (data.kind === 'forestSpot') {
    postMessage({ id: data.id, forestSpot: forestSpot(data) });
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
