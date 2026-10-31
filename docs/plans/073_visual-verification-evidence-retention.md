---
type: Plan
title: "Visual verification evidence and retention"
description: "Reproducible visual verification evidence, review-friendly derivatives, reviewer provenance, and bounded media retention for engine demos and consumer games."
timestamp: 2026-10-31T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/073_visual-verification-evidence-retention.md
map_schema: 1
document_id: plan-073
initiative_id: "visual-verification-evidence-retention"
performance: []
---

# Plan 073: Visual verification evidence and retention

Status: **in progress**. Evidence and decisions: [ER 073](/docs/engineering-records/073_visual-verification-evidence-retention.md).

<!-- tri:scope -->

## Intended outcome

`triangular-engine/testing` lets the demo and consumer games define repeatable visual-verification scenarios and save useful evidence for later human or agent review. App adapters own the scene-specific camera paths, animation phases, labels and scene data; the shared entry point owns recording lifecycle, artifact references and review provenance.

The test definition, app/engine fingerprint, browser/renderer environment, scenario settings and seed are the durable recipe for reproducing a clip. Video, GIFs, contact sheets and sprite sheets are media artifacts that can expire and be regenerated when the matching build and inputs remain available. Derived media links back to its source and never replaces or alters it. Compact test results and review records remain available after media cleanup; regenerated captures are identified as new files rather than assumed byte-identical across rendering environments.

The triangular CLI operates on each app's configured artifact directory, so the demo and external games use the same workflow while keeping ownership local to their repositories. Agent-facing commands report metadata and artifact paths without automatically loading media into model context. External publishing and a hosted cross-repository curator are outside this plan.

## Phases and acceptance

- **reproducible-evidence** — Extend the optional testing contract so a host can define deterministic visual paths and capture points, including camera viewpoints and animation phases. Acceptance: a demo scenario records a horizontal and vertical character orbit plus representative motion frames; saved metadata identifies the suite/version, app fingerprint, browser/renderer profile, seed/settings, viewport, path and capture profile needed to rerun it; a consumer adapter can supply its own equivalent scene actions without engine-specific character assumptions.
- **review-derivatives** — Add on-demand generation of GIF previews and labeled contact/sprite sheets from a saved run, keeping each derivative linked to its source and reporting its size. Acceptance: GIFs are optional, silent derivatives; contact sheets label view and animation phase; the source video remains intact; agent summaries expose paths and metadata without reading image/video content automatically.
- **visual-review** — Retain human and agent visual assessments separately from automated test verdicts, and support optional vector overlays associated with a claim, object or frame. Acceptance: review records identify the reviewer, artifact and verdict; source media stays pristine; overlays can be toggled and distinguish a target to inspect from a reviewed pass.
- **artifact-retention** — Inventory media sizes per configured app artifact directory and enforce a configurable storage budget and TTL. Proposed initial policy: 1 GiB per app, seven days for unpinned media, and oldest generated GIF/contact-sheet derivatives pruned before oldest unpinned videos; bookmarks protect selected media. Acceptance: listing and dry-run pruning report exact files, sizes and reasons; applied pruning stays inside the configured root; compact test/review metadata records that an artifact expired and retains the inputs needed to regenerate it.

## Relationships

- **builds-on**: [Optional test video recordings](/docs/plans/072_testing-video-recordings.md)
<!-- /tri:scope -->

## Current phase status

| Phase               | State   |
| ------------------- | ------- |
| reproducible-evidence | in_progress |
| review-derivatives  | in_progress |
| visual-review       | in_progress |
| artifact-retention  | planned |

<!-- tri:review version="1" scope-hash="e43cba33d9f508b56927436b2657d1e7dd87ee8cd30defcb9366cb9c00d5cf33" reviewed="2026-10-31" reviewer="agent" -->
<!-- tri:item id="Q1" kind="assumption" applies-to="artifact-retention" blocks="artifact-retention" state="open" -->

- [ ] Is seven days a suitable default TTL for unpinned, reproducible media, with a 1 GiB quota per app artifact directory?
  - Why it matters: the answer controls how long session clips remain available for review/sharing and when the receiver may delete local media.
  - Next action: use the demo and a consumer-style fixture to confirm regeneration inputs are retained, then have the developer set the default TTL and quota before enabling automatic deletion.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

The first demo proof of concept is on the capsule character lab. See the dated run and evidence in [ER 073](../engineering-records/073_visual-verification-evidence-retention.md). On-demand GIF previews, labeled video/still contact sheets, attributed review records and toggleable vector overlays are implemented. The lab has motion and close-up expression suites; full-cycle sprite sheets and retention tooling remain later work. The owner confirmed the original sheets render in chat; facial-expression quality still needs review against a claim.

Future exploration, not yet committed scope: link concept-reference sets, named parts/views and test cases in an app-owned manifest; generate aligned concept/render comparisons; and investigate human-approved SVG outlines or landmarks as view-specific guides for silhouette/feature review. See the dated discussion in ER 073. First wait for feedback from the current consumer-app experiment before choosing a shared CLI/API shape.

The `triangular-engine-testing` skill and testing guide now explain how to select and present GIFs, sampled contact sheets and detail stills, including multiple sheets for separate review goals and the current lack of full-cycle sprite-atlas generation.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
