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

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
