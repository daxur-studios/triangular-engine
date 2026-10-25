---
type: Runbook
title: Engine Docs Ship With Entry Points
description: Dated decisions and checks for moving triangular-engine guides into entry-point READMEs and shipping docs/.
timestamp: 2026-10-25T00:00:00Z
tags: [documentation, packaging, entry-points, agents]
plans:
  - /docs/plans/064_engine_docs_ship_with_entry_points.md
performance: []
---

# Runbook 064: Engine Docs Ship With Entry Points

Plan: [064](/docs/plans/064_engine_docs_ship_with_entry_points.md).

## 2026-10-25 — Starting

**Finding.** `projects/triangular-engine/ng-package.json` ships only the root `README.md`,
`THIRD_PARTY_NOTICES.md`, `schematics`, `bin`, `assets`, and `.agents/skills` (as `skills/`). The 23 files in
`projects/triangular-engine/docs/` never reach `node_modules/triangular-engine/`. Secondary entry-point
READMEs (for example `impostor/README.md`) do reach `dist/triangular-engine/<entry>/`.

**Decision: where each guide lives.**

- Entry-owned, moved into `<entry>/README.md`: atmosphere, planet-material, cell planets (`worldgen/render`),
  testing, physics (Rapier → `rapier/`), jolt physics (→ `jolt/`), pmndrs, procedural, gpu-data-flow, facial
  animation (→ `characters/`). Existing entry READMEs are merged, not duplicated.
- Cross-cutting, kept in `docs/` and shipped: getting-started, core-concepts, components, services,
  assets-and-loading, particles, audio, shadows, entry-points, `api/selectors.md`, `examples/`, and the
  `docs/README.md` index.
- Folded into the shipped skill and removed: `docs/ai-agents.md`, and the skill's `atmosphere.md` fragment
  (its content moves into `atmosphere/README.md`).

**Decision: root README.** The root README becomes an index. Its consumer guide (install, quick start, assets,
services, troubleshooting) moves to `docs/`, so no consumer content is lost.

**Decision: skill paths.** The package maps `.agents/skills/` to `skills/`, one folder shallower than the source.
A relative link that works from the repo does not work in `dist/`. Skills therefore name entry READMEs by
package-root path, not by markdown link.

**Decision: historical runbooks.** Runbooks are append-only. Where an old runbook or plan links to a moved
file, only the link target changes; dated text stays as written.

## Checks (planned)

- `npm run build:triangular-engine`
- Link check across `dist/triangular-engine/**/*.md`
- `daxur tokens map status`

## 2026-10-25 — Built and checked

**Done.**

- Moved entry-owned guides into their entry READMEs: `atmosphere`, `planet-material`, `testing`, `gpu-data-flow`, `procedural`, `worldgen/render` (cell planets). Merged into existing READMEs: `rapier` (physics), `jolt`, `pmndrs`, `characters` (facial animation), `takram`.
- Removed `docs/ai-agents.md` and the skill's `atmosphere.md` fragment. Their content is folded into `.agents/skills/triangular-engine/SKILL.md` (entry guide table and §11 agent conventions) and into `atmosphere/README.md`.
- Shipped `docs/` via `ng-package.json` assets. Also shipped `CHANGELOG.md`, because the root README links it.
- Split the root README: install and quick start went to `docs/getting-started.md`, troubleshooting to `docs/troubleshooting.md`, the Scene Tree section to a new `scene-tree/README.md`. The root README is now an index with an entry table linking each entry's guide.
- Added the entry-point rule to `docs/README.md` and the root `AGENTS.md`. Added a CHANGELOG entry.
- Repaired links in the package, the token map, the testing skills, `AGENTS.md`, `docs/plans-and-runbooks.md`, and `instructions/`. Historical plans and runbooks had only their markdown link targets changed. Dated prose that names old paths is left as written.

**Checks.**

- `npm run build:triangular-engine`: exit 0.
- Link check over `dist/triangular-engine` (46 markdown files): 0 broken. Over the source tree (55 files): 0 broken.
- `daxur tokens map status`: the `docPath` entries for jolt, procedural, atmosphere and planet-material now resolve. `atmosphere` shows a growth flag of +109%, which is expected because its README now holds the full guide. Not acknowledged, since acknowledging records a permanent decision for the owner. The `docs/runbook` and `demo-app` growth flags predate this change.

**Decisions.**

- Skill and root-README references to package files use plain text paths, such as `skills/triangular-engine/SKILL.md`. Those paths differ between the repo and the package, so a markdown link cannot resolve in both.
- Repo-only runbook links in shipped entry READMEs (worldgen, scatter, terrain, water, takram, and others) are now plain text. They would break inside the package.

**Open.**

- `trail`, `clouds` and `cloud-volumes` have no guide. Sub-entries such as `terrain/core` are covered by their parent README.
- Public symbols were not audited for TSDoc. The rule is written; the audit is not done.
- The `atmosphere` growth flag needs owner acknowledgement via `daxur tokens map acknowledge projects/triangular-engine/atmosphere`.
