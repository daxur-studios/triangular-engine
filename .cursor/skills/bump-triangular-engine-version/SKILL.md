---
name: bump-triangular-engine-version
description: Increments the triangular-engine package version, generates a changelog from commits since the last version, and updates CHANGELOG.md. Use when releasing a new version of triangular-engine, bumping the version, or when the user asks to increase the version number of the triangular-engine package.
---

# Bump Triangular Engine Version

Workflow for releasing a new version of the triangular-engine package: bump version, generate changelog from git commits on **master**, and update CHANGELOG.md. The agent edits files only—**no git commit**. The user commits the changes themselves.

## Key Paths

| File | Path |
|------|------|
| Package | `projects/triangular-engine/package.json` |
| Changelog | `projects/triangular-engine/CHANGELOG.md` |
| README | `projects/triangular-engine/README.md` |

## Workflow

**Important:** Edit files only. Do not run `git add`, `git commit`, or `git push`. The user commits the changes themselves.

### 1. Read current version

From `projects/triangular-engine/package.json`, read the `version` field (e.g. `0.0.11`).

### 2. Determine "since" reference for commits

Use one of these methods (in order). Run from workspace root (`D:\code\triangular-workspace`). On PowerShell, use `;` instead of `&&` to chain commands.

**A. Git tag** (if present):
```bash
git tag -l "v*"
```
If a tag exists for the current version (e.g. `v0.0.11`), use it as the "since" ref.

**B. Commit that introduced current version** (if no tag):
```bash
git log -S '"version": "' -1 --format=%H master -- projects/triangular-engine/package.json
```
This returns the commit that last changed the version string. Use that commit as the "since" ref (commits after it are new).

**C. Fallback**: If the above yields nothing useful, use:
```bash
git log --oneline -30 master -- projects/triangular-engine
```
Use the most recent commits (e.g. last 20–30) as the changelog source.

### 3. Get commits for changelog (from master)

From workspace root, use **master** as the tip (not HEAD):

```bash
git log <since-ref>..master --oneline -- projects/triangular-engine
```

Or if using fallback, the commits from step 2C.

Format each commit as a changelog bullet. Prefer the commit subject; drop merge commits and noise like "Merge branch...".

### 4. Bump version

Increment the patch segment by default: `0.0.11` → `0.0.12`. If the user specifies major/minor, follow that.

Update `projects/triangular-engine/package.json`:
```json
"version": "0.0.12"
```

### 5. Update CHANGELOG.md

Prepend a new section at the top of `projects/triangular-engine/CHANGELOG.md`:

```markdown
## [0.0.12] - YYYY-MM-DD

### Changed
- Commit message 1
- Commit message 2
- ...
```

Use today's date. Group commits by type (Added, Changed, Fixed, etc.) when it makes sense; otherwise use a single "Changed" or "Commits" section.

If `CHANGELOG.md` does not exist, create it with this structure and add a brief header:

```markdown
# Changelog

All notable changes to triangular-engine are documented here.

## [0.0.12] - YYYY-MM-DD
...
```

### 6. Reference changelog in README

Ensure `projects/triangular-engine/README.md` includes a link to the changelog. Add near the top (e.g. after the intro paragraph):

```markdown
See [CHANGELOG.md](CHANGELOG.md) for release history.
```

If that line already exists, leave it as is.

## Changelog format

- Use `## [x.y.z] - YYYY-MM-DD` for each version
- One bullet per notable change; use the commit subject as the basis
- Group by type when there are many entries: `### Added`, `### Changed`, `### Fixed`, `### Removed`

## Checklist

- [ ] Version bumped in `projects/triangular-engine/package.json`
- [ ] New section added to `projects/triangular-engine/CHANGELOG.md`
- [ ] README references CHANGELOG.md
- [ ] Commits since last version are included in the new changelog section
