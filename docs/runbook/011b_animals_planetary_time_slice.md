# Animals planetary-time reconstruction slice

Status: active. Milestone 2A checkpoints 1–4 are implemented; one timed
consequence event is next.

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

## Headed acceptance

Add a small lab using the same core as the tests:

- universal-time scrubber plus 1x–10,000x controls;
- enter/leave observer range;
- aircraft disturbance toggle or simple flight path;
- visible aggregate/materialized/waiting/fleeing/landed state;
- record one consequence event and scrub before/after it;
- show stable group/member IDs and bounded-work diagnostics.

The lab must display authored versus automatically derived inputs explicitly.

## Ordered implementation

- [x] 1. Freeze stable group identity, universal-time, and stable coordinate
     contracts. The sparse event contract remains checkpoint 5, where its actual
     query semantics can be tested.
- [x] 2. Implement one pure analytical group timeline with bounded direct
     sampling.
- [x] 3. Materialize the sampled group through existing flock primitives.
- [x] 4. Add residency handoff and unload/reload tests.
- [ ] 5. Layer one timed consequence event without mutating the baseline
     generator.
- [ ] 6. Integrate aircraft disturbance and one deterministic perch affordance.
- [ ] 7. Add the shared headed lab and documentation.
- [ ] 8. Only then add automatic habitat selection, seasonal migration, ground
     herds, aquatic groups, or statistical populations.

## Explicit deferrals

- Automatic world-scale migration route discovery.
- Full spherical local navigation and floating-origin adapters beyond the
  stable contract test.
- Fish, whales, boats, water-volume connectivity, and shorelines.
- Population births/deaths/capacity beyond the one consequence proof.
- Nest construction, parenting, predators, and detailed ecology.
- Physics damage and collision resolution; the game reports their outcomes as
  events.
- Multiple writable historical branches until the consuming game chooses a
  timeline policy.

## Definition of done

This slice is complete when the same deterministic core is runnable headlessly
and watchable in the lab; arbitrary-time reconstruction is bounded; local
materialization and unload/reload are stable; aircraft disturbance works; one
persisted consequence survives reconstruction; and every authored shortcut is
visible and documented.
