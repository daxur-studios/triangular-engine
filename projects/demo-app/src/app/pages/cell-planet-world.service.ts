import { Injectable } from '@angular/core';
import {
  buildPlanetEcology,
  buildPlanetGraphCore,
  buildPlanetTectonics,
  computeFeatures,
  createPlanetSurfaceSampler,
  deriveIsLand,
  IPlanetSurfaceSampler,
  WorldProfileKind,
  WORLD_PROFILES,
} from 'triangular-engine/worldgen';
import { ICellPlanetMapWorldData } from 'triangular-engine/worldgen/render';
import { CELL_PLANET_GENERATION_DEFAULTS } from './cell-planet-generation-config';

export interface ICellPlanetWorldOptions {
  readonly cellCount: number;
  readonly seed: number;
  readonly relaxationIterations: number;
  readonly worldProfileKind: WorldProfileKind;
  readonly waterLevel?: number;
}

export interface ICellPlanetWorldSnapshot extends ICellPlanetMapWorldData {
  /** Surface without authored cell feature relief, useful for an A/B debug toggle. */
  readonly baseSampler: IPlanetSurfaceSampler;
  /** Canonical surface with the generated cell-owned features applied. */
  readonly featureSampler: IPlanetSurfaceSampler;
  /** Civ-like surface where a generated feature is owned by exactly one Voronoi cell. */
  readonly cellFeatureSampler: IPlanetSurfaceSampler;
  readonly seaLevelElevation: number;
}

/**
 * Owns the shared graph → tectonics → ecology → features pipeline used by the terrain views.
 * Renderer pages decide how to display the snapshot; they do not define a second planet.
 */
@Injectable({ providedIn: 'root' })
export class CellPlanetWorldService {
  #cache = new Map<string, ICellPlanetWorldSnapshot>();

  build(options: ICellPlanetWorldOptions): ICellPlanetWorldSnapshot {
    const waterLevel = options.waterLevel ?? 0;
    const key = [
      options.cellCount,
      options.seed,
      options.relaxationIterations,
      options.worldProfileKind,
      waterLevel,
    ].join(':');
    const cached = this.#cache.get(key);
    if (cached) return cached;

    const profile = WORLD_PROFILES[options.worldProfileKind];
    const graph = buildPlanetGraphCore({
      cellCount: options.cellCount,
      seed: options.seed,
      relaxationIterations: options.relaxationIterations,
      jitter: CELL_PLANET_GENERATION_DEFAULTS.jitter,
    });
    const tectonics = buildPlanetTectonics(graph, {
      plateCount: CELL_PLANET_GENERATION_DEFAULTS.plateCount,
      seed: options.seed,
      ...profile.tectonics,
    });
    const seaLevelElevation = tectonics.seaLevelElevation + waterLevel * 0.3;
    tectonics.seaLevelElevation = seaLevelElevation;
    tectonics.isLand = deriveIsLand(
      graph,
      tectonics.elevation,
      seaLevelElevation,
      profile.tectonics?.minRegionCellFraction,
    );

    const ecology = buildPlanetEcology(graph, tectonics, {
      climate: profile.climate,
      biomes: profile.biomes,
    });
    const features = computeFeatures(graph, tectonics, ecology.waterBodyKind, profile.features);
    const snapshot: ICellPlanetWorldSnapshot = {
      graph,
      tectonics,
      ecology,
      features,
      baseSampler: createPlanetSurfaceSampler(graph, tectonics, ecology),
      featureSampler: createPlanetSurfaceSampler(graph, tectonics, ecology, { features }),
      cellFeatureSampler: createPlanetSurfaceSampler(graph, tectonics, ecology, {
        features,
        featureComposition: 'cell',
      }),
      seaLevelElevation,
    };
    this.#cache.set(key, snapshot);
    // Keep navigation between a few comparison presets fast without retaining every random seed.
    while (this.#cache.size > 4) {
      const oldestKey = this.#cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.#cache.delete(oldestKey);
    }
    return snapshot;
  }
}
