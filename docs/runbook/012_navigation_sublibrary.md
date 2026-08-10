# Navigation sub-library

Status: implementation in progress; Milestones 0 and 1 are partially verified.

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

The public contracts must not assume a flat world or use rebased render-space
coordinates as authoritative navigation positions. The first proofs support a
plane and a quad-sphere. The contracts should leave other topologies possible
without implementing them initially.

Every navigation location contains a stable coordinate-frame ID and a position
in that frame. Frames do not move when the renderer rebases. Tiles and regions
have stable IDs, and cache keys quantize positions in tile-local coordinates;
raw floating-point world positions are never route-cache identities. Portals
connect frames or regions and provide the transform needed to cross them.

The design should allow:

- Heightfield and mesh terrain.
- Planes and quad-sphere planetary surfaces initially.
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
| Flow field | Very cheap per follower | Expensive per destination; weak for varied task goals | Experimental hot destinations or army movement |
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
entire world. The first grid representation carries obstacle clearance so
multiple agent radii can share one bake. A later navmesh provider may instead
use profile-specific data.

### 3. Shared route data

Agents with compatible starts, goals, profiles, and world versions may share
route corridors. RTS agents heading to common task areas should primarily use
cached region/portal corridors rather than each running a full search. Flow
fields remain an experiment for unusually hot shared goals.

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

Providers publish changed tile/edge IDs, stable feature IDs, bounds, and
version increments. Routes record the IDs and versions of the tiles and graph
edges they depend on. Cached routes are indexed by those dependencies, while
followers validate the current and look-ahead route segments lazily. A global
world revision is diagnostic context, not a reason to invalidate every route.

If a change leaves an agent inside newly blocked space, following reports
`displaced`. The consumer can stop, move to a provider-supplied nearest valid
location, temporarily ignore the obstacle, or reconstruct the agent.
Navigation must not silently choose gameplay policy.

Updates and searches use an asynchronous incremental queue from the first
slice. Query results state the data revisions they used. While rebuilding,
policy must be explicit: retain the previous safe data, return a partial
route, or report that navigation data is unavailable.

The planner consumes immutable, serializable navigation tiles and graph
snapshots plus incremental change sets. Terrain sampling and nav-data baking
are separate adapters. The core planner does not retain arbitrary callbacks,
which allows the same data to run on the main thread or cross a worker boundary
using transferable buffers.

## Scaling model

Agent count alone is not a useful performance promise. Cost also depends on
graph size, route length, unique destinations, changing topology, and replans
per second.

Initial planning assumptions on an ordinary desktop CPU:

| Active agents | Feasible strategy |
| ---: | --- |
| 1–10 | Independent routes and frequent replanning are reasonable |
| 100 | Cached hierarchical routes and staggered replanning |
| 1,000 | Shared corridors, bounded local avoidance, few new global searches per frame |
| 10,000+ | Out of scope for individual navigation; use region/task-level simulation and navigate only nearby agents |

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
Node/work-unit budgets determine reproducible query results. Millisecond frame
caps only control when queued work completes and are not deterministic across
machines; the library does not promise simulation-level lockstep timing.

## Determinism

Given the same navigation data version, query, options, and processing budget,
the planner should produce the same result. Stable IDs and explicit
tie-breakers must be used where costs are equal.

Asynchronous completion time need not be deterministic. Consumers should not
depend on the wall-clock frame in which a route becomes available. Cross-machine
lockstep is not a v1 requirement; cost functions should nevertheless avoid
unnecessary engine-sensitive transcendental math.

## Proposed minimal public concepts

Names remain provisional.

