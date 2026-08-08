# 009 — Life sub-library

## Status

- State: **Phase 0 implementation in progress.** The initial framework-free
  core, package entry point, and `/life-lab` bird slice now exist; behaviour
  tuning and integration hardening remain.
- Proposed entry point: `triangular-engine/life`.
- First proving ground: a small flock of low-poly birds above an existing
  terrain demo, avoiding the player and nearby tree canopies.
- Immediate integrations: `terrain`, `scatter`, `water`, `spline`, and `trail`.
- Blocked on: build/test verification while the local Windows shell process
  session is intermittently failing to spawn child processes.
- Last updated: 2026-08-07.

## Objective

Create reusable simulation primitives for autonomous living actors, ranging
from ambient flocks to game-directed creatures, without turning the engine into
a prescribed ecology, combat, or general-purpose AI framework.

The package should make existing worlds feel inhabited. Terrain, biomes,
water, vegetation, paths, and weather describe a place; `life` supplies actors
that notice and move through it.

The architectural target is:

> A strong body and senses with a replaceable brain.

Simple consumers should be able to create birds, fish, insects, or herds with
built-in behaviours. More ambitious games should be able to retain movement,
perception, spatial queries, and habitat integration while replacing goal
selection with their own utility AI, behaviour trees, needs, schedules,
combat, persistence, or networking.

## Why this belongs in the engine

The existing secondary entry points describe the world but do not provide a
shared model for actors moving through it:

- `terrain` provides surfaces, elevation, normals, and streamed domains.
- `scatter` provides deterministic vegetation and nearby world objects.
- `water` provides surfaces, depth, and motion.
- `spline` provides routes, territories, and migration corridors.
- `trail` can visualize or render movement history.
- physics packages can resolve contacts for the small subset of creatures that
  need rigid-body interaction.

Without a neutral actor layer, every demo or game must independently rebuild
neighbour lookup, steering, obstacle avoidance, terrain following, perception,
and simulation-distance policies. `life` owns those reusable mechanics and
leaves species and game meaning to consumers.

## Product boundary

`life` may own:

- agent kinematic state: position, velocity, orientation, and limits;
- fixed-step simulation and deterministic seeded randomness;
- composable steering behaviours;
- spatial indexing and neighbour queries;
- obstacle, influence, and habitat queries;
- lightweight perception observations;
- short-lived intent and broad locomotion state;
- group membership, flock splitting, and merging;
- simulation levels of detail and sleeping;
- events such as `targetReached`, `threatDetected`, and `stuck`;
- Three.js instanced presentation helpers for large ambient groups.

Games or higher-level packages should own:

- hunger, thirst, health, age, metabolism, and reproduction;
- relationships, factions, ownership, taming, and social history;
- long-term memories, schedules, goals, and strategic planning;
- combat, damage, inventories, resources, and quests;
- animation content and species-specific animation graphs;
- save-game policy, network authority, and replication;
- population and ecosystem rules.

These game-owned systems are supported consumers, not rejected use cases.
They choose an intent; `life` turns that intent into plausible local movement
and observations.

```ts
const observations = wolf.senses.observe(world);
const intent = wolfBrain.decide(wolfNeeds, observations);

wolf.movement.applyIntent(intent);
wolf.movement.step(deltaSeconds);
```

The scope alarm is not “a game has hunger.” The alarm is “`LifeAgent` itself
has acquired hunger, genes, inventory, combat, faction, and save-game fields.”

## Core decisions

### 1. Prove the toy before extracting the package

The first implementation is a narrow demo spike: approximately 50 low-poly
birds flock over one existing terrain scene, remain above the surface, avoid a
moving player influence, and steer around nearby tree canopies.

The spike exists to discover the smallest useful contracts. It must not begin
with package scaffolding, an ecology model, a behaviour-tree editor, or a
species system. Once the vertical slice feels alive, extract only the reusable
mechanics into `triangular-engine/life`.

