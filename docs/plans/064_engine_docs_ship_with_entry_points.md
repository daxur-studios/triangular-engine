---
type: Plan
title: Engine Docs Ship With Entry Points
description: Move entry-specific triangular-engine guides into each secondary entry point's README, ship docs/ in the npm package, and make the root README an index.
timestamp: 2026-10-25T00:00:00Z
tags: [documentation, packaging, entry-points, agents]
runbook: /docs/runbook/064_engine_docs_ship_with_entry_points.md
performance: []
---

# Plan 064: Engine Docs Ship With Entry Points

Status: **built; growth-flag acknowledgement and three missing guides open**. Evidence and decisions: [Runbook 064](/docs/runbook/064_engine_docs_ship_with_entry_points.md).

**Goal:** a game that installs `triangular-engine` receives every guide it needs. Today
`projects/triangular-engine/docs/*.md` is not in `dist/`, so consumers never see it, while secondary
entry-point `README.md` files already ship. Each entry point owns one guide in `<entry>/README.md`; the
cross-cutting guides stay in `docs/` and ship with it.

## Scope

| #   | Item                                                                                                                                  | Status      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Move entry-owned guides (atmosphere, planet-material, cell planets, testing, physics, jolt, pmndrs, procedural, gpu-data-flow, facial animation) into their entry READMEs, merging with existing ones | planned |
| 2   | Keep cross-cutting guides in `docs/` and add `docs` to `ng-package.json` assets                                                        | done        |
| 3   | Turn root `README.md` into a short index of every entry point's README; move its consumer guide content into `docs/`                  | done        |
| 4   | Fold `docs/ai-agents.md` and the skill atmosphere fragment into the shipped `triangular-engine` skill, which points at entry READMEs  | done        |
| 5   | Repair every link that pointed at a moved file (AGENTS.md, skills, active plans and runbooks, `.daxur/token-map.json`, CHANGELOG, code comments) | planned |
| 6   | Add the entry-point documentation rule to `docs/README.md` and `AGENTS.md`, including TSDoc on public symbols                          | done        |
| 7   | Note the move in `CHANGELOG.md`; run the library build, a dist link check and `daxur tokens map status`                                | done        |

## Constraints

- Do not touch `projects/demo-app/src/app/planet-surface-detail-spike/` or Plan/Runbook 063; another session owns them.
- Links inside a skill must not assume the repo's `.agents/skills/` depth, because the package maps that folder to `skills/`. Skills name entry READMEs by package-root path.
- Historical runbooks are append-only. Update only link targets in them, never their dated content.

## Acceptance

- `npm run build:triangular-engine` passes.
- `dist/triangular-engine/` contains `docs/` and each moved entry README.
- A script finds no broken relative links in the shipped markdown.
- No repo file outside historical content links to a removed `docs/*.md` path.
