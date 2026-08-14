# Animals sub-library

Status: Milestones 0–1 implemented (`triangular-engine/animals`: deterministic
flocks, residency, presentation). Milestone 2 has one minimal slice —
single-agent seek-and-land (`stepArrival`) — added to unblock
[014_procedural_sublibrary.md](014_procedural_sublibrary.md)'s Milestone 5;
the rest of Milestone 2 (habitat regions, activity selection, reachability)
is not built. See Roadmap below for per-milestone detail.

## Goal

Create a new `triangular-engine/animals` secondary entry point for scalable,
deterministic animal populations, groups, behaviours, and environmental
interactions in procedural 3D worlds.

The first consumer is a vehicle-building game in which rovers, aircraft, and
other vehicles travel through a living world. Nearby animals should feel
present rather than decorative: birds flock, animals react to vehicles, and
the player can be rewarded for protecting life. The same foundations should
later support seasons, migration, bases, roads, terraforming, population
change, extreme time warp, and forward or backward time jumps.

The first useful result is intentionally smaller: a deterministic population
can produce visible bird flocks near an observer, cull them at distance, make
them travel for understandable reasons, and make them flee from a vehicle
before recovering.

## Why a new entry point

Use `triangular-engine/animals`, not `triangular-engine/life` or
`triangular-engine/deterministic-animals`.

- The domain is specifically non-human animal life.
- `life` is too broad: plants, humans, microbes, and complete ecosystems have
  different requirements.
- Determinism is a behavioural contract, not the domain name.
- The previous `life` experiment must not be reused, extended, or mixed into
  this work by default. It may only be consulted later if a deliberate review
  is requested.

Possible future entry points are separate concerns:

- `triangular-engine/navigation` for semantic routes and local navigation
  shared by animals, vehicles, and other consumers.
- `triangular-engine/ecology` for later coupling of animal populations,
  vegetation, climate, seasons, and terraforming.

Neither is required to begin the first animals milestone.

## Core idea

Animal life is defined by relationships with its environment and with other
life, not by random waypoint movement.

The environment exposes meaning such as food, shelter, water, perches,
nesting sites, traversable surfaces, obstacles, and danger. Animals have
needs, capabilities, relationships, and rhythms that make those opportunities
relevant. A visible path is the result of an activity; it is not the animal's
reason for existing.

The intended decision chain is:

```text
population -> group -> need/activity -> meaningful destination
           -> valid route -> local steering -> presentation output
```

## Scope

The animals library should eventually provide reusable mechanisms for:

- Persistent regional populations.
- Flocks, herds, schools, packs, pods, families, and other groups.
- Nearby individual movement and group steering.
- Habitat requirements and environmental affordances.
- Affordances exposed by animals as well as terrain, vegetation, and
  structures.
- Vehicle, player, predator, construction, noise, and weather disturbances.
- Activities such as feeding, resting, travelling, migrating, fleeing,
  perching, hunting, playing, and caring for young.
- Simple species relationships such as prey, predator, fear, competition,
  cooperation, cleaning, parasitism, following, protection, mobbing, and play.
- Multi-participant interactions with roles, phases, prerequisites,
  interruption, and asymmetric outcomes.
- Deterministic materialization, culling, save/restore, and time evaluation.
- Presentation-neutral transforms and state for simple shapes, sprites,
  particles, sounds, or animated meshes.

It should not initially provide:

- Meshes, materials, skeletal animation, or procedural animal appearance.
- Plant growth or tree scattering.
- Terrain generation.
- Generic vehicle pathfinding.
- Detailed calorie accounting, genetics, or a complete food web.
- Human settlement or social simulation.
- Individually simulated births, deaths, parasites, and hunts everywhere.
- A universal intelligence intended to reproduce every real animal behaviour.

A simple relationship network belongs in the library. A detailed ecosystem
simulation does not belong in the first milestones.

## Ownership boundaries

### Animals library owns

- Seeded deterministic utilities and stable animal identities.
- Population, group, activity, interaction, and individual state models.
- Observer-based simulation detail and materialization.
- Generic flock, herd, flee, recover, follow, and arrival controllers.
- Environment, habitat, affordance, obstacle, route, and attachment contracts.
- Statistical population response mechanisms.
- Presentation-neutral output.