This is an explicit anti-overwhelm constraint: the first success is visual and
playable, not architectural completeness.

### 2. Intents connect replaceable brains to reusable movement

Long-term decision-making must not be embedded in steering behaviours. A game
or lightweight built-in state machine produces a `LifeIntent`; the movement
layer satisfies it as far as local conditions allow.

```ts
interface LifeIntent {
  readonly mode: 'wander' | 'seek' | 'flee' | 'follow' | 'hold';
  readonly targetPosition?: LifeVector3;
  readonly targetVelocity?: LifeVector3;
  readonly urgency?: number;
}
```

The initial union stays deliberately small. Consumers may attach their own
intent metadata outside the core rather than growing this into a universal
catalogue of animal actions.

### 3. Behaviours are pure steering contributions

A behaviour reads an immutable local context and contributes a desired
acceleration or velocity. It does not mutate the world, select strategic
goals, apply damage, or own animation.

```ts
interface LifeSteeringBehavior {
  sample(context: Readonly<LifeSteeringContext>, out: LifeVector3): number;
}
```

The numeric result is a weight or confidence. Built-ins may include:

- separation, alignment, and cohesion;
- wander, seek, flee, arrive, pursue, and evade;
- obstacle avoidance with predictive look-ahead;
- surface-height, depth-band, and volume constraints;
- route following and home-range attraction;
- flow and wind influence.

Behaviours must be allocation-free in the hot loop after initialization.

### 4. World integration uses narrow query contracts

`life/core` must not import `terrain`, `scatter`, `water`, `spline`, Jolt,
Rapier, Angular, or Three.js. It declares the information it needs; adapters
in later layers bind existing packages to those contracts.

```ts
interface LifeObstacleQuery {
  querySphere(
    position: Readonly<LifeVector3>,
    radius: number,
    out: LifeObstacleBuffer,
  ): number;
}

interface LifeHabitat {
  sample(position: Readonly<LifeVector3>, out: LifeHabitatSample): boolean;
}

interface LifeInfluenceQuery {
  querySphere(
    position: Readonly<LifeVector3>,
    radius: number,
    out: LifeInfluenceBuffer,
  ): number;
}
```

An obstacle is geometry to avoid. An influence is a semantic moving presence
such as a player, predator, food source, or attractor. A habitat constrains
valid movement and supplies environmental values. Keeping these distinct
prevents every world object from becoming a heavyweight entity.

### 5. Scatter objects remain derived data

Trees should not be copied into persistent creature state. A scatter adapter
queries nearby deterministic cells and exposes temporary obstacle or semantic
records:

```ts
interface LifeObstacle {
  readonly id: number | string;
  readonly position: LifeVector3;
  readonly radius: number;
  readonly height?: number;
  readonly tags?: readonly string[];
}
```

The initial bird demo treats tree canopies as conservative spheres or
capsules. Trunk avoidance, perching candidates, shelter, food, and territory
tags can be added only when a real consumer needs them. Removed scatter
instances disappear naturally from future queries.

### 6. Perception reports observations, not conclusions

Perception may answer “a player tagged `threat` is 8 metres northeast and
approaching.” It should not conclude “the deer is afraid” or select “run to
the forest”; those meanings belong to the brain or game.

Initial perception is geometric and deterministic:

- radius and field-of-view filtering;
- nearest or strongest tagged influence;
- optional line-of-sight supplied by a consumer adapter;
- short observation lists written into reusable buffers.

Hearing, smell fields, memory, and social knowledge are future consumers or
optional extensions, not Phase 1 requirements.

### 7. Fixed-step, deterministic simulation

Simulation uses a fixed timestep with a capped accumulator. Seeded randomness
is derived from stable agent identifiers and tick number; it must not depend on
render-frame rate or array iteration accidents.

Determinism is valuable for tests, replays, debugging, and eventual networked
consumers. It is not a promise of cross-platform bit-identical lockstep until
that requirement is explicitly designed and tested.

