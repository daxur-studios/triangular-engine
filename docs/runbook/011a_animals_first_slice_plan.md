# Animals first slice execution plan

Status: first slice implemented; deterministic residency and smooth flock-motion
follow-ups are implemented and ready for visual review. Camera integration and full
streaming remain deferred.

Parent design: [011_animals_sublibrary.md](011_animals_sublibrary.md)

## Objective

Create the new `triangular-engine/animals` secondary entry point and prove one
small vertical slice:

> Given the same seed, terrain sampler, observer movement, disturbance, and
> simulation time, an abstract flock materializes consistently, remains above
> terrain, flees an approaching vehicle, recovers, and culls cleanly.

This plan covers contracts, deterministic foundations, the flock simulation,
and an isolated `/animals-lab` demo. It does not cover persistent planetary
populations, ground animals, perches, migration, seasons, aquatic life,
terraforming, reproduction, food webs, or rich animal interactions.

## Agent workflow

Luna is the implementation owner. Terra is the reviewing and verification
owner.

For every numbered step:

1. Luna implements only that step and runs its narrow tests.
2. Terra reviews the diff against this plan, runs or inspects the stated gate,
   and reports concrete findings.
3. Luna resolves accepted findings.
4. Terra confirms the gate before the next step begins.

The agents must work sequentially on shared files. Terra should not implement
an alternative design in parallel. If a contract must change after Step 2,
record the decision in this plan's change log and update the parent runbook.

Both agents must:

- Read the repository `AGENTS.md`, the package README, AI-agent guide, parent
  runbook, and this plan before editing.
- Check `git status --short` and preserve unrelated work.
- Not inspect, import, copy, rename, or modify `triangular-engine/life` or its
  demos. This is a clean implementation.
- Avoid changes to generated `dist/` and `out-tsc/` output.
- Keep public exports intentional and add colocated tests for behaviour.

## Fixed decisions

These are not open during the slice unless evidence shows the slice cannot be
completed:

1. Public import: `triangular-engine/animals`.
2. Framework-free simulation core; Three.js and Angular integration remain
   outside core.
3. Internal positions are plain readonly `{ x, y, z }` values, not `Vector3`.
4. The first terrain contract is a height-and-normal sampler suitable for a
   local plane. Planetary and floating-origin contracts are deliberately
   deferred, but public state must not assume a permanently fixed camera.
5. Nearby simulation uses a fixed step plus render interpolation.
6. Random choices are keyed by stable identifiers; there is no shared mutable
   random stream.
7. A flock is the simulation unit. Visible members have stable derived IDs but
   are not persistent population records.
8. The first disturbance is a moving spherical influence representing a
   vehicle.
9. Terrain clearance is enforced by projection/prediction, not full 3D
   navigation.
10. Time warp is bounded: local simulation consumes at most a configured number
    of fixed steps per update and then uses a documented coarse catch-up rule.
11. Rendering uses abstract low-cost geometry owned by the demo.
12. No public Angular service or component is required for the first slice.

## Proposed minimal public surface

Names may receive small clarity improvements during Step 1, but no additional
ecology concepts should be added.

```ts
type AnimalTime = number;

interface AnimalVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface AnimalObserver {
  readonly id: string;
  readonly position: AnimalVector3;
  readonly materializationRadius: number;
  readonly interactionRadius: number;
}

interface AnimalTerrainSample {
  readonly position: AnimalVector3;
  readonly normal: AnimalVector3;
}

interface AnimalTerrainSampler {
  sampleSurfaceAt(x: number, z: number): AnimalTerrainSample;
}

interface AnimalDisturbance {
  readonly id: string;
  readonly position: AnimalVector3;
  readonly velocity: AnimalVector3;
  readonly radius: number;
  readonly intensity: number;
}

type FlockActivity = 'travel' | 'flee' | 'recover';

interface AnimalPresentation {
  readonly id: string;
  readonly position: AnimalVector3;
  readonly forward: AnimalVector3;
  readonly speed: number;
  readonly activity: FlockActivity;
  readonly visible: boolean;
}
```

The core also needs definitions and runtime state for a flock, plus pure
functions or a small stateful runner for materialization, stepping, and
presentation. Do not expose speculative `Species`, `Population`, `Habitat`, or
`Interaction` APIs in this slice.

## Planned file shape

The implementation may consolidate very small files, but keep these layers
clear:

```text
projects/triangular-engine/animals/
  ng-package.json
  public-api.ts
  README.md
  core/
    animal-types.ts
    animal-hash.ts
    animal-hash.spec.ts
    fixed-step-clock.ts
    fixed-step-clock.spec.ts
    flock-definition.ts
    flock-materialization.ts
    flock-materialization.spec.ts
    flock-step.ts
    flock-step.spec.ts
    flock-presentation.ts
    flock-presentation.spec.ts
```

