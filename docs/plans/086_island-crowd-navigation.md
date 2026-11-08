---
type: Plan
title: "Island crowd navigation"
description: "Sector flow-field navigation, crowd movement and rendering for thousands of villagers, platoons and creatures on an island."
timestamp: 2026-11-07T00:00:00Z
tags: [engineering-records, navigation, crowds, webgpu]
record: /docs/engineering-records/086_island-crowd-navigation.md
map_schema: 1
document_id: plan-086
initiative_id: "island-crowd-navigation"
performance: []
---

# Plan 086: Island crowd navigation

Status: **in progress** (grid-layers, sectors-portals and sector-fields done; goals-edits in progress). Evidence and decisions: [ER 086](/docs/engineering-records/086_island-crowd-navigation.md).

<!-- tri:scope -->

## Intended outcome

A fresh, framework-free navigation and crowd-movement system for a Black & White 2 style island: thousands of
villagers (target 10,000), platoons, catapults and a few large creatures sharing one heightfield island that
changes over time (buildings placed, roads built and preferred, gates opened and closed, resources harvested).
Work scales with the number of distinct destinations, not the number of agents: agents read shared sector flow
fields over a fine cost grid, with a portal graph for long routes and incremental repair after edits. Crowds are
drawn with capsule humans near the camera and as cheap shader-drawn dots or marks from far away.

Constraints: the core runs in a web worker (pure, worker-safe entry with no Angular imports), simulation state is
in typed arrays, and step-driven scenarios are deterministic. Rendering uses WebGPU and TSL.

Out of scope for now: hard collision between agents (soft separation only, as in BW2), cell-planet navigation
(cells are too coarse), multi-level ground such as walkable ground under bridges, and lockstep multiplayer
determinism (see Q2). The existing `triangular-engine/navigation` entry stays untouched until this replaces it.

## Phases and acceptance

- **grid-layers** — Island navigation grid built from a heightfield: Uint8 cost layers (terrain/slope, structure, road, territory), a flag layer, and a clearance field (distance transform) that unit classes threshold. A demo page draws every layer as a terrain overlay. Acceptance: unit specs for slope cost, clearance and layer composition pass headless; the demo page shows the overlays on a generated island with no console errors.
- **sectors-portals** — 64×64-cell sectors with edge portals per clearance class and an abstract portal-graph path query. Acceptance: specs show villagers route through a gap that creatures cannot pass, and an abstract query on a 2,048² grid returns a sector corridor; the overlay shows sectors and portals.
- **sector-fields** — Lazy flow fields built only in the corridor's sectors, cached by (goal, class) with per-sector versions and LRU limits; agents sample direction bilinearly and add soft separation from a spatial hash. Acceptance: a step-driven scenario moves 1,000 villagers to one goal with all arrivals and a recorded field build time per sector; the overlay shows flow arrows.
- **goals-edits** — Multi-source goal fields (nearest tree, storehouse, free house), road cost multipliers, and incremental edits: placed buildings, finished roads, gate toggles and terrain edits rebuild only touched sectors and repair cached fields lazily. Acceptance: scenarios for a building dropped on an active route and a gate closing mid-route complete with no agent inside a blocked cell, and specs show untouched sectors keep their versions.
- **worker-scale** — The worker owns the navigation world and simulation; the main thread sends edits and goal requests and reads a positions buffer; field rebuilds have a per-tick budget; movement LOD lowers the tick rate for distant agents and moves off-screen agents along portal paths. Acceptance: a 10,000-villager scenario runs in the demo with simulation time per tick and frame time recorded through `triangular-engine/testing`.
- **crowd-rendering** — Three-tier crowd LOD fed from one storage buffer of previous and current agent state, interpolated on the GPU between simulation ticks, with feet sampling the drawn ground height: (1) near: full `CapsuleCharacterActor`s for the few closest or selected agents; (2) mid: an instanced "crowd capsule" whose body and rubber-hose limbs are bent in a TSL vertex stage from per-instance locomotion phase, in one or two draw calls; (3) far: a crowd layer on the terrain material (dots up close, an averaged density tint further out), read from a sector-aligned occupancy texture, compared against instanced points (I1). Acceptance: 10,000 agents visible at once in the demo with every tier in view, recorded frame times per tier through `triangular-engine/testing`, and a human visual check of the tier transitions.
- **unit-classes** — Catapult and creature clearance classes, creature A* with villager fear repulsion, and platoons: a virtual formation anchor on one string-pulled path, slots with cohesion, deformation into a column at chokepoints, slot reassignment on turns, and villagers yielding to platoons. Acceptance: scenarios for a platoon crossing a bridge in column and reforming, and a creature walking through a crowd without villagers entering its body radius.
- **combat** — Platoon-level targeting, engagement steering with surround slots, a coarse per-faction threat map, flee fields, and siege costs that lead siege units to walls and gates. Acceptance: scenarios for two platoons engaging, villagers fleeing a creature to safety, and a siege unit pathing to a closed gate.
- **tight-spots** — Lane bias relative to the field direction, density feedback into integration costs, and gate/bridge capacity queues. Acceptance: a two-way 2-cell gap scenario with 100 agents from each side completes with no permanent stuck agents, and a comparison against the lane-bias-only version is recorded.

## Relationships

