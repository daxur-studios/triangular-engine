import type { ScatterSpeciesDefinition } from './scatter-species-definition';

/**
 * A generation layer groups species that share one fixed identity-cell level
 * and one candidate pool size. Trees and grass are typically separate layers
 * so grass can use a finer cell than trees — see the identity model in
 * docs/runbook/005_scatter_sublibrary.md. The concrete mapping from a layer
 * to a terrain quadtree level lives in the terrain adapter, not here.
 */
export interface ScatterLayerDefinition {
  readonly id: string;
  /** Bumping this is a breaking regeneration — every instance ID in the layer changes. */
  readonly generatorVersion: number;
  /** Upper bound on instances per cell per species; also part of identity (see generatorVersion). */
  readonly candidatePoolSize: number;
  readonly species: readonly ScatterSpeciesDefinition[];
}
