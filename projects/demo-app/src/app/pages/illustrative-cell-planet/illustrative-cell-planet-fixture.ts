import { Color } from 'three';
import {
  buildCellPlanetWorld,
  createPlanetSurfaceSampler,
  type IVec3,
} from 'triangular-engine/worldgen';
import { buildCellPerPixelLookupPayload } from 'triangular-engine/worldgen/render';

export type IllustrativeLandmark =
  | 'lowland'
  | 'mountain'
  | 'volcano'
  | 'coast'
  | 'seam'
  | 'north-pole';
export type IllustrativeStyle = 'cell-features' | 'illustrative';
export const ILLUSTRATIVE_FIXTURE = {
  cellCount: 600,
  seed: 71,
  relaxationIterations: 2,
  jitter: 0.15,
  plateCount: 10,
  worldProfileKind: 'volcanic',
} as const;
export const ILLUSTRATIVE_RADIUS_M = 600_000;
export const ILLUSTRATIVE_HEIGHT_SCALE_M = 12_000;

/** One graph and palette for both styles. Anchors are resolved by feature identity, never a silent fallback. */
export function buildIllustrativeFixture() {
  const startedAt = performance.now();
  const world = buildCellPlanetWorld(ILLUSTRATIVE_FIXTURE);
  const illustratedSampler = createPlanetSurfaceSampler(
    world.graph,
    world.tectonics,
    world.ecology,
    {
      features: world.features,
      illustrativeTerrain: { version: 1, kind: 'illustrative' },
    },
  );
  const land = world.graph.cells.filter((c) => world.tectonics.isLand[c.id]);
  const volcanoId = world.features.instances.find(
    (f) => f.kind === 'volcano',
  )?.siteCellId;
  if (volcanoId === undefined)
    throw new Error('Illustrative fixture has no generated volcano.');
  const lowland = [...land]
    .filter(
      (c) =>
        !world.features.featureByCellId.has(c.id) &&
        !['alpine', 'hills', 'canyon'].includes(world.ecology.biome[c.id]),
    )
    .sort(
      (a, b) =>
        world.tectonics.elevation[a.id] - world.tectonics.elevation[b.id],
    )[Math.floor(land.length * 0.1)];
  const mountain = land
    .filter(
      (c) =>
        world.ecology.biome[c.id] === 'alpine' &&
        !world.features.featureByCellId.has(c.id),
    )
    .sort(
      (a, b) =>
        world.tectonics.elevation[b.id] - world.tectonics.elevation[a.id],
    )[0];
  const coast = land.find((c) =>
    c.neighbors.some((n) => !world.tectonics.isLand[n]),
  );
  if (!lowland || !mountain || !coast)
    throw new Error('Illustrative fixture lacks a required landform anchor.');
  const anchors: Record<IllustrativeLandmark, IVec3> = {
    lowland: lowland.center,
    mountain: mountain.center,
    volcano: world.graph.cells[volcanoId].center,
    coast: coast.center,
    seam: { x: 0, y: 0, z: -1 },
    'north-pole': { x: 0, y: 1, z: 0 },
  };
  const palette = new Float32Array(world.graph.cells.length * 4);
  for (const cell of world.graph.cells) {
    const biome = world.ecology.biome[cell.id];
    const colour = new Color(
      !world.tectonics.isLand[cell.id]
        ? '#125c88'
        : biome === 'desert' || biome === 'savanna'
          ? '#b6a26a'
          : biome === 'ice_cap'
            ? '#d6e5e8'
            : '#809959',
    );
    colour.multiplyScalar(0.93 + ((cell.id * 17) % 13) / 100);
    palette.set([colour.r, colour.g, colour.b, 1], cell.id * 4);
  }
  const lookup = buildCellPerPixelLookupPayload(world.graph, palette, {
    cellIdWidth: 2048,
    cellIdHeight: 1024,
  });
  return {
    world,
    illustratedSampler,
    anchors,
    lookup,
    generationMs: performance.now() - startedAt,
    startedAt,
    anchorCellIds: {
      lowland: lowland.id,
      mountain: mountain.id,
      volcano: volcanoId,
      coast: coast.id,
    },
  };
}