### 8. Simulation LOD is foundational

Life is likely to be numerous. The design must support distance- or
importance-based update policies from the beginning:

- **active** — full perception and steering every fixed tick;
- **reduced** — steering and perception on staggered lower-frequency ticks;
- **ambient** — coarse group or route motion without individual perception;
- **sleeping** — no updates until an invalidation or proximity wake-up.

Transitioning between levels must preserve stable identity and avoid visible
teleports. Full ecosystem simulation outside the active region is not implied;
a game may provide its own aggregate population model.

#### Visibility and simulation centres

Consumers with free cameras should separate “can be seen” from “must be
simulated.” A camera-visible region may request cheap ambient groups,
silhouettes, or coarse motion so panning across a world still reveals life.
The gameplay actor, vessel, or player region remains the authoritative bubble
for individual steering, perception, hazards, collisions, and persistence.
An importance pin may keep a followed, tagged, injured, authored, or
mission-relevant actor alive outside both regions. These are consumer policy,
not additional species state in `life/core`.

Both regions require hysteresis and a protected visible boundary: materialize
before an actor enters view, retire only beyond a larger range, and preserve
stable group identity while changing representation. The reusable package may
expose region inputs and lifecycle transitions, but a game decides camera
framing, vessel bubbles, importance, and the visual quality budget.

### 9. Physics and animation are adapters, not foundations

Most birds, fish, and insects should remain kinematic. Creating one rigid body
per ambient agent is expensive and makes flock motion harder to control.

Physics adapters may resolve contacts or promote selected nearby agents to
physical actors. Presentation adapters convert simulation state into instance
transforms and animation parameters such as speed, turn rate, grounded state,
or locomotion mode. Neither concern enters `life/core`.

### 10. Large worlds preserve continuity selectively

`life` must not imply that every creature on a planet is instantiated or
advanced on every fixed tick. Large worlds use a hierarchy of representations:

1. **Habitat distribution** describes where a species can plausibly occur and
   the approximate carrying capacity of a region.
2. **Population cells** retain aggregate counts, activity, disturbance, and a
   last-updated time without creating individual agents.
3. **Active groups** represent nearby flocks, schools, herds, pods, or crowds
   with stable group identity and coarse movement state.
4. **Persistent individuals** retain identity only when observation,
   interaction, injury, missions, tagging, or authorship makes continuity
   meaningful.
5. **Presented agents** are the bounded nearby subset receiving individual
   steering, animation, detailed perception, and collision tests.

Promotion and demotion change representation, not world meaning. An observed
whale may move from an active pod into a persistent individual record; leaving
the simulation bubble demotes it to route progress and coarse state rather
than deleting it. Returning later advances that bounded record over elapsed
world time and reconstructs a plausible current position. It does not replay
every missed fixed tick and does not leave the whale frozen awaiting the
player.

Lifecycle policy must include hysteresis beyond the visible region, forbid
visible pop-in or despawning, and pin followed, targeted, recently interacted,
or otherwise important actors until a safe transition is available. Ambient
individuals may be reconstructed deterministically from world seed, habitat,
group seed, coarse time, and persistent disturbance overlays.

The reusable package may provide representation records, deterministic
materialization inputs, bounded elapsed-time advancement hooks, and
promotion/demotion policies. The consuming game owns save schema, authored
importance, mission relevance, and the exact promise of persistence.

### 11. Vegetation informs habitat without becoming life

`scatter` continues to own deterministic distribution and streaming of mostly
static trees, shrubs, grass, rocks, coral, and similar world objects. `life`
reads that world through narrow obstacle and habitat queries; neither package
imports the other in its core.

Examples include canopy density contributing cover, grass density contributing
grazing capacity, forest edges influencing herd movement, and individual tree
or coral bounds acting as obstacles. Persistent removal, burning, or damage is
a sparse scatter/world overlay supplied to both systems by the consumer.

