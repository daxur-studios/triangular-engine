# Animals planetary-time reconstruction slice

Status: active. The deterministic primitives exist, but the headed proof is
being rebuilt as small additive phases. No headed phase is complete until it
is both automatically tested and visually accepted.

Parent design: [011_animals_sublibrary.md](011_animals_sublibrary.md).
Related designs:
[009-dynamic-habitats-seasons-migration.md](009-dynamic-habitats-seasons-migration.md),
[012_navigation_sublibrary.md](012_navigation_sublibrary.md), and
[014_procedural_sublibrary.md](014_procedural_sublibrary.md).

## Why this slice exists

The current `triangular-engine/animals` entry point can produce a deterministic
nearby flock, steer it around terrain, react to a moving disturbance, cull it,
and land an individual at a supplied point. It cannot yet answer the planetary
question:

> Given a world seed, stable planetary location, event history, and universal
> time, which animal group exists here, what is it broadly doing, and what
> should materialize when an observer arrives?

At 1x–10,000x time warp, or when selecting an arbitrary past or future time,
the answer cannot come from replaying every boid tick. This slice establishes
the reconstructable boundary before adding migration, herds, fish, or ecology.

## State model

```text
world seed + stable planet/cell/group IDs + universal time + environment
                              |
                              v
             reconstructable group baseline state
                              |
                 + authoritative sparse events
                              |
                              v
               effective group state at query time
                              |
             observer/interaction requires detail?
                    /                         \
                  no                           yes
          aggregate record          materialized local agents
                                           |
                              fixed-step steering/navigation
```

The baseline is deterministic and cheap to query. Events contain consequences
that cannot be regenerated from seed alone: an animal killed by a collision, a
nest removed by construction, a protected area established, or a flock driven
away for a bounded interval.

The game owns authoritative history and gameplay outcomes. The animals library
owns pure reconstruction/materialization mechanisms and serializable contracts.

## First proving scenario

Use one bird group in one stable planetary cell with two authored semantic
destinations supplied by the game adapter: a feeding area and deterministic
tree-perch sockets.

1. Query the group at universal time `T` without simulating missed seconds.
2. Materialize stable member IDs when an aircraft/player observer approaches.
3. Run the existing fixed-step flock and disturbance response locally.
4. Allow a bird to land at a consumer-provided perch socket.
5. Dematerialize when no observer or interaction keeps the group resident.
6. Query the same seed/cell/time again and reconstruct a compatible baseline.
7. Add one explicit vehicle or construction consequence event and prove that
   it changes later reconstruction without perturbing unrelated groups.

Abstract birds and authored habitat data are sufficient. Planet rendering,
animation, procedural species meshes, and automatic habitat discovery are not
part of this proof.

## Required contracts

Names are provisional until implementation review.

- A stable group key containing world/planet, population cell, species/group,
  and seed identity without renderer-relative coordinates.
- An authoritative universal-time input; local simulation time must remain a
  separate bounded fixed-step clock.
- A pure group-baseline sampler that evaluates broad position, activity,
  destination/progress, and population/member count directly at a query time.
- A deterministic materializer that derives stable visible member IDs and
  offsets from the effective group state.
- A sparse, stably ordered event overlay with explicit effective times and
  affected stable IDs or regions.
- A residency handoff that distinguishes aggregate, materialized, interacting,
  and explicitly tracked state.
- A consumer adapter boundary for planetary coordinates, terrain/habitat
  samples, affordances, and disturbances.

Concepts may be selectively ported from the isolated `triangular-engine/life`
experiment after API review. Production `animals` code must not import `life`,
and no compatibility export should join the entry points.

## Navigation boundary

This slice does not wait for complete planetary pathfinding.

- The group baseline may use an authored deterministic route between semantic
  destinations and evaluate progress directly from universal time.
- Existing animal steering handles the bounded nearby flock.
- Existing navigation primitives may validate small local surface movement,
  but spherical streamed navigation, automatic macro migration corridors, and
  unrestricted air/water routing are not implemented yet.
