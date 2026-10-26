---
type: Plan
title: "Test Cost Breakdown and Budget View"
description: "Proposal: a view of each saved browser test's cost by resource (GPU ms, CPU ms, triangles, draw calls, GPU MB) against a budget, and a labelled what-if that adds systems (terrain, surface material, sky, clouds), confirmed by a real combined-scene test."
timestamp: 2026-10-26T00:00:00Z
tags: [testing, results, budgets, performance, demo-app, proposal]
runbook: /docs/runbook/067_test-cost-breakdown.md
map_schema: 1
document_id: plan-067
initiative_id: "test-cost-breakdown"
performance: []
---

# Plan 067: Test Cost Breakdown and Budget View

Status: **proposal, awaiting owner review (2026-10-26). Nothing is built.** Evidence and decisions:
[ER 067](/docs/runbook/067_test-cost-breakdown.md).

<!-- tri:scope -->

## Intended outcome

The owner can open one page and judge, per spike, what a feature costs beyond frame time: GPU time, CPU time,
triangles, draw calls and GPU memory, each against a budget. The same page can add several systems (terrain, a planet
surface material, sky, clouds) and show whether they would fit together, as a labelled first-order estimate, and then
compare that estimate with a real combined-scene test.

**Shape of the view (proposal).**

- **One budget bar per resource, not a pie.** The resources have different units, so each gets its own horizontal bar
  scaled to its own budget line. Each system is a segment of the bar; the bar's end past the line turns the overage
  into a visible, labelled amount. A stacked bar answers "who uses the budget" and "how much is left" per resource,
  which one pie across units cannot.
- **Five bars:** GPU ms, CPU ms, triangles, draw calls, GPU MB.
- **Single-test mode.** One saved run and one case give one segment per bar, for example the LOD surface lab (about
  1.57 M triangles, 2 draw calls, 0.2 ms scene pass): it fills the triangle bar to about 157 % of a 1 M budget and
  leaves the rest almost empty. That mismatch is the point of the view.
- **Combined "what if" mode.** The owner ticks systems; the bars stack their segments. The header says **Estimate**.
  Counts and memory add almost linearly (triangles, draw calls, MB). GPU time does not: shared memory bandwidth,
  overdraw and occlusion make the sum an approximation, so the GPU bar shows the sum as an estimate and, once a
  combined test exists, the measured value beside it with the gap (estimate error). CPU time adds closer to linearly
  but still shares one main thread, so it is labelled the same way.
- **Confirmation by a real combined test.** A suite renders the systems together and the page shows measured against
  estimated per resource. A combined-case number is the evidence; the estimate only guides what to build next.

**Where per-system numbers come from.** Each spike's own suite supplies its numbers (for example `lod-surface-terrain`
for terrain, an atmosphere or cloud suite for sky and clouds). A small committed cost model names, per system, the
suite, version, case and metric behind each resource, and optionally pins the accepted run. The page reads the
newest valid run of that source when nothing is pinned, and shows the run's date, mode, profile, GPU adapter and
stale flag beside the segment so the reader knows what the number is worth.

**Where budgets are stored.** In the same committed cost model file (plain JSON), one budget per resource for the
target machine and frame rate, with an optional per-system share. They are the owner's judgement, not measured
results, so they live in version control and are edited by the owner, never written by a test run. Existing
per-case `TestScenario.budgets` stay the pass/fail gates of a single suite; the cost model is the cross-system view
and may reference them but does not replace them. (Open question Q3.)

**Out of scope.** Changing how timings are measured; verdicts or gates from the view (it shows, the suite judges);
automatic GPU memory accounting for every three.js object (Q2); running tests from the page; any combined-scene
visuals beyond what the cost test needs.

## Phases and acceptance