`life` may consume resulting habitat capacity and disturbance values, but it
does not own vegetation growth, terrain editing, or the scatter population.

### 12. Interaction uses observations, hazards, and optional physics promotion

Ambient actors remain kinematic by default. Physics adapters expose nearby
terrain, structures, vehicles, swept collision volumes, and contact results
without requiring one rigid body per creature. Continuous hazards such as
rocket exhaust, heat, pressure, noise, toxicity, or dust are sampled as fields
or volumes rather than modeled as ordinary rigid-body contact.

The reusable layer reports factual events such as detection, avoidance
attempt, disturbance, exposure, impact, injury, incapacitation, and death. It
does not decide morality, reputation, mission failure, legal protection, or
player blame. Those interpretations belong to the consuming game.

An exceptional nearby actor may be temporarily promoted to a physics-backed
presentation after impact or incapacitation. That is an optional adapter state,
not the default simulation model and not a dependency of `life/core`.

## Proposed data model

```ts
interface LifeAgentState {
  readonly id: number;
  position: LifeVector3;
  velocity: LifeVector3;
  forward: LifeVector3;
  maxSpeed: number;
  maxAcceleration: number;
  radius: number;
  groupId?: number;
}

interface LifeHabitatSample {
  valid: boolean;
  surfacePosition?: LifeVector3;
  surfaceNormal?: LifeVector3;
  elevation?: number;
  depth?: number;
  flow?: LifeVector3;
  wind?: LifeVector3;
  tags?: readonly string[];
}

interface LifeObservation {
  readonly sourceId: number | string;
  readonly position: LifeVector3;
  readonly velocity?: LifeVector3;
  readonly distance: number;
  readonly tags: readonly string[];
}
```

The hot simulation may use structure-of-arrays storage internally. Public
interfaces must not force consumers to mutate internal arrays or allocate one
object per agent per tick.

## Proposed package layout

```text
projects/triangular-engine/life/
  core/                       # framework-free simulation and contracts
    life-vector.ts
    life-agent.ts
    life-intent.ts
    life-random.ts
    life-spatial-hash.ts
    life-steering.ts
    life-simulation.ts
    life-perception.ts
    life-simulation-lod.ts
    behaviors/
      flocking.ts
      wander.ts
      seek-flee.ts
      arrive-pursue.ts
      obstacle-avoidance.ts
      habitat-constraint.ts
  terrain/                    # terrain habitat adapter
  scatter/                    # streamed obstacle/semantic query adapter
  water/                      # aquatic volume/depth/flow adapter
  spline/                     # route and territory adapter
  three/                      # instanced transforms and presentation helpers
  engine/                     # optional Angular hosts/services
  public-api.ts
  ng-package.json
  README.md
```

The exact adapter folders are validated against Angular package constraints
before implementation. Optional integrations must not pull their dependencies
into consumers that use only `life/core`.

## Phases

### Phase 0 — Joy-first bird spike

- [ ] Add a demo-local fixed-step flock with separation, alignment, cohesion,
      and wander.
- [ ] Render approximately 50 low-poly birds using instancing or another
      single-/few-draw-call path.
- [ ] Keep birds within a configurable volume above an existing terrain.
- [ ] Add one moving player influence and predictive flee/avoidance.
- [ ] Query nearby tree scatter cells and avoid conservative canopy volumes.
- [ ] Add minimal controls for flock size, behaviour weights, and debug
      vectors/obstacles.
- [ ] Record what contracts were genuinely required before extracting code.

Exit gate: the scene is visibly enjoyable, birds neither tunnel through the
terrain nor repeatedly collide with the player/canopies, and the implementation
reveals a small stable core worth extracting.

### Phase 1A — Framework-free movement core

