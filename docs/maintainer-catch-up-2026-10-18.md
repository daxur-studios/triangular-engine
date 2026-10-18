# Maintainer catch-up: 9–18 October 2026

This is a short review brief for the maintainer. It summarizes the committed repository history from Friday 9 October through Sunday 18 October 2026 and points to the evidence. It does not approve or reject the recorded decisions.

## What changed

The repository history contains **91 commits** in this period. Relative to the last commit before 9 October, **268 files changed** (+35,098 / −1,973 lines). The working tree was clean when this brief was prepared.

| Period | Main work |
|---|---|
| 11–15 Oct | Engine frame lifecycle and late-write diagnostics; `ng add` and scene-page schematics; terrain worker/visibility/per-frame install limits; telemetry; surface and biome work; spatial audio. |
| 16 Oct | Three.js upgraded to 0.186.1; new TSL planet material and WebGPU path; new atmosphere entry point and GPU model. |
| 17–18 Oct | Atmosphere wired into planet demos; cloud-volume renderer and lab; performance/replay tooling; bent-planet experiment; several new plans for future work. |

Most of the large code growth is concentrated in the demo labs and three new library areas: atmosphere, TSL planet material, and cloud volumes. The earlier engine work is broad but more incremental.

## The decisions that most need your attention

These are product or architecture choices where your preference matters more than an agent’s implementation skill.

1. **Is the new rendering direction the one you want to invest in?** Plans 049–051 add public entry points for atmosphere, TSL planet materials, and cloud volumes. In plain terms: atmosphere uses precomputed lookup textures for lighting and haze; the planet surface is being moved from custom GLSL patches to Three.js’s TSL material system; clouds are drawn by marching through cloud volumes on the GPU. These choices affect the library’s public shape and future maintenance. Start with [Plan 049](plans/049_morphing_planet_atmosphere.md), [Plan 050](plans/050_tsl_planet_surface_material.md), and [Plan 051](plans/051_cloud_volumes.md).

2. **Bent morph is a visual/product decision as well as a math decision.** The new experiment bends the map onto progressively flatter spherical surfaces, instead of linearly moving globe vertices to a plane. This is intended to keep the atmosphere coherent between globe and map. A lab spike exists, but the real TSL planet material integration and a live morph scrub are still outstanding. The runbook records unresolved edge cases and tests in [Runbook 049](runbook/049_morphing_planet_atmosphere.md). Your acceptance should be based on the full transition and map-edge views, not only the globe and flat endpoints.

3. **Cloud performance is promising for the measured setup, with a real trade-off still open.** The chosen default is a box-proxy path; at 12 volumes its measured cost was lower than the per-pixel screen pass. Those numbers are from one GPU/lab setup, and the 12-volume stress case is slightly above some stated budgets. The new per-pixel atmosphere haze costs about 2.45 ms in the fly-by result against a 0.1 ms goal. The proposed cheaper fallback—one coarse haze estimate per volume—loses depth accuracy and has not yet been accepted or measured. See the final sections of [Runbook 051](runbook/051_cloud_volumes.md).

4. **Decide what performance evidence is trustworthy enough to set release gates.** Plan 052 is building repeatable page tests, but its status says replay consistency and timestamp plumbing are proven while pass attribution, timestamp precision, visible-cloud capture, bake-budget coverage, and a controlled machine profile still need work. Cloud measurements should be treated as useful comparisons from the lab, not yet as portable guarantees. See [Plan 052](plans/052_page_test_sessions_and_performance_comparison.md).

5. **Set priority before starting the proposed next waves.** Procedural creature animation (Plan 053) and stylized illustrative rendering (Plan 054) are plans, not delivered features. Both imply substantial follow-on work and compete with finishing/reviewing the planet and cloud stack. Their scope and goals are worth endorsing before implementation begins: [Plan 053](plans/053_procedural_creature_animation.md), [Plan 054](plans/054_stylized_illustrative_rendering.md).

## Decisions that appear already recorded as yours

The runbooks attribute several consequential choices to the maintainer/owner: TSL-only for the new planet material; Hillaire-style atmosphere lookup tables with an optional stylized producer; keeping real day/night plus an always-day mode; the bend morph and map-edge air mask; and box proxies as the cloud default. These are recorded as prior owner decisions, not inferred approvals from this summary. The relevant evidence is in Runbooks 049–051. If any entry does not match your intent, correcting it now is cheaper than building more work on top.

## Where to spend review time

- **First:** look at the current visual results for the bent morph, atmosphere at map edges, and clouds against the ground. The docs name the labs and the specific views that remain unchecked.
- **Then:** choose whether the public TSL/atmosphere/cloud direction and the next priorities match the product you want.
- **Delegate to code review and evidence:** internal shader math, resource lifecycle, API consistency, and unit coverage. Ask for a plain-language explanation and an observable consequence for any technical proposal that changes visual quality, performance budget, compatibility, or public API.

You do not need to understand every shader implementation detail to retain control. For a technical choice, the useful review packet is: **what users will see; what it costs; what alternatives were measured; what is still uncertain; and what would make us reverse the decision.**

## Recordkeeping improvement to consider

The repository already separates current plans (intended work) from append-only runbooks (evidence and dated decisions) in [Plans and Runbooks](plans-and-runbooks.md). A separate permanent “humans vs agents” policy file is not necessary to get control back. A lightweight decision section in each active plan could instead label items as **maintainer decision**, **agent implementation choice within an agreed boundary**, or **open pending evidence**, and state what would trigger escalation. Keep review acceptance and release priorities with the maintainer; let agents choose reversible implementation details inside those bounds. This brief is a one-time catch-up aid, not a change to that workflow.

## Documentation drift to clean up

The detailed runbooks contain newer state than some plan headers. For example, Plan 049’s opening status still describes early visual gates as pending while the runbook records a later bent-planet lab spike and follow-up; Plan 051’s status/budget summary predates the 18 October proxy and bake-budget results. Before the next major implementation phase, reconcile those summary statuses from the runbooks so the plan index is a reliable short view.

