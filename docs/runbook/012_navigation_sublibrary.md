# Navigation sub-library

Status: core M1/M2 implementation checkpoints complete; M3 visual verification
demo in progress; planetary work remains planned.

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

Static traversal capability and live congestion behaviour are separate
concerns. A radius or slope limit can determine whether a route is feasible,
but it cannot determine whether an agent should squeeze past another agent,
reverse, queue, retreat, or choose another route. Those decisions require an
explicit strategy boundary rather than one universal avoidance policy.

## Scope

### Navigation owns

- Traversal profiles such as radius, height, slope, clearance, and domain.
- Read-only queries over consumer-provided navigation data.
- Reachability, route cost, route planning, and partial-route results.
- Hierarchical and cached routing.
- Route invalidation when relevant world data changes.
- Optional local corridor following and dynamic-obstacle avoidance.
- Bounded congestion observations, recovery actions, and reusable strategy
  presets without assuming that every agent behaves like a pedestrian.
- Deterministic query ordering, tie-breaking, and bounded work.
- Debug snapshots and benchmark instrumentation without rendering dependencies.

### Consumers own

- Terrain generation, modification, and coordinate transforms.
- Roads, buildings, walls, water, airspace, doors, and their semantic meaning.
- Agent tasks, destinations, schedules, flocking, and group behaviour.
- Physics integration, acceleration, animation, and collision consequences.
- Deciding when an abandoned or partial route should be retried.
- Selecting or supplying gameplay-specific congestion strategy, urgency,
  social rules, and collision consequences.
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

### 5. Capability and congestion strategy boundary

Navigation must not tune one local-avoidance simulation and present it as the
answer for every agent type. The local layer should expose a bounded,
deterministic observation of progress, nearby occupancy, route validity, and
available recovery targets. A pluggable strategy then selects an intent such
as `continue`, `wait`, `yield`, `retreat`, `replan`, or `blocked`.

Two profiles remain distinct:

- A traversal profile describes where an agent can physically plan: radius,
  height, clearance, slope, domains, and similar static constraints.
- A movement/recovery profile describes how an agent responds while following
  a route: whether it can squeeze, sidestep, reverse, wait, use passing space,
  or accept an alternative route.

Consumer strategies may use gameplay facts such as urgency or social role,
but receive navigation observations and return navigation intents rather than
mutating planner state. Built-in strategies are defaults and examples, not a
claim that the library owns human, vehicle, or animal behaviour. The strategy
hook belongs to local following/recovery orchestration and must not introduce
arbitrary callbacks into immutable planner snapshots or route-cache keys.

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

**Status: historical checkpoint superseded by M1/M2.** The entry point exports
serializable contracts, a deterministic bounded-work queue, and fixed synthetic
fixtures. Pathfinding is now implemented in the later milestones below.

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

**Status: core checkpoint complete — local plane tile proof verified.**
Navigation locations use finite coordinates local to a named frame. The first
terrain provider is Y-up, with X/Z as horizontal axes; renderer rebasing must
not change route identity. Cross-frame calculations are rejected. The current
grid proof routes around blocked cells, enforces clearance and slope limits,
and returns `budget-exceeded` rather than doing unbounded work. Immutable
versioned cell changes invalidate dependent routes without invalidating every
route in the world.

- Heightfield/grid provider and deterministic bounded A*.
- Route simplification; corridor following remains a consumer/integration step.
- Local obstacle insertion and tile-level invalidation.
- One-agent and 100-agent benchmark scenarios.

The current implementation treats each immutable heightfield grid as a local
tile snapshot. Route simplification is available through
`simplifyNavigationGridRoute()`. A visual demo and multi-tile provider
composition remain integration work; spherical navigation is not implemented.

### Milestone 2: hierarchy, sharing, and RTS scale

**Status: core checkpoint complete — headless proof verified.** The library now
has a deterministic region/portal graph route, dependency-aware route cache,
and shared-destination goal field. One reverse search can serve many compatible
agents, and the 100-agent test compares shared extraction with independent A*.
The 1,000-agent harness exists for measurement; this is not a claim of a fixed
frame-rate limit or completed local avoidance.