- [ ] Create the `triangular-engine/life` secondary entry point.
- [ ] Define vector, state, intent, habitat, obstacle, and influence contracts.
- [ ] Implement fixed-step integration and deterministic seeded randomness.
- [ ] Implement spatial hashing with stable neighbour ordering.
- [ ] Implement separation, alignment, cohesion, wander, seek, flee, and
      arrive as allocation-free steering behaviours.
- [ ] Extract the bird spike onto this core without changing its feel.

Tests: deterministic replay for a fixed seed; no NaN state from coincident
agents; stable tie-breaking; speed and acceleration limits; fixed-step
agreement under different render-frame sequences; spatial-hash neighbour
results agree with a brute-force reference.

Exit gate: `life/core` has no Angular, Three.js, or sibling-entry-point imports,
and the bird demo behaves equivalently on the extracted implementation.

### Phase 1B — Terrain, scatter, and dynamic influences

- [ ] Terrain habitat adapter for surface position, normal, and clearance.
- [ ] Scatter obstacle adapter querying nearby streamed cells without copying
      the scatter population.
- [ ] Predictive obstacle avoidance using position, velocity, radius, and
      look-ahead time.
- [ ] Dynamic influence query suitable for players and other creatures.
- [ ] Lightweight perception filtering by distance, field of view, and tags.
- [ ] Debug visualization for neighbour, obstacle, habitat, and influence
      queries.

Exit gate: birds avoid moving players and streamed tree canopies while terrain
and scatter remain unaware of `life`.

### Phase 2 — Presentation and simulation LOD

- [ ] Three.js instance-transform writer with interpolation between fixed
      simulation ticks.
- [ ] Presentation parameters for speed, turn rate, and locomotion state.
- [ ] Active, reduced, ambient, and sleeping update policies.
- [ ] Stable transitions between simulation levels without identity loss or
      visible teleportation.
- [ ] Performance fixtures for 100, 1,000, and 10,000 simple agents, with
      target budgets documented from measured demo hardware rather than guessed
      in advance.

Exit gate: distant life becomes cheaper predictably, and rendering does not
force one Angular component or rigid body per agent.

### Phase 3 — Fish and routes

- [ ] Water habitat adapter exposing valid volume, surface, depth, and flow.
- [ ] Fish-school demo reusing the flocking core with depth-band constraints.
- [ ] Spline route adapter for migration, patrol, river following, and home
      ranges.
- [ ] Group split/merge behaviour when obstacles or threats divide a flock.
- [ ] Optional trail integration for debugging and stylized consumers.

Exit gate: birds and fish use the same simulation primitives with different
habitats and presentation, demonstrating that the abstraction is not secretly
an aviation package.

### Phase 4 — Game-directed creatures

- [ ] Document the brain/intent boundary with a consumer-owned state machine.
- [ ] Provide a small reference state machine: idle, wander, alert, flee,
      recover. Keep it optional and outside agent state.
- [ ] Demonstrate a game-owned need selecting between food, water, shelter,
      and flee intents without adding needs to `life/core`.
- [ ] Add `targetReached`, `threatDetected`, `stuck`, sleep, and wake events.
- [ ] Define promotion hooks for a nearby ambient agent becoming a richer game
      entity while preserving identity.

Exit gate: a consumer can build a goal-driven animal without forking movement
or perception and without `LifeAgent` acquiring game-specific fields.

### Phase 5 — Optional advanced consumers, only when demanded

Possible later work, each justified by a concrete game:

- utility-AI or behaviour-tree adapters that produce `LifeIntent`;
- perching and landing candidate queries;
- physics promotion/demotion adapters;
- aggregate off-screen population simulation;
- consumer-defined memory and sensory fields;
- network snapshot/replication helpers;
- climbing or amphibious locomotion modes.

None of these is required to call the initial package successful.

## Difficulty ladder for demos

Implement in an order where visual success arrives before contact-heavy edge
cases:

