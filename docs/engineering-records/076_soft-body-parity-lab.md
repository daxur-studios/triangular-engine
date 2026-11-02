---
type: EngineeringRecord
title: "Soft-body parity lab (official Jolt examples)"
description: "Dated decisions, findings and evidence for Soft-body parity lab (official Jolt examples)."
timestamp: 2026-10-31T00:00:00Z
tags: [engineering-records]
record_id: er-076
scope_history_schema: 1
plans:
  - /docs/plans/076_soft-body-parity-lab.md
performance: []
---

# Engineering Record 076: Soft-body parity lab (official Jolt examples)

Plan: [PLAN-076](/docs/plans/076_soft-body-parity-lab.md).

## 2026-10-31 — Implemented

**Goal.** Rebuild the two official Jolt.js soft-body examples with the declarative
`<joltSoftBody>` wrapper and measure parity, replacing the three archived soft-body demo
pages, which did not demonstrate the feature.

**What changed.**

- `JoltSoftBodyComponent` now mirrors the `SoftBodyCreationSettings` the examples use:
  `updatePosition`, `friction`, `restitution`, `vertexRadius`, `maxLinearVelocity`,
  creation-time `pressure`, and `body$` / `body()` for the live `Jolt.Body`. It applies the
  body rotation to the mesh, disables frustum culling on the deforming mesh (the bounds were
  computed once at creation), and disposes geometry and material with the body.
- `linearDamping` default moved from `0.1` to `0` to match the examples; callers that relied
  on the old default must set `[linearDamping]="0.1"`.
- `demo-app`: `/soft-body-lab` replaces `soft-body-poc`, `soft-body-tear-lab` and
  `soft-bend-constraint`. The page ports the official cloth (40 × 40, spacing 0.5, pinned
  corners, ten 100 kg spheres) and pressure (eleven 2 m polar spheres, pressure 0 .. 10 000)
  constructions without changing their topology, and adds a `triangular-engine/testing`
  suite, `jolt-soft-body-examples@v1`.

**Findings.**

- Pressure is `nRT`, not an inflation multiplier. At pressure 0 the sphere collapses
  (volume ratio ≈ 0.46); from ≈ 3 000 upward it holds its rest volume (≈ 1.00–1.02). The
  first check asked for volume > 1.35 and failed correctly; the gate is now "pressure changes
  the spheres" (spread ≥ 0.3) plus "the highest pressure holds its volume" (≥ 0.9).
- Vertex mass is `invMass = 1` in both official examples, so mesh tessellation changes the
  body mass. That is preserved for parity and is a known limitation to address separately.
- The engine steps at a fixed 1/240 s; the official pages step at the rendered delta. The
  trajectories are comparable, not identical.

**Checks (2026-10-31, noisy headless-hardware quick run).**

- `npx ng build demo-app --configuration development` — pass.
- `npm run build:triangular-engine` — pass.
- `npx ng test demo-app --watch=false --browsers=ChromeHeadless --include=**/soft-body-lab/*.spec.ts`
  — 5/5 pass (mesh counts, rest volume, deterministic sphere placement).
- `triangular-test-run --url http://triangular-demo.localhost:4200/soft-body-lab --suite
  jolt-soft-body-examples --version 1 --profile headless-hardware --mode quick --noisy` —
  pass. Cloth: shape RMS 1.38 %, P95 2.60 %; pressure row: volume ratio 0.46 .. 1.02;
  penetration 0.00 m in both.
- Thumbnails show the cloth sagging under the spheres and the eleven-sphere pressure row,
  matching the official pages' composition.

**Open.**

- Visual review against both official pages (Plan phase `visual-review`).
- Pressure 0 collapse and the pressure/sphere count should be tuned by a person if the look
  differs.
- Vertex mass still scales with tessellation (`invMass = 1`); a mass/density input is the next
  component improvement.
- No gameplay integration: BSP landing balls, coupling a soft body to a vessel, and
  floating-origin rebasing are separate work.

## 2026-10-31 — Lifecycle fix after the visible-browser run

**Symptom.** After the suite finished, the console filled with `Uncaught RuntimeError: memory
access out of bounds` from `GetPosition` / `GetMotionProperties`, followed by
`[Jolt] Physics fault during 'jolt:step'`. One suite repetition looked clean; two consecutive
repetitions reproduced it every time.

**Cause 1 — the body handle.** `<joltSoftBody>` used
`bodyInterface.CreateAndAddSoftBody(settings, ...)`, which returns a `BodyID`, then resolved it
with `physicsSystem.GetBodyLockInterface().TryGetBody(id)` and cached that `Jolt.Body`. The
engine's default `maxWorkerThreads` is `4`, so the lock interface is the locking variant and the
resolved handle is not a stable body to cache. Some bodies synced against freed memory every
frame, and `RemoveBody`/`DestroyBody` later corrupted the world.

**Cause 2 — creation settings ownership.** `Jolt.destroy(settings)` right after creation also
released the `SoftBodySharedSettings` the component still owned (the binding's `mSettings` does
not add a reference), leaving `#settings` dangling and double-freeing it in `dispose()`.

**Fix.** Create with the official path, `CreateSoftBody(settings)` followed by
`AddBody(body.GetID(), EActivation_Activate)`; keep the creation settings until the body is
destroyed, then release the creation settings only (which releases the shared settings). The
component also unsubscribes from `physicsUpdated$` in `dispose()`, clears `#body` before removal,
removes the mesh from the group, logs instead of throwing if a body cannot be destroyed, and the
page skips a component whose body is sampled in the frame it is destroyed.

**Checks.**

- Two suite repetitions in a row (`testRepetitions=2`): 0 console errors, `[Jolt]` heap flat
  (+456 KB baseline, no growth between samples).
- `jolt-soft-body-examples@v1` quick headless run: pass; cloth 1.38 % / 2.60 % shape strain,
  pressure volume ratio 1.01, penetration 0.00 m.
- `jolt-soft-body-examples@v1` quick visible-browser run
  `2026-10-31T20-37-00-683Z_visible-browser_quick_5d03af99-7c83be8f`: pass; cloth 1.35 % / 2.60 %
  shape strain, pressure volume ratio 1.02, penetration 0.00 m. The runner redid `cloth-spheres`
  twice because the window lost focus (visible profile only), not because of a failure.
- `tsc -p projects/demo-app/tsconfig.app.json --noEmit`: pass.

**Limitation.** The suite's "no console error" check stops with the run, so it did not catch this
teardown-only fault; it was found by watching the page and by running two repetitions. A future
suite could keep the error watcher alive through `restore`.

## History

- 2026-10-31 — Plan created and implemented in the same session; three archived pages removed.
  Measured parity suite passes; visual review pending.
- 2026-10-31 — Fixed the soft-body body-handle and creation-settings lifetime; two consecutive
  repetitions run without console errors.
- 2026-11-02 — Visual review accepted. The developer compared `/soft-body-lab` with
  `soft/soft_body.html` and `soft/soft_sphere_pressure.html` and recorded two human `pass`
  reviews on the visible-browser run `2026-10-31T20-37-00-683Z_visible-browser_quick_5d03af99-7c83be8f`.
  Plan 076 is complete.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