- Later ground migration uses coarse habitat regions plus local terrain
  navigation. Birds and aquatic animals require domain-specific air or water
  corridors rather than a dense planetary 3D grid.

Navigation decides how a materialized animal can move through local geometry.
It does not own population history, universal time, activity choice, or
collision consequences.

## Determinism and consequence policy

Given identical seed, stable IDs, environment version, event history, and query
time, aggregate reconstruction and initial materialization must be identical.
Exact centimetre-level replay after arbitrary observer histories is not
required. Local motion remains deterministic while continuously observed.

Rewinding and merely observing an old time is supported by evaluation. Acting
after rewind needs an explicit game policy and remains open:

- branch history from the selected time;
- replace later events on the current timeline; or
- make historical viewing read-only.

The library must not silently choose among these policies.

## Automated acceptance

The first runnable tests should prove:

1. Same key, environment, events, and `T` produce byte-equivalent aggregate
   group state and member IDs.
2. Querying `T + years` performs bounded work and does not replay fixed ticks.
3. Query order, unrelated groups, and observer ordering do not change results.
4. Materialize → dematerialize → materialize at the same `T` produces a
   compatible flock.
5. Continuous local observation remains fixed-step deterministic.
6. A vehicle disturbance changes local steering but does not permanently alter
   baseline history unless the game records a consequence event.
7. A timed consequence affects queries at/after its effective time, not before.
8. Rewinding before that event restores the pre-event effective state.
9. A consequence targeting one group does not reshuffle another group.
10. All authoritative coordinates remain stable across floating-origin render
    rebases.

## Revised target: one animal API across world shapes

The supported proof matrix is mandatory, not a later port:

- infinite plane terrain;
- planet-scale spherical terrain;
- the inhabited inside wall of a cylinder.

Air flocks, land herds, and aquatic schools must consume the same animal API.
Shape-specific coordinate mapping belongs in world adapters. Species policies
must not contain `plane`/`sphere`/`cylinder` branches.

The headed lab is a thin consumer. It may supply a world seed, Universal Time,
observer, terrain/water adapters, species definitions, and rendering. It must
not contain authored routes, destination coordinates, activity schedules,
movement equations, landing order, or special-case animal decisions. A visual
claim is accepted only after the same framework-free scenario passes headlessly.

## Revised ordered milestones

Existing identity, bounded-time sampling, residency, and sparse-event code is
useful foundation, but the caller-authored destination timeline is only a test
fixture. It is not the game-facing population API.

- [x] 1. **World-domain contract.** Add a framework-free animal world adapter
     over terrain domain/field sampling. It exposes stable world coordinates,
     local tangent axes, `surfaceUp`, surface normal, slope, walkability,
     projection, and movement along a surface. Prove identical contract tests
     for plane, sphere, and inside-cylinder topology, including angular wrap.
     Implemented by `AnimalWorldSurface` and the optional
     `triangular-engine/animals/terrain` adapter. The built-package
     `animals:surface-scenarios` runner verifies all three shapes without a
     browser.
- [x] 2. **Water-volume contract.** Add containment, water surface, bottom,
     depth, shoreline/blocked state, flow, and segment-clearance queries. Prove
     that a volume sample can reject land, above-water positions, and positions
     below terrain for all three shapes.
     Implemented by `AnimalWaterVolume` and the optional
     `triangular-engine/animals/water` adapter. Pure water sampling was split
     from the Angular service, and `animals:water-volume-scenarios` verifies
     water/air/bottom classification and crossing rejection for all shapes.
- [x] 3. **Deterministic population query.** Implement a bounded direct query
     from world seed, region/cell, species definition, habitat version, and
     Universal Time to aggregate animal groups. Habitat suitability chooses
     existence, activity, and coarse location; callers do not author routes or
     destinations. Query order, frame rate, unloading, and revisiting must not
     change the result.
     Implemented by `queryAnimalGroups()`. It uses fixed procedural group slots,
     stable versioned identities, bounded habitat candidates, and direct
     Universal-Time activity decisions. `animals:population-scenarios` verifies
     order independence, negative-time revisits, valid habitat positions, and
     absence when no viable habitat exists on all three shapes.