1. fireflies or plankton — free motion and almost no contact;
2. distant birds — flocking plus broad terrain clearance;
3. fish schools — bounded volume and depth constraints;
4. butterflies or insects — obstacle awareness with forgiving motion;
5. distant herds — terrain following and group movement;
6. birds that land or perch — precise approach and state transitions;
7. grazing quadrupeds — foot contact, slopes, turning, and animation;
8. predators and prey — target selection plus group reactions;
9. climbing or amphibious animals — changing contact and locomotion domains;
10. close-up dogs, horses, or humans — highest player expectations and the
    least tolerance for repetition, sliding, clipping, or shallow reactions.

The package should not use close-up quadrupeds or humans as its initial proof
of generality. They primarily test animation, authored behaviour, and content
quality rather than the reusable steering foundation.

## Integration rules

- `terrain`, `scatter`, `water`, `spline`, and physics entry points must never
  import `life` to satisfy an integration. Dependency points toward optional
  adapters owned by `life` or a narrower nested integration entry point.
- Core positions and calculations use the repository's established
  high-precision conventions where needed; rendering may derive f32 relative
  transforms at the presentation boundary.
- Floating-origin shifts must move or reinterpret simulation state exactly
  once. They must not appear as enormous agent velocities.
- Agents retain stable identifiers across spatial cells, LOD transitions,
  sleep/wake, and presentation changes.
- Queries use caller-provided reusable buffers in hot paths.
- Built-in behaviours expose explicit units and timestep assumptions.
- Debug visualizations are consumers of simulation state, never required for
  correctness.

## Non-goals

- A universal animal class or species database.
- A complete ecosystem, evolution, genetics, or reproduction simulator.
- A mandatory behaviour-tree, GOAP, or utility-AI framework.
- Navigation-mesh generation for humanoid characters.
- A universal animation graph or procedural foot-placement system.
- Combat, damage, inventory, quest, or faction systems.
- Making every ambient agent a physics body or Angular component.
- Cross-platform lockstep determinism in the first release.
- Claiming that a flocking demo proves convincing close-up animals.

## Risks

- **Fun spike becomes architecture work.** Phase 0 must remain demo-local until
  it produces a scene worth preserving.
- **God-agent scope creep.** Reject game-specific state from `LifeAgent`; add
  intents, observations, tags, or adapters instead.
- **Query abstraction becomes a world/entity framework.** Obstacle, influence,
  and habitat contracts remain read-only and narrow.
- **O(N²) neighbour and obstacle checks.** A brute-force implementation is a
  correctness oracle only; spatial indexing is required before large counts.
- **Overusing physics.** Kinematic simulation is the default; promote only
  nearby agents that need contact fidelity.
- **Visual quality mistaken for AI quality.** Landing, quadruped feet, and
  close-up animals require animation work beyond steering.
- **Hidden optional dependencies.** Adapters must not cause terrain, scatter,
  water, spline, or physics packages to enter the core consumer bundle.
- **Planetary precision.** World-space f32 accumulation can corrupt flocking
  at large coordinates; tests must cover floating-origin changes.
- **Determinism overpromised.** Stable seeded behaviour is required;
  bit-identical multiplayer lockstep is a separate design commitment.

## Verification

For each implementation phase, run the narrowest life tests before the full
library build:

```powershell
npx ng test triangular-engine --watch=false --browsers=ChromeHeadless --include='../life/**/*.spec.ts'
npm run build:triangular-engine
npx ng build demo-app --configuration development
```

Also confirm:

- `life/core` contains no Angular, Three.js, or sibling-entry-point imports;
- terrain, scatter, water, spline, Jolt, and Rapier do not import `life`;
- fixed-seed simulations replay deterministically in tests;
- neighbour queries match a brute-force reference;
- the demo is checked visually with debug rendering both enabled and disabled;
- unrelated working-tree changes remain untouched.

## Decision log

### 2026-08-05 — Initial proposal