### Game owns

- Planet history, time controls, saves, and authoritative world events.
- Species selection, balance, authored ecology, and gameplay consequences.
- Conversion of terrain, vegetation, weather, roads, bases, and terraforming
  into habitat samples, obstacles, disturbances, and affordances.
- Vehicle noise, speed, physical danger, and other disturbance values.
- Meshes, animation, audio, particles, rendering, and interaction anchors on
  detailed models.
- Missions, discovery, protection rewards, UI, and narrative.

The library supplies mechanisms. The game supplies ecological meaning and
consequences.

## Simulation scales

Animal existence and visible presentation are separate.

### Population scale

Far away or during large time jumps, animals are counts and distributions in
habitat regions. Births, deaths, capacity, migration, colonisation, and
extinction are statistical operations. No individual paths exist at this
scale.

### Group scale

Near a relevant observer, part of a population materializes as stable groups.
A group has an activity, destination, route, progress, size, and cohesion.

### Individual scale

Only nearby or interacting animals receive individual steering, avoidance,
attachment, and visible interaction phases. When they leave the active area,
their important state folds back into their group and population.

Observers are not limited to cameras. A player, vehicle, base, sensor, or
scripted area may keep animals relevant at an appropriate simulation level.

## Semantic environment

The library must not guess ecological meaning from arbitrary meshes. Consumer
adapters describe the world through stable interfaces.

Example concepts include:

```ts
interface AnimalEnvironment {
  sampleHabitat(position: AnimalPosition, time: AnimalTime): HabitatSample;
  queryAffordances(query: AffordanceQuery): readonly AnimalAffordance[];
  queryObstacles(bounds: AnimalBounds): readonly AnimalObstacle[];
  findRegion(position: AnimalPosition): HabitatRegionId | undefined;
}
```

Scatter can register a tree as a perch, nest, food source, or shelter without
the animals library understanding its mesh. A building can expose roof and
antenna perches while also contributing a blocked footprint, noise, light, or
long-term avoidance pressure. Roads may be barriers, easy routes, collision
risks, crossings, or habitat fragmentation depending on the species.

Geometry answers where an animal can move. Ecology answers why it moves there.

## Animal relationships and interactions

Animals may expose affordances to other animals. This supports cleaning birds,
suction-attached fish, parasites, parents feeding young, group protection,
scavenging, cooperative hunting, and play without hard-coding every species
pair into the core.

An interaction has:

- Named participant roles.
- Requirements for each role.
- Environmental and state prerequisites.
- Deterministic phases such as approach, attach, act, and depart.
- Rules for interruption, recovery, or abandonment.
- Outcomes for every participant; outcomes may be beneficial, neutral, or
  harmful.
- A statistical population-level equivalent when the interaction is not
  observed.

For example, cleaning may feed a small animal while reducing parasite pressure
on a host. At population scale this is a relationship between population
health values; nearby it can materialize as approach, landing, cleaning, and
departure.

Play is a normal interaction category. It may include chasing, racing,
jumping, object play, or playful interaction with a vehicle. It is generally
eligible when participants are safe, sufficiently energetic, and not occupied
by a stronger need.

## Movement and navigation

Intent, routing, and immediate movement are distinct:

1. **Activity:** feed, rest, migrate, flee, play, hunt, or travel.
2. **Semantic route:** select reachable habitat regions and meaningful
   destinations.
3. **Local navigation:** pass around ponds, cliffs, buildings, and other
   obstacles.
4. **Steering:** cohesion, separation, alignment, arrival, pursuit, evasion,
   terrain following, and immediate avoidance.

Boids is a group movement technique, not the animal simulation. Random
waypoints must not be the primary source of movement. Repetition is reduced by
meaningful destinations, longer regional routes, recent-location memory,
minimum activity durations, and reachability checks before movement begins.

Terrain integration must be semantic. Species or locomotion profiles describe
slope limits, water behaviour, altitude or clearance, and movement modes such
as ground, flight, swim, seabed, or amphibious. Local steering must not be
expected to fix an unreachable destination.