Demo files:

```text
projects/demo-app/src/app/pages/animals-lab/
  animals-lab-page.component.ts
  animals-lab-page.component.html
  animals-lab-page.component.scss
```

Workspace integration is expected in:

- `tsconfig.json`
- `angular.json`
- `projects/demo-app/src/app/app.routes.ts`
- `projects/demo-app/src/app/pages/demo-index/demo-index.component.html`
- `projects/triangular-engine/README.md`
- `projects/triangular-engine/docs/entry-points.md`
- `projects/triangular-engine/CHANGELOG.md`

Do not add a compatibility export from `triangular-engine/life`.

## Step 0 — clean baseline and contract audit

### Luna

- Read required guidance and record the current dirty files.
- Confirm the planned paths do not overlap unrelated changes.
- Check whether package scripts and Angular test inclusion require explicit
  animals entries.
- Add a brief implementation-start entry to the change log below.
- Do not create production code yet.

### Terra gate

- Confirm this plan is sufficient to implement without reading `life`.
- Flag only blockers to the first vertical slice.
- Confirm the proposed API is framework-free and contains no BSP-specific
  vehicle, planet, or rendering types.

### Exit criteria

- No unresolved ownership or coordinate question blocks a local-plane flock.
- Exact files to be changed are known and unrelated changes are preserved.

## Step 1 — secondary entry point and deterministic primitives

### Luna

- Create `animals/ng-package.json`, `public-api.ts`, and `README.md`.
- Add the `triangular-engine/animals` TypeScript path.
- Ensure animals specs are included by the library test target if required.
- Implement plain vector helpers needed internally without exporting a general
  math library.
- Implement a stable keyed 32-bit hash/random sampler using explicit string or
  integer keys.
- Implement stable flock-member IDs derived from world seed, flock ID, and
  member index.
- Export only the contracts required by the slice.

### Required tests

- Identical keys return identical values.
- Different decision namespaces do not share mutable state.
- Asking for an unrelated flock/member does not change existing results.
- Output ranges and edge inputs are documented and tested.

### Terra gate

- Review hash math for JavaScript integer coercion and platform stability.
- Review the public API for accidental Three.js, Angular, BSP, or `life`
  dependencies.
- Confirm a consumer can import the entry point after a library build.

### Exit criteria

- Narrow animal primitive specs pass.
- `npm run build:triangular-engine` resolves the new entry point.

## Step 2 — fixed-step clock and bounded time warp

### Luna

- Implement a clock/accumulator that accepts authoritative target time.
- Produce zero or more fixed simulation steps and an interpolation fraction.
- Cap local steps per update.
- When the cap is exceeded, report or return the skipped/coarse interval rather
  than silently running an unbounded loop.
- Reject or explicitly handle backward local stepping; do not pretend local
  flock physics can reverse.
- Document units and invalid inputs.

### Required tests

- Equivalent elapsed time split across different render-frame sequences yields
  the same fixed-step count and simulation time.
- A very large time delta executes no more than the configured maximum steps.
- Interpolation remains within `[0, 1]`.
- Pause and resume do not introduce extra steps.
- Backward time is surfaced deterministically for reconstruction by a higher
  layer.

### Terra gate

- Try adversarial deltas: zero, negative, extremely large, and floating-point
  boundary values.
- Confirm the clock does not conflate render time with future population time.

### Exit criteria

- Frame-rate independence and bounded work are demonstrated in tests.

## Step 3 — deterministic flock materialization

### Luna

- Define the smallest serializable flock definition: stable ID, seed, member
  count, home/anchor position, initial travel direction, preferred speed,
  separation/cohesion/alignment ranges, flight clearance, and materialization
  radius.
- Derive stable initial member offsets, headings, and small speed variation.
- Materialize when an observer is within range and dematerialize outside a
  separate hysteresis radius.
- Keep identity independent of array ordering and unrelated observers.
- For multiple observers, use deterministic union residency; do not duplicate
  a flock or its members.

### Required tests

- Same definition and observer state yields identical member states and IDs.
- Observer entry/exit hysteresis prevents boundary flicker.
- Two observers do not duplicate members.
- Adding an unrelated observer or flock does not reshuffle member state.
- Culling removes presentation work without destroying the flock definition.

### Terra gate

- Review state ownership at materialize/dematerialize boundaries.
- Confirm no camera-specific assumptions entered the public contracts.

### Exit criteria

- Stable flock residency and identities are proven without rendering.

## Step 4 — travel flock and terrain clearance

### Luna

- Implement fixed-step cohesion, separation, alignment, and preferred travel
  steering.
