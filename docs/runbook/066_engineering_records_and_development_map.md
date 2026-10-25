---
type: Runbook
title: Engineering Records and Development Map
description: Dated decisions and validation evidence for numbered Engineering Records, preserved plans and reusable progress visualization.
timestamp: 2026-10-25T00:00:00Z
tags: [documentation, planning, engineering-records, testing, visualization]
record_id: er-066
scope_history_schema: 1
plans:
  - /docs/plans/066_engineering_records_and_development_map.md
performance: []
---

# Engineering Record 066: Engineering Records and Development Map

Plan: [PLAN-066](/docs/plans/066_engineering_records_and_development_map.md).
The legacy path and frontmatter type are retained during the format pilot.

## 2026-10-25 — Direction and staged rollout

**Problem.** Numbered history, plans, example pages and accumulated test results are useful individually,
but do not provide a shared view of progress, parallel approaches, dependencies and supersession.
Planning also needs to expose consequential interpretation gaps before they become unwanted results.
Skim-reading or approving a plan does not establish understanding of every implication.

**User-confirmed direction.**

- Call the historical document an **Engineering Record**.
- Preserve plans instead of deleting them on completion or replacement.
- Keep documents numbered for easy reference.
- Explore a compact, visible Markdown readiness review with parseable comment boundaries and checkboxes.
- Support a reusable visualizer for the demo app and consumer games, with example thumbnails,
  relationships, progress and longitudinal evidence.

**Findings.** The existing convention already pairs numbered plans and runbooks, keeps dated record
history append-only, and requires reciprocal links. It explicitly preserves legacy runbooks but
did not explicitly prohibit deleting completed/superseded plans. The handover convention separately
allows deleting a finished local handover; that is not permission to delete the plan or record.
Existing `doc-section` HTML comments belong to token-map tracking and must retain their own meaning.
No plan/record creation helper or Markdown templates were found in the inspected conventions,
scripts or package commands. This session did not audit other repositories or historical deletions.

**Implementation proposal.** Use a numbered pair now under existing paths. Validate the format and
templates first, then a small creation/validation helper, then a viewer pilot with real evidence
and an independent project fixture, followed by incremental adoption and optional path migration.
The current plan records detailed acceptance tests and unresolved technical questions. Its marker
syntax, phase model, CLI and packaging remain proposals, not implemented contracts.

**Numbering.** A next-number lookup alone does not reserve an identity. A helper should combine
allocation and exclusive creation, generate reciprocal links from templates, and detect collisions.
It can coordinate one checkout; separately edited checkouts still require conflict detection.
For this pair, the inspected directories ended at 065 and contained no 066 document before creation.

**Readiness.** Scope readiness to a phase, keep its review items in one owning plan, and derive
record/card summaries. Missing review means unassessed. An experiment may proceed to answer a
question while the subsequent implementation remains blocked by that question. Do not silently
convert assumptions to decisions because a developer approved a document. Prefer investigations
for technical unknowns and concrete consequences when user intent is actually needed.

**Changes in this session.** Created PLAN-066/ER-066 and index entries, introduced the agreed name
without moving historical files, and added an explicit plan/record retention rule to the convention
and repository agent instructions. Runtime code, templates, CLI and viewer implementation remain future work.

**Verification.** Documentation checks are recorded below after execution. No browser scenario or
performance result is claimed by this planning work.

## 2026-10-25 — M1 format pilot and M2 authoring tools

**Decision: stable document identity.** Mapped plans carry `document_id: plan-NNN` and
`initiative_id`; Engineering Records carry `record_id: er-NNN`. IDs stay fixed if a Markdown file
moves or is renamed. A new pair shares an allocated number by default. Future plans may point to a
prior record through the reciprocal `plans:` list.

**Decision: scope freshness.** A `tri:scope` block contains the intended outcome, phase acceptance
criteria, constraints and relations. The reviewed SHA-256 fingerprint also includes review-item
wording and its affected/blocking phase IDs. Editing scope or item meaning makes readiness unassessed;
changing only checkbox/state and resolution evidence leaves the assessment current. The explicit
review command refreshes the scope fingerprint and records the reviewer role; it does not represent
developer approval.

**Decision: per-phase readiness.** For a current review, unresolved blocking items make the affected
phase `needs-resolution`; other applicable unresolved items produce `open-items`; phases with no
applicable open items are `ready`. Missing, malformed or stale reviews are `unassessed`. A deferred
item needs a reason and stays unresolved. Resolution requires a visible checked box and answer.
Reopening requires moving the earlier answer to `Previous resolution`.

**Implementation.** Added Markdown templates, `scripts/engineering-records.mjs`, the versioned JSON
manifest adapter, npm commands and root agent-writing instructions. Pair creation allocates a shared
number while holding an exclusive lock, creates both files without overwriting, and updates both
indexes. Stable ID metadata supplements the legacy `type: Runbook`, `runbook:` and `plans:` fields.
Mapped metadata is opt-in, so historical files remain unconverted; legacy Plan frontmatter is shown
in the manifest as unassessed, without inferred phases or progress.

