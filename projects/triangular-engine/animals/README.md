# Animals

Framework-free deterministic primitives for lightweight animal populations and flocks.

The first slice provides fixed-step time, stable flock materialization/culling,
lightweight deterministic boid steering, terrain clearance, moving disturbances,
flee/recover state, and immutable presentation snapshots. Use
`presentInterpolatedFlock(previous, current, alpha)` for smooth render-only
motion between fixed simulation states. Rendering and game-specific ecology remain
application-owned.

`sampleAnimalGroupTimeline()` is the first planetary-time bridge. It samples
one stable group's authored destination cycle directly at any finite universal
time, without replaying missed boid ticks. Its positions are authoritative
consumer coordinates, not floating-origin render coordinates.
`materializeAnimalGroup()` converts that snapshot into the existing local flock
primitive with stable member IDs and offsets. Travel uses the consumer-supplied
local direction; feeding and resting snapshots start stationary. Observer
residency can unload the members and recreate the same result later without
persisting every bird. `handoffAnimalGroupResidency()` makes that transition
explicit: groups are aggregate-only, materialized for a nearby observer, or
retained as individual members for an active interaction or explicit tracking.

Run the focused headless suite with
`npm run test:triangular-engine:animals`.
