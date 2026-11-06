---
type: EngineeringRecord
title: "Cat Space Program: Operation Moon Boop"
description: "Dated decisions, findings and evidence for Cat Space Program: Operation Moon Boop."
timestamp: 2026-11-05T00:00:00Z
tags: [engineering-records]
record_id: er-084
scope_history_schema: 1
plans:
  - /docs/plans/084_cat-space-program.md
performance:
  - id: moon-boop-functional-v1
    url: http://triangular-demo.localhost:4200/cat-space-program?testSuite=moon-boop-functional&testVersion=1&testProfile=headless-hardware&testMode=standard&testRepetitions=1&testAutoStart=1
    status: functional-pass-visual-review-pending
---

# Engineering Record 084: Cat Space Program: Operation Moon Boop

Plan: [PLAN-084](/docs/plans/084_cat-space-program.md).

## 2026-11-05 — Starting

**Goal.** A short playable capsule-cat incremental game and a continuous narrated recording proof.

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/084_cat-space-program.md).

**Checks.** Record commands and observable outcomes. Keep functional, performance and human visual evidence distinct.

## 2026-11-05 — Start

The owner authorized a goofy capsule-cat incremental game as the engine/demo and narrated-recording pilot. One capsule human collects cats; speed and carrying upgrades scale throughput. The scene will reuse procedural actors, existing scene/portal/tick facilities and the testing entry. Keep generic runtime extraction separate until the page contract is demonstrated. Existing staged/unstaged changes, especially Plan 083 and recording/sidecar code, belong to concurrent work and must remain intact.

Production is bounded; stacked cats are posed once. This is a resource-control choice, not verified performance evidence. Source footage remains distinct from presentation acceleration. The first recording is a demo-local proof, not a claim that Stop Motion's packaged continuous API already exists.

## 2026-11-05 — Playable prototype and functional evidence

Implemented `/cat-space-program` and its demo-hub card. The pure fixed-step model owns production, resource accounting, one collector, shoes/basket upgrades, three starting conditions, pause/reset and an 18-cat victory. Source counts are bounded to 30 cats total. Cats waiting in the scene use existing CapsuleCatActor assemblies; one CapsuleCharacterActor carries them on their head. Stacked actors stop rig updates after posing, but continue to contribute draw calls. There is no controlled performance measurement or optimality/balance claim.

The page owns a development-only `window.moonBoopDemo` interface: actions, cloned state, selection, readiness and named projected bounds. Buttons, scene picking and the recording script use supported actions. Bounds are inspection aids, not proof of visibility or a passing review. A portal-centered decoration carries the focus box without an input-catching full-size layout box; this was verified after the original overlay intercepted pointer clicks. Camera modes cover overview, following the collector and the tower.

Checks actually run:

- `node --experimental-strip-types --test .../moon-boop-game.spec.mjs`: 10 passed. Includes accounting, six-kitten timing, food portions, pause, complete one-collector round, upgraded throughput/capacity, bounded population, reset/snapshot remainder and fixed-step chunk equivalence. Node emits the workspace's existing module-type inference warning; no manifest-wide module-mode change was made.
- `node .../@angular/compiler-cli/.../ngc.js -p projects/demo-app/tsconfig.app.json --noEmit`: passed, including final template/type checks.
- `ng build triangular-engine`: passed all entry points. The page adds no public engine API.
- `daxur app status triangular-demo --json --wait`: live build successful, zero errors/warnings. The existing owner-served app was reused; no server was started.
- `node tools/scene-tests/moon-boop-check.mjs`: passed Angular stacking, named-target real pointer picking, pause across renders, test cancellation/restoration/input locking and the hub link; no pageerror events. A later `--full-suite` run also passed.
- `moon-boop-functional@1`: three valid cases, zero invalid, zero failed. The compact saved summary reports automated pass, performance not run, visual pending. One retained result is `artifacts/test-runs/moon-boop-functional@v1/2026-11-05T23-37-40-622Z_visible-browser_836d7789-e3b0c442.json`.

The unattended launcher was queued behind a pre-existing long-lived run. Only this task's still-unstarted launcher was stopped; no other process was interrupted. Functional evidence was collected by headless Chrome driving the page's actual runner instead. Its saved profile label is visible-browser; the actual browser was headless, so this is functional evidence only. Initial browser harness failures (stale API before a live rebuild, an overly broad summary selector, and matching the word pass when the result card prints counts) were corrected; durable suite results and final browser checks are the authority.

Global `triangular docs records check` is blocked by pre-existing stale review metadata in Plan 081. Do not refresh unrelated scope to make this pass. Plan 084 is reviewed separately. No scope baseline, commits or archives were created.

## 2026-11-05 — Narrated continuous recording and final outcome

Final demo-local proof: `ignore/moon-boop-videos/2026-11-05T23-40-06-716Z/demo.mp4`, 34.733 seconds, 1440x960, H.264/yuv420p limited-range video, AAC narration, 1,426,555 bytes. `source.mp4`, 734 timestamped source JPEG frames, `frame-times.json`, `recording.json`, `edit-filter.txt`, copied speech clips and a contact sheet are retained beside it. The recorded source covers 54.55 seconds; source/output section mappings preserve the 3x kitten countdown and 5x hauling sections. Final model state is an 18-cat victory, exactly one collector, with one shoe upgrade. Source wall time and model time are not equated. The final manual stacking sequence is a supported player action; it is not presented as a fully unattended collector victory (the pure model separately checks a complete collector-only round).