- Region/portal graph above local tiles.
- Route cache and compatible-route sharing.
- Optional flow-field experiment for one hot destination — deferred.
- 1,000-agent benchmark harness — available; staggered runtime processing is deferred.

Human verification checkpoint for the current M1/M2 core:

```text
npm run test:triangular-engine:navigation
npm run build:triangular-engine
```

Expected navigation result: 19 headless tests pass. This proves the current
library contracts, local routing, dynamic invalidation, shared-goal extraction,
region routing, cache invalidation, and benchmark fixtures. It does not prove
spherical, navmesh, worker, or local-avoidance support.

### Milestone 3: visual verification demo

**Status: integration checkpoint complete — demo build verified.** The demo page
at `/navigation-lab` uses the real heightfield grid and A* APIs. It shows the
same route as a flat plane or height-varied terrain, supports deterministic seed
changes, and lets a human toggle obstacle editing and click cells to trigger
versioned grid changes and route recalculation. An optional navigation-data
overlay exposes blocked, clearance-limited, slope-limited, and walkable cells
  using the active rover profile.

M3 was manually verified on the navigation lab: flat and height-varied views
show the same route, seed changes are reproducible, obstacle edits trigger
versioned recalculation, and the navigation-data overlay distinguishes blocked,
clearance-limited, slope-limited, and walkable cells. A goal-slope regression
was also fixed and covered by the headless navigation tests.

Human verification checklist:

- Open `/navigation-lab` from the Examples page.
- Switch between Flat plane and 3D terrain; the blue route remains coherent.
- Enable Edit obstacles and click a walkable cell; the route or status changes.
- Reset seed, then Change seed; terrain and obstacles change deterministically.
- Confirm the status, route-cell count, and expanded-node count update.
- Enable Show nav data; confirm blocked, clearance, slope, and walkable cells
  are visually distinguishable when a route is absent or unexpected.

Build checkpoint:

```text
npx ng build demo-app --configuration development
```

### Milestone 4: local avoidance

**Status: baseline API and visual checkpoint in progress.** M4 starts with a ground-layer
baseline: a deterministic uniform spatial index and separation steering. It
does not guarantee collision-free movement and does not replace route planning.

- M4.1: spatial index for nearby agents and circular obstacles.
- M4.2: deterministic separation steering with speed clamping.
- M4.3: visual crossing/congestion demo with eight agents travelling in both
  directions on the real route; the demo now exposes agent positions and
  steering through the avoidance API.
- M4.4: compare the baseline with velocity-obstacle/ORCA-style steering before
  selecting an approach for dense RTS crowds. The library now has a bounded,
  deterministic velocity-obstacle-style candidate sampler; full ORCA remains a
  measured option rather than an assumed dependency.
- M4.5: define congestion, deadlock, local-replan, and global-replan thresholds.
  `classifyNavigationAvoidanceState()` now provides the explicit baseline state
  policy.
- M4.6: define the capability/recovery strategy contract and one deterministic
  queue-and-yield baseline. Stop tuning the existing crowd fixture as a
  universal solution.
- M4.7: turn the visual lab into a scenario harness with pedestrian, vehicle,
  and animal-oriented profiles and repeatable congestion fixtures.
- M4.8: add congestion-aware alternative-route recovery and then evaluate
  bottleneck reservations or directional traffic as separate coordination
  policies.

M4.6 implementation checkpoint: `navigation-strategy.ts` now exports the
framework-free `NavigationRecoveryStrategy` contract, bounded observations,
recovery actions, and `createNavigationQueueYieldStrategy()`. The baseline
queues lower-priority agents behind right-of-way traffic, returns stable
staggered retry delays, and escalates to an alternative route, retreat, or
explicit blockage when its wait budget is exhausted. It does not yet wire
those decisions into the visual lab; that is the next integration slice.

M4.6 demo integration checkpoint: `/navigation-lab` now offers `Queue / yield`
and `Baseline` recovery modes. Queue/yield mode uses the strategy for the
narrow-corridor fixture, sends lower-priority agents to deterministic holding
targets behind the blocker, keeps them there for staggered retry intervals, and
reports queued agents separately from yielding and stuck agents. The baseline
remains available as an A/B comparison. This is still a visual proof fixture,
not the final generic bottleneck coordinator.

