import { vec3, vec4 } from 'three/tsl';
import { buildCellPlanetLookup, cellPlanetCellColours, cellPlanetWorld, cellPlanetFor } from 'triangular-engine/lod-surface/core';
import { cellLookupLayer, cellVoronoiLayer } from 'triangular-engine/planet-material';
import { buildCellPlanetWorld, findCellAt } from 'triangular-engine/worldgen';
import { evaluateOnGpu } from '../planet-material/gpu-eval.testing';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('terrain ground colours from a cell planet', () => {
  const world = buildCellPlanetWorld({ cellCount: 150, seed: 11 });
  const colours = cellPlanetCellColours(world);
  // A deliberately coarse atlas (32 x 16 texels for 150 cells) so a texel straddles cell edges and the plain lookup is wrong near them.
  const lookup = buildCellPlanetLookup(world, { atlasWidth: 32 });

  const directions = Array.from({ length: 400 }, (_, i) => {
    const a = i * 2.399963;
    const z = 1 - ((i + 0.5) / 400) * 2;
    const r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a), r * Math.sin(a), z] as const;
  });
  const expected = directions.map(([x, y, z]) => {
    const id = findCellAt(world.graph, { x, y, z }).id;
    return [colours[id * 4], colours[id * 4 + 1], colours[id * 4 + 2]];
  });

  async function paint(layerOf: (below: any) => any): Promise<number[][]> {
    const out = await evaluateOnGpu(directions.map((d) => [[d[0], d[1], d[2], 0]]), (at) =>
      vec4(layerOf({ radialDirection: at(0).xyz }).albedo, 1),
    );
    return directions.map((_, i) => [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]]);
  }
  const mismatches = (got: number[][]) => got.filter((rgb, i) => rgb.some((v, k) => Math.abs(v - expected[i][k]) > 2e-3)).length;
  const below = { albedo: vec3(0.2, 0.2, 0.2), roughness: 1, metalness: 0 } as any;

  it('the exact lookup agrees with the nearest-cell search on every direction, on a coarse atlas', async () => {
    const exact = cellVoronoiLayer();
    exact.setLookup(lookup);
    const got = await paint((context) => exact.layer(context, below));
    exact.dispose();
    expect(mismatches(got)).toBe(0);
  });

  it('control: the plain atlas lookup on the same atlas is wrong near cell edges', async () => {
    const plain = cellLookupLayer();
    plain.setLookup(lookup);
    const got = await paint((context) => plain.layer(context, below));
    plain.dispose();
    expect(mismatches(got)).toBeGreaterThan(5);
  });

  it('measures the colour build at the lab\'s size (1,000 cells, default atlas)', () => {
    const labPlanet = cellPlanetFor(10_000);
    const began = performance.now();
    const labWorld = cellPlanetWorld(labPlanet).world;
    const worldMs = performance.now() - began;
    const lookupBegan = performance.now();
    const built = buildCellPlanetLookup(labWorld);
    const lookupMs = performance.now() - lookupBegan;
    const bytes = built.cellIdData.byteLength + built.cellData.byteLength + built.cellCentres.byteLength * (4 / 3) + built.cellNeighbours.byteLength * 2;
    console.log(`[G3 measure] world ${worldMs.toFixed(0)} ms, lookup ${lookupMs.toFixed(0)} ms, atlas ${built.cellIdWidth}x${built.cellIdHeight}, ~${(bytes / 1048576).toFixed(2)} MB`);
    expect(built.cellTextureWidth).toBe(1000);
    expect(lookupMs).toBeLessThan(5000);
  });
});
