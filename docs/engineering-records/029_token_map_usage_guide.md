---
type: Usage Guide
title: Token Map — How To Use This In Triangular Engine
description: Standing instructions for running `daxur tokens map` to discover, track, and baseline documentation candidates across triangular-engine and triangular-workspace.
timestamp: 2026-09-07T00:00:00Z
status: active
tags: [tokens, documentation, runbook, tooling, usage-guide, triangular-engine]
---

# Token Map — How To Use This In Triangular Engine

This guide adapts Daxur-Daemon's token mapping workflow ([02_token-map-usage-guide.md](file:///D:/code/Daxur-Daemon/docs/runbook/02_token-map-usage-guide.md)) as a standing instruction for any AI agent or developer working in `triangular-workspace`. It assumes the `daxur` CLI is available on `PATH`. The design reasoning behind this system lives in [Daxur-Daemon's docs/runbook](file:///D:/code/Daxur-Daemon/docs/runbook/) if you want the underlying architecture — this file is the operational guide for this repository.

## What this is

`daxur tokens map` identifies folders in `triangular-workspace` large enough that an AI agent reading raw source code is significantly slower and more token-heavy than reading a concise architecture or "why" document first. It also tracks whether that documentation exists and re-surfaces directories that drift or grow substantially after being documented.

It is designed to be **operated autonomously by an agent**: every step is a non-interactive CLI command.

## Where documentation belongs in this workspace

Before registering documentation sections, follow these repository conventions:

1. **Engine consumer & architecture docs** (`projects/triangular-engine/docs/`):
   - Scope docs for public features, core concepts, or secondary entry points (e.g. `docs/procedural.md`, `docs/physics.md`, `docs/core-concepts.md`).
2. **Runbooks & deep design notes** (`docs/runbook/`):
   - Zero-padded sequentially numbered design specs and attempt histories (e.g. `docs/runbook/029_token_map_usage_guide.md`).
3. **Application & page documentation** (`projects/demo-app/`):
   - Colocated `README.md` files within the respective application directory (e.g. `projects/demo-app/src/app/pages/README.md`).

---

## The workflow

### 1. See what's undocumented

Run from the repository root with the calibrated `--floor 50000` (recommended for `triangular-workspace`):

```bash
daxur tokens map --floor 50000
```

> [!TIP]
> The CLI's default floor is 150K tokens, which was tuned for 6M+ token codebases and only surfaces 5 top-level folders here. Passing `--floor 50000` (50K) calibrates the scan to triangular-engine's modular sublibrary structure.

At `--floor 50000`, the scan surfaces the primary engine sublibraries and subsystems:
- `projects/triangular-engine` (core library, owned 402.6K / recursive 1.1M)
- `projects/demo-app/src/app/pages` (demo showcase pages, owned 403.5K)
- `projects/triangular-engine/procedural` (procedural generation sublibrary, owned 171.8K)
- `projects/triangular-engine/animals/core` (animals sublibrary, owned 84.4K)
- `projects/triangular-engine/worldgen/core` (world generation core, owned 82.5K)
- `projects/triangular-engine/celestial` & `celestial/surfaces` (celestial and surfaces, owned 79.3K / 68.0K)
- `projects/triangular-engine/water` (water sublibrary, owned 57.0K)
- `projects/triangular-engine/src/lib/engine/components` (declarative scene components, owned 56.5K)
- `projects/triangular-engine/terrain/cdlod` (CDLOD planetary terrain, owned 56.3K)
- `projects/triangular-engine/jolt` (Jolt physics integration, owned 50.8K)
- `docs/runbook` (runbooks collection, owned 195.3K)
- `.` (workspace root, owned 196.2K)

### 2. Track a candidate

```bash
daxur tokens map register <scopePath> <docPath>
```

#### Examples in `triangular-workspace`:

For a sublibrary:
```bash
daxur tokens map register projects/triangular-engine/procedural projects/triangular-engine/docs/procedural.md
```

For demo app pages:
```bash
daxur tokens map register projects/demo-app/src/app/pages projects/demo-app/src/app/pages/README.md
```

This creates `docPath` (or appends to it if it already exists) with a stub `doc-section` block, and adds an entry to `.daxur/token-map.json`. The stub looks like this — **only edit the text between the markers, never the markers themselves**:

```markdown
<!-- doc-section section-id="sec_xxxxxxxxxxxx" path="projects/triangular-engine/procedural" baseline-tokens="0" -->
TODO: describe purpose + why, not what
<!-- /doc-section -->
```

If the folder you're registering sits **inside** an already-registered parent scope (e.g. `projects/triangular-engine/procedural` inside `projects/triangular-engine`), see [When a subfolder of an already-documented parent grows](#when-a-subfolder-of-an-already-documented-parent-grows) to carve it out properly.

### 3. Write the actual content

Open the doc file and replace the `TODO: describe purpose + why, not what` placeholder with real prose.

Focus on:
- **Why**, not **what**: The code already shows the classes and functions. Explain *why* the architecture is structured this way.
- **Constraints & Gotchas**: WebGL/Three.js caveats, coordinate space assumptions, disposal lifecycle, change detection interactions, or performance budgets.
- **Public API boundaries**: Which symbols are exported via `public-api.ts` versus internal helper utilities.

### 4. Lock it in

```bash
daxur tokens map acknowledge <scopePath>
```

Example:
```bash
daxur tokens map acknowledge projects/triangular-engine/procedural
```

This command validates that the stub placeholder has been replaced with real documentation. On success, it records the current token count as the new drift baseline.

#### If it's not worth documenting right now:

```bash
daxur tokens map dismiss <scopePath> --reason "<why not>"
```

Example:
```bash
daxur tokens map dismiss docs/runbook --reason "Runbooks are self-contained design logs and implementation traces"
```

`--reason` is required. A dismissal counts toward review coverage but never documentation coverage — it is a legitimate, tracked outcome.

### 5. Check overall state

```bash
daxur tokens map status
```

Shows every tracked section, review state, current token count, and flags:

- `[GROWTH FLAG +N%]` — This section grew by more than 40% past its last acknowledged or dismissed baseline. Review the changes, then update the doc and re-acknowledge, or dismiss with an updated reason.
- `[NOT COMPARABLE — run migrate-baselines]` — The section baseline was measured under different tokenizer/exclusion rules. Run `daxur tokens map migrate-baselines` to re-baseline.
- `[ORPHANED — scope missing on disk]` — The folder was renamed or deleted. Requires adjusting `.daxur/token-map.json`.
- **Ownership overlap warnings** — Two registered sections claim the same files without an exclusion. Fix by adding the child scope to the ancestor's `excludedScopes`.

It reports two key metrics:
- **Review coverage**: percentage of candidate scopes reviewed (documented or dismissed).
- **Documentation coverage**: percentage of candidate scopes with an actual doc.

### 6. Check prior reasoning before re-deciding

```bash
daxur tokens map decisions [scopePath]
```

Every acknowledge, dismiss, or carve-out decision is logged permanently. Consult this before re-documenting or dismissing an area to understand past architectural rationale.

---

### When a subfolder of an already-documented parent grows

If `daxur tokens map` surfaces a child directory of an already-registered parent (e.g. `projects/triangular-engine` is registered, and `projects/triangular-engine/procedural` grows above the floor), use `carve-out`:

```bash
daxur tokens map carve-out <childScopePath> [--doc <docPath>]
```

Example:
```bash
daxur tokens map carve-out projects/triangular-engine/procedural --doc projects/triangular-engine/docs/procedural.md
```

If the parent doc already had a `doc-section` for that path, its prose is moved automatically. If not, a fresh stub is created. In both cases, the parent's `excludedScopes` in `.daxur/token-map.json` is updated so tokens are not double-counted.

### If the tokenizer or exclusion rules change

```bash
daxur tokens map migrate-baselines
```

Re-measures baselines under the current rules without altering review status or requiring documentation edits.

---

## Floor calibration & sensitivity

The global CLI default floor is 150k tokens (`--floor 150000`). For `triangular-workspace` (total: 1.9M tokens), the following floor levels are recommended:

- **Calibrated Standard (`--floor 50000`)**: Recommended baseline for general candidate mapping. Identifies 13 major scopes corresponding to primary sublibraries (`animals`, `worldgen`, `celestial`, `water`, `terrain/cdlod`, `jolt`, `procedural`).
- **Fine-Grained Audit (`--floor 25000`)**: Surfacing ~30 modular packages and subcomponents (e.g. `scatter`, `clouds/three`, `navigation/core`, `procedural/flora`, `procedural/structures`, and individual demo lab pages).
- **Macro Monorepo View (`--floor 150000`)**: Surfaces only high-level containers (`projects/triangular-engine`, `projects/demo-app/src/app/pages`, and workspace root).

---

## Managing exclusions

Gitignored files (and standard build folders like `dist/` and `out-tsc/`) are excluded automatically. For global directory exclusions across all repos scanned by `daxur`:

```bash
daxur tokens exclusions list
daxur tokens exclusions add <dirName>
daxur tokens exclusions remove <dirName>
```

---

## Suggested agent cadence

1. **Before starting substantial work in an unfamiliar area**: Run `daxur tokens map --floor 50000` to check if documentation exists or should be consulted.
2. **When creating or significantly expanding a sublibrary**: Check `daxur tokens map status` to verify if growth flags were triggered. If so, update the relevant `docs/*.md` file and run `daxur tokens map acknowledge <scopePath>`.
3. **During documentation reviews**: Run `daxur tokens map status` to verify review and documentation coverage across the workspace.