Generic navigation should eventually live in `triangular-engine/navigation`,
not inside terrain or animals. Terrain may supply navigation surfaces and
semantic samples; animals and vehicles supply different traversal and steering
profiles.

## Aquatic domains

Aquatic movement must be designed explicitly, but it is not part of the first
bird-flock implementation.

The terrain or water system owns the physical description of water: water
volumes, surface height, shoreline, lakebed, depth, flow, connectivity, and
stable water-body identity. The game adapts its procedural terrain and water
implementation to those contracts. The animals library consumes the result
and applies species locomotion and habitat constraints.

An aquatic query must eventually be able to answer:

- Whether a position is inside water and which water body contains it.
- Surface and bed elevation, depth, and clearance.
- Distance and direction to the shoreline.
- Flow and optional habitat qualities such as temperature or oxygen.
- Whether two positions belong to connected, traversable water.

A swimming species may define minimum, maximum, and preferred depth, required
surface and bed clearance, current tolerance, and whether it can leave water.
Routes must remain inside the connected traversable water volume; local
steering must not be responsible for recovering fish after they cross a
shoreline. Seabed and amphibious locomotion can use the same domain with
different traversal constraints.

The animals library does not discover lakes from arbitrary terrain meshes.
It does own keeping aquatic animals within the valid semantic water domain
reported by the consumer.

## Habitat change, colonisation, and exclusion

Newly suitable habitat does not automatically contain animals. Physical
validity, ecological suitability, reachability, colonisation permission, and
actual introduction are separate states.

The game chooses a policy for each relevant habitat or species:

- **Automatic:** establish a population when habitat becomes suitable.
- **Connected only:** allow colonisation from a connected populated region.
- **Explicit introduction:** remain empty until a game event introduces the
  species.
- **Excluded:** prevent the species from occupying the area.

These policies also support artificial lakes, fenced reserves, bases, sterile
terraforming zones, and protected areas. More specific zone rules may prevent
colonisation, require introduction, make existing animals leave, or change
gameplay protection without changing physical habitat.

Terrain changes, habitat-rule changes, and species introductions are timed
world events. This preserves history: before an introduction event a new lake
is empty; afterwards its population can develop deterministically. The game
owns the authoritative events and policies. The animals library applies them
to population state. Sophisticated natural dispersal may later belong in an
ecology layer.

## Time and determinism contract

The design must support real time, extreme time warp, and later forward or
backward time jumps.

### Required determinism

Given the same world seed, stable IDs, environment inputs, event history, and
query time:

- Population history should be reproducible.
- Group identities, broad locations, activities, and routes should be
  reproducible.
- Adding an unrelated animal must not change existing results.
- Visible simulation must not depend on render frame rate.

Random choices use keyed streams based on stable values such as world seed,
entity ID, decision kind, and decision index. They must not consume a single
shared random sequence.

### Reasonable limit

Exact centimetre-level replay of every unobserved animal across arbitrary
observer histories and time jumps is not an initial promise. Macro ecological
history is deterministic. Visible motion is deterministic and continuous while
observed, but may be reconstructed approximately when observation begins.

### Time model

- Nearby movement uses fixed simulation steps and interpolation.
- Population changes use coarse intervals or direct time-dependent functions.
- Group travel can use deterministic routes and progress functions.
- Large time jumps must not replay every movement tick.
- Backward evaluation uses deterministic initial state, immutable world events,
  periodic checkpoints, and re-evaluation from the appropriate checkpoint.

## First vertical slice

A deterministic bird population inhabits one or more terrain regions. When an
observer approaches, a flock materializes consistently. It travels between
meaningful feeding and perching areas, follows terrain with safe clearance,
reacts to an approaching vehicle, and later recovers and resumes its prior or
newly selected activity. At large time scales it returns to group or
population state instead of running boids at accelerated speed.

Success means:

- Flocks spawn and cull correctly around observers.
- The same seed and time produce compatible groups.
- Movement is frame-rate independent.
- Birds do not fly through terrain.
- Birds do not repeat a visibly obvious three-point loop.
- Vehicle response has notice, flee, monitor, and recovery stages.
- Presentation works with abstract geometry and no animation system.
- Time warp changes simulation resolution rather than multiplying every local
  steering step.

