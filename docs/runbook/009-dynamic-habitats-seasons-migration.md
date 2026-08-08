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

Use the numbered acceptance anchors in
[`009_life_sublibrary.md`](009_life_sublibrary.md) as the source of truth. The
next technical slices are:

1. Replace route-led movement with free local steering and species movement
   domains (land, water, air).
2. Add deterministic habitat distribution over streamed cells, including
   camera-visible materialization and species-specific suitability.
3. Add natural activities and transitions: wander, feed, rest, flee, land,
   perch, split, and regroup where applicable.
4. Add presentation/simulation LOD and scale tests; cull insects sooner than
   birds, and birds sooner than large animals.
5. Add player, vessel, vehicle, structure, rock, and hazard observations.
6. Couple suitability to UT, seasons, and weather fields; verify time warp.
7. Add broad destination selection for migration from changing suitability
   fields. Corridors are optional aids, never mandatory visible splines.
8. Add selective persistence, depletion/recovery, predators, death, growth,
   and people only as concrete game consumers require them.

The existing Life Lab paths are temporary debug fixtures. They are not the
target population model and should be removed or isolated once free movement
is in place.