- Chose `triangular-engine/life` as the working entry-point name because the
  intended scope includes birds, fish, insects, herds, and game-directed
  creatures rather than flocking alone.
- Defined the package as “body and senses with a replaceable brain.” This lets
  simple consumers use built-in ambient behaviour while deeper games layer on
  needs, goals, combat, persistence, and networking without replacing local
  movement and perception.
- Assigned terrain, scatter, water, spline, and physics support to adapters so
  existing world packages remain independent of `life`.
- Made a joy-first bird scene Phase 0 and delayed package extraction until the
  scene proves which contracts are real.
- Selected player avoidance and tree-canopy avoidance as the first two world
  interactions because together they exercise dynamic influences, streamed
  obstacles, prediction, and terrain-aware movement without requiring contact
  animation or full gameplay AI.
- Made simulation LOD foundational so the design can grow from dozens of
  close agents to large ambient populations without pretending every creature
  receives full AI at every distance.
- Explicitly accepted advanced game AI as a consumer while rejecting hunger,
  genetics, combat, inventories, and similar game semantics from core agent
  state.

### 2026-08-05 — Phase 0 implementation started

- Added the `triangular-engine/life` secondary entry point with framework-free
  agent state, vector helpers, flocking/avoidance behaviours, and fixed-step
  simulation.
- Added `life-lab`, a lazy-loaded demo route with 60 instanced birds, a simple
  terrain plane, tree-canopy obstacles, and a moving player influence.
- Added focused simulation tests for speed limiting and repeatability.
- Added the package README and entry-point documentation links.
- Deliberately left terrain/scatter adapters for the next phase; the first
  demo uses the same narrow obstacle/influence contracts directly so the core
  remains independent.

### 2026-08-07 — Procedural animal presentation study

- Extended `/life-lab` with a presentation POC comparing the existing
  primitive agents with articulated cutouts and shallow extruded relief.
- Built every animal from procedural Three.js `ShapeGeometry` or
  `ExtrudeGeometry`; the study does not depend on authored SVG, textures,
  skeletal meshes, or external model assets.
- Kept rendering efficient by using one `InstancedMesh` per articulated part,
  rather than one scene object or Angular component per animal. Birds use a
  body and two wings; fish use a body, tail, and two fins; herd animals use a
  body, head, tail, and four one-joint legs.
- Started with birds because a side-view body crossed with top-view wings gives
  a readable semi-3D silhouette and wing-flap animation with very little rig
  complexity. This was the strongest result of the study.
- Added fish to test whether the same technique transfers to free-swimming
  motion. A side silhouette plus separately animated tail and top-plane fins
  was sufficient for an abstract school presentation.
- Added a distant herd to test grounded animals while deliberately avoiding a
  realistic horse rig. The first version exposed two important failure modes:
  side silhouettes were mapped onto the wrong local plane, making animals look
  flattened, and tails rotated around an ineffective axis, making them read as
  detached paddles. Mapping the silhouettes onto a true vertical longitudinal
  plane, simplifying the body, reducing gait bounce, and giving the tail a
  tapered backward curve with lateral swish produced an acceptable distant
  herd.
- The visual treatment is intentionally conceptual: recognizable silhouettes,
  a few semantic joints, flat colour, and restrained motion. It is not intended
  for close-up quadrupeds, accurate foot planting, or realistic locomotion.
- Keep the current geometry, proportions, species silhouettes, and animation
  timing demo-local. They are presentation content, and the study has not yet
  revealed a stable universal animal-rig API worth publishing.
- A later `life/three` extraction may own generic allocation-free helpers for
  writing interpolated agent transforms into multipart instanced meshes and
  exposing presentation signals such as speed, turn rate, grounded state, and
  locomotion phase. It should not own bird, fish, horse, or other species
  definitions.
- Extraction gate: build at least one more independent consumer using the same
  multipart instance writer. Extract only the shared transform/presentation
  mechanism that survives both consumers without species-specific branches.
