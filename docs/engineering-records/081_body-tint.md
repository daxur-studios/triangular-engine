---
type: EngineeringRecord
title: "Body tint for meshes in atmosphere"
description: "Dated decisions, findings and evidence for Body tint for meshes in atmosphere."
timestamp: 2026-11-01T00:00:00Z
tags: [engineering-records]
record_id: er-081
scope_history_schema: 1
plans:
  - /docs/plans/081_body-tint.md
performance: []
---

# Engineering Record 081: Body tint for meshes in atmosphere

Plan: [PLAN-081](/docs/plans/081_body-tint.md).

## Roles

- **Architect:** `claude-opus-5-5`, session `CONTEXT: body-tint` (`local_7b365d96-7436-446b-b722-523021a382d5`), 2026-11-01. Plan text only.
- **Supervisor (reviewer):** session `SUPERVISOR: body-tint` (`local_c027370f-acd3-4b42-b3ed-2ea5f6907390`), started 2026-11-01 in bypass permissions. Model still to be switched to Sonnet, pending owner approval.
- **Worker (main session):** `claude-haiku-5-5`, 2026-11-01.

## 2026-11-01 — Starting

**Goal.** Tint real 3D meshes seen through an atmosphere so they match terrain haze, opt-in per opaque material. Follows the Plan 078 Q2 developer answer: a narrow beyond-air tint now, extensible to large structures.

**Context (Stage 1, Haiku).** The context session read the Plan 078 plan and record, `atmosphere-backdrop.ts`, `planet-atmosphere.ts` and the atmosphere README. Findings: the existing `withAtmosphere` accepts only planet and ocean surfaces; the froxel haze path reads only `positionView` and `cameraDistance`, so it can serve a mesh; `atmosphereSky(worldDir)` gives the beyond-air term.

**Architect decisions (Opus, 2026-11-01).**
1. Hook shape: a narrow `tintMaterial(NodeMaterial)` that wraps `outputNode`, not a general `withAtmosphere` overload. Confidence high on narrow and opt-in; medium on `outputNode` as the seam until P4 specs confirm tone mapping runs after it.
2. In-air tint reuses the froxel table through a `{cameraDistance}` context. Confidence high. `scene.fogNode` was rejected because fog mixes by a scalar and cannot express chromatic transmittance.
3. Beyond-air tint reuses `atmosphereSky` on the fragment's view ray. Confidence high. The blend width at the range limit is medium until bt-spike measures it.
4. Opt-in per material, returning a disposer. Confidence high.
5. Test scene: suite version 2 of `atmosphere-multi-lab`, v1 kept. Confidence high. Page placement is the owner's (plan Q1).
6. Plan Q2 is answered in the P6 docs phase.

**Open for the owner.** Plan Q1 (page placement) and Q2 (transparent materials, architect recommends deferred).

**Limits to state in the README.** Only the atmosphere the camera is inside tints a mesh. A mesh seen through another body's limb from space is not tinted. Flat-map morph is not supported on tinted meshes.

**Checks.** Not yet run. Acceptance commands are in the plan, per phase.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

### 2026-11-01 — bt-spike P1 (worker: claude-haiku-5-5; supervisor: SUPERVISOR: body-tint, Sonnet 5.5)

- **Code.** Demo-only spike `atmosphere-body-tint-spike.ts` in the lab folder, opened by `?spike=body-tint`. A test plane in space at 300 km altitude, depth running across the froxel range limit. Left half: `binding.perspective()`. Right half: `backdrop.skyObject()`. A red line marks where camera distance meets the range limit. No library file changed.
- **Range limit.** Read from the public `binding.aerialPerspective.rangeFor(altitudeM).max` (metres); the froxel table sets its `rangeMax` uniform from the same function each frame.
- **Checks run.** `tsc --noEmit` on `projects/demo-app/tsconfig.app.json` passes.
- **Not yet verified.** The owner's served page did not show the spike readout when the worker loaded it (it showed the Plan 078 text), so the served bundle may be stale or a rebuild may have failed. The owner's dev-server output should show which. Pipeline errors (`renderPipeline_NodeMaterial_22`, `MeshStandardNodeMaterial_20`) also appear on the plain page without the flag, so they are not from the spike.
- **Open.** The saved spike run and the owner's screenshot review (blend-band width) are pending. P1 is not signed off.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
