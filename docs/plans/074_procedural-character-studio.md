---
type: Plan
title: "Procedural character studio"
description: "A focused, extensible demo workspace for procedural characters."
timestamp: 2026-10-31T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/074_procedural-character-studio.md
map_schema: 1
document_id: plan-074
initiative_id: "procedural-character-studio"
performance:
  - id: character-studio-human-performance-v1
    url: http://triangular-demo.localhost:4200/character-studio?testSuite=character-studio-human-performance&testVersion=1&testProfile=visible-browser&testMode=standard&testRepetitions=1&testAutoStart=1
    status: runnable-hardware-unmeasured
---

# Plan 074: Procedural character studio

Status: **in progress**. Evidence and decisions: [ER 074](/docs/engineering-records/074_procedural-character-studio.md).

<!-- tri:scope -->

## Intended outcome

Give capsule humans and cats a dedicated, full-screen studio in the demo app. The studio shell presents a large character viewport with focused selection and editing controls, and keeps the character-specific verification workflow close to the characters being reviewed. Begin with an app-owned extension seam for the capsule human and cat; keep the existing engine character and procedural APIs independently usable.

This plan covers separating the capsule character experience from the mixed-purpose Characters Lab and scaffolding an app-local contribution model. A public studio/plugin API, themed clothing and equipment packs, new anatomy systems, authoring persistence, and concept-art tracing remain future work.

## Phases and acceptance

- **studio-shell** — Add a dedicated `/character-studio` route and full-screen responsive workbench shell with a clear human/cat selector and a large scene viewport. Acceptance: both capsule families can be selected and displayed in the new route; the route is discoverable in the demo selector; existing `/characters-lab` remains available during migration.
- **family-contributions** — Represent capsule humans and cats as app-local studio contributions that supply identity, presets, actor lifecycle, supported controls and visual test suites. Acceptance: each family owns its settings and cleanup through the contribution boundary, and shared shell actions do not depend on human- or cat-specific DNA fields.
- **verification-workflow** — Move capsule visual, face-detail and variant suites into the studio's verification surface with the recording/evidence workflow intact. Acceptance: the existing capsule suites remain reproducible and save the same review-friendly artifacts from the studio route.
- **legacy-lab-separation** — Remove capsule customization from `/characters-lab` after its tests and evidence workflow have moved. Acceptance: `/characters-lab` continues to host its face-rig and general humanoid demonstrations without duplicate capsule controls or suites.
- **hair-generation-coverage** — Add deterministic, close-up visual verification for procedural human hairstyles across representative presets and head views. Acceptance: reviewed front, side and rear evidence covers the selected generated styles and identifies attachment, silhouette, coverage, floating or head-intersection issues; fixes can be reproduced from the recorded recipe.
- **hair-motion-and-helmet** — Verify representative hairstyles during walking and inside a clear dome-style space helmet. Acceptance: focused motion and helmet-fit cases produce reviewable close-up evidence, define expected hair movement and helmet interaction, and pass human review for unintended clipping, occlusion or detachment; implement any behavior changes established by that review.
- **experimental-pigtail-head** — Add an experimental capsule human head preset using the approved pigtail geometry and the existing face controller. Acceptance: the preset can be selected in Character Studio and shows distinct neutral, happy and surprised expressions from the front and at 45°.
- **experimental-pigtail-speech** — Fit the earlier capsule mouth to the experimental pigtail head and add a short speech preview. Acceptance: Studio shows the shaded mouth rim, teeth and tongue, preserves the three expression poses, and plays and releases speech shapes from both angles. Browsers without voice output still preview the animation.
- **experimental-pigtail-eyes** — Refine the experimental head's eyelids and add an Awe expression. Acceptance: eyelid edges follow the eye from the front, at 45°, and in profile. The lids can close over the pupils. Awe is selectable on the experimental head and shows a raised gaze, enlarged pupils and a softly parted mouth.
- **experimental-pigtail-variants** — Generate three selectable heads from the pigtail recipe using fixed seeds. Acceptance: each seed recreates its head proportions, hair shape and colour, and freckle pattern. Check the front, 45°, and profile views, plus blinks, Awe and speech on each head.
- **experimental-pigtail-body** — Fit one procedural body and standing pose to Orange, Plum, Honey and Chestnut Pigtails in Character Studio. Acceptance: front, 45° and profile show boots on the pedestal and connected limbs and neck for every preset. Head close-up, Awe, speech and switching to existing characters still work.
- **capsule-parts-workshop** — Add a prewired graph for the approved spacesuit and shared animated face. Acceptance: Hair, Head and Suit each show a 3D preview. Swapping Pigtails and Shaggy hair updates the assembled character and preserves facial animation. Review Shaggy from multiple angles against the concept.
- **classic-stache-shape-editing** — Fit a swept hairstyle and optional mustache using Classic Stache as the reference. Acceptance: dragging the fringe and mustache tips updates the edit view and the assembled character. The editor and assembled preview can turn together, and speech remains readable. Review whether the handles help with fitting.
- **short-beard-fit** — Fit a rounded, layered beard from the approved reference. Acceptance: the beard follows the jaw and meets the sideburn area in the front and profile views, stays interchangeable across workshop hairstyles, and frames the speaking mouth in synchronized views. The beard and scalp hair use the character's natural hair colour in all previews.
- **webgpu-bob-lock** — Shape one rounded bob lock with TSL on native WebGPU. Acceptance: the length slider moves the hem and preserves the scalp attachment and mesh buffers. Review the locked root, rounded profile and lighting from front, three-quarter and side views across the slider range.
- **character-performance-matrix** — Measure one and many procedural humans while idle, walking in place and moving on repeatable scene paths. Acceptance: a visible-browser performance run records actor-update CPU time, render-submit CPU time, frame cadence, draw calls, triangles and scenario setup time at populations of 1, 16 and 48; scenario setup includes constructing additional actors, arranging the population and fitting the camera, but excludes construction of the studio's pre-existing primary human. The 16.7 ms p95 frame-cadence budget is labeled as an initial 60 Hz target hypothesis, and no hardware baseline is accepted before reviewing a clean run on the intended device.

