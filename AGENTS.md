# Repository guide for AI agents and developers

## Repository map

- `projects/triangular-engine/` — the published Angular library.
- `projects/demo-app/` — the local demo application.
- `projects/triangular-engine/docs/` — cross-cutting library guides; they ship in the npm package. Each secondary entry point's guide is `projects/triangular-engine/<entry>/README.md`, next to its code, and ships with it.
- `docs/engineering-records/` — Engineering Records: design notes and implementation history for larger features.
- `docs/plans/` — current and preserved historical work plans linked to their Engineering Records; [convention](docs/plans-and-runbooks.md).
- `docs/handover/` — notes for picking up unfinished work from an earlier session; [convention](docs/handover/README.md).
- `instructions/` — maintainer workflows and historical project notes.
- `tools/consensus-conversation/README.md` — how to run the experimental multi-provider discussion coordinator, its limits and how to report outcomes.
- `.daxur/token-map.json` — repository token documentation manifest (see `docs/engineering-records/029_token_map_usage_guide.md`).

## First steps

1. Read `projects/triangular-engine/README.md` for the supported consumer API.
2. Read `projects/triangular-engine/.agents/skills/triangular-engine/SKILL.md` for implementation conventions; it lists the entry-point guides to read before changing an entry.
3. Inspect the relevant secondary entry point before changing it.
4. Check `git status --short` and preserve unrelated working-tree changes.
   If `docs/handover/` has a handover for the work you are picking up, read it first. Write a handover only when the owner
   asks for one; when a session ends with work open, offer one in your closing message and wait for a yes
   ([convention](docs/handover/README.md)).
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
npx ng serve demo-app                   # owner only; agents use the server already running (see Browser tests)
npm run serve:demo-map                  # refresh the records manifest, then serve the development map
daxur tokens map --floor 50000
daxur tokens map status
```

For a library-only edit loop, use `npm run watch`. `npm run start` prepares a linked library and starts its watch build; it does not serve the demo app.

## Change conventions

- **Do not commit**: Never run `git commit`. Leave all changes in the working tree for the user/maintainer.
- **No private repos in this public repo**: never name private/consumer repositories, apps or their paths (code, docs, engineering records, plans, CHANGELOG, commit text). Write generic wording such as "a consumer app"; keep repo-specific notes in that repo.
- Keep public exports and secondary-entry-point `public-api.ts` files intentional.
- Add or update a colocated `*.spec.ts` for behavior changes.
- Update user-facing docs and `CHANGELOG.md` for public API changes.
- New secondary entry points document themselves in `<entry>/README.md` and are added to the package README index and `projects/triangular-engine/docs/entry-points.md`. Entry-specific guides do not go in `projects/triangular-engine/docs/`.
- Public symbols get TSDoc. IDE hovers show it to consumers, so write it for them.
- Keep optional integrations isolated from the core entry point.
- When creating or modifying demo-app scene pages, follow `projects/demo-app/src/app/AGENTS.md`: set `showFPS: true` on the engine provider and `[showFps]="true"` on `<scene>`, and use the engine portal layout for HUD/viewport controls. Do not place independently positioned scene controls with local absolute CSS; portal lanes coordinate their stacking and order.
- Before feature or part work, use its existing reciprocal plan and Engineering Record pair or create one under `docs/plans/` and `docs/engineering-records/`.
- Preserve numbered plans and Engineering Records after completion, abandonment or supersession. Record the outcome and replacement links; do not delete them, reuse their numbers, or silently erase earlier commitments. To archive completed or superseded pairs into git-backed stubs, use `triangular docs archive <path>` (or `triangular docs unarchive <path>` to restore); see [the convention](docs/plans-and-runbooks.md).
- Use `triangular docs plan new --title "..." --slug ...` to allocate a shared number, create the reciprocal Markdown pair from packaged templates, and update both indexes. `triangular docs records check` validates mapped documents; `triangular docs records review docs/plans/<file>.md --reviewer agent` refreshes its scope fingerprint only after reviewing it. A preview from `triangular docs records next` is not a reservation. Pass `--root <workspace>` to target another project. Read [the document format and workflow](docs/plans-and-runbooks.md#engineering-record-format-and-tooling) before authoring mapped plans.
- Use the `triangular docs consensus` commands for one durable review per engineering decision. Give participants the same frozen brief, preserve independent responses and dissent, and keep developer decisions separate. The CLI creates and updates Markdown; it does not call AI providers. Follow the packaged [triangular-cli skill](projects/triangular-engine/.agents/skills/triangular-cli/SKILL.md).
- Never run `triangular docs records baseline` unless the developer explicitly confirms the exact scope snapshot; review markers, checkboxes and agent-authored reviewer fields are not confirmation. Keep confirmed baselines and dated scope changes in the paired Engineering Record; do not overwrite the history.
- Do not edit generated output in `dist/` or `out-tsc/`; rebuild it instead.
- New demo pages need a route in `projects/demo-app/src/app/app.routes.ts` and a card in `projects/demo-app/src/app/pages/demo-index/demo-index.component.ts`. Check the dev server output for build errors and open the page before reporting it done. See `projects/demo-app/src/app/AGENTS.md`.
- Check `daxur tokens map status` when adding or expanding sublibraries to keep architecture docs in sync.

## Browser tests and their results

- To deliver generated media in chat, read `projects/triangular-engine/.agents/skills/share-media-in-chat/SKILL.md`: Codex and Antigravity use an absolute-path Markdown media embed; Claude uses its available `SendUserFile` tool. Codex phone MP4 playback was confirmed on 2026-11-05; Antigravity inline playback was confirmed on 2026-11-06. The skill also ships at `node_modules/triangular-engine/skills/share-media-in-chat/SKILL.md` for consumers; delivery is separate from content review.
- Before adding or changing a page integration with `triangular-engine/testing`
  (including `<tri-test-runner>` and its game adapter), writing or extending a browser
  test suite, or reading its results, read `projects/triangular-engine/testing/README.md`
  and the `triangular-engine-testing` skill
  (`projects/triangular-engine/.agents/skills/triangular-engine-testing/SKILL.md`).
  This is a repository-local skill; it may not appear in the agent's installed skill
  catalog. Open the file at that path directly. For consumer apps outside this repo,
  the package includes it at `node_modules/triangular-engine/skills/triangular-engine-testing/`.
- Read results with `npm run test:summary` first; it reads `artifacts/test-runs/index.jsonl`
  and run-adjacent `.reviews.json` metadata without opening media. Open a full result JSON
  only for a failing case. In PowerShell quote the separator
  (`npm run test:summary '--' --suite <id>`), or npm swallows the flags and prints every suite.
- **The demo app is already served.** The owner keeps it running at `http://triangular-demo.localhost:4200`, with the
  result receiver. Never start `ng serve` or another dev server; point browser runs and `npm run test:run --url` at
  that address. Open it in a browser before concluding that it is unavailable: on Windows, PowerShell/.NET DNS
  lookups and `Invoke-WebRequest` can fail for `triangular-demo.localhost` even when Chromium opens it successfully.
  For a shell-only connectivity check, `http://127.0.0.1:4200/characters-lab` can confirm an HTTP response; that
  alone does not verify the intended hostname, browser rendering, or result receiver. Keep the documented hostname
  for browser and test-run URLs. If the page itself does not load in the browser, tell the owner instead of starting
  a server.