M4.6 manual verification:

- Open `/navigation-lab`, enable avoidance, and select `Narrow corridor`.
- Select `Queue / yield`, then test 8 and 16 agents with velocity-obstacle
  mode.
- Confirm the HUD shows a non-zero `queued` count when the corridor is full.
- Confirm queued agents move back from the choke point to holding positions,
  remain there, and retry at visibly different times rather than all reversing
  and restarting together.
- Switch to `Baseline` and confirm the previous local-avoidance behaviour is
  still available for comparison.
- Confirm a genuinely full corridor remains blocked; queueing does not move
  agents through occupied space.

Human checkpoint for M4.1/M4.2:

```text
npm run test:triangular-engine:navigation
npm run build:triangular-engine
```

Expected result: nearby queries exclude distant objects and return stable ID
ordering; overlapping agents and obstacles produce a bounded steering velocity.
This does not yet prove collision guarantees, ORCA suitability, or 1,000-agent
runtime performance.

M4.4/M4.5 design decision checkpoint:

| Approach | Strength | Limitation | Current role |
| --- | --- | --- | --- |
| Separation steering | Very cheap and simple | Can oscillate or deadlock | Default baseline |
| Velocity-obstacle sampling | Predicts short-horizon conflicts and is bounded | Candidate quality depends on samples | Current comparison experiment |
| ORCA-style half-planes | Stronger reciprocal crowd behaviour | More complex and needs careful edge-case policy | Defer until benchmark evidence |

State policy: temporary low-speed response is `yielding`; no progress beyond
0.25 seconds is `stuck`; no progress or blocking beyond 1 second requests a
local replan; 3 seconds requests a global replan. Thresholds are configurable
and are defaults for the first proof, not universal gameplay values.

The avoidance benchmark now measures spatial queries and baseline steering for
1, 100, and 1,000-agent fixtures. Record results on named target hardware
before making any frame-time or agent-count claim.

M4.3 manual verification:

- Open `/navigation-lab` and click Run avoidance demo.
- Confirm orange and purple agents move in opposite directions and visibly
  separate when they approach one another.
- Adjust the avoidance-strength slider: `0` disables separation steering, while
  higher values apply stronger separation.
- Switch between Flat plane and 3D terrain while the demo is running.
- Edit an obstacle, reset the seed, and change the seed; confirm the route and
  agent simulation rebuild without errors.

**Manual checkpoint result: verified.** The avoidance-strength control was tested
at `0`, `1`, `5`, and `10`; stronger values made separation visibly clearer.
The visual lab remains a demonstration of bounded local steering, not a proof
of zero overlap or collision-free movement.

M4.4 implementation checkpoint: the lab now has a mode selector for the
velocity-obstacle sampler and runs it against the same route and eight-agent
scenario as separation steering. This is still a bounded experiment, not full
ORCA and not a collision guarantee.

M4.4 manual verification:

- Run the demo with `Separation`, then switch to `Velocity obstacle`.
- Use the same seed, route, eight agents, and avoidance-strength setting.
- Compare visible overlap, jitter, sticking, and whether agents make progress.
- Record which mode is the better default; do not decide from one seed only.

**Manual checkpoint result: verified.** Across the visual comparison, the
velocity-obstacle mode began avoidance earlier and produced cleaner crossings;
the separation baseline tended to react later, closer to contact. Keep
separation as the cheap baseline and continue evaluating velocity-obstacle
steering as the preferred crowd-demo approach across more seeds.

M4.5 implementation checkpoint: the visual lab now classifies each agent as
moving, yielding, stuck, local-replan, or global-replan. It shows state counts
and replan totals. Local recovery first requests a bounded A* repair route from
the agent's current cell to its current endpoint, treating dynamic congestion
as temporarily blocked cells. If no repair route exists, it performs a short,
bounded back-off before the global fallback. Global recovery returns the agent
to its nearest route waypoint. These are bounded demo recovery actions, not yet
a production crowd-routing service or a guarantee that a fully occupied
corridor can clear. The lab also provides a
named narrow-corridor fixture and an agent-count control so congestion can be
reproduced without editing or invalidating the terrain route. The fixture
barriers are rendered as gold circles, and the lab has a 0.25x–4x
simulation-speed control for observation.

