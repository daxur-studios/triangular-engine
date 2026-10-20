# Repository guide for AI agents and developers

## Repository map

- `projects/triangular-engine/` — the published Angular library.
- `projects/demo-app/` — the local demo application.
- `projects/triangular-engine/docs/` — user-facing library documentation.
- `docs/runbook/` — design notes and implementation history for larger features.
- `docs/plans/` — current work plans linked to their runbooks; [convention](docs/plans-and-runbooks.md).
- `docs/handover/` — notes for picking up unfinished work from an earlier session; [convention](docs/handover/README.md).
- `instructions/` — maintainer workflows and historical project notes.
- `.daxur/token-map.json` — repository token documentation manifest (see `docs/runbook/029_token_map_usage_guide.md`).

## First steps

1. Read `projects/triangular-engine/README.md` for the supported consumer API.
2. Read `projects/triangular-engine/docs/ai-agents.md` for implementation conventions.
3. Inspect the relevant secondary entry point before changing it.
4. Check `git status --short` and preserve unrelated working-tree changes.
   If `docs/handover/` has a handover for the work you are picking up, read it first. When your session ends with work
   open, write one ([convention](docs/handover/README.md)).
5. **DO NOT COMMIT**: Never create git commits (`git commit`). Multiple agents and developers work concurrently in the workspace; creating commits interferes with concurrent branches, worktrees, and tasks. Leave all changes uncommitted in the working tree.

## Common commands

```powershell
npm install
npm run build:triangular-engine
npm test                                # unit tests (headless, single-run)
npm run test:triangular-engine:worldgen
npm run test:triangular-engine:testing  # testing entry specs (headless)
npm run test:triangular-engine:sink     # result receiver and summary (node --test)
npm run test:summary -- --suite <id> --last 3 --metric <text>  # read saved browser test results
npm run test:receiver                   # save browser test results to artifacts/test-runs/
npx ng serve demo-app
daxur tokens map --floor 50000
daxur tokens map status
```

For a library-only edit loop, use `npm run watch`. `npm run start` prepares a linked library and starts its watch build; it does not serve the demo app.

## Change conventions

- **Do not commit**: Never run `git commit`. Leave all changes in the working tree for the user/maintainer.
- **No private repos in this public repo**: never name private/consumer repositories, apps or their paths (code, docs, runbooks, plans, CHANGELOG, commit text). Write generic wording such as "a consumer app"; keep repo-specific notes in that repo.
- Keep public exports and secondary-entry-point `public-api.ts` files intentional.
- Add or update a colocated `*.spec.ts` for behavior changes.
- Update user-facing docs and `CHANGELOG.md` for public API changes.
- Keep optional integrations isolated from the core entry point.
- Before feature or part work, use its existing reciprocal plan/runbook pair or create one under `docs/plans/` and `docs/runbook/`.
- Do not edit generated output in `dist/` or `out-tsc/`; rebuild it instead.
- Check `daxur tokens map status` when adding or expanding sublibraries to keep architecture docs in sync.

## Browser tests and their results

- Before writing or extending a browser test suite, or reading its results, read
  `projects/triangular-engine/docs/testing.md` and the `triangular-engine-testing` skill
  (`projects/triangular-engine/.agents/skills/triangular-engine-testing/SKILL.md`).
- Read results with `npm run test:summary` first; it reads only `artifacts/test-runs/index.jsonl`.
  Open a full result JSON only for a failing case. In PowerShell quote the separator
  (`npm run test:summary '--' --suite <id>`), or npm swallows the flags and prints every suite.- Timings from headless or SwiftShader runs are not hardware numbers. Check which GPU adapter a run recorded.

## Verification checklist

- Run the narrowest relevant tests, then the library build. Tests must always run headless and non-watching (`npm test` / `--browsers=ChromeHeadless --watch=false`). Never run tests with a browser popup or in interactive watch mode.
- Confirm imports use the intended public entry point.
- Check documentation links and examples against current symbols/selectors.
- For rendering changes, verify the demo app and asset paths when practical.

## Documentation source of truth

The package README and `projects/triangular-engine/docs/` describe the current consumer API. Treat `instructions/summary.md` and old runbooks as historical context unless they explicitly describe a current workflow. For repository documentation coverage and drift tracking, see `docs/runbook/029_token_map_usage_guide.md`.

## Local package archives

All local `.tgz` files go under `/ignore/packages/`, and `/ignore/` must be gitignored.
Follow [Local package archives](docs/local-packages.md) for packing, dependency paths and clone setup.
