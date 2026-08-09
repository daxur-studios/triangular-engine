# Navigation sub-library

Status: design proposal; no implementation started.

Related plans:

- [011_animals_sublibrary.md](011_animals_sublibrary.md)
- [011a_animals_first_slice_plan.md](011a_animals_first_slice_plan.md)

## Goal

Create a framework-free `triangular-engine/navigation` secondary entry point
for deterministic route planning over large 3D worlds. It should support
vehicles, animals, and crowds without owning their physics, behaviour, tasks,
or rendering.

The design must work for two demanding consumers:

1. **Bruno's Space Program (BSP):** rovers and animal life on large or
   planetary terrain, with player-built bases, roads, terrain modification,
   floating origins, and relatively sparse long-distance movement.
2. **Settlement RTS:** a game in the style of *Black & White 2*, with roads,
   walls, buildings, and terrain changed during play, plus hundreds or
   thousands of villagers repeatedly travelling between tasks.

## Core principle

Navigation is a pipeline, not one universal pathfinding algorithm:

```text
consumer intent
  -> semantic destination
  -> global/region route
  -> local corridor or surface path
  -> local avoidance and steering
  -> consumer movement or physics
```

The library may own route planning and reusable local-navigation mechanisms.
The consumer owns why an agent travels, how it accelerates, and what happens
when it arrives.

## Scope

### Navigation owns

- Traversal profiles such as radius, height, slope, clearance, and domain.
- Read-only queries over consumer-provided navigation data.
- Reachability, route cost, route planning, and partial-route results.
- Hierarchical and cached routing.
- Route invalidation when relevant world data changes.
- Optional local corridor following and dynamic-obstacle avoidance.
- Deterministic query ordering, tie-breaking, and bounded work.
- Debug snapshots and benchmark instrumentation without rendering dependencies.

### Consumers own

- Terrain generation, modification, and coordinate transforms.
- Roads, buildings, walls, water, airspace, doors, and their semantic meaning.
- Agent tasks, destinations, schedules, flocking, and group behaviour.
- Physics integration, acceleration, animation, and collision consequences.
- Deciding when an abandoned or partial route should be retried.
- Supplying navigation-data changes with stable IDs and versions.

## Required environments

The public contracts must not assume a flat world or a single representation.
They should allow:

- Heightfield and mesh terrain.
- Planes, spheres, cylinders, and other world topologies.
- Floating-origin rendering while authoritative navigation coordinates remain
  stable.
- Ground, road, water, flight, and custom traversal domains.
- Static terrain plus incrementally changing obstacles and costs.
- Portals such as gates, bridges, lifts, doors, crossings, and region seams.

Full free-space 3D navigation is significantly more expensive than navigation
over a surface. Flight and swimming should use sparse regions, corridors, or
bounded volumes unless a use case proves dense voxels are necessary.

## Candidate representations

| Approach | Strengths | Limits | Likely use |
| --- | --- | --- | --- |
| Regular terrain grid | Simple, deterministic, easy partial rebuilds | Resolution-dependent; poor on overhangs | Editable heightfield terrain |
| Navigation mesh | Compact paths on irregular surfaces | Generation and dynamic repair are complex | Local ground navigation |
| Waypoint/portal graph | Very small and fast | Needs useful nodes supplied or generated | Roads, doors, regions, migration |
| Sparse voxel/octree | Supports true 3D free space | High memory and generation cost | Bounded air/water spaces |
| Flow field | Very cheap per follower | Expensive per destination; weak for unique goals | RTS crowds sharing goals |
| Hybrid hierarchy | Matches representation to scale/domain | More contracts and integration work | Recommended long-term design |

No single representation should be exposed as the meaning of navigation. The
public query API should allow providers and planners to evolve independently.

## Proposed architecture

### 1. Semantic region graph

A sparse, world-scale graph describes connected regions and portals. It is
suitable for planetary sectors, islands, settlements, roads, gates, bridges,
and water bodies. Global A* or a similar bounded graph search selects a broad
route.

### 2. Local navigation tiles

Loaded areas provide grid, navmesh, or other local navigation tiles. A route
through a region produces a corridor appropriate to the traversal profile.
Tiles are independently versioned so local world edits do not invalidate the
entire world.

### 3. Shared route data

Agents with compatible starts, goals, profiles, and world versions may share
route corridors. RTS agents heading to common task areas should use cached
routes or flow fields rather than each running a full search.

