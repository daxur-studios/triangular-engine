---
type: EngineeringRecord
title: "Visual verification evidence and retention"
description: "Dated decisions, findings and evidence for visual verification evidence and retention."
timestamp: 2026-10-31T00:00:00Z
tags: [engineering-records]
record_id: er-073
scope_history_schema: 1
plans:
  - /docs/plans/073_visual-verification-evidence-retention.md
performance: []
---

# Engineering Record 073: Visual verification evidence and retention

Plan: [PLAN-073](/docs/plans/073_visual-verification-evidence-retention.md).

## 2026-10-31 — Starting

**Goal.** Build a reusable visual-verification workflow for the engine demo and consumer games, with reproducible scene evidence, on-demand review media, separate human/agent assessments and bounded local artifact retention.

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/073_visual-verification-evidence-retention.md).

**Checks.** Record commands and observable outcomes. Keep functional, performance and human visual evidence distinct.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## 2026-10-31 — Follow-up scope from test-recording POC

Plan 073 builds on completed [Plan 072](/docs/plans/072_testing-video-recordings.md), which established opt-in browser recordings and explicitly left transcoding out of scope. The user clarified that deterministic test runs can regenerate recordings; short-lived media therefore may serve as session evidence for review and sharing, while the test definition, source fingerprint, seed/settings and compact review history are retained as the regeneration recipe and audit trail.

The proposed workflow covers more than playback. A host game can define camera orbits and animation phases; a run can produce video plus labeled contact/sprite sheets suited to targeted human or agent review. GIFs are optional on-demand derivatives for clients that display animated images but not video. Vector highlights should be a separate toggleable layer tied to scene/frame evidence; a target highlight must not imply that the area passed review. Human and agent reviews remain separately attributed from automated verdicts.

The initial retention proposal is a configurable per-app 1 GiB media budget, a seven-day TTL for unpinned media, and oldest generated GIF/contact-sheet derivatives pruned before oldest unpinned videos. Bookmarks would protect selected media. These values and the safety of regeneration after expiry remain open; do not treat this proposal as approval for automatic deletion. See Q1 in the plan.

**Action.** Create the reusable contract and artifact-policy plan before implementation. Keep the demo and each consumer app's output directory independently managed by the triangular CLI; preserve run/review metadata when media files expire.

**Checks.** `triangular docs plan new` created the reciprocal PLAN-073 / ER 073 pair and updated both indexes. Run mapped-document validation after completing the scope review.

## 2026-10-31 — Capsule Characters Lab evidence proof of concept

**Change.** Added the `capsule-visual-verification@v1` suite to the demo's Characters Lab. It runs a procedural capsule human walk and a capsule cat goofy walk, with a deterministic horizontal camera turn followed by a vertical elevation sweep. The existing opt-in recording control captures each case at 960×540, 20 fps, preserving the source canvas aspect ratio. The host adapter also snapshots/restores the page's selected character, layout, camera and actor yaw around the run.

**Verification.** `npx ng test demo-app --watch=false --browsers=ChromeHeadless --include projects/demo-app/src/app/pages/characters-lab/characters-lab-test-adapter.spec.ts` passed (7/7). A visible-browser quick run completed with 2 valid cases, 0 invalid cases and 0 failures. The saved result is `artifacts/test-runs/capsule-visual-verification@v1/2026-10-31T04-11-16-689Z_visible-browser_quick_3eda5891-e3b0c442.json`. It contains two silent WebM recordings, each 9.1 seconds at 960×540: human 202,768 bytes; cat 199,160 bytes; total 401,928 bytes (about 393 KiB). The test summary reports `auto=pass`, `visual=pending`; no visual verdict was recorded. Visible-browser frame timings are diagnostic and are not performance claims.

The first run revealed that the human test settings used a stale preset ID (`wacky-hair-cosmonaut`); the actual ID is `wacky-helmet-waver`. Correcting the setting made the full run pass. The separately saved first run remains available as the failed-result history.

**Status and next work.** The `reproducible-evidence` phase is in progress. This demo proves scene-specific motion paths and opt-in video capture, but the acceptance scope still includes richer recipe metadata and an equivalent consumer-style adapter example. On-demand GIF/contact/sprite-sheet generation and artifact inventory/retention are not implemented. Q1 remains open, so this work does not enable automatic deletion.

## 2026-10-31 — On-demand GIF preview command

**Change.** Added `triangular testing media gif` (also `triangular-test-media`) for saved WebM files inside the configured test artifact directory. FFmpeg creates a silent, palette-optimized GIF beside the source; the source remains intact. A run-local `media-manifest.json` records the source and derivative paths, byte sizes, generation time and encoder settings. Existing previews require `--force` before replacement.

