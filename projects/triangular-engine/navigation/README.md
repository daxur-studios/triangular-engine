# Navigation

Framework-free contracts and bounded-work scheduling for navigation data and
route requests. This first milestone deliberately does not choose a grid,
navmesh, or pathfinding algorithm.

Use stable `NavigationLocation` frame IDs and local coordinates as authoritative
positions. Do not use renderer-rebased coordinates as route or cache identity.

`NavigationRequestQueue` gives the application or worker host a deterministic
priority queue. It schedules serializable `NavigationQuery` values but does not
perform planning itself; a later milestone adds the tiled ground planner.
