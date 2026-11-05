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

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
