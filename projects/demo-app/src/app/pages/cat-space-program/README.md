# Cat Space Program — Operation Moon Boop

Open `/cat-space-program` from the demo hub. One capsule human collects cats from a catnip garden, food bowl or six-kitten nursery. Stack 18 cats to reach a deliberately nearby Moon. Buy shoes and extra carrying capacity instead of more humans. Manual stacking earns the same four treats per cat as collector deliveries.

## Play

Start collecting, use the manual stack button or click a waiting cat, and spend treats on throughput. Food refills contain six portions. The nursery produces six cats every 24 simulation seconds; the kitten-surprise fixture begins halfway through its first countdown. Exactly one human and at most 30 cats exist. Stacked cat rigs stop updating; this limits animation work but does not eliminate draw calls or establish a performance budget.

Starting conditions are deterministic alternatives, not claims of balanced strategies. They reset the round. Pause freezes the model; New round resets it. Turning off the collector completes its current trip before parking. On victory, production and movement stop. No save/offline production, physics stacking or sound effects are implemented.

## Agent and recording interface

In development, `window.moonBoopDemo` exposes:

- `ready()` — first usable rendered canvas.
- `read()` — cloned plain game state including simulation time, source clocks, cats, collector and victory.
- `selection()` — selected semantic target ID.
- `actions` and `act(action, value?)` — supported page actions; false indicates refusal.
- `targets()` — visible projected bounds in normalized viewport percentages (0–100), with stable IDs and labels. These are focus aids, not occlusion or pickability guarantees.

Actions: `stack` (optional cat ID), `collector`, `pause`, `shoes`, `basket`, `food`, `nursery`, `reset` (garden/feast/kittens), `select` (target ID), `camera` (overview/collector/tower), `highlights`. Targets include catnip, food, nursery, collector, tower, moon and cat-N. Buttons and picked scene objects use the same actions. The test adapter locks all manual/API scene actions and orbit input while running. The surface is removed when the page is destroyed and is absent from production builds. It is demo-owned, not a new engine API.

Game time uses fixed 50 ms steps. The page caps a stalled render delta at 100 ms to avoid background-tab jumps, so wall time can exceed simulation time. Video speed edits must be labeled separately; this page has no simulation-speed cheat.

## Checks

```sh
node --experimental-strip-types --test projects/demo-app/src/app/pages/cat-space-program/moon-boop-game.spec.mjs
node tools/scene-tests/moon-boop-check.mjs
```

The shared runner (under Run functional checks) owns suite `moon-boop-functional@1`: collector delivery, paused state and six-kitten production. Its adapter captures/restores the previous round and view, waits on rendered game conditions, and cooperates with cancellation. Visual review remains pending after automated completion. These are functional checks, not performance measurements.

## Packaged continuous recording

The demo now uses the installed `@daxur-studios/stop-motion-ui` dev dependency and `tools/scene-tests/moon-boop.video.mjs`. The recipe contains game actions/readiness and six named segments; the package owns staged CDP capture, paced input, captions/speed labels, speech timing and final encoding. This is a consumer of a generic recorder, independent of testing result recordings and Plan 083 frame-identity contracts.

```sh
node tools/scene-tests/record-moon-boop.mjs ignore/moon-boop-speech
node tools/scene-tests/record-moon-boop.mjs --silent
npx --no-install stop-motion-ui run tools/scene-tests/moon-boop.video.mjs --out ignore/moon-boop-videos --json
npx --no-install stop-motion-ui render ignore/moon-boop-videos/run-ABC/scenario --out ignore/moon-boop-videos --codec h264 --json
```

The convenience launcher retains the prior speech-directory/codec arguments. Supplied speech uses intro.wav, collector.wav, kittens.wav and victory.wav. Without a directory the recipe uses the package Daxur Gemini adapter and its text/voice cache; `--silent` skips speech entirely. The direct CLI can also use `--narration off`. `MOON_BOOP_SPEECH_DIR` supplies existing clips for the direct command. Generated text and deterministic setup belong in this app-owned recipe.

Install/restore the ignored local archive referenced by package.json before running; see the repository local-package convention. The recipe uses installed headless Chrome with WebGPU arguments and the already-served app, starting no server. `result.json` identifies the final video, preview, transcript and timeline mapping. Source JPEGs and their real timestamps remain under `scenario/recording.json`; there is no intermediate source MP4 or extra lossy encode. Game sound is not captured. Final output defaults to compact HEVC/hvc1; use `--codec h264` for compatibility.

Keep pointer input and narration at 1x. The kitten countdown and gathering callbacks wait on game state, with captured footage accelerated 3x/5x and labeled visibly. Simulation speed is unchanged and source wall time remains distinct from game time. All video helpers are awaited: the real and synthetic pointer begin together and glide to controls before pressing. Old demo-local paced-mouse files remain as historical proof code and are no longer imported by the recording recipe.

For future recordings, read `node_modules/@daxur-studios/stop-motion-ui/skills/adopt-stop-motion-capture/SKILL.md`. Capture and previews support functional/visual review; they establish no hardware performance claim.

Plan and evidence: [Plan 084](../../../../../../../docs/plans/084_cat-space-program.md), [ER 084](../../../../../../../docs/engineering-records/084_cat-space-program.md).
