---
type: Plan
title: "Moon Boop cat care and treat guns"
description: "Implementation goals and acceptance criteria."
timestamp: 2026-11-06T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/085_moon-boop-cat-care.md
map_schema: 1
document_id: plan-085
initiative_id: "moon-boop-cat-care"
performance:
  - id: moon-boop-care-v1
    url: http://triangular-demo.localhost:4200/cat-space-program?testSuite=moon-boop-care&testVersion=1&testProfile=headless-hardware&testMode=standard&testRepetitions=1&testAutoStart=1
    status: functional-pass-visual-review-pending
---

# Plan 085: Moon Boop cat care and treat guns

Status: **implemented; owner motion/listening/play acceptance pending**. Evidence and decisions: [ER 085](/docs/engineering-records/085_moon-boop-cat-care.md).

<!-- tri:scope -->

## Intended outcome

Expand Operation Moon Boop with periodic cat care, one human who pets cats using a lightweight lift presentation, and purchasable one/two treat guns. Care uses fixed simulation time and stable cat IDs. Uncared-for cats leave safely, including from the middle of a tower. Preserve collection, production, resource limits, pause/reset and the frozen 18-cat victory. No rocket physics, extra humans, public engine API, persistence or recording/testing artifact integration.

## Phases and acceptance

- **care-model** — Deterministic deadlines, recipient-specific petting/treat hits, bounded human jobs, two gun upgrades and safe departures. Acceptance: focused model tests cover timing, scheduling/fairness, targeting/cadence, tower membership, pause/reset/cap and victory.
- **care-presentation** — Legible needs, lift/petting, departure/reflow and distinct guns with flying treats. Acceptance: Angular and scene controls share semantic actions, agent state/readiness is available, portal/FPS conventions hold, and deterministic pet/departure/gun fixtures run without long waits.
- **evidence** — Repeatable functional checks and narrated phone video. Acceptance: headless browser checks and library build pass; a new testing suite preserves earlier history; contact sheets/frames are inspected, video is delivered with human motion/listening acceptance and performance explicitly separate.

## Relationships

- builds-on: [/docs/plans/084_cat-space-program.md](/docs/plans/084_cat-space-program.md)
<!-- /tri:scope -->

## Current phase status

| Phase    | State   |
| -------- | ------- |
| care-model | done |
| care-presentation | done |
| evidence | done |

<!-- tri:review version="1" scope-hash="86db9ce945815edeb757a3844844d83b6fe12cb26a4937131789eea17647e9ce" reviewed="2026-11-06" reviewer="agent" -->
<!-- /tri:review -->

## Delivery progress

2026-11-06: Owner requested the care expansion and remote narrated review. Initial design follows the explicitly requested deterministic model and existing page architecture. The CLI allocated this reciprocal pair. No scope baseline is confirmed; leave full documents uncommitted.

2026-11-06: Care deadlines, single-human scheduling, stable-recipient petting/treats, two gun purchases, safe departure platforms and tower reflow are implemented. Three short fixtures, named scene/Angular actions, care camera and portal HUD are available. All 21 model tests pass; headless browser controls and the three-case care suite pass. Full library build and Angular template compilation pass. The narrated installed-package recording succeeds; final corrected video frame review is in progress. See the ER for evidence and limitations.

2026-11-06 (delivery): Corrected video `ignore/moon-boop-care-videos/run-GGbHuq/demo.mp4` is 45.967 seconds, 1,423,646 bytes, HEVC/hvc1 with AAC narration. Contact sheet, decoded pet/departure frames and a twelve-sample treat-flight sheet were inspected. All segments are 1x. The final browser interaction checks and the preserved original functional suite pass too. Implementation/evidence scope is complete; user motion/listening/play acceptance remains separate. Leave this full pair for maintainer commit before archival. No scope baseline was established.

[Run the exact functional care suite](http://triangular-demo.localhost:4200/cat-space-program?testSuite=moon-boop-care&testVersion=1&testProfile=headless-hardware&testMode=standard&testRepetitions=1&testAutoStart=1).

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