M4.5 manual verification:

- Run the avoidance demo and confirm the state counts are visible.
- Select `Narrow corridor`, then try 4, 8, and 16 agents.
- Confirm the gold corridor barriers are visible in both flat and terrain views.
- Adjust simulation speed to inspect slow interactions or quickly reach a
  recovery state.
- Increase avoidance strength to create a crowded crossing.
- Confirm agents can enter yielding/stuck states and that replan totals remain
  visible.
- Treat recovery as a behavioural checkpoint, not a guarantee yet: some agents
  should recover, while L-shaped corners and heavily packed groups may remain
  stuck. Confirm normal movement does not continuously trigger replans.

**Manual checkpoint result: verified with known limitations.** At 16 agents,
the narrow corridor can produce full blockage and artery-like accumulation.
Some agents recover, while others remain trapped at L-shaped corners or inside
dense groups. This validates the congestion/deadlock fixture and exposes the
remaining limitation of local steering: it cannot reliably escape every
corner or solve a fully occupied corridor. The repair-route slice now exists.
A second recovery layer now gives agents a stable priority/yield order,
progressively wider escape searches, and an increasing cooldown between failed
replans. Agents with no available escape remain visibly stuck rather than
oscillating through unlimited replan attempts.

M4.5 is complete as a diagnostic and mechanism proof, not as a universal
congestion solution. Its completion criteria are explicit state transitions,
bounded recovery work, visible permanent blockage, and no unlimited replan
loop. Further tuning of back-off distances or crowd pressure is deferred until
the strategy/profile slices below, because one setting cannot correctly model
pedestrians, vehicles, and animals.

#### M4.6: pluggable recovery strategy

Goal: separate reusable navigation observations/actions from game-specific
behaviour decisions.

Implementation slice:

- Define a framework-free strategy input containing agent identity, stable
  priority, progress history, blockage duration, nearby occupancy, route
  status, and bounded recovery candidates.
- Define decisions for `continue`, `wait`, `yield`, `retreat`, `local-replan`,
  `alternative-route`, `global-replan`, and `blocked`.
- Keep the strategy deterministic for the same observation and seed.
- Allow consumers to provide a strategy while shipping one small
  queue-and-yield baseline.
- Stagger retry times deterministically so a whole queue does not resume on
  the same update.
- Keep strategy execution out of the path-search hot loop and immutable
  navigation snapshots.

Headless checkpoint:

- A lower-priority blocked agent waits while the agent with right of way can
  continue.
- Waiting agents do not repeatedly alternate between forward and backward
  motion.
- Retry decisions are staggered and reproducible.
- A consumer strategy can choose a different valid action without replacing
  the planner or avoidance implementation.

Manual checkpoint:

- In the narrow-corridor fixture, queued agents visibly wait instead of all
  backing off and restarting together.
- State counts distinguish waiting/queued agents from genuinely stuck agents.
- Switching back to the existing baseline remains possible for comparison.

#### M4.7: agent profiles and scenario harness

Goal: prove that navigation mechanisms support different movement rules
without claiming to implement complete human, vehicle, or animal AI.

Initial proof profiles:

| Profile | Permitted recovery behaviour | Explicitly prohibited/limited |
| --- | --- | --- |
| Pedestrian | Wait, yield, sidestep, limited squeeze, alternate route | Squeezing below configured clearance |
| Vehicle/rover | Wait, reverse to a safe point, alternate route | Squeezing, instant turns, lateral sidesteps |
| Animal | Wait, yield, variable spacing, retreat, alternate route | Universal orderly queueing |

The profiles are data and strategy presets. Games may override them or provide
their own strategy; they are not behavioural simulations owned by navigation.

Repeatable scenario matrix:

- Open ground crossing.
- Narrow passage with same-direction traffic.
- Narrow passage with opposing traffic.
- L-shaped corner.
- Dead end and complete blockage.
- A longer available alternative route.
- Dynamic obstacle appearing while agents are travelling.

Headless checkpoint:

- Every profile produces only actions allowed by its capability data.
- A vehicle never selects squeeze or sidestep.
- Fixed seed, profile, and observations produce the same decisions.
- Scenario results report progress, waits, replans, route switches, unresolved
  blockage, and bounded work rather than requiring every scenario to clear.

