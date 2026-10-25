---
type: Plan
title: Engineering Records and Development Map
description: Preserve numbered engineering history, formalize plan readiness, and build a reusable view of progress and test evidence.
timestamp: 2026-10-25T00:00:00Z
tags: [documentation, planning, engineering-records, testing, visualization]
runbook: /docs/runbook/066_engineering_records_and_development_map.md
map_schema: 1
document_id: plan-066
initiative_id: engineering-records-development-map
performance: []
---

# Plan 066: Engineering Records and Development Map

Status: **M1, M2 and M3 complete; M4 planned**. Evidence and decisions:
[ER 066](/docs/runbook/066_engineering_records_and_development_map.md).

<!-- tri:scope -->

## Intended outcome

A developer can see what is being built, what can proceed, which decisions need attention,
how experiments relate, and how their observed behavior changes over time. The demo app and
consumer games can supply their own documents, pages and results to the same viewer.

An initiative is the subject; a plan describes intended work; an Engineering Record preserves
dated findings, decisions and evidence. Completed, abandoned and superseded plans and records
remain available under their original identity and links.

## Phases and acceptance

- **m1** — Formalize versioned metadata, phase identities, review items and two Markdown templates. Acceptance: ordinary Markdown stays readable; missing, stale, clear, open and blocking reviews have distinct behavior; questions can be resolved, deferred and reopened without losing their meaning.
- **m2** — Build the creation, validation and manifest helper; add agent authoring rules. Acceptance: exclusive creation preserves existing files; reciprocal links, stable identities, review freshness, phase readiness and relationships validate; legacy documents remain readable as unassessed.
- **m3** — Build a reusable viewer entry point and a demo-app adapter using real example pages, thumbnails and test summaries, plus an independent project fixture. Acceptance: cards show scoped readiness, accepted goals, relationships and evidence age; selecting a concern opens its source; both projects use the same viewer; scope history distinguishes a developer-confirmed baseline from later proposed, accepted, deferred or rejected changes, and shows baseline and current accepted-scope progress separately when the data supports it.
- **m4** — Adopt the format incrementally and migrate names or paths where useful. Acceptance: link and identity audit passes; no plans or history disappear; old references resolve; package and public API checks pass where applicable.

## Constraints and relationships

- Use **Engineering Record (ER)** as the document name while retaining `docs/runbook/`,
  `type: Runbook`, `runbook:` and `plans:` compatibility through the pilot.
- Number plans and records as reciprocal pairs. Do not delete finished, cancelled or superseded
  plans. Preserve their final outcomes, stable identities and links; never reuse a number.
- Keep current review items in the owning plan. Records preserve dated decisions and evidence.
  A card derives its review summary from the plan and does not duplicate editable questions.
- Separate readiness, delivery progress, functional checks, measured performance and human visual
  acceptance. Approval of the whole document does not close individual questions.
- Establish a scope baseline only after explicit developer confirmation of a specific scope snapshot;
  document review, checkbox completion and an agent's `reviewer` field do not count. Keep stable
  scope IDs and an append-only dated change history with origin (`requested`, `discovered` or
  `unplanned`), explicit disposition (`proposed`, `accepted`, `deferred` or `rejected`), reason,
  impact and affected IDs. Never infer whether a change was wanted from its origin. Show growth and
  progress against the confirmed baseline and current accepted scope separately; when there is no
  confirmed baseline, label growth unassessed.
- Keep the first viewer to area lanes, example cards, selected relationships, progress and evidence.
  Scheduling, effort prediction, results storage and inference of human agreement are outside scope.
- The viewer will consume a versioned manifest. Repository parsing and project-specific navigation
  belong in adapters. Expose the generic Angular viewer at `triangular-engine/development-map`.
- **builds-on**: [Test Results Page and Case Thumbnails](/docs/plans/058_test_results_page_and_thumbnails.md)
<!-- /tri:scope -->

## Current phase status

| Phase | State   |
| ----- | ------- |
| m1    | done    |
| m2    | done    |
| m3    | done    |
| m4    | planned |

## Questions, assumptions and investigations

