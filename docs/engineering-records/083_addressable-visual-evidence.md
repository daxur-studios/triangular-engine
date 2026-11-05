---
type: EngineeringRecord
title: "Addressable Visual Evidence and Shot Plans"
description: "Dated decisions, findings and evidence for Addressable Visual Evidence and Shot Plans."
timestamp: 2026-11-05T00:00:00Z
tags: [engineering-records]
record_id: er-083
scope_history_schema: 1
plans:
  - /docs/plans/083_addressable-visual-evidence.md
performance: []
---

# Engineering Record 083: Addressable Visual Evidence and Shot Plans

Plan: [PLAN-083](/docs/plans/083_addressable-visual-evidence.md).

## 2026-11-05 — Starting

**Goal.** Make recorded visual evidence useful to a reviewer away from the machine: agent-proposed shots aimed at what a change could break, and clips whose exact frames can be discussed.

**Why this approach.** The owner weighed live remote control from a phone (desktop streaming over a private network, plus a touch overlay) for time away from the RTX laptop, and judged it too complicated. They chose to improve generated evidence instead. Live free-look exploration is therefore not replaced by this work: recordings cannot show how a scene feels to steer through, and scripted shots only cover what someone thought to aim at.

**Current state found (read from code and docs, nothing run).**

- Recording is off by default, and diagnostic only. Performance and CPU suites refuse it (`test-runner.component.ts`).
- The runner forces `recordings: false` for launch links, and the testing README says links never start clips. Unattended runs therefore produce no video today (plan item Q1).
- `createTestMediaRecorderCapture` defaults to limits of 15 s and 1 MiB per clip and 5 MiB per run. `water-lod-spike-recording.ts` records 640x360 at 24 fps and already burns in a quality label, which is the seam for a frame number.
- Nothing in the testing entry or demo app uses `VideoEncoder`, so clip timing is whatever `MediaRecorder` produced (plan item Q2).
- `triangular testing media` already makes GIFs and labeled contact sheets and tracks them in `media-manifest.json`. `triangular testing review` already stores claim-scoped reviews and box or arrow overlays with normalized coordinates on a contact sheet frame. A frame-scoped note should extend these rather than add a parallel store.
- `water-lod-spike` already has camera keys and easing (`motionPose`) and orbit cases that record clips, which makes it the cheapest pilot (plan item Q4).
- `EngineService.tick` advances `elapsedTime$` from a measured, clamped delta, so two runs do not produce the same frames. This keeps run-to-run comparison out of this plan, and it limits exact re-rendering of a moment (plan item Q3).

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/083_addressable-visual-evidence.md).

**Checks.** No implementation yet. Record commands and observable outcomes per phase, and keep functional, performance and human visual evidence distinct.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

### 2026-11-05 — Owner answers

- **Launch-link recording (plan Q1): approved.** An explicit launch-link option may start recordings, opt-in per link. Links
  without it still record nothing. This reverses the documented "links never record" rule for that option only; `aev-agent-links`
  must update the README to match.
- **Pilot (plan Q4): confirmed.** `water-lod-spike` is the first shot-plan pilot.
- **Scope note, not a formal scope change.** The owner expects more scenes later, from this repository, from consumer apps in
  separate repositories and from games built on the engine. The plan now requires that the shot format and CLI be app-agnostic and
  work from any consumer workspace, and that public docs name no consumer repository or scene. Whether this needs a formal
  `tri:scope-change` entry is left for the owner to decide; no baseline has been confirmed.

### 2026-11-05 — aev-frame-map implemented (Q2 open)

**What changed (uncommitted).**

- Testing entry: `test-frame-burn-in.ts` (`drawFrameBurnIn`, `readFrameBurnIn`, `frameBurnInLayout`): a readable `shot · f0096` label
  and a 17-cell black/white strip in the bottom-right corner that encodes the frame number. `test-frame-sidecar.ts`
  (`createTestFrameLog`): one row per drawn frame (frame, clip time, optional engine frame time, camera position and target,
  short host state), at most 600 rows. `test-contracts.ts`: `TestRecordingArtifact.frames` and reference `frames` / `sidecar`.
  `test-recordings.ts`: the sidecar is kept only within its limits, and is sent beside the clip in the upload.
- Receiver (`triangular-test-receiver.mjs`): `validateFrameSidecar` checks numbering in order, finite times and vectors, key and
  value limits and a 64 KB size, then rebuilds the sidecar from known fields. It is stored as `<case>-r<rep>-0.frames.json` and
  the reference carries the row count and file name. A failed sidecar is dropped with a visible limitation and the clip is kept.
- Demo app (`water-lod-spike`): the recording names the case as its shot, burns the frame number, samples the engine clock, camera and
  quality tier per frame, and freezes the sidecar when recording stops. The clock is read with `performance.now()`, because the
  animation-frame timestamp can lag it.
- Known limits found while reading: the engine clamps each tick's delta to 0.1 s, so frame time can lag real time when the page
  stutters. The launcher has no recording flag and launch links force recording off, so a real clip needs the runner's
  **Record short video** checkbox.

**Checks (run from the repository root).**

- `npm run test:triangular-engine:sink`: 65 of 65 pass, including the new receiver validation and storage test.
- `npm run test:triangular-engine:testing` (ChromeHeadless, `--watch=false`): 216 of 216 pass after two fixes (a spec type error,
  and a size check that did not reach its limit).
- `node projects/triangular-engine/bin/triangular.mjs docs records check`: the only error is the known one on
  `docs/plans/081_body-tint.md`. Not this change; not fixed here.
- Legibility check (synthetic, not a browser clip): 96 synthetic frames with the same strip layout, encoded as VP8 at 900 kbps at
  640x360 and read back with the measurement method below: 96 of 96 readable, 0 unresolved, 0 mismatched. This shows the strip survives
  the recorder's bitrate. It does not measure the spike's clip timing.

**Q2 (display timing): not yet measured on a real clip. Open.**

- Blocker: a real clip of `water-lod-spike` (`water-lod-spike-camera-quality`, a functional suite that moves the camera and changes
  quality) needs the runner's **Record short video** checkbox. The launcher cannot record, and launch links force recording off. The
  in-app browser pane was hidden during this session, and recording needs animation frames, which hidden tabs throttle. Someone with
  the pane open must tick the checkbox and run the suite; the clip and its sidecar then land in `artifacts/test-runs`.
- Method, to run once that clip exists: decode the WebM to raw RGB frames with ffmpeg, read each frame's strip at the layout above, and
  join the number to the sidecar row. For each requested time (every 250 ms), the shown frame is the last decoded frame with pts at or
  before it. Report the requested-time gap (requested time minus that frame's `clipTimeMs`), the player lag (requested time minus its
  pts), and the container-vs-draw difference per frame. The script used for the synthetic check is kept in the agent scratch folder
  and its method is described here, not in the repository.

**Plan status.** `aev-frame-map` stays `in_progress`. The record, sidecar, receiver validation and specs are done. Real-clip evidence
(burned numbers that resolve on a real clip, the Q2 measurement and the visible size-limit case on a real run) is still missing.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