Manual checkpoint:

- The lab provides profile, scenario, agent-count, and speed controls.
- The selected profile changes visible recovery behaviour in the expected way.
- Complete blockage remains visible and truthful; agents do not pass through
  unavailable space.

#### M4.8: alternative routes and bottleneck coordination

Goal: let persistent congestion escalate beyond local steering without causing
every agent to run an expensive global search at once.

Implementation slice:

- First add a bounded decentralised encounter protocol. Agents exchange
  effective priority and retreat intent only through relevant nearby blocker
  relationships. Retreat requests propagate backward so newly arriving agents
  do not close space behind an existing retreat wave.
- Break symmetric encounters by effective priority and then stable identity.
  Propagated signals carry encounter identity, a hop limit, and absolute expiry;
  unresolved no-progress becomes explicitly `blocked` after a fixed budget.
- Request a small bounded set of meaningfully different routes, initially two
  or three, rather than near-identical shortest paths.
- Generate alternatives lazily after persistent low progress and cache/share
  compatible alternatives where possible.
- Penalize recently failed or congested corridors for a bounded time.
- Retreat to the nearest safe decision/staging point when required; do not
  automatically return to the original journey start.
- Stagger route switching so all agents do not select route B simultaneously.
- If no alternative exists, return to the active strategy for waiting,
  retreating, task deferral, or explicit blockage.
- Evaluate reservations, directional turns, or passing-place ownership for
  single-width bottlenecks after the alternative-route proof. These are
  coordination policies, not replacements for A* or local avoidance.

Headless checkpoint:

- Two equal-priority agents meeting in a single-width passage choose one stable
  winner instead of mirroring each other indefinitely.
- A retreat request propagates through a blocker chain, including to a newly
  arriving agent, without accumulating duplicate priority.
- Expired signals disappear, propagation is hop-bounded, and unsuccessful
  retreat produces an explicit blocked result instead of silent infinite
  indecision.
- Route B is topologically or spatially distinct from route A by a configured
  diversity threshold.
- A persistently blocked agent can switch routes within fixed search/work
  limits.
- Shared alternatives avoid one independent multi-route search per agent.
- Recently failed routes and retries expire deterministically.

Manual checkpoint:

- A fixture shows routes A and B and which route each agent currently follows.
- Blocking route A causes some eligible agents to use route B without every
  agent switching on the same frame.
- Vehicle and pedestrian profiles may make different choices from the same
  congestion observation.
- If both routes are blocked, agents wait or report blocked instead of
  oscillating indefinitely.

M4.8 decentralised-encounter implementation checkpoint:

- `navigation-encounter.ts` exports a pure local resolver; it owns no world or
  agent registry and requires consumers to provide relevant blocker relations
  from their existing spatial query.
- Equal encounters resolve by effective priority and stable agent identity.
  Priority can be inherited through a blocker chain without summing duplicate
  pressure, while retreat intent propagates backward through that chain.
- Signals expire and have a hop bound. A configurable no-progress budget
  returns explicit `blocked`, so the default protocol cannot remain silently
  undecided forever when physical clearance is unavailable.
- The headless contract is implemented. Navigation-lab integration is the next
  visual slice and must preserve route arrival separately from retreat state.
  The lab retreat search now starts at 6 cells and escalates to a maximum of 9;
  encounter retreat propagation retains its 64-hop default. Retreat signals are
  rebroadcast when the consumer re-evaluates the same active encounter, rather
  than being a one-shot message.
- The demo keeps journey direction separate from temporary repair-route
  traversal direction, so local recovery cannot make an agent appear to have
  reached its destination or create a false third traffic direction.
- The narrow-corridor fixture leaves valid single-file clearance for the demo
  agent radius. It intentionally does not allow two agents abreast; a fully
  occupied one-file corridor remains a coordination test, not a physically
  impossible zero-clearance test.
- The lab splits its selected agent count between both journey directions, so
  a two-agent test is a genuine one-versus-one encounter.

Build checkpoint for the visual slice:

```text
npx ng build demo-app --configuration development
```

