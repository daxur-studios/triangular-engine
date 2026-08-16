# Animals

Framework-free deterministic primitives for lightweight animal populations and flocks.

`AnimalWorldSurface` is the shape-neutral boundary used by movement policies.
Games using the engine terrain domains can create it through the optional
`triangular-engine/animals/terrain` entry point:

```ts
import { createTerrainAnimalWorldSurface } from 'triangular-engine/animals/terrain';
import { PlaneTerrainDomain } from 'triangular-engine/terrain';

const surface = createTerrainAnimalWorldSurface(
  terrainField,
  new PlaneTerrainDomain(1_024),
);
const ground = surface.sample(authoritativeWorldPosition);
```

The same adapter accepts `SphereTerrainDomain` and `CylinderTerrainDomain`.
It reports the appropriate local `surfaceUp`, normal, tangent frame, slope,
walkability, anchor-relative position, projection, and surface-constrained
movement. Animal policies should consume this interface and never branch on
the terrain shape themselves.

Aquatic policies consume `AnimalWaterVolume`. The optional
`triangular-engine/animals/water` adapter combines water-surface sampling with
an `AnimalWorldSurface` terrain bottom. It classifies water, air, terrain,
land, and dry footprints; reports surface and bottom clearance; and validates
short movement segments with bounded sampling. This is the boundary that keeps
fish from swimming above water or beneath terrain in any supported world shape.
The volume also owns lateral water-surface transport, so aquatic movement can
follow plane, sphere, or inside-cylinder curvature without shape branches in
animal code.

`queryAnimalGroups()` is the game-facing aggregate population query. It takes a
world seed, stable surface/cell identity, species policy, bounded habitat
candidates, habitat version, and Universal Time. It returns stable group IDs,
member counts, activity, and selected viable habitat without authored routes or
destination schedules. Candidate order and query order do not affect results;
changing the explicit population or habitat version regenerates identities.

`materializeLocalAnimalGroup()` reconstructs stable nearby individuals from an
aggregate group using an air, land, or water definition. It consumes only the
shape-neutral surface/water contracts, enforces local clearances, caps resident
detail, and reconstructs exactly after unload. Use
`handoffLocalAnimalGroupResidency()` for topology-aware observer residency.
The older `materializeAnimalGroup()` flight helper is retained only as a
deprecated XZ/Y-up compatibility fixture.

`stepConstrainedAnimalMovement()` is the shared fixed-step constraint kernel
for land, air, and water. Species policies provide a desired world velocity;
the kernel applies bounded acceleration and speed, caps substep work, transports
movement through the world adapters, and rejects invalid terrain or water
segments. It contains no flock, herd, school, destination, or page behavior.

`stepAnimalAirFlock()` is the first species policy on that kernel. It computes
cohesion, separation, alignment, local-up altitude, target approach, roost
approach, holding, and departure without inspecting the world shape. Roost
sites expose bounded capacity; `allocateAnimalRoosts()` assigns stable distinct
tangent-frame slots and leaves deterministic overflow in a holding pattern.
The policy receives intent and habitat candidates from population/ecology code;
rendering pages do not provide routes or movement equations.

`sampleAnimalAirFlockCycle()` provides the bounded Universal-Time bridge for a
repeatable local daily cycle. It reconstructs from stable roost assignments and
steps at most one configured cycle, regardless of whether the requested time is
in the distant past or future. This is suitable for direct scrubbing and time
warp without replaying planetary history. The current cycle requires enough
roost capacity for every reconstructed member; long-term migration and ecology
remain higher-level inputs.

`stepAnimalLandHerd()` applies the same pattern to surface animals. It selects
bounded suitable grazing patches, assigns stable non-overlapping forage
anchors, combines cohesion/separation/alignment with target steering, enforces
species-specific slope limits, and makes a small bounded local detour when a
step meets blocked terrain. Grazing and resting stop at their anchors; the
policy does not add perpetual motion merely for presentation.

`sampleAnimalLandHerdCycle()` reconstructs a canonical rest, outbound travel,
graze, and return cycle directly at arbitrary Universal Time. Grazing-patch
choice may vary deterministically by cycle index, while replay work remains
bounded to one local cycle. This is local habitat movement, not automatic
planet-scale migration route discovery.

`stepAnimalAquaticSchool()` provides the corresponding water-volume policy. It
selects suitable same-body habitat zones, assigns stable school slots, combines
cohesion/separation/alignment with flow and local-normal depth steering, and
tries a bounded set of local alternatives when a segment meets shoreline,
terrain, or another invalid part of the volume. The shared movement kernel
enforces both minimum and maximum surface clearance plus bottom clearance.

`sampleAnimalAquaticSchoolCycle()` directly reconstructs a canonical home,
outbound, feeding, and return cycle at arbitrary Universal Time. It samples
moving water at the cycle's actual absolute time, retains one water body, splits
steps exactly at phase boundaries, and never replays more than one local cycle.
Traversal between separately represented but connected water bodies remains an
adapter-level future capability rather than a policy shortcut.

`resolveAnimalDisturbances()` is the bounded shared interaction query. Games
provide materialized group positions plus vehicle, aircraft, boat, building,
or other disturbance volumes. The supplied surface or water adapter computes
topology-aware lateral distance, while local height or water-depth separation
completes the distance calculation. Results are deterministic, capped, and
species-neutral; flock, herd, and school policies decide how each hit changes
their desired movement.

`queryEffectiveAnimalGroups()` overlays sparse consequences on
`queryAnimalGroups()` without simulating elapsed history. Member loss,
temporary habitat displacement, and permanent habitat invalidation take effect
at explicit Universal Times. Rewinding before an event restores the baseline,
and displacement expiry is reconstructed directly. The consuming game owns
event persistence and supplies the bounded event set relevant to the query.

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

For directly addressable group-flight presentation, set an optional
`travelArcHeight` on the timeline and `formation: 'flight'` when materializing.
The sampler then exposes the analytical route tangent in `snapshot.velocity`;
the flight formation uses that tangent and Universal Time to reconstruct the
same 3D group shape after scrubbing or time warp. It is intentionally not a
boid, terrain-navigation, or collision simulation.
Sampled snapshots also expose `activityProgress`. Flight materialization uses
it to blend smoothly into distinct broad feeding and compact resting group
states, then back into travel without replaying intermediate time.

Consumer terrain or flora adapters may provide `AnimalPerchAffordance` sockets.
`selectAnimalPerch()` automatically chooses the nearest available socket with a
stable ID tie-break, independent of input order; `stepArrival()` then performs
the bounded, acceleration-limited flight and landing. The consumer provides the
possible sockets, but does not script the animal's chosen socket or movement.

Run the focused headless suite with
`npm run test:triangular-engine:animals`.