- [x] 4. **Generic local materialization.** Materialize aggregate groups into
     stable nearby individuals and return them to aggregate residency. Keep
     identity, persistence overlays, and floating-origin coordinates stable.
     Move flight-specific formation shaping out of the generic layer.
     Implemented by `materializeLocalAnimalGroup()` and
     `handoffLocalAnimalGroupResidency()`. The new path branches only on air,
     land, or water; topology and distance remain adapter-owned. The legacy
     XZ/Y-up flight helper is explicitly deprecated and isolated from this path.
     `animals:materialization-scenarios` verifies the full 3 locomotion × 3
     world-shape matrix, clearances, bounded resident detail, and exact reload.
- [x] 5. **Shape-neutral movement constraints.** Implement reusable tangent-
     surface and volume movement kernels before species presentation. Test
     finite values, clearance, blocked-region avoidance, sphere continuity,
     cylinder wrap, bounded work, and deterministic fixed-step results.
     Implemented by `stepConstrainedAnimalMovement()`: desired motion remains
     policy-owned while the kernel enforces acceleration, speed, bounded
     substeps, walkability, local-up altitude, and water-column clearances.
     Water curvature transport is owned by `AnimalWaterVolume`, not the core.
     `animals:movement-scenarios` executes the 3 locomotion x 3 world-shape
     matrix, including negative plane coordinates, sphere-frame continuity,
     cylinder angular wrap, deterministic repeats, and unchanged work-limit
     rejection. Colocated specs cover invalid origins/configuration and blocked
     land/water movement.
- [ ] 6. **Air-flock policy.** Add cohesive bird-like flight, separation,
     alignment, altitude clearance, habitat choice, and group-level roosting.
     Trees expose capacity through habitat data. Birds distribute across nearby
     trees; when capacity is insufficient, overflow keeps a cohesive holding
     pattern. Landing and departure are policy behavior, never page animation.
     The framework-free core is implemented by `stepAnimalAirFlock()` and
     `allocateAnimalRoosts()`. Capacity creates stable, distinct tangent-frame
     slots rather than stacking birds at one coordinate. The browser-free
     `animals:air-flock-scenarios` runner verifies deterministic allocation,
     cohesive constrained flight, six assigned roost slots, two holding
     overflow members, stationary perching, and unified departure on plane,
     sphere, and inside-cylinder worlds. Colocated specs cover bounds,
     input-order independence, altitude enforcement, and duplicate identities.
     This milestone remains open until a thin headed consumer renders these
     same scenario states and receives visual acceptance.
     `sampleAnimalAirFlockCycle()` additionally reconstructs a repeatable local
     roost/fly/return cycle directly from arbitrary positive or negative
     Universal Time with work capped to one configured cycle. The same
     three-shape scenario verifies distant-time equivalence and bounded replay;
     it does not claim world-scale migration or evolving ecology.
     The separate `/animals-worlds-lab` route is the thin headed consumer: it
     calls that sampler for every displayed snapshot, shows all three shapes,
     supports direct Universal-Time scrubbing and -50x through 50x playback,
     and derives real perch candidates from reusable procedural oak sockets.
     It contains rendering fixtures but no routes, member motion equations, or
     page-owned landing/departure decisions. The demo build passes; human visual
     acceptance is still pending.
- [ ] 7. **Land-herd policy.** Add walkable-surface movement, cohesion,
     grazing/rest activity, grazing-patch choice, slope limits, and blocked
     terrain avoidance. Prove herds remain on the valid surface in every shape.
     The framework-free core is implemented by `stepAnimalLandHerd()` and
     `sampleAnimalLandHerdCycle()`. It adds species slope limits to the shared
     movement kernel, bounded suitability/range-aware pasture allocation,
     stable grazing/rest anchors, cohesion/separation/alignment, and bounded
     local detours without claiming global route discovery. The browser-free
     `animals:land-herd-scenarios` runner verifies surface confinement,
     deterministic allocation, settled grazing, still resting, blocked-region
     response, direct Universal-Time reconstruction, and bounded distant-time
     queries on plane, sphere, and inside cylinder. Colocated specs cover the
     same contracts. The separate `/animals-herd-worlds-lab` route is a thin
     headed consumer of `sampleAnimalLandHerdCycle()`: it supplies only the
     three terrain adapters, habitat fixtures, Universal-Time controls, and
     rendering. The demo build passes; the milestone remains open pending human
     visual acceptance.