**Checks.** CLI unit coverage exercises option bounds, the palette-based silent encode arguments, source preservation, manifest metadata, metadata-only listing and rejection of files outside the configured artifact root. FFmpeg generated a 480×270, 8 fps GIF from each 960×540 WebM. The human GIF is 722,278 bytes (source 202,768 bytes); the cat GIF is 853,893 bytes (source 199,160 bytes). The total is 1,576,171 bytes for GIFs versus 401,928 bytes for both source videos. A frame sampled at three seconds from each GIF shows the character in motion. GIFs trade file size for clients that can display animated images but cannot display the source video.

**Status and next work.** The `review-derivatives` phase is in progress. GIF generation addresses clients that render animated images but cannot display the source video; labeled contact sheets for static human/agent inspection remain to be implemented. No automatic summarizer reads GIF or video pixels. Artifact inventory and cleanup remain deferred while Q1 is open.

## 2026-10-31 — Labeled contact-sheet command

**Change.** Added `triangular testing media contact-sheet`. Callers provide two to sixteen timestamp/label pairs. FFmpeg samples one aspect-preserving JPEG frame per timestamp; the CLI embeds them with the labels and times in a single, self-contained SVG contact sheet. The source video is untouched. A run manifest records capture labels, timestamps, size and source link. CLI listing continues to read only metadata. Manifest updates now use a short-lived lock and reread the latest manifest, so concurrent GIF/sheet generation for one run retains all derivatives.

**Demo evidence.** Generated sheets for the capsule human walk and capsule cat goofy walk, each with front, side, rear, opposite-side and high-angle frames. The human sheet is 21,194 bytes (about 20.7 KiB); the cat sheet is 19,819 bytes (about 19.4 KiB). Both are substantially smaller than their source WebM clips (202,768 and 199,160 bytes) and corresponding GIF previews (722,278 and 853,893 bytes). Each SVG is one portable file with five embedded frames; it requires no accompanying image files.

**Checks.** `npm run test:triangular-engine:media` passed (6/6), covering bounded capture inputs, FFmpeg sampling arguments, XML-escaped labels, source preservation, manifest/list metadata, overwrite protection, empty-frame handling and artifact-root containment. The first simultaneous human/cat generation exposed a Windows manifest replacement race; after adding manifest locking, both sheets regenerated successfully in parallel and the metadata-only listing returned all four GIF/contact-sheet records. Mapped Plan/Record validation, Node syntax checks and `git diff --check` passed. The SVG files were not visually opened in this session because the browser security policy blocked local-file navigation; no visual verdict is recorded.

**Status and next work.** `review-derivatives` remains in progress: on-demand GIFs and labeled contact sheets are implemented, while sprite-sheet generation is not. This contact sheet exposes representative positions and animation-in-progress, but it is not a walk-cycle sprite sheet and does not itself establish a visual pass. The visual reviewer still decides whether the frames meet the stated claim. No pixels are loaded by metadata listing. Retention and deletion remain deferred while Q1 is open.

## 2026-10-31 — Attributed visual-review records

**Change.** Added `triangular testing review add|list` and the standalone `triangular-test-review` binary. An append-only run-adjacent `.reviews.json` stores each review's human/agent identity, optional model, claim, verdict and artifact metadata (relative path, type, MIME type, size and modification time). Review files sit beside the saved result JSON, outside the media sidecar, so media cleanup can preserve the assessment. The command validates that the evidence is inside the matching run folder and does not read its contents. It makes no AI-provider calls and does not modify automated test results.

**Checks.** `npm run test:triangular-engine:review` passed (3/3). Coverage verifies explicit provenance/verdict/claim validation, separate human and agent records, unchanged automated verdicts, persistence after removing the media folder, and rejection of artifacts outside the run. The owner confirmed the generated sheets render in chat; two human `pass` records were saved for that visibility claim in the run-adjacent `.reviews.json`. These records verify delivery only; no visual pass/fail was recorded for the capsule characters or their animation.

**Status and next work.** `visual-review` is in progress. Human and agent assessments now persist separately from automation. Optional vector overlays with a toggleable inspection target and clear verdict semantics remain to be implemented; a full-cycle sprite-sheet derivative is also still open. The seven-day TTL and 1 GiB quota remain undecided, so pruning is not enabled.

## 2026-10-31 — Toggleable claim overlays

**Change.** Extended `triangular testing review` with `overlay` and `view`. A reviewer can attach a normalized vector box or arrow to a one-based frame of a reviewed contact sheet. Amber dashed markers are `target` overlays for areas to inspect. Green `passed` markers require the associated review verdict to be `pass`. The generated local HTML viewer has separate checkboxes for the two layers and states that automated test status remains separate. It references the original contact sheet without changing it, and its byte size is added to the run's media manifest. A reviewed artifact's recorded size and modification time are checked before adding or rendering overlays; replacing a contact sheet requires a fresh review.

