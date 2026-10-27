/// <reference lib="webworker" />

import { buildCellBorderLineGeometry } from 'triangular-engine/worldgen/render';
import {
  defaultCellPlanetWorldCache,
  FlatFeatureSet,
  handleCellPlanetWorkerMessage,
  type CellPlanetWorkerMessage,
  type FlatFeature,
  type ICellPlanetWorkerPipelineOptions,
} from 'triangular-engine/worldgen/render/core';
import { scatterPlanetLatticeTransferables } from 'triangular-engine/scatter';
import type { WorldProfileKind } from 'triangular-engine/worldgen';
import { forestClearance, forestFieldDensity, scatterForest } from './forest-field';
import { scatterRocks } from './rock-field';
import { airfieldFeatures } from './airfield-features';
import { buildingClearance, buildingInstances, placeBuildings, type IBuilding } from './building-field';
import { findRunwaySite, type IRunwaySite, type Vec3 } from './runway-site';

/**
 * Plan 063 spike S1: the cell-planet worker with one extra hook. Mesh requests flagged `flatFeatureStamp` get the
 * library flat-feature height stamp (the airfield and its roads) through the pipeline's `modifyElevation`; a
 * `runwaySite` message returns the site and a `flatFeatures` message the feature list, so the page draws the paint
 * from the same features. The material tile path is untouched.
 */
export interface IRunwaySiteRequest {
  readonly kind: 'runwaySite';
  readonly id: number;
  readonly radiusM: number;
  readonly heightScaleM: number;
  readonly worldProfile: WorldProfileKind;
  readonly seed: number;
}