### Milestone 5: large and planetary worlds

- Sparse unloaded-region connectivity.
- Planetary surface and floating-origin contract proof.
- Rover and animal-group route integration fixture.

### Milestone 6: additional domains

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
14. Traversal feasibility and live congestion behaviour use separate profiles.
15. Local recovery is pluggable; built-in strategies are bounded defaults, not
    universal human, vehicle, or animal behaviour.
16. The navigation lab is a repeatable scenario harness, not the specification
    of one final crowd simulation.
17. Persistent congestion may escalate to a small, lazy, diverse route set;
    coordinated retries prevent every agent choosing the same alternative at
    once.
18. The first bottleneck coordination primitive is a decentralised encounter
    protocol over nearby blocker relationships. It has no persistent global
    coordinator; consumers may later add reservations for high-throughput
    scenarios.

## Open decisions

- Whether the first local representation should be a grid, polygon navmesh, or
  an abstraction implemented by both.
- Cache keys and compatibility rules for starts near one another.
- How much route smoothing belongs in navigation versus consumer steering.
- Exact built-in pedestrian, vehicle, and animal recovery presets after the
  scenario matrix has produced evidence.
- Whether bottleneck coordination starts with reservations, directional turns,
  passing-place ownership, or a smaller queue policy.
- Route-diversity metric and cache compatibility rules for alternative routes.
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

### 2026-08-10: M4.5 congestion checkpoint

- Recorded the narrow-corridor congestion result: visible full blockage at
  higher agent counts, mixed recovery, and reproducible L-corner deadlocks.
- Clarified that this is expected for the current local-avoidance proof and is
  evidence for the next live local/global replanning slice, not a final crowd
  movement guarantee.

### 2026-08-10: M4.5 bounded local recovery

- Added a short deterministic back-off manoeuvre when an agent reaches the
  local-replan threshold, allowing it to create steering room at corners.
- Preserved the route and the global fallback; fully occupied corridors remain
  legitimately blocked rather than receiving a fabricated escape path.

### 2026-08-11: M4.5 bounded route repair

- Fixed the demo back-off so the temporary recovery waypoint actually drives
  the preferred velocity.
- Added a bounded local A* repair request from the agent's current cell to its
  current route endpoint, with dynamic agents and corridor barriers projected
  as temporary blocked cells.
- Kept the repair local and capped; no claim is made that an occupied corridor
  can always be resolved.

### 2026-08-11: M4.5 recovery escalation

- Added stable agent priority so lower-priority agents can yield during a
  congestion event instead of all agents choosing symmetric escape motions.
- Added progressively wider escape-cell searches for repeated failed repairs,
  including sideways escape targets.
- Added increasing recovery cooldowns to prevent rapid replan oscillation.
- Kept genuinely enclosed agents in the explicit `stuck` state; recovery does
  not fabricate movement through occupied space.

### 2026-08-11: capability and recovery strategy plan

- Closed M4.5 as a bounded diagnostic/recovery-mechanism proof rather than a
  universal congestion solution.
- Added M4.6 for a pluggable recovery strategy and deterministic queue/yield
  baseline.
- Added M4.7 for pedestrian, vehicle/rover, and animal capability profiles plus
  a repeatable scenario matrix.
- Added M4.8 for lazy diverse alternatives, congestion penalties, staggered
  route switching, and later bottleneck coordination experiments.

### 2026-08-12: decentralised encounter protocol

- Added the first M4.8 coordination primitive as a bounded local protocol
  rather than a persistent global coordinator.
- Added transferable effective priority and expiring retreat-wave signals so
  an agent already backing out can request clearance from agents behind it.
- Required deterministic tie-breaking, bounded propagation, and explicit
  blockage after unsuccessful recovery; the visual lab adapter remains a
  separate checkpoint.

### 2026-08-12: journey-direction recovery fix

- Separated an agent's persistent A-to-B journey direction from the traversal
  direction of a temporary repair route. Recovery no longer changes the
  apparent traffic direction before the agent reaches an endpoint.
- Widened the visual narrow-corridor fixture from zero practical clearance to
  valid single-file clearance while retaining the one-file bottleneck.
- Fixed the agent-count fixture so low counts still create opposing traffic;
  two agents now means one agent from each endpoint.

