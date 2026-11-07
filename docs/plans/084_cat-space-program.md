---
type: Plan
title: "Cat Space Program: Operation Moon Boop"
description: "Implementation goals and acceptance criteria."
timestamp: 2026-11-05T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/084_cat-space-program.md
map_schema: 1
document_id: plan-084
initiative_id: "cat-space-program"
performance:
  - id: moon-boop-functional-v1
    url: http://triangular-demo.localhost:4200/cat-space-program?testSuite=moon-boop-functional&testVersion=1&testProfile=headless-hardware&testMode=standard&testRepetitions=1&testAutoStart=1
    status: functional-pass-visual-review-pending
---

# Plan 084: Cat Space Program: Operation Moon Boop

Status: **implemented; human visual/play acceptance pending**. Evidence: [ER 084](/docs/engineering-records/084_cat-space-program.md).

<!-- tri:scope -->
## Intended outcome

A playable, short incremental game at `/cat-space-program`: attract capsule cats, collect them with exactly one capsule human, and stack 18 cats to boop a nearby Moon. Angular controls and Three.js targets use the same game actions. Faster shoes and carrying capacity replace additional collectors. This bounds the actor count; it is not a measured performance guarantee.

Keep game logic page-owned and deterministic. Use existing procedural actors and engine scene/tick/portal facilities. Keep source recording, edited video timing and simulation time distinct. No changes to engine public APIs or the concurrent addressable-evidence work are required. Full physics stacking, flight, persistence, offline production and multiple humans are out of scope.

## Phases and acceptance

- **playable-loop** — Three bounded cat sources, one collector, manual stacking, speed/capacity upgrades, pause/reset, scenario presets and Moon victory. Acceptance: production, collection and purchases obey resource accounting; a complete round is playable without debug commands; cat population is capped and actors are disposed on reset/navigation.
- **scene-controls** — Discoverable route/card, camera overview/follow/tower views, scene picking and optional target highlight. Acceptance: scene and Angular controls dispatch the same supported actions; a page-owned automation surface exposes state, actions, readiness and targets without scene traversal; no conflicting input during tests.
- **repeatable-evidence** — Model checks, a functional testing-entry adapter and browser walkthrough. Acceptance: production/batch timing, no overspending, collector upgrades, cap/victory, pause/reset and restoration/cancel are checked; the running route and hub link are verified. Visual acceptance remains separately pending.
- **recording-proof** — A short continuous recording with an explicitly accelerated repetitive segment. Acceptance: retain source and timing metadata; export a playable MP4 with a speed indicator, normal-speed interactions and cached Daxur narration. Mark the original producer as a demo-local proof; its later package adoption is a separate phase.
- **packaged-recording** — Adopt the installed continuous-video recipe API, replacing demo-local recorder machinery. Acceptance: an installed archive generates the narrated 1x/3x/5x clip, retains source/output mapping and uses paced input without an engine/testing API change.

## Relationships

- related-to: [/docs/plans/079_playable-capsule-human-sandbox.md](/docs/plans/079_playable-capsule-human-sandbox.md)
- related-to: [/docs/plans/083_addressable-visual-evidence.md](/docs/plans/083_addressable-visual-evidence.md)
<!-- /tri:scope -->

## Current phase status

| Phase | State |
| --- | --- |
| playable-loop | done |
| scene-controls | done |
| repeatable-evidence | done |
| recording-proof | done |
| packaged-recording | done |

<!-- tri:review version="1" scope-hash="2345e79072bfbc2348123ba198fb5e0a939755c05b3838f87036ab5edf1747fe" reviewed="2026-11-06" reviewer="agent" -->
<!-- /tri:review -->

## Delivery progress

2026-11-05: User authorized the Cat Space Program POC and suggested a single human for performance. Use one collector with shoes/capacity upgrades, bounded cat population and stationary stacked cats. No scope baseline is established.

2026-11-05 (implementation): Playable route/card, one collector, cat production, upgrades, fixed-step model, named targets/actions, camera modes and optional focus box are implemented. Ten Node model checks and the browser walkthrough pass. The shared functional suite completed all three cases with automated pass, performance not run and visual review pending. A demo-local continuous recording proof produced a narrated MP4 with 3x/5x segments; final overlay/export verification is in progress. See the ER for evidence and limitations.

[Run the exact functional suite](http://triangular-demo.localhost:4200/cat-space-program?testSuite=moon-boop-functional&testVersion=1&testProfile=headless-hardware&testMode=standard&testRepetitions=1&testAutoStart=1).

2026-11-05 (recording proof): Final output is 34.73 seconds, H.264/yuv420p with AAC narration, 1,426,555 bytes. Its 54.55-second source, timestamped JPEG frames and segment mapping are retained. The 3x and 5x sections change footage playback, not simulation speed. Inspected the contact sheet and the focus-box close-up; listening and user play/visual acceptance remain pending. All implementation phases are done. Keep this pair intact for the maintainer to commit before any archival.

2026-11-06 (recording follow-up): Owner confirmed HEVC phone playback and requested compact delivery by default. The local recorder now offers HEVC by default with a H.264 override, timed cursor approaches and retained pointer samples. A new 42.004-second narrated clip is 1,333,868 bytes. The headless paced-input check passed; the first-approach montage shows intermediate pointer positions. Full motion/listening review remains separate. See the append-only ER for the retry and exact evidence.

2026-11-06 (package adoption): Owner accepted the smoother pilot. The demo consumes installed Stop Motion UI 0.3.0 with an app-owned recipe and small launcher. The final archive rerender produced a 42.867-second HEVC/AAC clip, 1,400,410 bytes, from 786 source JPEGs and six 1x/3x/5x segments. Full engine build and package checks passed; decoded segment samples were reviewed. This is generic walkthrough recording, independent of shared testing result artifacts. New-export human motion/listening review remains separate.
