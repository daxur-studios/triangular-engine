---
name: triangular-engine-testing
description: Add or extend repeatable functional, visual-review and performance browser tests in this workspace with triangular-engine/testing, and read saved results cheaply (npm run test:summary) instead of opening full result JSON.
---

# triangular-engine testing (workspace pointer)

The skill's source ships with the package. Read it before writing a suite or reading results:

- Skill: `projects/triangular-engine/.agents/skills/triangular-engine-testing/SKILL.md` (and the adapter recipe beside it)
- Guide: `projects/triangular-engine/docs/testing.md`

In this repository:

- `npm run test:summary -- [--suite id] [--last N] [--metric text]` reads `artifacts/test-runs/index.jsonl` only. Run it
  first; open a full result JSON only for a failing case. `npx triangular-test-summary` does not resolve here.
- `npm run test:receiver` saves runs; `npm run test:triangular-engine:testing` and `npm run test:triangular-engine:sink`
  are the entry's own specs (headless).
