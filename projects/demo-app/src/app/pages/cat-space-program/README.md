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

## Continuous recording proof

`tools/scene-tests/record-moon-boop.mjs` is an explicit demo-local prototype for the Stop Motion integration direction. It uses the already-served app, headless Chrome CDP screencasting, timestamped JPEG frames and FFmpeg. It retains the H.264 continuous source MP4, original frame times, pointer track, final game state, segment/source/output mapping and edited MP4 under ignored `ignore/moon-boop-videos/<run>/`. Final delivery defaults to HEVC/hvc1 CRF 28; `--codec h264` selects compatibility output. A synthetic pointer follows actual browser input. The demo-local `paced-mouse.mjs` helper starts real/drawn positions together and moves for 0.5–1.1 seconds before clicking at arrival, rather than relying on unpaced Playwright step counts. Source footage is accelerated at 3x/5x with baked-in indicators; pointer interactions and narration remain at 1x. Game sound is not recorded in this proof.

For narration, supply a directory containing intro.wav, collector.wav, kittens.wav and victory.wav, generated using the supported Daxur Gemini speech command. Probe lengths before recording; authored holds allow each speech clip to finish. Daxur owns credentials and text/voice caching.

```sh
node tools/scene-tests/record-moon-boop.mjs <speech-directory>
node tools/scene-tests/record-moon-boop.mjs <speech-directory> --codec h264
node --test tools/scene-tests/paced-mouse.spec.mjs
```

Requires installed Chrome and FFmpeg/FFprobe on PATH. The current proof uses the Windows Segoe UI font. It starts no server. Capture sources and derived videos are diagnostic/presentation artifacts, never hardware timing evidence. This does not implement a continuous backend in the Stop Motion package or modify the testing recorder budgets. Keep Plan 083 frame-sidecar work independent; this proof records CDP source timestamps, not its frame-identity contract.

Plan and evidence: [Plan 084](../../../../../../../docs/plans/084_cat-space-program.md), [ER 084](../../../../../../../docs/engineering-records/084_cat-space-program.md).