### 4. Local avoidance

Local avoidance handles nearby moving agents and short-lived obstacles. It
must not be expected to repair a globally unreachable route. Candidate
implementations include simple velocity obstacles, ORCA-style avoidance, and
consumer-specific steering adapters.

Local avoidance should be optional because vehicle physics, flock steering,
and dense crowds have different movement constraints.

## Dynamic world changes

Changes should be classified by cost and scope:

- **Cost change:** a road, hazard, crowd, or slope changes preference but not
  connectivity.
- **Local topology change:** a building, wall, gate, crater, or terrain edit
  blocks or opens part of one or more tiles.
- **Regional topology change:** a bridge, tunnel, flood, or large terrain edit
  changes connectivity between regions.

Providers publish changed bounds, stable feature IDs, and version increments.
The navigation layer invalidates only affected tiles, graph edges, cached
routes, and flow fields. Agents whose route remains valid should not replan.

Updates may be asynchronous, but query results must state which world version
they used. While rebuilding, policy must be explicit: retain the previous safe
data, return a partial route, or report that navigation data is unavailable.

## Scaling model

Agent count alone is not a useful performance promise. Cost also depends on
graph size, route length, unique destinations, changing topology, and replans
per second.

Initial planning assumptions on an ordinary desktop CPU:

| Active agents | Feasible strategy |
| ---: | --- |
| 1–10 | Independent routes and frequent replanning are reasonable |
| 100 | Cached hierarchical routes and staggered replanning |
| 1,000 | Shared corridors/flow fields, bounded local avoidance, few new global searches per frame |
| 10,000+ | Region/task-level movement with only nearby agents individually navigated |

These are hypotheses to benchmark, not API guarantees. The first benchmark
suite should measure requests per second and frame-time budget separately from
the number of agents following existing routes.

## Work scheduling and limits

All expensive operations need explicit budgets:

- Maximum expanded nodes per query and per update.
- Maximum milliseconds spent processing a queue per frame.
- Query priority and cancellation.
- Partial, failed, stale, and complete result states.
- Maximum route age or world-version tolerance.
- Staggered replanning with deterministic ordering.

Path following should be cheap enough to run for many agents. Path search,
navigation-data rebuilding, and dense local avoidance are separate budgets.

## Determinism

Given the same navigation data version, query, options, and processing budget,
the planner should produce the same result. Stable IDs and explicit
tie-breakers must be used where costs are equal.

Asynchronous completion time need not be deterministic. Consumers should not
depend on the wall-clock frame in which a route becomes available.

## Proposed minimal public concepts

Names remain provisional.

```ts
type NavigationDomain = 'ground' | 'road' | 'air' | 'water' | string;

interface NavigationVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface TraversalProfile {
  readonly id: string;
  readonly domains: readonly NavigationDomain[];
  readonly radius: number;
  readonly height: number;
  readonly maxSlopeRadians?: number;
  readonly minimumClearance?: number;
}

interface NavigationQuery {
  readonly id: string;
  readonly start: NavigationVector3;
  readonly destination: NavigationVector3;
  readonly profile: TraversalProfile;
  readonly maximumCost?: number;
  readonly maximumExpandedNodes?: number;
  readonly allowPartial?: boolean;
}

interface NavigationRoute {
  readonly queryId: string;
  readonly status: 'complete' | 'partial' | 'unreachable' | 'budget-exceeded';
  readonly points: readonly NavigationVector3[];
  readonly cost: number;
  readonly worldVersion: string | number;
}
```

The first public API should avoid exposing Three.js classes, Angular services,
worker APIs, or a specific grid/navmesh implementation.

## BSP design test

The design succeeds for BSP when:

- A rover can route over large uneven terrain using slope, width, and clearance
  constraints.
- A new base building or terrain edit invalidates only nearby navigation data.
- Roads can lower route cost without forcing all vehicles to use them.
- Planetary and floating-origin coordinates do not corrupt route identity.
- Animal groups can share broad routes while individuals use local steering.
- Unloaded world regions can retain sparse connectivity without full local
  navigation data.

## Settlement RTS design test

The design succeeds for the RTS when:

- Hundreds of villagers travel among homes, resources, workplaces, and storage.
- Roads affect cost and throughput; walls and buildings affect connectivity.
- Placing a wall or opening a gate causes bounded, local invalidation.
- Agents sharing a task destination can use shared corridors or flow fields.
- Different body sizes and traversal permissions can coexist.
- Congestion avoidance does not trigger global replanning every frame.

## First vertical slice

Build a framework-free local-plane proof using editable heightfield terrain:

1. Generate tiled ground navigation data from terrain samples.
2. Route one rover-like agent with radius and maximum-slope constraints.
3. Add and remove one building-sized obstacle and invalidate affected routes.
4. Route 100 agents toward a mixture of shared and unique destinations.
5. Compare individual A*, cached routes, and a flow-field/shared-corridor mode.
6. Visualize routes, expanded nodes, invalid tiles, queue depth, and timings in
   an isolated demo.

The slice does not require spherical worlds, full navmesh generation, flight,
water, doors, or production crowd avoidance. It must leave those additions
possible through the contracts.

## Benchmark matrix

Run fixed-seed scenarios at 1, 100, and 1,000 agents with:

- One shared destination.
- Ten shared destinations.
- Unique destinations.
- No world changes.
- Repeated local obstacle changes.
- One connectivity-breaking wall or gate change.

Record:

- Navigation-data memory.
- Initial build and incremental rebuild time.
- Search latency distribution and expanded nodes.
- Searches completed per second under a fixed budget.
- Route-cache hit rate.
- Per-agent path-following and local-avoidance cost.
- Maximum frame/update time, not only averages.

No agent-count claim should enter public documentation until these benchmarks
exist on named hardware and scenario sizes.

## Implementation order

### Milestone 0: contracts and benchmark fixtures

- Finalize coordinates, versions, traversal profiles, providers, and results.
- Create deterministic synthetic terrain and graph fixtures.
- Add benchmark harnesses before selecting the first planner.

### Milestone 1: tiled ground routing

- Heightfield/grid provider and deterministic bounded A*.
- Route simplification and corridor following.
- Local obstacle insertion and tile-level invalidation.
- One-agent and 100-agent demo scenarios.

### Milestone 2: hierarchy, sharing, and RTS scale

- Region/portal graph above local tiles.
- Route cache and compatible-route sharing.
- Flow-field comparison for common destinations.
- 1,000-agent benchmark with staggered query processing.

### Milestone 3: local avoidance

- Spatial index for nearby agents and obstacles.
- Compare simple steering with velocity-obstacle/ORCA-style approaches.
- Explicit handling of congestion, deadlock, and replanning thresholds.

### Milestone 4: large and planetary worlds

- Sparse unloaded-region connectivity.
- Planetary surface and floating-origin contract proof.
- Rover and animal-group route integration fixture.

### Milestone 5: additional domains

- Road-specific costs and portals.
- Bounded air and connected-water proofs.
- Cross-domain links such as shorelines, ramps, bridges, and gates.

## Decisions recorded

1. The planned public entry point is `triangular-engine/navigation`.
2. Navigation is framework-free and does not own rendering or physics.
3. Global routing, local routing, avoidance, and movement are separate layers.
4. The long-term direction is hybrid and hierarchical rather than one global
   grid, navmesh, or voxel representation.
5. Dynamic changes use scoped invalidation and versioned data.
6. Dense crowds should share route work where destinations are compatible.
7. Surface navigation is the first proof; dense unrestricted 3D voxels are not.
8. Performance claims require reproducible benchmarks and named scenarios.

## Open decisions

- Whether the first local representation should be a grid, polygon navmesh, or
  an abstraction implemented by both.
- Exact authoritative coordinate contract for planetary worlds.
- Whether route planning ships synchronously first or starts with an explicit
  incremental query scheduler.
- Cache keys and compatibility rules for starts near one another.
- How much route smoothing belongs in navigation versus consumer steering.
- Initial congestion and deadlock policy for dense RTS crowds.
- Whether ORCA-style avoidance is suitable for physics-driven rovers.
- Worker ownership, serialization cost, and cancellation semantics.
- Memory and latency budgets for target hardware.

## Change log

### 2026-08-09: initial design

- Defined BSP and a dynamic settlement RTS as the two primary design tests.
- Separated global routing, local routing, avoidance, and consumer movement.
- Selected a hybrid hierarchical direction for investigation.
- Recorded dynamic-world invalidation, deterministic scheduling, scale
  hypotheses, benchmark scenarios, and a staged implementation plan.