- Apply explicit acceleration, turn-rate, and speed limits.
- Sample terrain ahead and below each member.
- Maintain minimum clearance using anticipatory climb plus a final safety
  projection so members cannot remain below the sampled surface.
- Use bounded forces and safe vector normalization; prevent NaN propagation.
- Keep broad flock travel directional in this slice. Do not add waypoint
  selection or pretend this is migration.

### Required tests

- Members remain finite and within speed/acceleration bounds.
- Separation increases for overlapping members.
- Cohesion reduces excessive spread without collapsing all members to one
  point.
- Alignment reduces heading disagreement.
- A rising terrain fixture causes an early climb.
- No member finishes a step below minimum terrain clearance.
- Equivalent fixed-step sequences produce identical results.

### Terra gate

- Review order-dependence: each step must read a previous-state snapshot rather
  than partially updated neighbours.
- Stress zero-length vectors, overlapping members, steep terrain, and large but
  allowed fixed steps.
- Confirm no random wandering or short waypoint loop was introduced.

### Exit criteria

- A headless flock travels coherently and never remains under test terrain.

## Step 5 — vehicle disturbance, flee, and recovery

### Luna

- Detect disturbances using predicted closest approach as well as current
  distance so a fast vehicle can be noticed before contact.
- Implement three explicit activities: `travel`, `flee`, and `recover`.
- `flee` chooses a deterministic direction away from threat position and
  approach velocity while preserving group cohesion.
- Use minimum activity durations and hysteresis to prevent state flicker.
- `recover` gradually returns speed, cohesion, and direction toward travel
  settings before resuming `travel`.
- Multiple disturbances combine deterministically using stable sorting and a
  documented strongest-threat rule.

### Required tests

- An approaching disturbance triggers flee before overlap.
- A receding or distant disturbance does not repeatedly retrigger flee.
- Members generally move away without exploding the flock.
- Recovery occurs only after safety conditions and minimum duration.
- Equal threats resolve in stable ID order.
- A fast disturbance cannot tunnel through the detection logic between steps.

### Terra gate

- Review the behaviour as a state machine, not scattered booleans.
- Verify deterministic threat ordering and transition boundaries.
- Confirm no game-specific reward, damage, or vehicle component entered the
  library.

### Exit criteria

- Headless tests prove notice, flee, monitor/recover, and travel resumption.

## Step 6 — presentation snapshots and interpolation

### Luna

- Convert previous/current member state and interpolation fraction into
  immutable `AnimalPresentation` records.
- Derive forward safely from velocity with a stable fallback direction.
- Expose activity and speed without prescribing animation.
- Return no visible records for non-resident flocks.
- Avoid leaking mutable internal arrays or vectors.

### Required tests

- Interpolation endpoints match previous and current state.
- Output remains finite when speed is zero.
- Consumer mutation cannot alter simulation state.
- Culling produces no visible presentation entries.

### Terra gate

- Confirm presentation is renderer-neutral and sufficient for an abstract
  Three.js demo.
- Confirm interpolation affects rendering only, never deterministic state.

### Exit criteria

- A renderer can consume snapshots without knowing simulation internals.

## Step 7 — isolated `/animals-lab` demo

### Luna

- Add a lazy `/animals-lab` route and demo-index card.
- Build an isolated local-plane scene with visible uneven terrain.
- Render one abstract flock from presentation snapshots using low-cost geometry
  or an instanced mesh.
- Add a clearly visible controllable or automated vehicle proxy that emits one
  disturbance.
- Add concise controls for pause, time scale, seed/reset, disturbance on/off,
  and observer/materialization range.
- Display current activity, resident/member counts, fixed steps, and coarse
  skipped time.
- Make culling observable without requiring developer tools.
- Keep all mesh/material/UI choices inside the demo.

### Manual acceptance script

1. Reset twice with the same seed; compare flock layout and initial motion.
2. Approach and retreat across the residency boundary; check for flicker or
   duplicated members.
3. Drive the vehicle toward the flock; observe notice, flee, and recovery.
4. Approach from different directions and at high speed.
5. Pause and resume.
6. Change ordinary time scale and confirm stable coherent motion.
7. Apply an extreme time jump and confirm bounded work with an honest coarse
   interval indicator.
8. View birds against the terrain from low angles and confirm none remain
   underneath it.
9. Leave and return; confirm compatible identities rather than a random new
   flock.

### Terra gate

- Run the manual acceptance script and record pass/fail evidence.
- Inspect performance for avoidable per-frame allocation and unbounded
  neighbour work. Optimization beyond the fixture size is not required.
- Confirm the demo communicates limitations honestly: directional travel is
  not migration and coarse catch-up is not population simulation.

### Exit criteria

- The first playable promise is visible and repeatable.
- No animation assets are needed to understand behaviour.

