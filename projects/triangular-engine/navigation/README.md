# Navigation

Framework-free contracts and bounded-work scheduling for navigation data and
route requests. The current vertical slice provides a deterministic local
heightfield-grid A* proof plus region routing, route caching, and shared-goal
route extraction. It is not the final navmesh, avoidance, or crowd system.

Use stable `NavigationLocation` frame IDs and local coordinates as authoritative
positions. Do not use renderer-rebased coordinates as route or cache identity.
The initial terrain convention is Y-up with X/Z as the horizontal axes. Use
`createNavigationCoordinateContract()` and the assertion helpers to reject
non-finite positions and accidental cross-frame calculations at system
boundaries.

`NavigationRequestQueue` gives the application or worker host a deterministic
priority queue. It schedules serializable `NavigationQuery` values but does not
perform planning itself. `findNavigationGridRoute()` is the separate bounded
local-grid planner used by the first terrain proof.

Use `simplifyNavigationGridRoute()` to remove redundant straight-line grid
points after planning. Use `buildNavigationGridGoalField()` once for a hot RTS
destination, then `findNavigationGridRouteFromGoalField()` for compatible
agents; extraction does no new graph search.

For larger worlds, `createNavigationRegionGraph()` and
`findNavigationRegionRoute()` provide the first sparse region/portal layer.
`NavigationRouteCache` stores complete routes and rejects them when a
dependent portal edge version changes.

Grid snapshots are immutable. Apply terrain or building edits with
`applyNavigationGridChangeSet()` using an advancing version; completed and
partial routes expose per-cell dependencies that can be checked with
`isNavigationGridRouteValid()`.

Use `createNavigationGridBenchmarkScenario()` and
`runNavigationGridBenchmark()` for reproducible 1, 100, and 1,000-agent
measurements. The harness reports route outcomes, expanded nodes, cost, and
elapsed time; it does not make hardware-independent performance promises.

For local ground movement, `createNavigationSpatialIndex()` provides bounded
nearby-agent and obstacle queries. `calculateNavigationAvoidanceVelocity()` is
the cheap separation baseline. `calculateNavigationVelocityObstacleVelocity()`
is a deterministic short-horizon candidate-sampling experiment for comparison;
it is not a full ORCA solver or collision guarantee. Use
`classifyNavigationAvoidanceState()` to turn no-progress time into yielding,
stuck, local-replan, or global-replan states.

`createNavigationAvoidanceBenchmarkScenario()` and
`runNavigationAvoidanceBenchmark()` measure the same bounded work for 1, 100,
and 1,000-agent fixtures. Results are hardware-specific measurements, not
performance guarantees.

For small, reproducible behavior checks,
`createNavigationAvoidanceScenarioSimulation()` exposes the deterministic
fixed-timestep scenario harness one `step()` at a time. Tests, scripts, and
visualizers can therefore use identical state transitions.
`runNavigationAvoidanceScenario()` is the convenience wrapper that runs that
same core to completion.

Scenario snapshots also expose their shared `walkableAreas`. The staged
opposing fixture constrains each agent-sized disc to that union and returns the
yielding agent through authored bay-interior and corridor-entry waypoints before
it resumes toward its goal. Use `isNavigationAvoidanceScenarioPositionWalkable()` in step-driven
tests to fail at the exact step where an agent would enter a wall. The staging
area and waypoint are authored fixture data; automatic staging-area discovery
is not implemented yet. A yielding agent enters an explicit `waiting` state
once it reaches the staging point and remains still until right-of-way clears.
The `same-direction` headed fixture uses three agents and has a step-driven
contract for ordered completion, walkability, zero overlap, and zero blockage.