```ts
type NavigationDomain = 'ground' | 'road' | 'air' | 'water' | string;

interface NavigationVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface NavigationLocation {
  readonly frameId: string;
  readonly position: NavigationVector3;
}

type NavigationGoal =
  | { readonly kind: 'point'; readonly location: NavigationLocation }
  | { readonly kind: 'any-of'; readonly locations: readonly NavigationLocation[] }
  | { readonly kind: 'region'; readonly regionId: string }
  | { readonly kind: 'adjacent-to'; readonly featureId: string; readonly range: number };

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
  readonly start: NavigationLocation;
  readonly goal: NavigationGoal;
  readonly profile: TraversalProfile;
  readonly maximumCost?: number;
  readonly maximumExpandedNodes?: number;
  readonly allowPartial?: boolean;
}

interface NavigationDependency {
  readonly id: string;
  readonly version: number;
}

interface NavigationRouteSegment {
  readonly from: NavigationLocation;
  readonly to: NavigationLocation;
  readonly domain: NavigationDomain;
  readonly tileId?: string;
  readonly portalId?: string;
  readonly corridorWidth?: number;
  readonly surfaceNormal?: NavigationVector3;
}

interface NavigationRoute {
  readonly queryId: string;
  readonly status: 'complete' | 'partial' | 'unreachable' | 'budget-exceeded';
  readonly segments: readonly NavigationRouteSegment[];
  readonly dependencies: readonly NavigationDependency[];
  readonly cost: number;
}

interface NavigationDataChangeSet {
  readonly upsertedTiles: readonly NavigationTileSnapshot[];
  readonly removedTileIds: readonly string[];
  readonly upsertedEdges: readonly NavigationEdgeSnapshot[];
  readonly removedEdgeIds: readonly string[];
}

interface NavigationDataStore {
  apply(changeSet: NavigationDataChangeSet): void;
  enqueue(query: NavigationQuery): NavigationRequestHandle;
  queryReachability(query: NavigationReachabilityQuery): NavigationRequestHandle;
  process(workBudget: number): readonly NavigationResult[];
}
```

The first public API should avoid exposing Three.js classes, Angular services,
worker APIs, or a specific grid/navmesh implementation. Snapshot, edge,
request, and result schemas will be fixed in Milestone 0. Public string IDs are
mapped to compact numeric handles in planner hot paths to avoid repeated string
comparison and allocation.

Routes are corridors, not bare polylines. Local providers project and smooth
paths on their surface, using funnel/string-pulling or an equivalent quality
step where the representation supports it. Portal segments tell consumers
when a door, gate, bridge, shoreline, or frame transition is crossed.

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
- Roads affect cost and traffic distribution; walls and buildings affect
  connectivity.
- Placing a wall or opening a gate causes bounded, local invalidation.
- Agents sharing compatible task routes can use cached portal corridors.
- Different body sizes and traversal permissions can coexist.
- Congestion avoidance does not trigger global replanning every frame.

Throughput is not promised by static routing. A later optional dynamic-cost
overlay may publish congestion costs at a deliberately slower cadence; local
avoidance owns immediate crowd separation.

## First vertical slice

Build a framework-free local-plane proof using editable heightfield terrain:

1. Generate tiled ground navigation data from terrain samples.
2. Route one rover-like agent with radius and maximum-slope constraints.
3. Add and remove one building-sized obstacle and invalidate affected routes.
4. Route 100 agents toward a mixture of shared and unique destinations.
5. Compare individual A* with cached/shared region corridors; record flow
   fields only as an optional experiment.
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
- Small, medium, and large tile/region graphs.
- No world changes.
- Repeated local obstacle changes.
- One connectivity-breaking wall or gate change.
- A connectivity break while 1,000 agents are travelling, producing a bounded
  replan storm.

Record:

- Navigation-data memory.
- Initial build and incremental rebuild time.
- Search latency distribution and expanded nodes.
- Searches completed per second under a fixed budget.
- Route-cache hit rate.
- Per-agent path-following and local-avoidance cost.
- Maximum frame/update time, not only averages.
- Allocation rate and garbage-collection pauses.
- Snapshot/change-set transfer or structured-clone cost when a worker is used.

No agent-count claim should enter public documentation until these benchmarks
exist on named hardware and scenario sizes.

The first benchmark harness is now part of the navigation entry point. It
generates seeded scenarios for 1, 100, and 1,000 agents and reports completed,
partial, unreachable, and budget-exceeded routes plus expanded nodes, cost, and
elapsed time. It is a measurement tool, not a performance guarantee.