## Step 8 — documentation and release gate

### Luna

- Document the supported imports and first-slice limitations in
  `animals/README.md`.
- Add the entry point to the package README and entry-point matrix.
- Add an Unreleased changelog entry.
- Update the parent runbook status and this plan's change log with actual
  results, deviations, and deferred findings.
- Do not claim populations, migration, planetary coordinates, backward replay,
  or ecology are implemented.

### Verification commands

Run the narrowest relevant animal tests first, then:

```powershell
npm test -- --watch=false --browsers=ChromeHeadless
npm run build:triangular-engine
```

Build or serve the demo when practical and perform the manual acceptance
script. If the complete test suite contains unrelated failures, record them
separately and prove the animal specs independently; do not modify unrelated
tests to make the gate green.

### Terra final gate

- Public imports resolve only through `triangular-engine/animals`.
- No `life` dependency or compatibility layer exists.
- Determinism, bounded time work, terrain clearance, materialization, flee,
  recovery, and interpolation have tests.
- Library build passes.
- Demo acceptance evidence is recorded.
- Documentation describes only shipped behaviour.

## Definition of done

The slice is complete only when all of the following are true:

- `triangular-engine/animals` is a buildable secondary entry point.
- Its simulation core has no Angular, Three.js, BSP, or `life` dependency.
- Stable keyed randomness and member identity are tested.
- Fixed-step simulation is frame-rate independent and time-warp work is
  bounded.
- Observer residency is deterministic and uses hysteresis.
- A flock travels coherently and maintains terrain clearance.
- A moving disturbance causes deterministic flee and recovery behaviour.
- Presentation snapshots are immutable and interpolated.
- `/animals-lab` demonstrates the complete slice with abstract visuals.
- Package documentation and the two animals runbooks reflect reality.

## Explicit deferrals

The following requirements remain recorded in the parent runbook and must not
be pulled into this slice:

- Persistent populations, births, deaths, and carrying capacity.
- Meaningful feeding, resting, and perching destinations.
- Ground navigation and ground herds.
- Seasons and migration.
- Bases, roads, and dynamic obstacle topology.
- Aquatic domains and fish.
- Colonisation, exclusion, and species introduction.
- Terraforming ecology.
- Predator/prey, play, cleaning, parasitism, parenting, and other multi-animal
  interactions.
- Detailed animal meshes and animation.

## Change log

### 2026-08-09: execution plan created

- Assigned Luna as sequential implementation owner and Terra as review and
  verification owner.
- Fixed the first slice around a deterministic, terrain-clearing flock with a
  vehicle disturbance and abstract demo presentation.
- Defined eight gated steps, acceptance tests, completion criteria, and strict
  deferrals.

### 2026-08-09: Luna implementation checkpoint

- Added the isolated `projects/triangular-engine/animals` entry point.
- Added deterministic hash, fixed-step clock, flock materialization/culling,
  terrain clearance, disturbance flee/recover, and immutable presentation
  primitives.
- Added colocated specs for the clock, materialization, and flock response.
- Focused TypeScript checking of the animals core passes; `git diff --check`
  passes.
- Full workspace TypeScript checking is blocked by the pre-existing syntax
  error in `projects/triangular-engine/jolt/jolt-leg/jolt-leg.component.ts`
  (line 102).
- Next gate is the isolated `/animals-lab` demo, followed by Terra review.
- Added the isolated `/animals-lab` route and demo page with abstract birds,
  terrain clearance, and an approach/release vehicle control.
- Added a demo-only time-scale slider (0–32×) and simulation-time readout so
  movement and flee response can be inspected without waiting in real time.
- Demo residency now applies every step around a fixed `(0,0,0)` observer with
  a 50 m radius, making culling observable before camera integration.
- Replaced the demo-only distance filter with the exported
  `updateFlockResidency()` contract. The lab now exposes an observer-distance
  slider and displays resident/culled state, distance, and visible count.
- Residency tests cover configured enter/exit thresholds, hysteresis, and
  observer radius. The simulation state is retained while culled so returning
  to range restores the same deterministic presentation IDs.
- `npm run build:triangular-engine` passes, including
  `triangular-engine/animals`.
- `npx ng build demo-app` passes; it reports only existing style-budget
  warnings.

### 2026-08-09: deterministic flock-motion follow-up

- Replaced straight-line velocity normalization with bounded, snapshot-based
  cohesion, alignment, separation, and broad directional travel steering.
- Added renderer-only interpolation between fixed simulation snapshots and a
  derived banking hint for abstract bird presentation.
- The lab now exposes 0–100x time scale and renders each bird aligned to its
  interpolated heading. Terrain semantics, migration, predators, and full
  streaming remain deferred.
