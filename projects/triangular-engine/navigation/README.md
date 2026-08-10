# Navigation

Framework-free contracts and bounded-work scheduling for navigation data and
route requests. The current vertical slice adds a deterministic local
heightfield-grid A* proof; it is not yet the final navmesh, hierarchy, or crowd
system.

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

Grid snapshots are immutable. Apply terrain or building edits with
`applyNavigationGridChangeSet()` using an advancing version; completed and
partial routes expose per-cell dependencies that can be checked with
`isNavigationGridRouteValid()`.

Use `createNavigationGridBenchmarkScenario()` and
`runNavigationGridBenchmark()` for reproducible 1, 100, and 1,000-agent
measurements. The harness reports route outcomes, expanded nodes, cost, and
elapsed time; it does not make hardware-independent performance promises.