- [ ] 8. **Aquatic-school policy.** Add schooling, connected-water habitat
     choice, depth-band behavior, shoreline avoidance, and continuous surface/
     bottom clearance. Prove fish never enter land, leave water, or pass below
     terrain in every shape.
     The framework-free core is implemented by `stepAnimalAquaticSchool()` and
     `sampleAnimalAquaticSchoolCycle()`. It adds same-body habitat selection,
     stable school slots, cohesion/separation/alignment, flow response, a
     species depth band, and bounded local shoreline/bottom detours. The
     browser-free `animals:aquatic-school-scenarios` runner verifies local
     water-surface transport, body continuity, surface/bottom/depth clearance,
     settled feeding/rest, invalid-segment response, direct Universal-Time
     reconstruction, and bounded distant queries on plane, sphere, and inside
     cylinder. A regression now prevents non-origin plane transport from
     teleporting toward world zero. Colocated specs cover the same contracts.
     The separate `/animals-fish-worlds-lab` route is a thin headed consumer of
     `sampleAnimalAquaticSchoolCycle()` using real terrain/water adapters for
     all three shapes. It supplies only water/habitat fixtures, Universal-Time
     controls, and rendering. The demo build passes; the milestone remains open
     pending human visual acceptance.
- [ ] 9. **Interaction and consequences.** Apply vehicles, aircraft, boats,
     construction, terraforming, loss/displacement events, and unload/reload
     reconstruction through shared APIs. Persistent events layer over the
     deterministic baseline without replaying all elapsed time.
     The first shared core slices are implemented. `resolveAnimalDisturbances()`
     performs bounded, deterministic surface/water proximity queries using the
     topology adapters; its browser-free runner covers surface height and water
     depth separation on plane, sphere, and inside cylinder.
     `queryEffectiveAnimalGroups()` overlays member loss, temporary displacement,
     and permanent habitat invalidation at explicit Universal Times. Its runner
     verifies direct rewind/expiry reconstruction and input-order independence
     on all three shapes. This milestone remains open: the species policies do
     not yet consume disturbance hits, no game interaction adapter writes the
     consequence events, and no headed interaction proof has visual acceptance.

Each milestone requires colocated unit tests, a serializable deterministic
scenario, a browser-free scenario runner, the full three-shape matrix where
applicable, and a headed view that only renders scenario snapshots. Visual
acceptance is required before advancing presentation complexity.

## Explicit deferrals

- Automatic world-scale migration route discovery.
- Detailed world-scale seasonal migration route discovery beyond habitat-driven
  regional movement.
- Boats and whales beyond the shared aquatic interaction contracts.
- Population births/deaths/capacity beyond the one consequence proof.
- Nest construction, parenting, predators, and detailed ecology.
- Physics damage and collision resolution; the game reports their outcomes as
  events.
- Multiple writable historical branches until the consuming game chooses a
  timeline policy.

## Definition of done

This workstream is complete when one public, framework-free animal API drives
air flocks, land herds, and aquatic schools across infinite plane, planetary
sphere, and inside-cylinder worlds; direct Universal-Time reconstruction and
unload/reload are deterministic; surface and water constraints are enforced by
tests; interactions and one persisted consequence survive reconstruction; and
headed pages contain no authored movement or behavior shortcuts.

## Terrain checkpoint perch note (2026-08-18)

The terrain checkpoint briefly used large procedural `roostSlotSpacingM` values
to separate multiple birds. This was an incorrect page-level workaround: the
generic slot resolver moves same-roost slots along the sampled surface, which
can place birds away from the actual tree mesh. Do not use slot spacing to
invent branch geometry. The checkpoint now allows one bird per tree roost and
keeps overflow birds airborne in holding until real flora perch sockets and
ground landing are implemented.