/** Q1/Q3: instances near `centre` from the library's planet lattice (`scatterPlanetLattice`) at the sampler's ground height. */
export interface IForestScatterRequest {
  readonly kind: 'forestScatter';
  readonly id: number;
  readonly radiusM: number;
  readonly heightScaleM: number;
  readonly worldProfile: WorldProfileKind;
  readonly seed: number;
  readonly centre: Vec3;
  /** Object class: trees (forest field) or rocks (rock field, own seed, cell size and size range). */
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

/** The airfield's flat features (plain data) for the page's material layer. */
export interface IFlatFeaturesRequest extends Omit<IRunwaySiteRequest, 'kind'> {
  readonly kind: 'flatFeatures';
}

/** The test buildings around `site`: their mesh records (`buildingInstances`), from which the page reads the list too. */
export interface IBuildingsRequest {
  readonly kind: 'buildings';
  readonly id: number;
  readonly radiusM: number;
  readonly heightScaleM: number;
  readonly worldProfile: WorldProfileKind;
  readonly seed: number;
  readonly site: IRunwaySite;
  readonly stamp: boolean;
}

export type SpikeWorkerRequest =
  | CellPlanetWorkerMessage
  | IRunwaySiteRequest
  | IFlatFeaturesRequest
  | IForestScatterRequest
  | IForestSpotRequest
  | IBuildingsRequest;

const sites = new Map<string, IRunwaySite | null>();
const featureSets = new Map<string, { features: FlatFeature[]; set: FlatFeatureSet } | null>();
const buildingLists = new Map<string, IBuilding[]>();

/** The building list for a site, placed once per worker: trees and rocks scattered later keep off its footprints. */
function buildingsFor(request: IForestScatterRequest | IBuildingsRequest, site: IRunwaySite): IBuilding[] {
  const key = `${request.worldProfile}:${request.seed}:${request.radiusM}:${request.heightScaleM}:${site.centre.join(',')}`;
  let list = buildingLists.get(key);
  if (!list) {
    list = placeBuildings(site, request.radiusM, groundHeight({ ...request, site }));
    buildingLists.set(key, list);
  }
  return list;
}

/** Natural ground height above the datum in metres at a direction, or `null` over water or ice. */
function naturalHeight(worldProfile: WorldProfileKind, seed: number, heightScaleM: number): (direction: Vec3) => number | null {
  const world = defaultCellPlanetWorldCache.getOrCreateWorld(worldProfile, seed);
  return (direction) => {
    const sample = world.sampler.sample({ x: direction[0], y: direction[1], z: direction[2] });
    if (sample.isIce) return null;
    const surface = sample.elevation - sample.seaLevel;
    return surface <= 0 ? null : surface * heightScaleM;
  };
}

/** The airfield and roads around the site, built once per world; `null` when there is no site. */
function featuresFor(request: Omit<IRunwaySiteRequest, 'kind' | 'id'>): { features: FlatFeature[]; set: FlatFeatureSet } | null {
  const key = `${request.worldProfile}:${request.seed}:${request.radiusM}:${request.heightScaleM}`;
  if (!featureSets.has(key)) {
    const site = siteFor({ ...request, kind: 'runwaySite', id: 0 });
    const features = site ? airfieldFeatures(site, request.radiusM, naturalHeight(request.worldProfile, request.seed, request.heightScaleM)) : null;
    featureSets.set(key, features ? { features, set: new FlatFeatureSet(features, request.radiusM) } : null);
  }
  return featureSets.get(key) ?? null;
}

/** Ground height above the datum in metres at a direction, or `null` over water or ice. */
function groundHeight(request: IForestScatterRequest | IForestSpotRequest | IBuildingsRequest): (direction: Vec3) => number | null {
  const natural = naturalHeight(request.worldProfile, request.seed, request.heightScaleM);
  const set = request.stamp && request.site ? (featuresFor(request)?.set ?? null) : null;
  return (direction) => {
    const heightM = natural(direction);
    return heightM === null || !set ? heightM : set.stampElevation(direction, heightM);
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
    const site = findRunwaySite({ heightM: naturalHeight(request.worldProfile, request.seed, request.heightScaleM) }, request.radiusM);
    sites.set(key, site);
  }
  return sites.get(key) ?? null;
}

addEventListener('message', async ({ data }: MessageEvent<SpikeWorkerRequest>) => {
  if (data.kind === 'runwaySite') {
    postMessage({ id: data.id, runwaySite: siteFor(data) ?? null });
    return;
  }
  if (data.kind === 'flatFeatures') {
    postMessage({ id: data.id, flatFeatures: featuresFor(data)?.features ?? null });
    return;
  }
  if (data.kind === 'forestScatter') {
    const site = data.site;
    const buildings = site ? buildingsFor(data, site) : [];
    const common = {
      centre: data.centre,
      radiusM: data.radiusM,
      areaRadiusM: data.areaRadiusM,
      maxCount: data.maxCount,
      site,
      heightAt: groundHeight(data),
      clearanceAt: (direction: Vec3) => buildingClearance(buildings, site, direction, data.radiusM),
    };
    const scatter =
      data.objectClass === 'rock'
        ? scatterRocks(common)
        : scatterForest({ ...common, spacingM: data.spacingM, densityScale: data.densityScale });
    postMessage({ id: data.id, scatter }, scatterPlanetLatticeTransferables(scatter));
    return;
  }
  if (data.kind === 'buildings') {
    const records = buildingInstances(buildingsFor(data, data.site), data.site, data.radiusM, groundHeight(data));
    postMessage({ id: data.id, buildings: records }, [records.buffer]);
    return;
  }
  if (data.kind === 'forestSpot') {
    postMessage({ id: data.id, forestSpot: forestSpot(data) });
    return;
  }
  let modifyElevation: ICellPlanetWorkerPipelineOptions['modifyElevation'];
  const flagged = data as {
    flatFeatureStamp?: boolean;
    radius?: number;
    radiusM?: number;
    heightScaleM?: number;
    heightScale?: number;
    worldProfile?: WorldProfileKind;
    seed?: number;
  };
  if (flagged.flatFeatureStamp) {
    modifyElevation = featuresFor({
      radiusM: flagged.radiusM ?? flagged.radius ?? 1,
      heightScaleM: flagged.heightScaleM ?? flagged.heightScale ?? 160,
      worldProfile: flagged.worldProfile ?? 'volcanic',
      seed: flagged.seed ?? 1,
    })?.set.heightStamp();
  }
  const { response, transfer } = await handleCellPlanetWorkerMessage(data, {
    buildCellBorderGeometry: buildCellBorderLineGeometry,
    modifyElevation,
  });
  postMessage(response, transfer);
});