## Implementation order

Future requirements are recorded now so early contracts do not prevent them,
but they are not all implemented now. Work proceeds in this order:

1. Make one nearby flock look coherent and respond to a vehicle.
2. Give that flock meaningful destinations and valid movement.
3. Prove the same contracts with a ground herd.
4. Add persistent populations and large time jumps.
5. Add migration and seasons.
6. Add dynamic construction, aquatic domains, and habitat policy as separate
   vertical slices after the shared foundations are proven.
7. Add terraforming ecology and richer animal interactions last.

Each milestone must produce a small demonstrable behaviour and focused tests.
Later milestones must not be pulled forward merely because their requirements
are described in this document.

## Roadmap

### Milestone 0: contracts and deterministic primitives

Status: done. `animals/core`: `AnimalVector3`/`AnimalObserver`/`FlockState`
types (`animal-types.ts`), seeded hashing (`animal-hash.ts`), a fixed-step
clock with time-warp/skip handling (`fixed-step-clock.ts`).

- Confirm package boundary and dependency rules.
- Define time, IDs, keyed random sampling, observers, environment queries, and
  presentation output.
- Define serialization and versioning expectations.
- Add determinism and fixed-step tests.

### Milestone 1: deterministic visible flocks

Status: done. `stepFlock` (`flock-step.ts`): cohesion/alignment/separation,
terrain-height clamping, vehicle-disturbance flee/recover with a bounded
escape response. `materializeFlock`/`updateFlockResidency` handle
observer-based spawn/cull; `presentFlock`/`presentInterpolatedFlock` give
frame-rate-independent renderer snapshots. Demo: `/animals-lab`.

- One flying species and stable flock identities.
- Observer-based materialization and culling.
- Terrain-relative flight and basic boid steering.
- Vehicle disturbances with flee and recovery.
- Abstract demo presentation.

### Milestone 2: meaningful activities and destinations