## Relationships

- **builds-on**: [Plan 073: Visual verification evidence and retention](/docs/plans/073_visual-verification-evidence-retention.md)

<!-- /tri:scope -->

## Current phase status

| Phase                  | State       |
| ---------------------- | ----------- |
| studio-shell           | done        |
| family-contributions   | done        |
| verification-workflow  | done        |
| legacy-lab-separation  | done        |
| hair-generation-coverage | in_progress |
| hair-motion-and-helmet | planned     |
| experimental-pigtail-head | done        |
| experimental-pigtail-speech | done        |
| experimental-pigtail-eyes | done        |
| experimental-pigtail-variants | done        |
| experimental-pigtail-body | done        |
| capsule-parts-workshop | done        |
| classic-stache-shape-editing | done        |
| short-beard-fit         | done        |
| webgpu-bob-lock        | done        |
| character-performance-matrix | in_progress |

<!-- tri:review version="1" scope-hash="ff95ce3397534ef6bbf03e11c151f40a4c063d2b4002e5865f121b71a5e01a28" reviewed="2026-11-21" reviewer="agent" -->
<!-- /tri:review -->

## Delivery progress

The shell and app-local human/cat contributions are in place. The studio hosts capsule visual suites with recordings, thumbnails and review sheets; `capsule-hair-coverage@v1` (30 front, side and back close-ups across 10 hairstyles) and `capsule-human-lineup@v1` (20 full-body baseline and alt presets) are active with centered focus framing and saved baseline contact sheets, while human visual verdicts and hair/clothing geometry improvements remain pending. Capsule actors, test suites, adapters and focus framing belong to Character Studio. `/characters-lab` keeps only the face-rig and general humanoid demonstrations. The human performance matrix is active; its visible hardware run and target-device review are pending. Broader themed character packs and promotion of the contribution contract into a public engine entry point require later evidence and scope review.

Latest diagnostic: [run the human performance matrix](http://triangular-demo.localhost:4200/character-studio?testSuite=character-studio-human-performance&testVersion=1&testProfile=visible-browser&testMode=standard&testRepetitions=1&testAutoStart=1).

The developer accepted Shaggy's overall look in the turnaround. The reviewed proportions are available in a selectable walking preset in the [playable sandbox](079_playable-capsule-human-sandbox.md). Hand refinement remains open for the gesture and grip pass.

The developer accepted the revised [Classic Stache fit](http://triangular-demo.localhost:4200/character-studio?workshop=classic-stache). The shape-editing prototype is complete. The [short beard fit](http://triangular-demo.localhost:4200/character-studio?workshop=short-beard) reuses the synchronized rotation view, opens on Shaggy, and is available on the other workshop hairstyles. Owner visual review is pending.

The [WebGPU bob lock prototype](http://triangular-demo.localhost:4200/bob-hair-lock-spike) changes hem length and flare independently while keeping the crown attachment and mesh buffers fixed. The next visual review is the full bob's flared outline against the supplied concept. Its face opening and fringe can be fitted once the outline is approved.

For the next Orange Pigtails body review, compare one rotatable full-body blockout to the original art using the same angle slider and overlay as the head preview. The reproduction steps and local source are recorded in [ER 074](/docs/engineering-records/074_procedural-character-studio.md#2026-11-18--synchronized-concept-and-3d-review).

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
