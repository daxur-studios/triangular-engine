---
type: EngineeringRecord
title: "Optional test video recordings"
description: "Dated decisions, findings and evidence for opt-in test video recordings."
timestamp: 2026-10-31T00:00:00Z
tags: [engineering-records]
record_id: er-072
scope_history_schema: 1
plans:
  - /docs/plans/072_testing-video-recordings.md
performance: []
---

# Engineering Record 072: Optional test video recordings

Plan: [PLAN-072](/docs/plans/072_testing-video-recordings.md).

## 2026-10-31 — Starting

**Goal.** Add an optional, size-bounded recording path to `triangular-engine/testing` and demonstrate a camera proximity sweep with positional audio in the demo audio lab.

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/072_testing-video-recordings.md).

**Checks.** Record commands and observable outcomes. Keep functional, performance and human visual evidence distinct.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## 2026-10-31 — POC scope

The user requested a short video from `/audio-lab` while a test moves the camera listener nearer to and farther from a positional source, with the saved recording playable in chat without the agent processing its video content. The current demo page already synthesizes its sounds through the engine `AudioListener` and moves the listener with the active camera. The browser page is served and initially reports a suspended AudioContext; the run will require the page's Enable Sound gesture before recording.

**Decision.** Keep recording opt-in and capture only during the case measurement. The host adapter supplies video/audio tracks; the shared test entry owns lifecycle, size limits and saved artifact references. Recordings are visual/functional diagnostics and cannot support performance conclusions. The POC captures the scene canvas and engine audio only; microphone and desktop capture are excluded.

**Current storage finding.** The local receiver currently accepts only still-image sidecars, and its read API exposes an image endpoint. Video support therefore needs bounded upload and an allowlisted playback route; the result JSON should retain file references and descriptive metadata rather than media bytes.

## 2026-10-31 — Implementation and live POC

Implemented an opt-in browser recording contract in `triangular-engine/testing`, with a host-supplied canvas stream and optional audio track. Recordings are limited to 15 seconds and 1 MiB per case, with a 5 MiB run cap. Only functional and visual suites can record; performance suites remain excluded. The recording checkbox defaults off. The local receiver validates bounded WebM/MP4 sidecars, stores metadata and file references in test results, serves byte ranges, and the results page uses a controls-enabled video element with `preload="none"`.

Added the `audio-lab-proximity@v1` scenario. After the page's Enable Sound gesture, it moves the active camera/listener from 12 units away to 2.8 units from the positional sound source and back, capturing the 640×360 canvas at 12 fps with the engine audio mix. The test restores camera/audio state. A run with recording enabled completed with 1 valid case, 0 invalid cases and 0 failures; the nearest and return distances both passed. The saved clip is `camera-proximity-sweep-r1-0.webm`, 23,025 bytes, 7,818 ms, `video/webm;codecs=vp9,opus`, with audio. The saved result has no embedded media bytes. The browser result player points at its sidecar while `preload="none"` and `readyState=0`, so checking the result did not fetch or decode the video into the agent context.

The successful browser run initially reached an older receiver process that stored upload bytes inline. The clip was moved into the current validated sidecar format and the inline field removed; the run ID and result metadata were preserved. The result summary and `/tests` player both show the saved artifact. One earlier exploratory run failed because deactivating the orbit-controls component recreated it before the adapter captured it; the implementation now keeps the controls mounted and shields scene pointer input during the test.

The user's follow-on idea is a lightweight clip-curation workflow across engine consumers: agents and people could bookmark/highlight a recording with a short note and later select it for social posting. This is future work outside this POC's scope; no publishing or external sharing is included here.

## Follow-up: playback quality and aspect ratio (2026-10-31)

The user could see the first local video on a laptop but not on the same chat from a phone, and reported that the clip sounded silent, looked low quality and seemed squashed. An image extracted from the local clip displayed inline in chat; phone-side visibility remains for the user to confirm. Inspection showed that the first file did contain Opus audio, but its measured peak was only -21 dBFS and its mean was -41.6 dBFS. Its 640x360 dimensions were 16:9, while the capture code stretched the source canvas into that fixed ratio.