Status: one minimal slice done, rest not started. `stepArrival`
(`flock-arrival.ts`) steers a single agent toward a 3D target point and
marks it `'landed'` once within a configurable distance — Reynolds-style
arrival deceleration inside `arrivalRadiusM`, turn-rate-limited horizontal
heading (shared `rotateTowards` from the new `animal-math.ts`, which
`stepFlock` was refactored onto too), acceleration-limited horizontal and
vertical speed. Built specifically to unblock
[014_procedural_sublibrary.md](014_procedural_sublibrary.md) Milestone 5
("bird lands on a generated tree's perch socket"), not as a full M2
implementation — no habitat regions, activity selection, minimum-duration/
recent-location memory, or reachability checks exist. Demo:
`/flora-affordance-lab` (in the demo-app, alongside the procedural pages,
since the design test is procedural's).

Fixed while building this: `rotateTowards`'s turn-rate limiting used the
agent's *current* horizontal velocity as its "current heading," but a unit
vector from a zero velocity is itself the zero vector — an agent starting
at rest (as `stepArrival` naturally does; flocks always start with nonzero
`velocity.z` so this path was never exercised) got stuck permanently
turned away from its target, `atan2(0, 0)` always evaluating to a zero
turn. Fixed by snapping straight to the target heading when the current
horizontal speed is ~0, since there's no existing direction to rotate away
from. Covered by `flock-arrival.spec.ts`; `flock-step.spec.ts` still passes
unchanged since flocks never hit this branch in practice.

- Habitat regions, feeding areas, perches, and resting areas.
- Activity selection with minimum duration and recent-location memory.
- Reachability checks and longer semantic travel.
- Landing on consumer-provided tree or building anchors.

### Milestone 3: ground herds

- Walkable semantic surfaces, slope and water constraints.
- Building and local obstacle avoidance.
- Grazing, herd movement, and vehicle response.
- Validate that public contracts are not flight-specific.

### Milestone 4: persistent populations and large time jumps

- Region-level counts and habitat capacity.
- Materialization from persistent population state.
- Statistical births, deaths, and transfers between regions.
- Save, restore, and large forward time jumps.

### Milestone 5: seasons and migration

- Time-dependent habitat suitability and activity curves.
- World-scale migration routes and staging regions.
- Deterministic multi-year evaluation.

### Milestone 6: construction and fragmentation

- Dynamic obstacles and affordances from bases and roads.
- Habitat disturbance, fragmentation, crossings, and corridors.
- Population response to persistent construction.

### Milestone 6A: aquatic domain proof

- One stable water body supplied by a terrain/water adapter.
- One swimming species constrained by surface, bed, depth, shoreline, and
  water-body connectivity.
- Deterministic materialization and group movement underwater.
- No procedural lake discovery inside the animals library.

### Milestone 6B: habitat policy proof

- One newly created aquatic or terrestrial habitat region.
- Automatic, connected-only, introduction-only, and excluded policies.
- Timed introduction and exclusion events with forward and backward
  evaluation.
- Clear behaviour for existing populations when rules change.

### Milestone 7: terraforming ecology

- Environmental suitability envelopes.
- Introduction, colonisation, population growth, and extinction.
- Vegetation-dependent carrying capacity.
- Historical evaluation across terraforming changes.

### Later: richer interactions

- Simple predator/prey and species-relationship network.
- Play, parenting, cleaning, attachment, parasitism, scavenging, cooperative
  hunting, and unusual authored lifecycle activities.
- Population-scale approximations paired with optional visible interactions.

## Decisions recorded

1. The public entry point is planned as `triangular-engine/animals`.
2. The previous `triangular-engine/life` attempt is out of scope and must remain
   isolated unless deliberately reviewed later.
3. Animal simulation has population, group, and individual resolutions.
4. Populations persist; visible individuals are materialized expressions of
   populations and groups.
5. Environment semantics and affordances are consumer-provided rather than
   inferred from meshes.
6. Animals can provide affordances to other animals.
7. Multi-animal interactions and play are first-class concepts, though not
   first-milestone implementations.
8. A simple species relationship network is in scope; a detailed food-web
   simulation is deferred.
9. Intent, semantic routing, local navigation, steering, and presentation are
   separate layers.
10. Generic navigation is a candidate separate secondary entry point shared
    with vehicles.
11. Macro history should be deterministic; exact replay of every unobserved
    local movement is not initially guaranteed.
12. The first implementation target is a small bird-flock vertical slice, not
    the complete ecology roadmap.
13. Water geometry and connectivity are supplied by terrain/water adapters;
    animals owns species constraints within the supplied aquatic domain.
14. Suitable habitat and populated habitat are distinct. Colonisation and
    exclusion are explicit, game-owned policies applied by the library.
15. Aquatic life and habitat policy are recorded design requirements but are
    deferred until population, movement, and time foundations are proven.

## Open decisions

- Exact public type names and whether the first API should be framework-free,
  Angular-integrated, or split into core and Angular adapters.
- Coordinate and precision contracts for planes, spheres, cylinders,
  floating origins, and planetary scale.
- Habitat-region ownership and how regions are derived from terrain and
  scatter data.
- Checkpoint format and ownership between the library and consuming game.
- Minimum initial navigation contract required before a separate navigation
  entry point exists.
- How deterministic groups reconcile multiple moving observers.
- Whether population equations are discrete, continuous, or pluggable.
- Performance budgets and default materialization distances.
- Exact aquatic-volume query representation and which future entry point owns
  its generic navigation data.
- Behaviour when a habitat is split, merged, drained, flooded, or made
  inaccessible while it contains a population.

## Change log

### 2026-08-09: initial plan

- Chose the `animals` name and explicitly separated it from the earlier `life`
  work.
- Recorded the population/group/individual model, semantic environment,
  interactions, determinism limits, ownership boundaries, and staged roadmap.
- Selected deterministic vehicle-responsive bird flocks as the first vertical
  slice.

### 2026-08-09: aquatic habitats and implementation priority

- Assigned water-volume discovery, shorelines, depth, and connectivity to
  terrain/water providers, with animal traversal constraints owned by the
  animals library.
- Separated habitat suitability from colonisation permission and explicit
  species introduction.
- Added timed exclusion and introduction requirements for deterministic
  history.
- Fixed the implementation priority: visible flock first; aquatic and dynamic
  habitat-policy proofs only after shared population and movement foundations.
