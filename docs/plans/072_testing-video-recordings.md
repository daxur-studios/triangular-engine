---
type: Plan
title: "Optional test video recordings"
description: "Opt-in, bounded browser recordings for selected test cases, saved as playable artifacts; prove the path in the audio lab with a camera proximity sweep and captured positional audio."
timestamp: 2026-10-31T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/072_testing-video-recordings.md
map_schema: 1
document_id: plan-072
initiative_id: "testing-video-recordings"
performance: []
---

# Plan 072: Optional test video recordings

Status: **complete**. Evidence and decisions: [ER 072](/docs/engineering-records/072_testing-video-recordings.md).

<!-- tri:scope -->

## Intended outcome

`triangular-engine/testing` can optionally record a short clip for selected browser test cases, with the page supplying a canvas video track and optional scene-audio track. Clips are size-bounded, stored beside saved test results, and playable from the results UI; normal runs remain unrecorded. The demo app's audio lab provides the first example: a repeatable camera move toward and away from a positional sound, with the recording containing both the rendered scene and the engine's audio mix. Recording is diagnostic evidence and does not produce valid performance evidence. Microphone capture, desktop capture, transcoding, and a shared social-media curator are out of scope.

## Phases and acceptance

- **recording-contract** — Add an opt-in recording lifecycle and user control for selected cases, default off; the adapter provides a capture stream. Acceptance: enabled cases record only around `measure`, stop on success, failure, timeout or cancellation, enforce duration/size bounds, and leave existing thumbnails and unrecorded runs unchanged.
- **artifact-storage** — Persist recordings as validated sidecar artifacts with metadata and safe receiver read routes. Acceptance: the stored run JSON contains only artifact references and metadata, rejected/oversized clips become visible limitations, and the results page can play a clip without eagerly loading it.
- **audio-lab-poc** — Add a functional, visually reviewable audio-lab suite that moves the camera listener closer to and farther from a sound source. Acceptance: an explicitly enabled recording includes the 3D canvas and the in-page audio mix, the scenario restores the initial camera state, and the saved artifact plays from its result.
- **verification** — Verify narrow tests, package build and the live demo workflow. Acceptance: tests cover opt-in lifecycle, cancellation/failure cleanup, artifact validation and rendering; a saved audio-lab run has a playable clip and reports its actual size and MIME type.

## Relationships

<!-- Add only links that have a defined relation; omit this placeholder line when there are none. -->
<!-- /tri:scope -->

## Current phase status

| Phase    | State   |
| -------- | ------- |
| recording-contract | done |
| artifact-storage | done |
| audio-lab-poc | done |
| verification | done |

<!-- tri:review version="1" scope-hash="a1551f441d71c345d22d0795a07d42a2201b53b1ecbe9e2d096297322c663efb" reviewed="2026-10-31" reviewer="agent" -->
<!-- tri:item id="Q1" kind="assumption" applies-to="recording-contract,audio-lab-poc" blocks="recording-contract" state="resolved" -->

- [x] The POC records only the app's canvas and an explicitly supplied engine audio mix, with recording disabled by default.
  - Why it matters: source selection controls privacy, browser permissions, integration scope and whether ordinary performance measurements are affected.
  - Next action: implement a host-supplied `MediaStream` through the optional adapter hook and enable audio only after the page's AudioContext is running.
  - Resolution: use `HTMLCanvasElement.captureStream()` plus a page-provided audio track; do not request desktop, camera or microphone capture. Record only selected `measure` windows, and classify recorded runs as visual/functional diagnostics.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