- Timings from SwiftShader runs are not hardware numbers. Runs with `--profile headless-hardware` use the real GPU,
  but compare them only with other headless runs. Check which GPU adapter a run recorded.
- For functional checks and quick iterations, start the unattended launcher with `--noisy` (add it to `npm run test:run`).
  Without it the launcher waits for a quiet GPU and can sit for a long time while another app uses it. Keep runs
  without `--noisy` for timing evidence only.

## Verification checklist

- Run the narrowest relevant tests, then the library build. Tests must always run headless and non-watching (`npm test` / `--browsers=ChromeHeadless --watch=false`). Never run tests with a browser popup or in interactive watch mode.
- Confirm imports use the intended public entry point.
- Check documentation links and examples against current symbols/selectors.
- For rendering changes, verify the demo app and asset paths when practical.

## Documentation source of truth

The package README, `projects/triangular-engine/docs/` and each entry's `<entry>/README.md` describe the current consumer API. Treat `instructions/summary.md` and old engineering records as historical context unless they explicitly describe a current workflow. For repository documentation coverage and drift tracking, see `docs/engineering-records/029_token_map_usage_guide.md`.

## Demo walkthrough recordings

For narrated UI/game videos, read `node_modules/@daxur-studios/stop-motion-ui/skills/adopt-stop-motion-capture/SKILL.md`. Use `defineVideo` for continuous gameplay and `defineDemo` for reconstructed screenshots. The demo recipe `tools/scene-tests/moon-boop.video.mjs` illustrates the installed API. Await paced pointer helpers, keep input/speech at 1x and label accelerated waits. This development tool does not modify the engine testing recorder or its result-artifact contract.

## Local package archives

All local `.tgz` files go under `/ignore/packages/`, and `/ignore/` must be gitignored.
Follow [Local package archives](docs/local-packages.md) for packing, dependency paths and clone setup.

<!-- daxur-app:triangular-demo -->Served by daxur at http://triangular-demo.localhost:4200 — don't start your own `ng serve`; run `daxur app guide triangular-demo` for how to check builds.<!-- /daxur-app -->
