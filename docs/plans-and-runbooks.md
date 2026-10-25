---
type: Standard
title: Plans and Engineering Records
description: Link current implementation plans to dated decisions and verification evidence.
timestamp: 2026-10-13T00:00:00Z
tags: [documentation, plans, runbook]
performance: []
---

# Plans and Engineering Records

Each active initiative uses a plan in `docs/plans/` and an append-only Engineering Record in
`docs/runbook/`. The plan's `runbook:` and record's `plans:` references are reciprocal; the first
pair shares its numbered filename. Plans show current work/status; records preserve dated findings,
decisions, actions and checks; both indexes include new pairs. Preserve legacy runbooks as history.

The preferred name for a runbook is now **Engineering Record (ER)**. Existing `docs/runbook/`
paths and frontmatter keys/types remain supported; renaming the concept does not require moving
historical files. The format and visualization pilot is tracked in
[Plan 066](plans/066_engineering_records_and_development_map.md) and
[ER 066](runbook/066_engineering_records_and_development_map.md).

## Retention and references

- Do not delete plans or Engineering Records when work is completed, abandoned, or superseded.
  Keep their numbered identity, content, reciprocal links and final outcome. Record a replacement
  explicitly and link it in both directions. Filtering history out of an active view must not delete it.
- Preserve completed/replaced plans as history. Update current plans as work proceeds, but record
  material changes to scope and decisions in the Engineering Record rather than silently rewriting
  what was previously intended or accepted.
- Do not reuse numbers or renumber existing documents. Use the creation helper so exclusive file
  creation reserves the next shared number; a read-only preview does not reserve it.
- Any later path migration must preserve identities/history and repair or resolve existing links.
  Local handover cleanup follows its own convention and does not authorize removing plans or records.

The structured readiness syntax is versioned as `map_schema: 1`. It applies only to documents that
opt in; existing documents without that metadata remain unassessed, not implicitly ready.

## Engineering Record format and tooling

New mapped plans use `map_schema: 1` and a stable `initiative_id`. The versioned manifest is
generated from these Markdown sources; do not edit generated output. Start with
[`docs/templates/engineering-plan.md`](templates/engineering-plan.md) and
[`docs/templates/engineering-record.md`](templates/engineering-record.md). Create a pair with
`npm run docs:records:new -- --title "A short title" --slug lower-kebab-case`. The helper reserves
a shared number through exclusive file creation and updates both indexes under a short-lived lock.
`npm run docs:records:next` previews the next candidate; it does not reserve it. To create for a
consumer workspace, invoke `node scripts/engineering-records.mjs new --root <workspace> ...`.
The tool uses these checked-in templates and the consumer workspace's `docs/plans/`,
`docs/runbook/` and index files.

The paired Engineering Record has `scope_history_schema: 1` and one `tri:scope-history` block.
Its initial `tri:scope-baseline state="unconfirmed"` is not a baseline. Establish one only after
the developer explicitly confirms the exact current scope, with
`npm run docs:records:baseline -- docs/plans/<file>.md --developer-confirmed`. This writes a frozen
list of stable phase IDs and a scope hash; an existing confirmed baseline cannot be replaced.
Append changes as `tri:scope-change` entries with stable ID, date, kind, origin, disposition,
affected scope IDs, summary, reason and impact. Allowed origins are `requested`, `discovered` and
`unplanned`; dispositions are `proposed`, `accepted`, `deferred` and `rejected`. Origin does not
imply whether a change is wanted. Only accepted changes affect current-scope growth.

Wrap the outcome, phase acceptance criteria and relations in one `tri:scope` comment block. Give each
phase a stable lowercase ID, outcome and observable acceptance condition. Keep current phase state
in the separate status table (`planned`, `in_progress`, `blocked` or `done`); `done` means accepted
planned scope, not elapsed effort. Allowed relation labels are `depends-on`, `builds-on`,
`alternative-to`, `supersedes` and `related-to`. Only dependency links are checked for cycles.

The `tri:review` marker stores schema version, the SHA-256 fingerprint of scoped intent and review
item meaning, review date and reviewer role. It is current only when that fingerprint matches.
Refresh it after examining changed scope with
`npm run docs:records:review -- docs/plans/<file>.md agent` (or `developer`). This records
who refreshed the assessment; it does not record user approval. Item markers declare a stable ID,
kind (`intent`, `assumption` or `investigation`), applicable phases, blocking phases and state
(`open`, `deferred` or `resolved`). Keep the checkbox synchronized. A resolved item needs a
`Resolution`; a deferred item needs `Deferred because`; reopening keeps the earlier answer as
`Previous resolution`. Every item states why it matters and its next action. Remove the example item
when there are no open questions; the checked, empty review markers stay invisible in Markdown and
mean the scope was reviewed clear. Omitting or staling the markers means unassessed. Technical uncertainty
should lead to an investigation where feasible; ask the developer about intent only when the
consequence could materially change the desired result. Surface the few items most likely to cause
rework first, and keep all others accessible.

For a fresh plan, a phase with an unresolved blocker is `needs-resolution`; an unresolved item that
applies but does not block it is `open-items`; no applicable unresolved items is `ready`. Missing,
malformed or stale review is `unassessed`, never ready. These badges describe scoped readiness, not
completion, quality, test success or informed developer understanding. `npm run docs:records:check`
checks mapped docs and fails on invalid metadata. `npm run docs:records:manifest` prints the adapter
contract as JSON, including diagnostics; stale or malformed reviews remain unassessed in the output.
`npm run docs:records:export` updates the demo's generated manifest and current test fingerprint;
`npm run serve:demo-map` refreshes it before opening the demo app. Do not edit the generated JSON.
Legacy `type: Plan` documents without `map_schema: 1` remain in the manifest as unassessed cards,
with no inferred phases or progress. Their files remain unchanged; do not bulk-convert them.

## Runnable experiment history

Every new or substantively updated spike, plan and Engineering Record carries an append-only
`performance` array. Keep literal arrays in paired documents consistent for now. The
`triangular-engine/development-map` entry renders normalized project data; host adapters resolve
documents, example routes, thumbnails and saved result summaries. Historical pages are updated
when touched, without a repository-wide backfill.

Use `performance: []` until an actual scenario and verified launch link exist.
Runnable entries identify the experiment, suite/version, URL, availability and
evidence references. Preserve older versions and failed/inconclusive results;
the final entry is latest, not the fastest or most successful. A blocked latest
entry keeps its blocker rather than silently selecting an older test.

The host page uses `triangular-engine/testing` to expose **Run latest test** and
exact-version reruns; Markdown plans/Engineering Records expose corresponding launch links.
Follow the [testing guide](../projects/triangular-engine/testing/README.md) for
current contracts and profiles. Agents author and exercise these scenarios;
"visit the page and inspect it" is not a complete feature handoff. Builds/unit
tests, controlled performance evidence and explicit human visual acceptance
remain distinct. This standard page has no scenario of its own.
