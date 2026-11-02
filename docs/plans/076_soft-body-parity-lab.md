---
type: Plan
title: "Soft-body parity lab (official Jolt examples)"
description: "Implementation goals and acceptance criteria."
timestamp: 2026-10-31T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/076_soft-body-parity-lab.md
map_schema: 1
document_id: plan-076
initiative_id: "soft-body-parity-lab"
performance: []
---

# Plan 076: Soft-body parity lab (official Jolt examples)

Status: **implemented; visually reviewed and accepted**. Evidence and decisions: [ER 076](/docs/engineering-records/076_soft-body-parity-lab.md).

<!-- tri:scope -->

## Intended outcome

Replace the three archived soft-body demo pages with one `/soft-body-lab` page that rebuilds
the two official Jolt.js examples using the declarative `<joltSoftBody>` wrapper and measures
whether the result behaves like them:

- `soft/soft_body.html`: 40 x 40 pinned cloth, ten 100 kg spheres dropped on it.
- `soft/soft_sphere_pressure.html`: eleven 2 m spheres at pressure 0 .. 10 000.

The page must be runnable from the existing demo app and drive a repeatable
`triangular-engine/testing` suite. Out of scope: gameplay integration (BSP landing balls),
artistic parity with the official page, cross-engine determinism, and any new soft-body
solver.

## Phases and acceptance

- **component-parity** - `<joltSoftBody>` exposes the creation settings the examples use (`updatePosition`, creation-time `pressure`, `friction`, `restitution`, `vertexRadius`, `maxLinearVelocity`), a live body accessor, rotation-following mesh, no stale culling, and disposal. Acceptance: engine build and the demo app build pass.
- **parity-lab** - `/soft-body-lab` renders both examples with the same meshes, settings, camera and floor as the official pages. Acceptance: the page renders both examples; the mesh generators match the official vertex/face counts.
- **measurement** - a functional suite records shape strain, mesh volume and floor penetration and gates the two behaviours that define the examples: the cloth keeps its mesh under the spheres, and pressure changes the spheres while the highest pressure holds its volume. Acceptance: `jolt-soft-body-examples@v1` passes headless.
- **visual-review** - a person compares the page with both official pages. Acceptance: a recorded review. Done: two human `pass` reviews recorded for the visible-browser run (`cloth-spheres`, `pressure-row`).

## Relationships

- Supersedes the archived demos `soft-body-poc`, `soft-body-tear-lab` and `soft-bend-constraint`.
- Uses `triangular-engine/testing`; the runnable suite is `jolt-soft-body-examples@v1`.

<!-- /tri:scope -->

## Current phase status

| Phase            | State   |
| ---------------- | ------- |
| component-parity | done    |
| parity-lab       | done    |
| measurement      | done    |
| visual-review    | done    |

<!-- tri:review version="1" scope-hash="e29f6a0cca4ccf6dd1d66f7ec2e921bc28665cdfbc7191e5fe937a880f32aa01" reviewed="2026-10-31" reviewer="agent" -->
<!-- tri:item id="Q1" kind="intent" applies-to="visual-review" blocks="none" state="resolved" -->

- [x] Do the measured gates match what the official pages show?
  - Why it matters: the gates are sanity bounds derived from the observed parity run, not a
    pixel comparison; a person still has to confirm the look.
  - Next action: none. The developer compared `/soft-body-lab` with both official pages and
    recorded two human `pass` reviews on the visible-browser run
    `2026-10-31T20-37-00-683Z_visible-browser_quick_5d03af99-7c83be8f`.
  - Resolution: the recorded reviews confirm the sighted result matches both official pages; the
    measured gates stand as sanity bounds, not pixel parity.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