## Implementation order

### Milestone 0: contracts and benchmark fixtures

**Status: checkpoint verified — implementation scaffold only.** The entry point now
exports serializable contracts, a deterministic bounded-work queue, and fixed
synthetic fixtures. The library build passing only confirms that this scaffold
compiles and packages; it does not mean pathfinding is implemented. This
checkpoint is verified by `npm run test:triangular-engine:navigation`, which
passes 3 headless tests. It intentionally includes no pathfinder.

- Finalize coordinates, versions, traversal profiles, providers, and results.
- Finalize asynchronous queueing, dependency validation, multi-goal and
  reachability queries, and serializable snapshot/change-set schemas.
- Create deterministic synthetic terrain and graph fixtures.
- Add benchmark harnesses before selecting the first planner.

Human checkpoint command:

```text
npm run test:triangular-engine:navigation
npm run build:triangular-engine
```

### Milestone 1: tiled ground routing

**Status: in progress — coordinate contract and local A* proof locked.**
Navigation locations use finite coordinates local to a named frame. The first
terrain provider is Y-up, with X/Z as horizontal axes; renderer rebasing must
not change route identity. Cross-frame calculations are rejected. The current
grid proof routes around blocked cells, enforces clearance and slope limits,
and returns `budget-exceeded` rather than doing unbounded work. Immutable
versioned cell changes invalidate dependent routes without invalidating every
route in the world.

- Heightfield/grid provider and deterministic bounded A*.
- Route simplification and corridor following.
- Local obstacle insertion and tile-level invalidation.
- One-agent and 100-agent demo scenarios.

### Milestone 2: hierarchy, sharing, and RTS scale

**Status: not started.** The next implementation slice is a shared-destination
goal field, which is an early proof of route sharing but is not yet the full
region/portal hierarchy or route cache.

- Region/portal graph above local tiles.
- Route cache and compatible-route sharing.
- Optional flow-field experiment for one hot destination.
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
9. Stable frame-relative locations, tile-local quantization, and portal
   transforms are the initial coordinate contract.
10. Planning starts with an asynchronous incremental work queue over immutable,
    serializable navigation snapshots and change sets.
11. Routes carry versioned dependencies and corridor/portal segments.
12. Point, multi-point, region, adjacency, and reachability queries are v1
    requirements.
13. The first grid uses a clearance field for multiple agent radii.

## Open decisions

- Whether the first local representation should be a grid, polygon navmesh, or
  an abstraction implemented by both.
- Cache keys and compatibility rules for starts near one another.
- How much route smoothing belongs in navigation versus consumer steering.
- Initial congestion and deadlock policy for dense RTS crowds.
- Whether ORCA-style avoidance is suitable for physics-driven rovers.
- Whether the initial queue runs on the main thread, a worker, or supports both;
  cancellation and serialization semantics remain to be measured.
- Memory and latency budgets for target hardware.

## Change log

### 2026-08-09: initial design

- Defined BSP and a dynamic settlement RTS as the two primary design tests.
- Separated global routing, local routing, avoidance, and consumer movement.
- Selected a hybrid hierarchical direction for investigation.
- Recorded dynamic-world invalidation, deterministic scheduling, scale
  hypotheses, benchmark scenarios, and a staged implementation plan.

### 2026-08-09: architecture review

- Made stable coordinate frames and tile-local cache quantization mandatory.
- Chose serializable snapshots, incremental change sets, and an asynchronous
  bounded-work queue as Milestone 0 contracts.
- Added route dependency versions, lazy look-ahead validation, displaced-agent
  reporting, richer corridor segments, multi-goal queries, and reachability.
- Made cached portal corridors the primary RTS sharing strategy and demoted
  flow fields to an experiment.
- Added map-size, replan-storm, allocation/GC, and worker-transfer benchmarks.
- Narrowed initial topology support to a plane and quad-sphere while preserving
  extensibility for later domains.
