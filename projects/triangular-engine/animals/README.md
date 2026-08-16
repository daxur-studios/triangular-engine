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
`applyAnimalGroupEvents()` overlays sparse permanent consequences without
mutating the reconstructable baseline. The first deliberately narrow event is
`member-loss`: it affects only its stable target group at and after its
effective universal time, so rewinding before that time restores the baseline.
Population recovery and ecology remain separate future layers.

Consumer terrain or flora adapters may provide `AnimalPerchAffordance` sockets.
`selectAnimalPerch()` automatically chooses the nearest available socket with a
stable ID tie-break, independent of input order; `stepArrival()` then performs
the bounded, acceleration-limited flight and landing. The consumer provides the
possible sockets, but does not script the animal's chosen socket or movement.

Run the focused headless suite with
`npm run test:triangular-engine:animals`.