**Verification.** `npm run test:docs:records` passed 12 Node tests covering allocation, concurrent
creation, index preservation, readiness states, review invalidation, legacy files, stable IDs after
path changes, relations/cycles, reciprocal links, the consumer-root CLI and rollback after index
failure. `npm run docs:records:check` passed for one mapped and 23 legacy plans. Manifest inspection
reported 50% completed planned scope, phases m1/m2 ready, m3 ready, and m4 needs resolution from its
explicit open migration question. Legacy plans appeared as unassessed with no inferred progress.

## 2026-10-25 — Documentation validation

A one-off Node check passed for 103 local Markdown link targets across the new pair, convention,
both indexes and AGENTS.md. It also checked reciprocal pair references, matching empty performance
arrays, one 066 document per directory, balanced pilot review/question markers, unique question IDs,
valid referenced phase IDs, contiguous index table rows and trailing whitespace.

`git diff --check` passed for the four edited tracked documents. These checks establish document
consistency only; they are not the proposed reusable parser tests or evidence of viewer behavior.
No runtime tests or library build were run for this documentation-only change. Existing unrelated
work was preserved; this session did not stage files or create commits.

## 2026-10-25 — Later viewer considerations

The developer wants to refine these ideas before they become planned scope:

- Show how an initiative and its evidence change over time, including decisions, progress and
  performance history.
- Make scope growth visible: compare the agreed baseline with later additions, distinguish
  requested changes from incidental or unwanted expansion, and explore a timeline or other clear
  treatment.

These are captured as questions for a future design discussion. They are not commitments or
acceptance criteria yet; do not update the plan's accepted scope until refined together.

**Tooling portability.** The helper accepts `--root` and tests creation/review/validation against a
separate consumer workspace. However, the CLI and templates currently live in this repository and
are not published with the triangular-engine package. A consumer must invoke the checked-out helper
with its workspace root, or copy/adapt it. Decide packaging after the viewer/manifest adapter
contract is clearer.

## 2026-10-25 — Scope history model accepted for M3

The developer approved adding this scope-history behavior to the viewer work:

- A baseline is a specific scope snapshot explicitly confirmed by the developer. Review markers,
  checked boxes and agent-authored reviewer labels are not confirmation.
- Later changes are append-only events with stable scope IDs, a date, origin (`requested`,
  `discovered` or `unplanned`), explicit disposition (`proposed`, `accepted`, `deferred` or
  `rejected`), reason, impact and affected IDs. Origin does not imply whether the change is wanted.
- The view reports growth and progress against the confirmed baseline and current accepted scope
  separately. Without confirmation, it labels baseline growth unassessed.

This makes accepted scope additions visible without treating plan review as proof that the
developer understood or wanted every implication.

**M3 packaging decision.** Put the normalized, data-in/data-out Angular viewer in a dedicated
`triangular-engine/development-map` entry. Keep Markdown parsing, route links, thumbnails and
result-receiver access in each application's adapter. A consumer can then reuse the viewer without
depending on this repository's demo catalog or document layout.

## 2026-10-25 — M3 implementation complete

Added the reusable `triangular-engine/development-map` viewer with a normalized input model and
no dependency on this repository's Markdown layout, routes, thumbnail cache or result receiver.
The demo adapter exports the document manifest, joins four example branches and 15 pages, reads
saved thumbnails and test-run summaries, and supplies links and evidence to the viewer. The page
shows document readiness and progress, unresolved questions, document relationships, saved test
metrics and a timeline of scope changes and test evidence. A separate Coastal Garden fixture
exercises the adapter with its own document IDs, paths, routes and test results.

Plan 066 remains on an **unconfirmed** scope baseline: the view shows current phase progress but
does not infer scope growth. A developer can confirm a specific snapshot later, after reviewing
that exact scope:

```sh
npm run docs:records:baseline -- docs/plans/066_engineering_records_and_development_map.md --developer-confirmed
```

The map also flags example cards without a linked document. The three Scatter cards currently show
this state: their existing history is in legacy runbook files that have not yet been imported into
the paired-plan manifest. M4 must connect or migrate those references without removing the old
records.

**Portability:** the viewer is a published Angular entry point. The record helper and templates
remain repository tools; the CLI accepts `--root` and its consumer-root test passes, so they can be
run against another workspace from a checkout or copied/adapted. They are not currently shipped
inside the npm package. Each consumer still owns the adapter that reads its records, pages,
thumbnails and test results.

**Verification:** `npm run build:triangular-engine`, `npx ng build demo-app`, the focused headless
library and demo-adapter specs, `node --test scripts/engineering-records.spec.mjs` (13 passing),
`npm run docs:records:check` and `npm run docs:records:export` passed. The live development page
loaded with four branches, 15 examples and one open concern. Existing run evidence is displayed as
stale when its fingerprint differs from the current source, and performance remains unassessed
when the saved run does not have an assessed performance verdict.

## Structured scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- tri:scope-change id="SC-066-M3" date="2026-10-25" kind="addition" origin="requested" disposition="accepted" scope-ids="m3" -->
- Summary: Add explicit scope history, baseline and current-scope progress to the development map.
- Reason: Make scope growth visible without treating skimmed plan reviews as developer agreement.
- Impact: Extend M3 with a normalized scope-history contract, viewer support and an independent fixture.
<!-- /tri:scope-change -->
<!-- /tri:scope-history -->
