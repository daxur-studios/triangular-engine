# Cat Space Program — Operation Moon Boop

Open `/cat-space-program` from the demo hub. One capsule human collects cats from a catnip garden, food bowl or six-kitten nursery. Stack 18 cats to reach a deliberately nearby Moon. Buy shoes and extra carrying capacity instead of more humans. Manual stacking earns the same four treats per cat as collector deliveries.

## Play

Start collecting, use the manual stack button or click a waiting cat, and spend treats on throughput and care. Food refills contain six portions. The nursery produces six cats every 24 simulation seconds; the kitten-surprise fixture begins halfway through its first countdown. Exactly one human and at most 30 cats exist, including cats still departing. Stacked cat rigs stop updating; this limits animation work but does not eliminate draw calls or establish a performance budget.

Each stacked cat requests care after 24 simulation seconds. An amber **PET ME!** badge and named HUD button identify it; pet or feed it within the following 18 seconds. Click the cat, use its keyboard-accessible HUD button, or choose **Pet neediest cat**. The single human uses a small cat lift, pets that specific cat, then descends. Automatic human care starts on in ordinary rounds; collection has a separate toggle. Current jobs finish before toggles park the human. One pending explicit pet request is allowed. Automatic care takes at most two consecutive trips before an available collection trip, so care cannot monopolize the collector indefinitely.

Buy the golden treat gun for **20 treats**, then its mint twin for **32**. Each fires at most once per **2.5 simulation seconds**, aims at the oldest care request and reserves a distinct target. Ammunition is free after purchase. A treat refreshes care only on its **0.8-second arrival**, by cat ID. It cannot revive a departed cat; deadlines win simultaneous late hits. Missed cats leave on a small safety platform over three seconds, and the remaining tower closes the gap. No cat is injured and no treat reward is refunded or repeated.

Starting conditions are deterministic alternatives, not claims of balanced strategies. They reset the round. **Petting practice** has six stacked cats and Cat 4 requesting care; **Safe departure** puts that middle cat four seconds from its deadline; **Treat-gun trial** has eight care requests and 52 treats. These three care fixtures start human automation off so the demonstration has an explicit cause. Pause freezes care, jobs and airborne snacks as well as production; New round clears them. **Care cam** frames the tower and guns. On an 18-cat victory, all simulation freezes, including care: the win cannot decay. The former unupgraded collector-only victory check now purchases upkeep and movement upgrades through ordinary actions. No save/offline production, physical climbing/stacking, tower launch or sound effects are implemented.

## Agent and recording interface

In development, `window.moonBoopDemo` exposes:

- `ready()` — first usable rendered canvas.
- `read()` — cloned plain game state including simulation time, source clocks, cats, collector and victory. Care state includes each cat's `caredAt`, `careBy`, `careCount` and optional departure time/level; human height/phase/target, pending request, gun cooldowns, in-flight shot recipient IDs and pet/hit/departure totals.
- `selection()` — selected semantic target ID.
- `actions` and `act(action, value?)` — supported page actions; false indicates refusal.
- `targets()` — visible projected bounds in normalized viewport percentages (0–100), with stable IDs and labels. These are focus aids, not occlusion or pickability guarantees.

Actions: `stack` (optional cat ID), `collector`, `pet` (optional needy cat ID), `care` (toggle human care), `gun` (buy next), `pause`, `shoes`, `basket`, `food`, `nursery`, `reset` (garden/feast/kittens/petting/departure/treats), `select` (target ID), `camera` (overview/collector/tower/care), `highlights`. Targets include catnip, food, nursery, collector, tower, moon, cat-N and purchased gun-1/gun-2. Buttons and picked scene objects use the same actions. The invisible tower proxy yields to actual scene targets. The test adapter locks all manual/API scene actions and orbit input while running. The surface is removed when the page is destroyed and is absent from production builds. It is demo-owned, not a new engine API.

Game time uses fixed 50 ms steps. The page caps a stalled render delta at 100 ms to avoid background-tab jumps, so wall time can exceed simulation time. Video speed edits must be labeled separately; this page has no simulation-speed cheat.

## Checks

```sh
node --experimental-strip-types --test projects/demo-app/src/app/pages/cat-space-program/moon-boop-game.spec.mjs
node tools/scene-tests/moon-boop-check.mjs
```

The shared runner (under Run functional checks) owns suite `moon-boop-functional@1`: collector delivery, paused state and six-kitten production. Its adapter captures/restores the previous round and view, waits on rendered game conditions, and cooperates with cancellation. Visual review remains pending after automated completion. These are functional checks, not performance measurements.

The appended `moon-boop-care@1` suite checks recipient-specific human petting, a middle departure and eight-cat automatic care with two guns. The runner uses a scrolling engine side portal. [Run the exact care suite](http://triangular-demo.localhost:4200/cat-space-program?testSuite=moon-boop-care&testVersion=1&testProfile=headless-hardware&testMode=standard&testRepetitions=1&testAutoStart=1). The browser script also checks real scene picking, keyboard petting, rendered tower reflow, purchase controls, pause and input-lock/cancellation restoration.

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

## Care walkthrough

```sh
npx --no-install stop-motion-ui run tools/scene-tests/moon-boop-care.video.mjs --out ignore/moon-boop-care-videos --json
```

This new installed-package `defineVideo` recipe uses the care fixtures, normal-speed paced pointer input and predeclared cached Daxur narration. It demonstrates the human trip, a safe middle departure, one gun and then two, with actual state assertions. All footage is 1x; short fixtures remove the need for accelerated waits. The original `moon-boop.video.mjs` remains the historical collection/victory walkthrough; its no-upkeep script predates care and is not the acceptance recipe for this expansion. No engine/testing artifact recording integration is claimed.

Care implementation and evidence: [Plan 085](../../../../../../../docs/plans/085_moon-boop-cat-care.md), [ER 085](../../../../../../../docs/engineering-records/085_moon-boop-cat-care.md).
