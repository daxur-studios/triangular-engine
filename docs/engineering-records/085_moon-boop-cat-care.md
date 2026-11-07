---
type: EngineeringRecord
title: "Moon Boop cat care and treat guns"
description: "Dated decisions, findings and evidence for Moon Boop cat care and treat guns."
timestamp: 2026-11-06T00:00:00Z
tags: [engineering-records]
record_id: er-085
scope_history_schema: 1
plans:
  - /docs/plans/085_moon-boop-cat-care.md
performance:
  - id: moon-boop-care-v1
    url: http://triangular-demo.localhost:4200/cat-space-program?testSuite=moon-boop-care&testVersion=1&testProfile=headless-hardware&testMode=standard&testRepetitions=1&testAutoStart=1
    status: functional-pass-visual-review-pending
---

# Engineering Record 085: Moon Boop cat care and treat guns

Plan: [PLAN-085](/docs/plans/085_moon-boop-cat-care.md).

## 2026-11-06 — Starting

**Goal.** A focused care expansion to [Plan 084](/docs/plans/084_cat-space-program.md), preserving its one-human architecture and remote video workflow.

**Decisions.** Use 50 ms simulation steps, stable cat IDs and bounded in-flight jobs. Cats need care after 24 seconds and depart after 42 seconds without care. Human automatic care starts enabled independently of collection; explicit pet requests use one pending slot, and at most two consecutive automatic pet trips precede an available collection trip. A lightweight lift depicts ascent/descent; no physical climbing. Guns cost 20 then 32 treats, each firing at most every 2.5 seconds with a visible 0.8-second flight. Shots reserve targets to avoid duplicates. Departing cats remain visible briefly and count toward the 30-cat cap until removed; tower membership compresses immediately. Victory remains an 18-cat frozen celebration, so post-victory care does not decay. The former collector-only victory fixture must include upkeep upgrades; previous collection/pause/nursery suite identities stay intact.

**Scope and preservation.** Existing staged/unstaged AGENTS, package/recording, Plan/ER 083/084 and unrelated demo edits are preserved. No staging, commits, archive or scope baseline. No public engine API change. Stop Motion remains an independent recording consumer, not an engine testing artifact backend.

**Checks.** Record commands and observable outcomes. Keep functional, performance and human visual evidence distinct.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## 2026-11-06 — Implementation and functional evidence

The existing page-owned fixed-step model now owns per-cat care timestamps/recipient history, a one-slot explicit pet queue, bounded automatic care/collection scheduling, gun cooldowns and target-reserved shots. The human walks to a lightweight lift, ascends, uses the actor's public hand-action API, then descends. Amber needs and green purr badges identify care state. Safe departures use a small lavender platform, retain their original height, and remove only their own stable ID; stacked survivors settle into contiguous levels. A care camera frames the action. Gold and mint gun bases/barrels are distinct, with bright arcing treat projectiles. Pause/reset cover every transient job and shot. The 18-cat celebration freezes care as well as production; the unupgraded collector-only victory assertion was deliberately replaced with a full-round test that purchases upkeep and movement upgrades normally.

The existing `moonBoopDemo` surface adds pet/care/gun actions, care camera, three deterministic fixtures and cloned care/job/shot state. Actual cat picks and keyboard-accessible named buttons dispatch the same actions. Fixed the existing invisible tower proxy swallowing cat hits: real scene targets take priority. The runner now occupies a scrolling engine side portal, and the old `moon-boop-functional@1` suite remains in history alongside `moon-boop-care@1`. Game/API/pointer/orbit controls lock during a test; cancellation restores the captured round and view.

Checks actually run:

- `node --experimental-strip-types --test projects/demo-app/src/app/pages/cat-space-program/moon-boop-game.spec.mjs`: **21 passed**. Tests include exact care/departure thresholds, correct pet/hit recipients, flight delay, gun cadence/cost/cap, two-gun throughput, deadline/hit ties, missed and moved targets, bounded scheduling, pause/reset, snapshots/chunk equivalence, population occupancy during departure, and a complete upkeep-funded victory. Node emits the existing module-type inference warning; no package-wide module change was made.
- `node node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js -p projects/demo-app/tsconfig.app.json --noEmit`: passed template/type checks. `npm run build:triangular-engine`: passed all entry points (34.35 seconds). This task changes no public engine API.
- `daxur app status triangular-demo --json --wait`: the existing served app compiled successfully with zero errors/warnings. No server was started by this task.
- `node tools/scene-tests/moon-boop-check.mjs --full-suite`, followed by the expanded pointer/reflow checks: passed, no page errors. Covers real pointer picking, keyboard petting, Angular gun purchases, frozen airborne shots, rendered tower reflow, test lock/cancel/restore and demo-hub routing. Local artifacts are retained in `ignore/moon-boop-verification/`.
- Unattended `npm run test:run '--' --url http://triangular-demo.localhost:4200/cat-space-program --suite moon-boop-care --version 1 --profile headless-hardware --noisy --timeout-min 3`: three valid cases, automated pass, performance not run, human visual review pending. Retained run `artifacts/test-runs/moon-boop-care@v1/2026-11-06T19-51-21-838Z_headless-hardware_747079b6-e3b0c442.json`. Earlier intentional cancellation evidence remains alongside completed runs. Results were read through `npm run test:summary` first. These noisy headless checks establish functionality, not a hardware budget.
- `git diff --check`: no whitespace errors. Plan 085's scoped review is current. Global `triangular docs records check` still reports the pre-existing stale Plan 081 review; unrelated scope was not refreshed.

