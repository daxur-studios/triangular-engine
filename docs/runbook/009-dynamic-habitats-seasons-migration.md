# Dynamic habitats, seasons, and migration

Status: design direction for the Life Lab POC and future BSP integration.

## Goal

Make life respond to a changing planet without simulating every creature everywhere. The system should remain deterministic at any universal time (UT), support large time warp, and become detailed only where the player can observe or affect it.

## Shared environment model

Terrain, geology, scatter, weather, and life sample the same planetary environment:

`planet position + UT -> climate/weather -> habitat suitability`

Habitat suitability is a continuous score, not just a label. It can include land, water, air, elevation, slope, temperature, rainfall, season, vegetation/food density, and hazards or human changes.

## Species profiles

Each species declares valid habitat and movement model: land animals, fish, birds/insects, people, or vehicles. The profile also supplies animation, scale, culling distance, interaction radius, and persistence importance.

## Migration layers

Long-distance migration is not one detailed path across the planet:

1. A coarse, streamed habitat grid evaluates suitable regions.
2. Sparse macro corridors connect suitable regions and can change with seasons.
3. Local steering handles terrain, water, rocks, roads, buildings, vehicles, and nearby agents.

Closed loops, out-and-back routes, and seasonal routes are corridor policies. A route is regenerated or switched when habitat scores change significantly.

## Time warp and scale

The environment is sampled from UT, so weather and seasonal changes remain coherent at 100x or 1000x. Nearby creatures use detailed simulation; distant populations use cheaper aggregate/state updates. Important agents near the camera, vessel, or player are persisted, while ordinary background life can be reconstructed deterministically from world cell and UT.

## Implementation order

1. Add explicit land, water, and air habitat classifications.
2. Add a small habitat grid and suitability sampler to the Life Lab.
3. Generate a coarse migration corridor between suitable cells.
4. Couple suitability to UT, season, and the existing weather fields.
5. Add local obstacle avoidance and nearby/distant simulation tiers.

The current Life Lab routes remain visual test fixtures until the habitat grid and corridor layer replace them.