Adjusted the audio-lab profile to capture up to 960x540 at 20 fps while fitting the source canvas into the output without changing its aspect ratio. The audio-lab capture path applies a 2.5x gain only to the recorded mix and requests 48 kb/s audio; playback through the page remains unchanged. A fresh opt-in run passed with 1 valid case, 0 invalid cases and 0 failures. The saved WebM was 369,884 bytes (about 361 KiB), 6,980 ms, 960x540, VP9 + Opus; measured audio level was -33.4 dBFS mean and -13.6 dBFS peak. This is visibly clearer, preserves aspect ratio, and has a materially stronger recorded mix while remaining below the 1 MiB per-case limit.

The user heard the beacon but not the revolving motor buzz. The test setup had muted the SFX bus, which carries that motor, so the setup now leaves SFX enabled at full level while still muting music. A follow-up run passed and recorded the complete mix: 381,817 bytes (about 373 KiB), 6,973 ms, VP9 + Opus; measured mean/peak audio were -19.4/-5.8 dBFS. The user confirmed that images render on phone while embedded videos do not, although both render on laptop.

Evaluated an optional sharing conversion. A Daxur-compressed MP4 sample was made from an H.264/AAC MP4 intermediate: it is 219,931 bytes (about 215 KiB), 960x540, HEVC + AAC, with a visually comparable sampled frame and the audio track intact. Daxur reported 38.09% smaller than the intermediate MP4, and the output is about 42.4% smaller than the original WebM. The installed CLI currently preserves the input extension while encoding HEVC + AAC, so direct WebM-to-MP4 output needs a format/codec option before it is a safe one-step workflow. Keep the raw test artifact; compression should remain a separate, optional share/export step.

**Verification.** `npm run build:triangular-engine` passed. `npm run test:triangular-engine:sink` passed 57/57 after the receiver additions. `npm run test:triangular-engine:testing` passed 201/201 headless tests; this includes the recording lifecycle and the updated generic artifact-drop message assertion. The targeted session spec passed 44/44 after selecting its headless profile. `npx ng build demo-app` passed with existing CSS-budget and Mermaid CommonJS warnings. `node projects/triangular-engine/bin/triangular.mjs docs records check` passed for all 7 mapped and 23 legacy plans, and `git diff --check` found no whitespace errors. The visible-browser audio-lab POC saved and displayed its sidecar recording as described above.

## Follow-up: phone playback and GIF preview (2026-10-31)

The user confirmed that both tested MP4 files display on the laptop but neither displays on the phone in the same remote chat: the H.264/AAC and HEVC/AAC variants were both affected. The silent GIF preview is visible on the phone. It is 672,122 bytes (about 656 KiB) at 320×180 and 8 fps, compared with the 381,817-byte WebM (about 373 KiB, 960×540), 355,260-byte H.264/AAC MP4 (about 347 KiB), and 219,931-byte HEVC/AAC MP4 (about 215 KiB). GIF therefore serves as a useful compatibility derivative, but its larger size and lack of audio make it a poor default recording format.

The user noted that deterministic test runs can regenerate the video when needed; the near-term value is having media available during a review/sharing session. This motivates a short TTL for unpinned media, with generated derivatives eligible for cleanup before source videos and bookmarks protecting selected clips. The exact TTL and total quota remain open.

## Follow-up direction: visual verification and retention (2026-10-31)

The user expanded the follow-up from clip curation to reusable final visual verification for the demo and consumer games: deterministic camera/view and animation evidence, optional GIF/contact/sprite-sheet derivatives, distinct human and agent review records, and toggleable non-destructive annotations. Test definitions, build/environment fingerprints and scenario inputs must remain sufficient to regenerate expired media; compact run and review metadata remain after cleanup.

Plan 073, [Visual verification evidence and retention](/docs/plans/073_visual-verification-evidence-retention.md), tracks this follow-up. Its initial proposal is a seven-day TTL for unpinned media and a per-app 1 GiB quota, pruning generated GIF/contact-sheet derivatives before videos in oldest-first order. Those policy values are open assumptions pending confirmation and a regeneration check; Plan 072 remains complete and unchanged in scope.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
