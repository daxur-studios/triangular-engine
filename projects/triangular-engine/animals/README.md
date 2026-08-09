# Animals

Framework-free deterministic primitives for lightweight animal populations and flocks.

The first slice provides fixed-step time, stable flock materialization/culling,
lightweight deterministic boid steering, terrain clearance, moving disturbances,
flee/recover state, and immutable presentation snapshots. Use
`presentInterpolatedFlock(previous, current, alpha)` for smooth render-only
motion between fixed simulation states. Rendering and game-specific ecology remain
application-owned.