**Checks.** `npm run test:triangular-engine:review` passed (6/6), covering normalized input bounds, frame selection, target/pass distinctions, rejection of green markers on non-passing reviews, toggle-layer markup, artifact immutability and stale-artifact rejection. Applied five green frame-visibility boxes to each of the two user-confirmed sheets and generated separate toggleable viewers (4,287 and 4,351 bytes). The metadata-only listing returned both viewers; all derivatives total 1,625,822 bytes. These green markers record only that each frame is visible in chat, not that the character or gait passed. The viewer and annotations are local derivatives; no media pixels are read by the CLI and no model is called. The viewer was not opened in this session because the browser security policy blocks local-file navigation.

**Status and next work.** The `visual-review` phase remains in progress. Review records and overlays are implemented, but a full-cycle walk sprite atlas and consumer-app adapter example remain open. The owner has confirmed sheet visibility; character appearance and animation quality have not received a recorded verdict. Retention Q1 remains open and pruning stays disabled.

## 2026-10-31 — Close-up facial expression evidence

**Change.** Added an explicit `face-close-up` camera preset to Characters Lab and the `capsule-facial-emotions@v1` suite: four still human expressions and four still cat expressions. Close-up thumbnails use a 1280×720, four-sample screenshot pass after the case measurement, then WebP compression to a maximum 640-pixel side and 50 KB target. Other Characters Lab cases do not emit these thumbnails. `triangular testing media contact-sheet` now accepts two to sixteen labeled saved JPEG/PNG/WebP stills from one run sidecar and embeds them unchanged in a self-contained SVG; manifest metadata records every source path and size.

**Verification.** The focused Characters Lab spec passed (9/9). `npm run test:triangular-engine:media` passed (8/8). A fresh headless-hardware quick run of `capsule-facial-emotions@v1` completed with `auto=pass`, eight cases, no invalid cases, and no failures. Its eight WebP stills total 63,126 bytes and range from 6,932 to 10,296 bytes; the labeled 640-pixel-cell sheet is 87,693 bytes. The screenshots are generated after measurement and therefore are not performance evidence. No video was requested for this still-focused run. The saved result is `artifacts/test-runs/capsule-facial-emotions@v1/2026-10-31T05-00-10-111Z_headless-hardware_quick_3eda5891-10c06413.json`.

**Status and next work.** This is high-detail visual evidence, not an automated expression-quality check. The generated contact sheet still needs a human or agent review against a concrete claim; no facial-expression pass has been recorded. Motion evidence, close-up still evidence, GIFs and sheet derivatives remain optional and locally generated. Full-cycle sprite atlases, consumer-app proof, and retention policy/tooling remain open; Q1 still blocks any automatic pruning.

## 2026-10-31 — Future exploration: concept references and approved traces

**Discussion.** A concept-reference workflow could link source artwork to a character, named procedural part, view or pose, test case and scene focus target. A compact app-owned manifest could let tooling compose only the relevant concept crop beside its matching rendered still, so human or vision review does not need to identify a character or feature inside a large sheet. Candidate prompt templates discussed were a 2×4 eight-view turnaround (front through back at 45-degree steps), a 2×4 facial-expression sheet, and a 4×4 component sheet whose rows follow real generator component IDs and whose columns are front/back/left/right views. Labels and cell mappings should be added or verified by tooling rather than trusted to generated text.

A later extension could let a vision agent propose an SVG outline and named landmarks (for example, hair/head silhouette, eye centers, mouth bounds or cockpit-frame corners). A human would correct and approve/version that trace before it becomes a guide or benchmark. Comparisons should use registered orthographic views and preferably a flat silhouette/feature pass, with the trace kept separate from source renders. One 2D trace describes only one projection; depth and curvature need other views or CAD/dimensioned references. This also applies to shader-only details: their declared shape/focus bounds should come from the same parameters that control the shader.

**Disposition.** Future exploration only; no new phase scope, reference-manifest format, command or engine API is accepted here. Start with the current external consumer-app experiment and paired image/render review. Use its feedback to decide whether concept-to-render pairing is useful before building prompt-pack or trace tooling. No media cleanup policy changes.

## 2026-10-31 — Visual evidence selection and handoff guidance

**Change.** Updated the packaged `triangular-engine-testing` skill and `testing/README.md` so a fresh consumer-app session can select evidence by review goal: optional WebM for source playback/audio, GIF as a silent motion preview when useful, labeled video-sampled contact sheets for motion/view coverage, and separate still contact sheets for detail claims such as facial expressions. The guidance explicitly permits multiple focused sheets, calls sampled sheets distinct from a full sprite atlas, recommends metadata-first/limited vision review, and describes claim-scoped review records. It also says concept-art mappings remain app-owned and shader-feature bounds need app-provided data.

**Verification.** The skill is included in package output by `ng-package.json` from `.agents/skills`; the testing README ships with the testing entry point. Mapped Plan/Record validation and `git diff --check` pass. No runtime API changed. Existing installed consumers need a package build/update to receive the new skill text.

**Status.** The current external consumer-app experiment remains the next feedback gate. This documentation makes the established media workflow discoverable in a fresh session; it does not accept the proposed concept-reference manifest or SVG tracing work into implementation scope.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