### 2026-08-12: headless avoidance scenario harness

- Added a deterministic single-lane crossing harness for baseline and
  priority-yield comparisons without Angular or rendering.
- Added compact metrics for completion, blockage, stationary agents,
  oscillation, velocity reversals, and overlap.
- Added seed sweeps that return aggregate counts and failed seed IDs only, so
  investigation does not depend on verbose visual descriptions or logs.

After building the library, the compact local comparison can be run with:

```text
npm run navigation:scenarios -- baseline 2 100
npm run navigation:scenarios -- priority-yield 2 100
```

The command prints one line per requested run and limits the displayed failed
seed list so repeated investigations remain token-efficient.

The navigation lab now prints the same compact fields live beneath the canvas,
prefixed with `ui=`. Its `blocked`, `stationary`, `overlap`, and `reversals`
values come from the actual rendered simulation. `completed=na` is intentional:
the lab continuously reverses agents at route endpoints, while the headless
fixture ends when agents reach their goals.

This first harness intentionally isolates a single-lane crossing around the
navigation avoidance primitives. It is not yet a byte-for-byte extraction of
the Angular lab loop; disagreements between its result and the lab should be
treated as evidence for the next simulation-extraction slice, not as proof
that the visual fixture is fixed.

### 2026-08-13: baby-step headless checkpoint

- Established that the existing suite and build were green while both the
  baseline and priority-yield two-agent opposing fixtures failed 100/100
  seeds. Report-format tests were therefore not evidence of working corridor
  behaviour.
- Fixed the harness so completed agents leave spatial queries and overlap
  measurements instead of remaining as permanent invisible obstacles.
- Added an explicit `same-direction` traffic fixture and behavioral tests that
  require actual completion with no failure categories.
- Verified 100/100 seeds for one unobstructed agent and two same-direction
  agents. Both two-agent opposing modes remain 0/100 and are the intentionally
  red next frontier.
- Keep the next slices ordered and independently runnable: one opposing pair
  with a staging area, then a same-direction queue, then an opposing blocker
  chain. Do not return to large random maps or the Angular lab until each
  headless fixture has an explicit passing contract.

Fast checkpoint commands after building the library:

```text
npm run navigation:scenarios -- baseline 1 100 opposing
npm run navigation:scenarios -- baseline 2 100 same-direction
npm run navigation:scenarios -- baseline 2 100 opposing
npm run navigation:scenarios -- priority-yield 2 100 opposing
```

### 2026-08-13: one opposing pair with staging

- Added the first deliberately solvable opposing-traffic fixture:
  `opposing-with-staging`. The stable lower-priority agent moves to a real
  off-corridor holding point while the right-of-way agent crosses, then resumes
  its journey after that agent exits the simulation.
- Corrected progress accounting so movement or waiting under an explicit
  holding assignment is not classified as accidental no-progress. Agents
  without a holding assignment still accumulate blockage normally.
- Updated position integration and overlap measurement to use both horizontal
  axes; the staging bay is physical simulation space, not a special overlap
  exemption.
- Verified the staged opposing pair across 100/100 seeds with zero failure
  categories. The one-dimensional opposing fixture remains 0/100 by design,
  proving that the staging space and coordination policy are doing necessary
  work rather than local avoidance silently allowing agents through each
  other.

Fast checkpoint:

```text
npm run navigation:scenarios -- priority-yield 2 100 opposing-with-staging
```

Next narrow frontier: a same-direction queue of three agents through the same
bounded corridor. Require ordered completion, no overlap, and no false blocked
classification before adding an opposing blocker chain.

### Shared headed scenario viewer

- The deterministic avoidance harness now exposes a fixed-step simulation via
  `createNavigationAvoidanceScenarioSimulation`.
- Unit tests, the CLI one-shot runner, and the navigation-lab canvas all execute
  that same simulation core.
- The lab supports play, pause, single-step, reset, seed, speed, mode, and the
  same-direction, unstaged opposing, and staged opposing fixtures.
- Focused verification: 50 navigation tests pass; the library and demo app both
  build successfully. The unstaged opposing fixture remains intentionally
  visible as the next failing baby-step rather than being treated as solved.