<!-- tri:review version="1" scope-hash="c27b934e82beb5878219c93aad831b273b32fa2c26731332dfed74f657f5f1d5" reviewed="2026-10-25" reviewer="agent" -->
<!-- tri:item id="Q1" kind="investigation" applies-to="m2" blocks="m2" state="resolved" -->

- [x] How will a change to planned scope make the old readiness review visibly stale?
  - Why it matters: an old approval of scope must not silently apply to new commitments.
  - Next action: implement the fingerprint check and cover it with fixtures.
  - Resolution: the review records a SHA-256 fingerprint of the scoped outcome, acceptance and relationships plus the review item text and targets; the checker reports unassessed when that input changes.
  <!-- /tri:item -->

<!-- tri:item id="Q2" kind="investigation" applies-to="m2" blocks="m2" state="resolved" -->

- [x] How do checked boxes distinguish a real answer from a deferral or a reopened question?
  - Why it matters: a checkbox alone can make an unanswered decision appear closed.
  - Next action: use explicit item state and require evidence for resolved/deferred states.
  - Resolution: item metadata declares open, deferred or resolved; the checkbox must agree; resolved items require a Resolution line, deferred items require a reason, and reopened items preserve prior answers separately.
  <!-- /tri:item -->

<!-- tri:item id="Q3" kind="investigation" applies-to="m4" blocks="m4" state="open" -->

- [ ] Which document loaders, routes and tooling depend on the old names and paths?
  - Why it matters: renaming a folder could break existing references and document discovery.
  - Next action: inventory consumers before migration and prepare an old-to-new identity/link map.
    <!-- /tri:item -->
    <!-- /tri:review -->

The review applies to the scope block. Editing a question's meaning, affected phases or blocker
targets also makes it stale; changing only its open/deferred/resolved state does not. Readiness is
calculated per phase: an unresolved blocker affects its target phase, open nonblocking items show
as open items, and missing or stale reviews are unassessed. The reviewer field names the review
role; it is not a user approval or evidence that a developer understood every implication.

The checked-in format uses comment markers separate from token-map `doc-section` markers. User-visible
question text, consequences and next steps stay in Markdown. Item kinds are `intent`, `assumption`
and `investigation`; `applies-to` lists phases that should show the item; `blocks` is `none` or a
comma-separated list of blocked phases. Engineering Records retain dated decision history when
items resolve, defer or reopen.

## Validation strategy

1. **Format and creation:** fixtures cover missing metadata, malformed markers, duplicate IDs,
   unknown schema versions, broken reciprocal links, invalid phase targets, legacy files, empty
   reviews, concurrent creation, partial pairs and existing-file preservation. Check only mapped
   documents; do not force a historical rewrite.
2. **Readiness:** a blocker affects only its named phase; an open nonblocking item produces open
   items; an absent or stale review is unassessed; approval of a plan cannot resolve a question;
   resolution requires an answer; deferral requires a reason; reopening changes readiness while
   preserving prior evidence.
3. **Retention and relations:** completing or superseding a plan preserves its file, number, items
   and links. Detect dependency cycles; allow ordinary related-to links to be cyclic.
4. **Evidence:** use existing summary contracts and stable page/suite/scenario identities. Show
   missing, stale, failed and incomparable results. Compare only compatible suite versions, modes,
   scenario settings and hardware/backend contexts. Gallery thumbnails do not establish measured
   performance or human visual acceptance.
5. **Viewer:** test selection, filtering, source navigation, history, relation meaning and status
   changes. Headless behavior tests do not establish hardware performance.
6. **Human usefulness:** on a realistic example with a surprising assumption, a developer should
   be able to find the intended result, consequential caveat, next action and work that can proceed
   after a quick skim. Revise wording/layout based on confusion; automated checks cannot prove
   human understanding or visual acceptance.

Use accepted phases/goals for progress. The manifest reports completed planned scope, not time
remaining. Keep IDs stable when scope changes. Relation types `depends-on`, `builds-on`,
`alternative-to`, `supersedes` and `related-to` have distinct meanings; dependencies can target a
phase. Never infer that a later experiment supersedes every earlier alternative.

Read the [testing guide](/projects/triangular-engine/testing/README.md) and its repository-local
skill before integrating browser-test results. Keep `performance: []` until an actual scenario and
verified launch link exist.
