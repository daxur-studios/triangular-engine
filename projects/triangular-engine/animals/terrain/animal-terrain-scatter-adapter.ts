import type { AnimalHabitatActivity, AnimalHabitatCandidate, AnimalHabitatCandidates, AnimalRoostSite } from 'triangular-engine/animals';
import type { ITerrainScatterInstance } from 'triangular-engine/scatter';

export interface AnimalTerrainScatterSource {
  readonly speciesId: string;
  readonly instances: readonly ITerrainScatterInstance[];
  readonly habitatKind?: string;
  readonly activities?: readonly AnimalHabitatActivity[];
  readonly suitability01?: number;
  readonly obstacleRadiusM?: number;
  readonly blocksLand?: boolean;
  readonly roostCapacity?: number;
}

export interface AnimalTerrainObstacleCandidate {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly radiusM: number;
  readonly surfaceUp: { readonly x: number; readonly y: number; readonly z: number };
  readonly sourceSpeciesId: string;
}

export interface AnimalTerrainScatterAdapterInput {
  readonly habitatVersion: string;
  readonly sources: readonly AnimalTerrainScatterSource[];
  readonly maximumCandidates?: number;
}

export interface AnimalTerrainScatterAdapterResult {
  readonly habitats: AnimalHabitatCandidates;
  readonly obstacles: readonly AnimalTerrainObstacleCandidate[];
  readonly roostSites: readonly AnimalRoostSite[];
}

/**
 * Converts already-generated terrain scatter instances into animal inputs.
 * This is deliberately a data adapter: it has no renderer, physics engine,
 * terrain-domain, or movement policy dependency.
 */
export function adaptTerrainScatterForAnimals(
  input: AnimalTerrainScatterAdapterInput,
): AnimalTerrainScatterAdapterResult {
  if (input.habitatVersion.length === 0) throw new RangeError('Animal scatter habitat version is required.');
  const maximum = input.maximumCandidates ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new RangeError('Animal scatter candidate bound is invalid.');

  const sources = [...input.sources].sort((a, b) => a.speciesId.localeCompare(b.speciesId));
  for (let i = 1; i < sources.length; i++) {
    if (sources[i - 1].speciesId === sources[i].speciesId) throw new RangeError(`Duplicate animal scatter species: ${sources[i].speciesId}`);
  }

  const habitats: AnimalHabitatCandidate[] = [];
  const obstacles: AnimalTerrainObstacleCandidate[] = [];
  const roostSites: AnimalRoostSite[] = [];
  const ids = new Set<string>();
  for (const source of sources) {
    const suitability = source.suitability01 ?? 1;
    if (!Number.isFinite(suitability) || suitability < 0 || suitability > 1) throw new RangeError('Animal scatter suitability must be between zero and one.');
    const radius = source.obstacleRadiusM ?? 0;
    if (!Number.isFinite(radius) || radius < 0) throw new RangeError('Animal scatter obstacle radius must be non-negative.');
    const activities = source.activities ?? ['feed'];
    for (const instance of [...source.instances].sort((a, b) => String(a.instanceId).localeCompare(String(b.instanceId)))) {
      const id = `${source.speciesId}:${String(instance.instanceId)}`;
      if (ids.has(id)) throw new RangeError(`Duplicate animal scatter instance: ${id}`);
      ids.add(id);
      if (habitats.length >= maximum) break;
      const position = { x: instance.worldPositionM[0], y: instance.worldPositionM[1], z: instance.worldPositionM[2] };
      const surfaceUp = { x: instance.surfaceUp[0], y: instance.surfaceUp[1], z: instance.surfaceUp[2] };
      habitats.push({ id, position, kind: source.habitatKind ?? source.speciesId, suitability01: suitability, activities });
      if (source.blocksLand && radius > 0) obstacles.push({ id, position, radiusM: radius, surfaceUp, sourceSpeciesId: source.speciesId });
      if (source.roostCapacity !== undefined) {
        if (!Number.isSafeInteger(source.roostCapacity) || source.roostCapacity < 0) throw new RangeError('Animal scatter roost capacity must be a non-negative safe integer.');
        roostSites.push({ id, position, capacity: source.roostCapacity });
      }
    }
    if (habitats.length >= maximum) break;
  }
  habitats.sort((a, b) => a.id.localeCompare(b.id));
  obstacles.sort((a, b) => a.id.localeCompare(b.id));
  roostSites.sort((a, b) => a.id.localeCompare(b.id));
  return { habitats: { version: input.habitatVersion, candidates: habitats }, obstacles, roostSites };
}