## 2026-11-06 — Narrated care recording and frame review

Used the installed Stop Motion UI 0.3.0 skill/CLI and new app-owned `tools/scene-tests/moon-boop-care.video.mjs`. Doctor passes. Daxur speech is prepared before capture and cached automatically. All six segments use 1x input, speech and footage; the short fixtures avoid accelerated waits. Readiness and completion use the supported game API. The recipe asserts human care of Cat 4, middle departure membership and eight distinct treat recipients after upgrading to two guns. No Three.js traversal or per-frame movement scripting is used.

Initial run `ignore/moon-boop-care-videos/run-tPG2n9` succeeded: 45.933 seconds, 1440×960 at 30 output fps, HEVC/hvc1 yuv420p with AAC narration, 1,427,944 bytes, 625 retained source JPEGs. Inspected its contact sheet and decoded pet/departure/gun frames. The inspection showed needs badges too high relative to their recipients; lowered them to body height and moved the pet lift slightly closer to the cat. The corrected recording reuses cached narration. Keep this first run as iteration history; final handoff evidence follows below.

The original staged collection/victory recipe is preserved as historical pre-care footage, and the README explicitly identifies the new care recipe as this expansion's acceptance recording. Stop Motion is independent of the engine/testing result-artifact contract. Source wall time, simulation time and encoded cadence remain distinct. Game sound is not recorded. Frame review does not establish continuous-motion quality, speech/listening acceptance, balance or performance. Those remain for owner review.

## 2026-11-06 — Corrected handoff

Final video: `ignore/moon-boop-care-videos/run-GGbHuq/demo.mp4`. FFprobe independently confirmed **45.967 seconds, 1440×960, HEVC/hvc1 yuv420p and AAC, 1,423,646 bytes**. Six narration clips, 624 timestamped source JPEGs, pointer samples, segment mapping and transcript are retained in the run folder. The recipe completed its three gameplay assertions. The second run used the unchanged authored narration through the package cache.

Inspected the final contact sheet, decoded pet frame at 9.3 seconds, departure frame at 18.6 seconds, gun frame at 33.5 seconds, and twelve half-second samples covering treat flight from 30.3–36.3 seconds. These show the hand reaching Cat 4, a recipient-aligned care badge, the lavender safe-exit disc, a shorter intact tower, distinct gold/mint guns and bright flying treats from both sides. This is a limited agent frame inspection, not owner motion/listening acceptance or a full animation assessment. No generic testing visual-review verdict was written for these independent recorder artifacts.

Final `moon-boop-check.mjs` passed all nine browser checks with zero page errors after the presentation correction. The preserved original `moon-boop-functional@1` suite also passed all three cases headlessly with `--noisy`: `artifacts/test-runs/moon-boop-functional@v1/2026-11-06T19-54-45-807Z_headless-hardware_747079b6-e3b0c442.json`. Automated pass, performance not run, visual pending. The deliberate cancellation checks save cancelled care runs; those are cancellation evidence, not failures of a completed suite.

The final care suite rerun after all code changes also passed all three cases: `artifacts/test-runs/moon-boop-care@v1/2026-11-06T19-56-05-620Z_headless-hardware_747079b6-e3b0c442.json`. The compact summary reports automated pass, performance not run and visual pending. No further code changes followed.

The new Plan/ER pair and its index entry are complete and remain full. No files were staged or committed, no baseline confirmed, no records archived, and prior staged/concurrent edits were retained. Owner review is by the machine's inline absolute-path media handoff. No external publication, upload or tunnel is involved.

## 2026-11-07 — Owner feedback and commit authorization

The owner said the demo is funny and they like it. They then explicitly authorized a one-time exception to create exactly two local commits: packaged recording adoption, followed by the cat-care expansion. This does not change the standing no-commit instruction. No push, archival or scope baseline is part of that authorization.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
