---
type: Runbook
title: "Remove Takram integration from the engine"
description: "Dated decisions, findings and evidence for removing the Takram integration from triangular-engine."
timestamp: 2026-10-28T00:00:00Z
tags: [engineering-records]
record_id: er-069
scope_history_schema: 1
plans:
  - /docs/plans/069_remove-takram.md
performance: []
---

# Engineering Record 069: Remove Takram integration from the engine

Plan: [PLAN-069](/docs/plans/069_remove-takram.md).

## 2026-10-28 — Starting

**Goal.** The engine must contain no Takram code or `@takram/*` dependency. Demo pages that used it are kept as deprecated, out of compilation.

**Finding.** `@takram/three-geospatial` (a plain dependency of the root and engine manifests) requires
`@react-three/fiber`, which requires React 19. That chain is why `react`, `react-use-measure`,
`zustand` and `@react-three/fiber` kept appearing and disappearing from `package-lock.json`. The
`@pmndrs/vanilla` package does not depend on React.

**Decisions.**

- Engine code moved, not deleted: `projects/triangular-engine/takram/` and
  `src/takram-adapter.spec.ts` go to `projects/demo-app/deprecated/takram-engine/`. It is outside
  `src/` and the demo's `tsconfig` includes, so it is not compiled.
- Demo pages moved to `projects/demo-app/deprecated/demo/`. Their five routes now load
  `DeprecatedTakramPageComponent`, so existing links do not 404. Their index cards carry
  `deprecated: true` and a Deprecated pill.
- The engine's `THIRD_PARTY_NOTICES.md` covered only Takram and is removed with its `ng-package`
  asset entry. The Takram cloud-texture asset copy in `angular.json` is removed.
- A breaking changelog entry is recorded in `projects/triangular-engine/CHANGELOG.md`.
- Historical plans and records that mention Takram are left as they are.

**Checks.** To run: `npm install` (regenerates the lock), `git grep -i takram` outside `docs/`,
`npm run build:triangular-engine`, the demo build, and `npm test`. Results are added below.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->

## 2026-10-28 — Verification

- `npm install`: `package-lock.json` has no `takram` entry and no `react`, `@react-three/fiber`, `zustand` or `react-use-measure` package.
- `git grep -i takram` outside `docs/`, `package-lock.json` and `projects/demo-app/deprecated/` finds only the deprecated placeholder, the deprecated index entries, the route names and the CHANGELOG entry.
- `npm run build:triangular-engine`: built.
- `npx ng build demo-app`: built (existing Mermaid CommonJS warnings only).
- `npm test`: 455 to 472 of 475 passing across two runs. The failing specs are the test-link tests for planet-material-extensions and cell-planet-morph-streaming (`testMode` in the expected URL) and a timing-dependent atmosphere-lab quick-mode test, which failed with `capped` in one run and not in the other. None touch Takram code. I did not confirm these fail on the base commit; that is the next check.
- `npm run docs:records:check`: OK.

Not done: no browser check of the deprecated routes; the owner's demo server was not restarted.