- **survey** — Record which cost fields saved results already carry and which are missing, from real saved results. Acceptance: ER 067 lists present and missing fields per suite with the source (metric, case `details`, machine block, or index line), checked against `lod-surface-baseline` and `lod-surface-terrain` results.
- **fields** — Make every resource readable from saved results without opening a full JSON: promote draw calls and renderer triangles to metrics (or index fields), and add buffer and texture megabytes plus per-frame uploads where a system can state them. Acceptance: a run of the lod suites carries all five resources in its index line; a missing resource is reported as missing, never as zero; specs cover the new fields.
- **model** — Pure helpers and the committed cost model contract: resolve a system's numbers from the index, sum counts and memory, sum times, label every sum as an estimate, compare with a measured combined case. Acceptance: specs for missing sources, stale runs, mixed profiles or adapters (flagged, not summed silently), and over-budget bars.
- **view** — Budget bars in `triangular-engine/testing` next to the results page (Plan 058), with single-run and combined modes and the estimate label. Acceptance: `/tests` shows the five bars for a saved run and for a ticked set of systems, with run date, mode, profile, adapter and stale flag per segment; no estimate is shown without its label; the page works with no cost model (bars only against none).
- **combined** — A demo-app suite that renders terrain, surface material, sky and clouds together, with system toggles for A/B attribution of GPU time (a scene pass is shared, so one meshes' own cost needs a with/without comparison). Acceptance: the suite runs headless-hardware and headed, records the five resources, and the view shows measured against estimated with the gap per resource.
- **docs** — Testing README, skill, changelog and a short how-to for adding a system to the cost model. Acceptance: docs match the shipped symbols; `npm run docs:records:check` passes.

## Constraints and relationships

- Show change and cost, do not judge: verdicts remain the suite's (`budgets`, `baseline`), as the testing guide states.
- Timings from SwiftShader or an unverified headless profile are not hardware numbers; the view flags them rather than
  adding them to a hardware bar. Do not mix headed and headless numbers in one sum without a flag.
- Keep this inside the opt-in `triangular-engine/testing` entry with no renderer dependency; systems report their own
  megabytes through metrics, as `textureMB` already does for terrain.
- Never put process names from machine blocks into the cost model or docs.
- **builds-on**: [Test Results Page and Case Thumbnails](/docs/plans/058_test_results_page_and_thumbnails.md)
- **related-to**: [LOD Surface Core](/docs/plans/059_lod_surface_core.md)
<!-- /tri:scope -->

## Current phase status

| Phase    | State   |
| -------- | ------- |
| survey   | in_progress |
| fields   | planned |
| model    | planned |
| view     | planned |
| combined | planned |
| docs     | planned |

## Questions, assumptions and investigations

<!-- tri:review version="1" scope-hash="11b97b4e46a5cb86deee313995f56fc01cfed07964d75c05f62fddec470fb905" reviewed="2026-10-26" reviewer="agent" -->
<!-- tri:item id="Q1" kind="intent" applies-to="view,combined" blocks="view" state="open" -->

- [ ] Should the GPU time and CPU time bars show the sum of the systems alone, or also a margin (for example the sum plus a fixed allowance for shared bandwidth) before it is called a fit?
  - Why it matters: a plain sum looks precise and can mislead in either direction; a margin changes what "fits" means.
  - Next action: owner decides; recommendation is the plain sum, labelled estimate, with measured value beside it once the combined test exists.
    <!-- /tri:item -->

<!-- tri:item id="Q2" kind="investigation" applies-to="fields" blocks="fields" state="open" -->

- [ ] How is GPU memory best accounted per system: each system reports bytes for its textures and buffers, or the renderer's own info, or a process-level VRAM reading as a cross-check?
  - Why it matters: `nvidia-smi` VRAM covers the whole browser and cannot split systems; the renderer's memory info may count objects, not bytes; self-reported bytes can miss things.
  - Next action: agent checks what the pinned three.js version exposes for the WebGPU renderer, then proposes self-reported bytes per system plus the process reading as a labelled cross-check.
    <!-- /tri:item -->

<!-- tri:item id="Q3" kind="intent" applies-to="model,view" blocks="model" state="open" -->

- [ ] Are the budgets one set for the RTX 3080 at 60 fps (Plan 059 step 3b's proposed numbers as the first values), or one set per machine class (including the integrated-GPU preset)?
  - Why it matters: the file layout and the bars change if a budget depends on the machine.
  - Next action: owner decides; recommendation is one set per named machine class in the same file, starting with the RTX 3080 and the 059 step 3b values.
    <!-- /tri:item -->

<!-- tri:item id="Q4" kind="investigation" applies-to="survey,combined" blocks="combined" state="open" -->

- [ ] Which saved suites exist today for sky and clouds, and which of the five resources do they report?
  - Why it matters: the combined estimate needs a source per system; a system with no suite has no segment.
  - Next action: agent surveys the atmosphere and cloud suites' saved results as the first step of the survey phase and records the gaps in ER 067.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
