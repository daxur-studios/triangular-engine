---
type: Plan
title: "Capsule Doodle Space Cats"
description: "Four-legged parametric space cats for triangular-engine/characters and triangular-engine/procedural, plus the characters-lab integration."
timestamp: 2026-10-28T00:00:00Z
tags: [engineering-records]
runbook: /docs/runbook/070_capsule-doodle-space-cats.md
map_schema: 1
document_id: plan-070
initiative_id: "capsule-doodle-space-cats"
performance:
  - id: cat-emotions-v1
    url: http://triangular-demo.localhost:4200/characters-lab?testSuite=cat-emotions&testVersion=1&testProfile=human-observed&testMode=quick&testRepetitions=1&testAutoStart=1
    status: runnable-functional
    evidence:
      - artifacts/test-runs/cat-emotions@v1/2026-10-29T13-46-59-264Z_headless-hardware_quick_0d50724c-c716e3f0.json
      - artifacts/test-runs/cat-emotions@v1/2026-10-29T13-50-36-151Z_headless-hardware_quick_0d50724c-25e23b60.json
  - id: cat-lineup-v1
    url: http://triangular-demo.localhost:4200/characters-lab?testSuite=cat-lineup&testVersion=1&testProfile=human-observed&testMode=quick&testRepetitions=1&testAutoStart=1
    status: runnable-functional
    evidence:
      - artifacts/test-runs/cat-lineup@v1/2026-10-29T13-47-33-761Z_headless-hardware_quick_0d50724c-c716e3f0.json
      - artifacts/test-runs/cat-lineup@v1/2026-10-29T13-52-37-372Z_headless-hardware_quick_0d50724c-26ae6a75.json
---

# Plan 070: Capsule Doodle Space Cats

Status: **in progress** (visual refinement). Evidence and decisions: [ER 070](/docs/runbook/070_capsule-doodle-space-cats.md).

## Intended outcome

A four-legged Capsule Doodle Space Cat system that mirrors the humanoid Capsule Doodle
architecture: framework-free DNA, quadruped locomotion and facial projection in
`triangular-engine/characters`; body shader, face rig, tail, paws, gear and actor in
`triangular-engine/procedural`; and a `/characters-lab` mode with a hero customizer and the
seven-cat concept-sheet lineup.

The seven cats are `space-cat-goofy`, `space-kity-jetpack`, `variant-d-caramel`,
`cosmo-kitten-a`, `cosmo-kitten-b`, `orbit-puffer-cat` and `scrufly-cat`. The body supports
`front_suit`, `full_suit` and `natural_two_tone` patterns, a twin-arch `:3` / `MEOW` mouth,
pointed ears, whiskers, an optional crown tuft, an S-curved tail, and modular cat gear
(angled bubble helmet, dorsal pet jetpack with harness, brown/blue mini saddle packs).

Out of scope: every dog on the reference sheet; dog presets, dog animation and dog gear.

<!-- tri:scope -->

## Phases and acceptance

- **cat-core** — Add `capsule-cat-dna.ts`, `capsule-cat-locomotion.ts` and `capsule-cat-face-projection.ts` with unit specs to `triangular-engine/characters`, and export them from the entry point. Acceptance: the seven presets normalize cleanly; the four gaits return finite four-leg and tail samples; the face projection covers `:3`, `MEOW`, blink, ear flatten and whisker spread.
- **cat-procedural** — Add `CapsuleCatActor`, `buildCapsuleCatBodyMesh`, `buildCapsuleCatFaceRig`, `CapsuleCatTailMesh`, `buildCapsuleCatPaw` and `buildCapsuleCatSpaceGear` with unit specs to `triangular-engine/procedural`, and export them. Acceptance: the actor builds every preset; limb and tail buffers stay allocated across updates; gear switches helmet/pack/harness cleanly.
- **cat-lab** — Add a **Capsule Space Cats** toggle to `/characters-lab` with Hero Customizer and 7-Cat Concept Sheet Lineup, including preset, gait, pattern, pack, fur palette and proportion controls. Acceptance: the mode renders the hero and all seven presets, and switching presets follows each preset's gait.
- **cat-refinement** — Refine expressive mouth and eyes and smoothly enlarge the head within the capsule body; review the seven cats and their motion against the new reference. Acceptance: distinct closed frown and open-mouth shapes, visually reviewed emotion and multi-angle head views, functional browser suites and focused tests pass, and remaining visual limitations are recorded.

## Relationships

- Record: [ER 070](/docs/runbook/070_capsule-doodle-space-cats.md).
- Builds on: [ER 027](/docs/runbook/027_characters_sublibrary.md).

<!-- /tri:scope -->

## Current phase status

| Phase          | State |
| -------------- | ----- |
| cat-core       | done  |
| cat-procedural | done  |
| cat-lab        | done  |
| cat-refinement | in_progress |

<!-- tri:review version="1" scope-hash="24bb93d255cf7c668b3a1a46f82599834e27405945230ba13782368e2c9f979a" reviewed="2026-10-29" reviewer="agent" -->
<!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