- **alternative-to**: [ER 012: Navigation sub-library](/docs/engineering-records/012_navigation_sublibrary.md)
- **related-to**: [Plan 079: Playable Capsule Human Sandbox](/docs/plans/079_playable-capsule-human-sandbox.md)
<!-- /tri:scope -->

## Current phase status

| Phase           | State       |
| --------------- | ----------- |
| grid-layers     | done        |
| sectors-portals | done        |
| sector-fields   | done        |
| goals-edits     | in_progress |
| worker-scale    | planned     |
| crowd-rendering | planned     |
| unit-classes    | planned     |
| combat          | planned     |
| tight-spots     | planned     |

<!-- tri:review version="1" scope-hash="64d11ed979d5f78c0d81a9ceea3e8ce111ed83fa266ef10ffe6729c37d2e20cf" reviewed="2026-11-07" reviewer="agent" -->
<!-- tri:item id="Q1" kind="intent" applies-to="grid-layers,worker-scale" blocks="grid-layers" state="resolved" -->

- [x] Island size and grid resolution: 2 km at 1 m (2,048², about 4 MB per layer) or 4 km at 1 m (4,096², about
      16 MB per layer).
  - Why it matters: it sets the memory budget, sector count and field cache size.
  - Next action: the grid-layers phase builds a size-parameterized grid.
  - Resolution: grid size is a parameter; the demo island is 2,048² at 1 m and 4,096² is kept as a benchmark size
    (developer agreed 2026-11-07).
    <!-- /tri:item -->

<!-- tri:item id="Q2" kind="intent" applies-to="worker-scale,combat" blocks="none" state="open" -->

- [ ] Is lockstep multiplayer a goal?
  - Why it matters: lockstep needs integer or fixed-point simulation and a fixed iteration order; retrofitting it
    later is expensive.
  - Next action: the developer decides before worker-scale; until then the simulation is deterministic only for a
    single engine and machine.
    <!-- /tri:item -->

<!-- tri:item id="Q3" kind="investigation" applies-to="worker-scale" blocks="none" state="open" -->

- [ ] Can the demo server send COOP/COEP headers for `SharedArrayBuffer`?
  - Why it matters: without cross-origin isolation the positions buffer must be double-buffered and transferred
    every tick.
  - Next action: an agent checks the daxur-served demo's headers and records the result in the ER; the fallback
    is transfer.
    <!-- /tri:item -->

<!-- tri:item id="Q4" kind="intent" applies-to="goals-edits" blocks="none" state="open" -->

- [ ] Roads: built only by the player and villagers, or also emerging from footfall (desire paths)?
  - Why it matters: desire paths need a footfall heatmap and an auto-road rule in the simulation.
  - Next action: the developer decides; footfall can be added later without changing the cost layers.
    <!-- /tri:item -->

<!-- tri:item id="I1" kind="investigation" applies-to="crowd-rendering" blocks="crowd-rendering" state="open" -->

- [ ] Far-view crowd: a terrain-material layer reading a sector-aligned occupancy texture versus instanced points
      or quads from the storage buffer.
  - Why it matters: the material layer costs a few fetches on every terrain pixel whatever the agent count, and
    needs occupancy uploads for changed sectors; points cost per agent and flicker when sub-pixel. The layer also
    gets terrain lighting, fog and atmosphere for free and can average into a density tint far away.
  - Next action: a spike measures both at 1,000 and 10,000 agents with `triangular-engine/testing` and records
    frame times and a visual comparison in the ER.
    <!-- /tri:item -->

<!-- tri:item id="I2" kind="investigation" applies-to="crowd-rendering" blocks="none" state="open" -->

- [ ] Can the capsule human's rubber-hose limbs and body be bent in a TSL vertex stage for an instanced mid tier?
  - Why it matters: today each actor is about a dozen meshes whose limb vertices are rewritten in JS every frame,
    which cannot reach thousands. The limbs are quadratic Bézier tubes, so a shared tube geometry bent from
    per-instance parameters is likely a good GPU fit, but the visual match with the full actor is unproven.
  - Next action: an agent measures full-actor counts in the sandbox, then spikes an instanced crowd capsule and
    records counts, frame times and a side-by-side image in the ER.
    <!-- /tri:item -->

<!-- tri:item id="N1" kind="intent" applies-to="worker-scale" blocks="none" state="deferred" -->

- [ ] North star: about 1,000,000 villagers by converting distant or off-screen villagers into statistical
      populations (counts and flows per sector or settlement), promoted back to agents near the camera.
  - Why it matters: it shapes how agent state is indexed now; keeping state per sector and goals as shared fields
    keeps demotion possible later. See ER 086.
  - Next action: none until the 10,000-agent phases are done; then a separate plan.
  - Deferred because: the developer named it a later north-star feature, outside the current scope.
    <!-- /tri:item -->

<!-- tri:item id="I3" kind="investigation" applies-to="crowd-rendering" blocks="none" state="open" -->

- [ ] Does the capsule body material work under the WebGPU renderer?
  - Why it matters: it is a `MeshStandardMaterial` patched with GLSL through `onBeforeCompile`, which the WebGPU
    node renderer is not expected to apply; the game renders with WebGPU, so the material may need a TSL port.
  - Next action: an agent checks the capsule sandbox under `preferredRenderer: 'webgpu'` and records the result.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