Daxur Gemini speech generated four supplied WAV clips using the documented command; no key or provider logic was added to this repository. Existing files were reused for the final recording. FFprobe verified the MP4 codecs, dimensions, pixel format, duration and size. Narration lengths are probed before capture and normal-speed holds prevent speech being cut short. The capture script adds a synthetic pointer following actual browser pointer events; exported badges/captions and game focus overlays remain in the video. There are no game sound effects in this POC. Contact-sheet samples and a close-up focus screenshot were visually inspected; this does not establish continuous-motion quality, listening acceptance or hardware performance.

A first video exposed a focus overlay that existed in the DOM but did not paint because its SVG viewport was zero-sized. It was replaced by a full-size, absolutely positioned SVG decoration in a zero-size portal lane, preserving pointer pass-through. Focus bounds now update after every rendered frame. The initial video and a compatibility derivative remain as history. Final source/export verification and the narrow browser checks passed after this fix.

The exact-version autostart URL was also exercised in headless Chrome: `artifacts/test-runs/moon-boop-functional@v1/2026-11-05T23-41-25-680Z_headless-hardware_836d7789-e3b0c442.json` reports three valid cases, automated pass, performance not run and visual review pending. The route, hub card and developer interface are usable now. User play/balance/visual acceptance and a controlled performance assessment remain open; no performance baseline is claimed.

All four implementation phases of this bounded POC are delivered. This is a game/demo-local integration proof, not a released continuous-capture backend for Stop Motion, and it does not change generic testing capture budgets or Plan 083's frame identity contract. The next reusable-library task should extract and test segment retiming/cue synchronization in Stop Motion using this scene as a consumer. No commits, staging or archival were performed by this agent; leave the full Plan/ER for maintainer review and commit.

## 2026-11-06 — User feedback and Daxur compression comparison

The owner reports the prototype is working well and requested a compact trace of the workflow and a check of Daxur video compression. This is general user feedback, not a new scope baseline or an attributed claim-scoped visual review.

Workflow: page-owned game actions/targets -> headless browser interaction and continuous CDP frames -> source MP4 plus source-time metadata -> segment edits at 1x/3x/5x -> pointer/focus/captions and normal-speed supplied Daxur speech -> H.264/AAC MP4 -> absolute-path chat media embed. The capture/retiming producer is still demo-local; extracting it into the Stop Motion package remains the next integration task.

The existing 34.73-second 1440x960 H.264/AAC export is already compressed: 1,426,555 bytes, about 329 kbit/s total. Ran `daxur --agent compress ignore/moon-boop-videos/2026-11-05T23-40-06-716Z/demo.mp4`. It preserved the original and wrote `demo.min.mp4`: 1,193,824 bytes, saving 232,731 bytes (16.31%). Its current default changes video to HEVC/H.265 with hvc1 tagging and retains AAC; it is not an equivalent H.264 encode. FFprobe checked both files. No comparative visual/listening review or phone playback of the HEVC derivative was performed.

Recommendation: retain the already-small H.264/AAC clip as the default chat handoff, whose codec workflow has confirmed phone playback. Daxur can remain an optional size-saving derivative; adding a mandatory second lossy encode is not justified by this result. A future reusable exporter should ideally apply the chosen delivery compression once at final encode. No runtime/default settings changed.

## 2026-11-06 — Compact default and paced pointer follow-up

The owner confirmed inline phone playback of the HEVC derivative and requested compact delivery by default. The demo-local recorder now encodes final HEVC/hvc1 CRF 28 directly, with `--codec h264` available, retaining the H.264 continuous source. Earlier advice to prefer H.264 pending a phone trial is superseded by that explicit playback confirmation; motion/listening acceptance remains separate.

The previous synthetic pointer began at (1050,400), while actual Playwright input had not been initialized there. Its `steps:14` movement also had no explicit duration, and locator clicks could reposition it again. Added demo-local `paced-mouse.mjs`: initialize actual input before capture; ease travel over 500–1100 ms; await arrival and stable bounds; refuse disabled/covered controls; click at the displayed input position; allow a short visible press/release. These waits pace presentation, not application readiness. Timestamped pointer samples are retained alongside CDP frame timestamps. This remains a demo-local proof, with no public engine API or generic testing recorder changes.

`node --test tools/scene-tests/paced-mouse.spec.mjs` passed headlessly: intermediate browser-rendered positions, minimum travel duration, exact click location, repeat clicks without resets, and disabled/covered target refusal. The first recording attempt timed out at startup with zero frames while the existing daemon rebuilt; its subsequent status showed build success and zero errors/warnings. No server was started. Added a failure screenshot diagnostic and retried.

`node tools/scene-tests/record-moon-boop.mjs ignore/moon-boop-speech` succeeded in run `ignore/moon-boop-videos/2026-11-06T11-51-41-137Z`. FFprobe: 42.004 seconds, 1440x960, HEVC/hvc1 limited-range yuv420p, AAC narration, 1,333,868 bytes. Retained 798 source JPEG frames across 58.73 seconds, 233 pointer samples, source MP4 and source/output segment mapping. Final state won with 18 cats and one human. The extra visible approaches make this clip longer than the earlier 34.73-second clip, so their sizes are not a controlled codec comparison. Narration reused supplied clips with no new synthesis. Inspected the overall contact sheet and an eight-frame first-approach montage: intermediate pointer positions are visible and victory/focus presentation remains present. Full motion/listening review remains for the owner. These checks establish no performance baseline.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
