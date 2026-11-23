---
type: EngineeringRecord
title: "Procedural character studio"
description: "Dated decisions, findings and evidence for Procedural character studio."
timestamp: 2026-10-31T00:00:00Z
tags: [engineering-records]
record_id: er-074
scope_history_schema: 1
plans:
  - /docs/plans/074_procedural-character-studio.md
performance:
  - id: character-studio-human-performance-v1
    url: http://triangular-demo.localhost:4200/character-studio?testSuite=character-studio-human-performance&testVersion=1&testProfile=visible-browser&testMode=standard&testRepetitions=1&testAutoStart=1
    status: runnable-hardware-unmeasured
---

# Engineering Record 074: Procedural character studio

Plan: [PLAN-074](/docs/plans/074_procedural-character-studio.md).

## 2026-10-31 — Starting

**Goal.** Build a focused procedural capsule character studio in the demo app, starting with a full-screen shell for capsule humans and cats and a small app-owned contribution boundary.

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/074_procedural-character-studio.md).

**Checks.** Record commands and observable outcomes. Keep functional, performance and human visual evidence distinct.

## 2026-10-31 — Initial scope and architecture

**Direction.** The existing Characters Lab combines capsule human/cat customization, face-rig experiments, a general humanoid scene and capsule visual suites. Give the capsule characters a dedicated `/character-studio` route and move their verification workflow with them. Keep the existing lab available during migration for face and general humanoid work.

**Boundary.** Start with capsule humans and cats as app-local contributions to a shared studio shell. Contributions own character-specific identity, presets, actors, controls and visual suites; the shell owns selection, viewport and shared verification actions. Keep the engine's character APIs usable without the studio. Defer a public plugin API, themed wardrobe/role packs, anatomy expansion, persistence and concept-art tracing until the local boundary has been exercised.

**Checks.** No implementation checks yet. See the acceptance conditions and phase states in [Plan 074](/docs/plans/074_procedural-character-studio.md).

## 2026-10-31 — First studio shell

**Change.** Added an app-local Character Studio route with a full-height workbench, capsule human/cat family selection, preset selection, expression and motion controls, and per-family appearance/gear controls. The initial `CharacterStudioContribution` contract is local to the demo app and keeps human and cat fields behind their own descriptors. The demo selector now lists the studio ahead of the previous Characters Lab on the newest sort. The prior route and its test workflow remain available during migration.

**Verification.** Documentation pair validation passed before the app edit. No app build, browser run or automated test has been run for this scaffold.

**Next.** Exercise the page in the already-running demo app, address any runtime/layout issues, then move capsule suites and recording into the studio before removing capsule editing from `/characters-lab`.

## 2026-10-31 — Hair generation and motion verification planned

**Change.** Added two later phases to Plan 074 for focused procedural-hair review. `hair-generation-coverage` covers deterministic hairstyle variants with close-up front, side and rear evidence, checking silhouette, attachment and coverage. `hair-motion-and-helmet` covers hair during walking and inside a clear dome-style helmet, including an explicit review of expected motion and fit behavior.

**Boundary.** These phases are planned visual verification and targeted corrections, not a commitment to physics-based hair simulation. The evidence should reveal whether hair should remain fixed, sway, or use another deterministic behavior, and whether dome clearance or occlusion needs a generator change. Motion video and labeled still/contact sheets can serve different review needs.

**Checks.** Documentation changes only; mapped-plan review freshness and pair validation remain to be refreshed. No runtime implementation or visual verdict is implied.

## 2026-10-31 — Studio verification surface

**Change.** Mounted the existing capsule orbit, facial-detail and human A/B variant suites on `/character-studio`. The studio host applies test settings through the family contribution boundary, waits for rendered frames, captures the same optional WebM recordings and review thumbnails, and restores the selected character, camera and motion afterward. Added focused front, profile, rear, face and head views, and exposed hand-action and cat face-detail controls used by the imported scenarios. The focused framing is resolved by each family contribution using the existing measured geometry and shader-mouth bounds helper.

**Verification.** `npx ng build demo-app` completed successfully. No browser suite or visual review was run in this change, so recording generation, result-sink retention and human review remain unverified on the studio route. The build reports the existing Angular component-style budget warning for the studio stylesheet, in addition to other workspace warnings.

**Next.** Run the capsule suites from the studio, inspect the generated result summaries and selected media, then move suite ownership out of the legacy page and remove duplicate capsule controls only after that workflow is established.

## 2026-10-31 — Studio visual suites and review media

**Change.** Raised the Angular `anyComponentStyle` warning budget from 10 kB to 14 kB; kept the 16 kB error budget. Made the studio scene host a flex container after the first headless readiness check found a 1-pixel canvas, allowing the renderer and test runner to become ready at the intended viewport size.

**Verification.** `npx ng build demo-app` succeeded and no longer reports the Character Studio component-style budget warning. The build still reports existing CommonJS optimization warnings from Mermaid dependencies. On `/character-studio`, all three suites passed in `headless-hardware` mode: `capsule-visual-verification` (2/2 cases, 20 s), `capsule-facial-emotions` (8/8, 33 s), and `capsule-human-ab-variants` (10/10, 41 s). The result summaries are saved under their respective `artifacts/test-runs/<suite>@v1/` directories. The tests did not collect performance measurements.

**Review artifacts.** Orbit recordings are 185,193 bytes (human) and 196,246 bytes (cat). Their generated GIF previews are 802,006 bytes and 699,347 bytes respectively, so these GIFs are about 4.3x and 3.6x larger than the source WebM recordings. The facial expression contact sheet is 70,981 bytes; the front-detail hair preset contact sheet is 67,074 bytes. All review verdicts remain pending human visual inspection; this entry records artifact generation and automated results only.

**Next.** Human review can use the generated orbit GIFs and face/hair contact sheets. Continue with legacy-lab separation after the studio evidence workflow is reviewed.

## 2026-10-31 — Legacy lab separation

**Change.** Removed capsule character modes, customization panels, actors and the test runner from `/characters-lab`. The remaining page opens on Face Studio and keeps the authored/procedural face demonstrations plus the general humanoid rig scene. Moved capsule suite definitions, test adapter, camera-focus helper and their specs into the Character Studio folder, preserving the existing suite IDs and history there. Renamed the demo selector entry to “Face Rig & Humanoid Lab.”

**Verification.** `npx ng build demo-app` completed successfully. Existing CommonJS optimization warnings from Mermaid dependencies remain. No browser review or automated suite tests were run for this separation.

**Next.** Start `hair-generation-coverage` with deterministic close-up views of selected hairstyles from front, side and rear. The generated Character Studio media still needs a human visual verdict; this migration does not record one.

## 2026-10-31 — Character performance matrix

**Change.** Added the `character-studio-human-performance@v1` suite to the Character Studio test selector. It compares 1, 16 and 48 capsule humans at idle, walking in place, and walking along deterministic per-character scene paths. The adapter measures display-paced frame intervals, per-tick actor-update CPU time, main-thread render-submit time, Three.js draw calls and triangles, and scenario setup time (extra actor construction, population placement and camera fit; primary human construction is excluded). This is a diagnostic performance suite; video capture and visual review are not part of its measurement.

**Decision.** Use p95 frame cadence of 16.7 ms as a provisional 60 Hz target for the first diagnostic run. Do not call it a production performance baseline; the intended device and clean visible-browser run still need review. The other measurements help identify whether the cost is primarily actor updates, scene submission, draw count, triangle count or setup.

**Run.** [Launch the visible standard performance matrix](http://triangular-demo.localhost:4200/character-studio?testSuite=character-studio-human-performance&testVersion=1&testProfile=visible-browser&testMode=standard&testRepetitions=1&testAutoStart=1).

**Verification.** `npx ng build demo-app` passed, the focused Character Studio adapter spec passed 12/12, and `triangular docs records check` passed. The build reports the existing Mermaid CommonJS optimization warnings. A visible hardware run remains pending; Computer Use was stopped with Escape before the browser suite could be launched. No performance result or hardware baseline is claimed yet.

**Next.** Run the suite on the intended device, inspect the compact saved summary and machine context, then decide whether the 60 Hz budget and largest actor count match the games this studio should guide.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

### 2026-11-14 — Multi-angle focus framing and hair/lineup contact sheets

- **Framing fix (`character-studio-page.component.html`, `character-studio-page.component.ts`, `character-studio-focus.ts`).** Removed `[isActive]="!runnerBusy()"` from `<orbitControls>` because disabling `OrbitControlsComponent` during test execution disposed the controls and stopped `orbit.update()` from updating the camera look-at target when `[cameraPosition]` and `[target]` changed, cropping test stills to the right edge. Kept `<orbitControls>` active with `[fov]="42"`, disabled pointer input on `.viewport-panel` while `runnerBusy()` is true, reset `family.root.rotation.y = 0` and called `family.update(0.25)` on scenario apply, and added world-Y `azimuthRadians` support to `fitCameraToFocusTarget` and `CameraFocusFitOptions` (`front`, `profile`, `back`, `three-quarter`) plus rear head bounds for `human-head-hair`.
- **Verification suites (`character-studio-tests.ts`).** Added `capsule-hair-coverage@v1` (30 helmetless `human-head-hair` close-ups across 10 hairstyles × Front/Side/Back) and `capsule-human-lineup@v1` (20 `human-full-body` front presets covering the 10 baseline and 10 alt capsule characters), with DNA override support (`hairStyleId`, `facialHairId`, `hairColor`, `accessory`, `helmet`) during scenario setup.
- **Verification and generated baseline sheets.**
  - `npx ng test demo-app --watch=false --browsers=ChromeHeadless --include="**/character-studio-*.spec.ts"` passed (`18 SUCCESS`).
  - `daxur app status triangular-demo --json --wait` reported `state: "ok"` (`0` errors, `0` warnings).
  - Headless hardware runs (`--profile headless-hardware --noisy`, GPU shared with desktop workload; `visual=pending` awaiting human review):
    - `capsule-hair-coverage@v1` (`2026-11-14T16-08-24-953Z_headless-hardware_9632de21-e3b0c442`): 30/30 `auto=pass`, 30 WebP stills + 2 contact sheets (`capsule-human-hair-variants-sheet-1-front-side-back.contact.svg`/`.png`, `capsule-human-hair-variants-sheet-2-front-side-back.contact.svg`/`.png`).
    - `capsule-human-lineup@v1` (`2026-11-14T16-09-47-155Z_headless-hardware_9632de21-e3b0c442`): 20/20 `auto=pass`, 20 WebP stills + 2 contact sheets (`capsule-human-space-variants-baseline-lineup-10.contact.svg`/`.png`, `capsule-human-alt-space-variants-lineup-10.contact.svg`/`.png`).
    - `capsule-human-ab-variants@v1` (`2026-11-14T16-10-49-331Z_headless-hardware_9632de21-e3b0c442`): 10/10 `auto=pass`.
  - Visual baseline observations: centered framing is restored across all hair angles and presets; current gaps relative to the target style include sharp horizontal scalp-cap seams on short/updo cuts, crown-fanning spike clusters lacking lower side/nape volume, wide gaps in `bob_cut` fringe teeth, tubular front bangs on `space_buns`, `sprout` helmet penetration, tall forehead spacing with flat rectangular eyebrows, and body customization limited to `suitSplitY` shader colors rather than layered garments.

### 2026-11-14 — Option A: Procedural hair, scalp, knit beanie, and facial hair overhaul

- **Sculpted clay hair & dome containment (`capsule-hair-kit.ts`, `capsule-space-gear.ts`, `capsule-character-actor.spec.ts`).** Replaced Twist-prone Frenet tube profiles with surface-aligned `CatmullRomCurve3` tapered clay locks with center ridge crease, configurable `tipBluntness`, recessed vertex-clamped base scalp blocker (`addScalpBaseCap`), forehead curtain bangs (`addFullCurtainBangs`), surface-hugging meridional back coverage (`addSculptedPartedBackScalp`), and exact-surface-radius layered back cascades (`addLayeredBackCascade`). Overhauled all non-bald hairstyles (`sprout`, `space_buns`, `bob_cut`, `afro`, `curly`, `ponytail`, `pigtails`, `buns`, `top_bun`, `spiky`, `wacky`, `mullet`, `swept`, `receding`, `mohawk`), upgraded `mustache_handlebar` and `full_beard`, tilted `buildKnitBeanie` (`-0.20` rad) with 10 ribbed cuff capsules so `mullet` bangs clear underneath without clipping, and clamped geometry vertices against the bubble helmet dome when `helmet: true`.
- **Coverage suite updates (`character-studio-tests.ts`, `character-studio-page.component.ts`).** Added `jetpack?: boolean` override support on `CharacterStudioTestSettings` and disabled jetpacks across `capsule-hair-coverage@v1` so side/back hair profiles are unoccluded, and updated the full-beard coverage preset to `spiky`.
- **Verification.**
  - `npm run test:triangular-engine:procedural` passed (`271 SUCCESS`), including the added spec asserting bubble helmet dome containment and rear-skull coverage across all hairstyles.
  - `npx ng test demo-app --watch=false --browsers=ChromeHeadless --include="**/character-studio-*.spec.ts"` passed (`18 SUCCESS`).
  - `daxur app status triangular-demo --json --wait` reported `state: "ok"` (`0` errors, `0` warnings).
  - Headless hardware browser runs (`--profile headless-hardware --noisy`; `visual=pending` awaiting human review):
    - `capsule-hair-coverage@v1` (`2026-11-14T17-19-26-232Z_headless-hardware_9632de21-87751c7b`): 30/30 `auto=pass`, 30 unoccluded stills + regenerated `capsule-human-hair-variants-sheet-1-front-side-back.contact.svg`/`.png` and `sheet-2` (blunt `bob_cut`, dense `afro` curls, high centered `ponytail`, clean `mullet` cuff bangs, full nape wrap across updos/swept/spikes).
    - `capsule-human-lineup@v1` (`2026-11-14T17-20-56-693Z_headless-hardware_9632de21-87751c7b`): 20/20 `auto=pass`, 20 lineup stills + regenerated `capsule-human-space-variants-baseline-lineup-10.contact.svg`/`.png` and `capsule-human-alt-space-variants-lineup-10.contact.svg`/`.png` with clean dome clearance across all helmeted characters.
    - `capsule-human-ab-variants@v1` (`2026-11-14T17-21-59-298Z_headless-hardware_9632de21-87751c7b`): 10/10 `auto=pass`.

### 2026-11-14 — Option B (in progress): Single-character `Orange Pigtails` face & proportion benchmark

- **Benchmark suite (`character-studio-tests.ts`, `character-studio-page.component.ts`).** Added `capsule-orange-pigtails-benchmark@v1` (4 helmetless close-ups on `curly-pigtails` `#e06829` / `#38bdf8` ties: `Front`, `3/4 View`, `Profile`, `Back`) and adjusted `framingAzimuthRadians('three-quarter')` to `-0.55` rad and `framingAzimuthRadians('profile')` to `-1.18` rad.
- **Pass 1 — Larger protruding eyes, arched brows & curtain bangs (`capsule-face-rig.ts`, `capsule-hair-kit.ts`).** Enlarged `eyeRadius` (`0.255r` → `0.325r`), raised `eyeY` (`suitSplitY + bodyHeight * 0.365 + 0.04r`) so lower eye clearance above the shader mouth stayed unchanged, rounded sclera Z-scale (`0.94`), tucked open `upperLidPivot.rotation.x` to `-1.34` rad, moved female eyelashes onto `eyelidTiltGroup` (`polarPhi = 0.94..1.36`), replaced flat brow capsules with 5-point `CatmullRomCurve3` `createArchedBrowGeometry`, lifted `addFullCurtainBangs` forehead waves, smoothed `addSculptedPartedBackScalp` (8 ribs, `tipBluntness: 0.90`), and tilted `pigtails` hairbands.
- **Pass 2 — Wide eye spacing, outer rim silhouette break & temple clearance (`capsule-face-rig.ts`, `capsule-space-gear.ts`, `capsule-dna.ts`, `capsule-hair-kit.ts`).** Enlarged `eyeRadius` to `0.385r` and widened eye/brow angle to `max(0.56, eyeSpacing * 1.72)` (`x ≈ 1.04r * sin(angle)`, `z ≈ 1.08r * cos(angle)`) so outer white eye rims reach/break the capsule silhouette; synced `buildRoundGlasses`; trimmed `curly-pigtails` to `bodyRadius: 0.34`, `bodyHeight: 0.84`; lifted `addFullCurtainBangs` temple sweep above eye level and disabled `includeLongTendrils` on `pigtails`.
- **Verification (after Pass 2).**
  - `npx ng test demo-app --watch=false --browsers=ChromeHeadless --include="**/character-studio-*.spec.ts"` passed (`18 SUCCESS`).
  - `npm run build:triangular-engine` succeeded (`dist/triangular-engine`).
  - `daxur app status triangular-demo --json --wait` reported `state: "ok"` (`0` errors, `0` warnings).
  - `capsule-orange-pigtails-benchmark@v1` (`2026-11-14T19-23-04-063Z_headless-hardware_9632de21-75c09682`): 4/4 `auto=pass`.
  - `npm run test:triangular-engine:procedural` failed to compile on unrelated working-tree changes in `projects/triangular-engine/testing/test-launch.spec.ts` (`recordings` missing in expected `TestLaunchSelection`).
- **Owner visual feedback after Pass 2.** Outer eye rims break the silhouette better, but the eyes now read as too wide apart — likely because the capsule body (`bodyRadius`) itself is still too wide relative to the head/eye proportions. Passing to a fresh agent for body-width/eye-spacing tuning.
- **Pass 3 — closer eyes and narrower body.** Set the `curly-pigtails` radius to `0.32`, eye spacing to `0.28`, and eye scale to `1.1`. Lowered the shared minimum eye angle from `0.56` to `0.45` in the eyes, brows and glasses, allowing smaller spacing values to take effect. This also affects other characters with low eye-spacing values; their appearance remains unchecked.
- **Verification (Pass 3).** The engine build and demo rebuild passed. `capsule-orange-pigtails-benchmark@v1` run `2026-11-14T19-33-30-580Z_headless-hardware_894a23c3-4977b19c` passed all four automated cases; visual review remains pending. The closer eyes and narrower head are visible, while hair and mouth still differ from the reference. Local-only comparison: `artifacts/test-runs/orange-pigtails-concept-vs-render.png`; regenerate using the benchmark and the comparison script named in the handover.
- **Pass 4 — pupil variation.** Bruno approved the closer eyes and narrower head. For `curly-pigtails`, reduced pupil scale from `0.28` to `0.26` and added subtle yaw (`0.05`) and pitch (`0.06`) asymmetry. This offsets the pupils relative to one another; it does not raise both pupils together. Engine and demo builds passed, and benchmark run `2026-11-14T19-44-10-537Z_headless-hardware_894a23c3-f2ab1181` passed all four automated cases. Visual review is pending; the local comparison board was regenerated.

### 2026-11-14 — Concept landmarks and camera study

- **Finding.** The owner visually approved the draft landmark placement and an approximate editable SVG recreation. The concept points are manually estimated in original-image pixels: eye outlines are circles defined by centre and radius; pupil centres, head edges and mouth corners are points. The reference crop and coordinates are preserved in [the small landmark dataset](assets/074/orange-pigtails-concept-landmarks.json), identified by source-image hash. The matching render was marked separately by hand; its positions are not yet projected automatically from the model.
- **Method.** `artifacts/orange-pigtails-study/build-study.py` reads a reference image and a render as arguments, draws the saved-in-script points and eye circles on independent crops, and outputs a board and JSON. The SVG was drawn by hand using shapes and gradients, not traced automatically. Local-only evidence: `artifacts/orange-pigtails-study/draft-landmark-comparison.png`; regenerate with `python artifacts/orange-pigtails-study/build-study.py <reference-image> <render-image>`. Scratch scripts and outputs are local, not a reusable shipped tool.
- **Camera experiment.** A local browser script applied the existing benchmark setup, then compared perspective FOVs 42°, 25° and 12° in front and three-quarter views. Camera distance was scaled by the ratio of half-angle tangents to keep framing approximately constant at the target. Eye size and protrusion change with perspective, while the outward pupil placement remains visible in all three views. No camera setting is established as a concept match; perspective, view angle and lighting remain uncalibrated. Local-only evidence: `artifacts/orange-pigtails-study/camera-comparison.png`; regenerate with `node artifacts/orange-pigtails-study/camera-study.cjs` followed by `python artifacts/orange-pigtails-study/camera-board.py` while the demo is running. The script uses Angular development-mode internals and is an experiment, not a supported test interface.
- **Decision.** Keep this initial character-specific study in the existing 074 record. A broader cross-asset comparison tool for characters and vehicle parts would need its own scope and plan if pursued; no new plan is created for this experiment.

### 2026-11-14 — 25° comparison benchmark

- **Decision.** Bruno selected 25° as the starting perspective for Orange Pigtails comparisons. Added `capsule-orange-pigtails-benchmark@v2` with the four existing views and explicit 25° FOV; v1 retains its 42° behavior. The studio captures and restores its prior FOV, and focus framing uses the active camera projection.
- **Verification.** The demo build succeeded; the focused adapter suite passed 15/15. Benchmark v2 run `2026-11-14T20-33-18-818Z_headless-hardware_894a23c3-d02ea780` passed all four automated cases (visual review pending). A browser check observed 42° before, 25° during and 42° after restoration. Local-only stills are under `artifacts/test-runs/capsule-orange-pigtails-benchmark@v2/`; regenerate with `npm run test:run '--' --url http://triangular-demo.localhost:4200/character-studio --suite capsule-orange-pigtails-benchmark --version 2 --profile headless-hardware --noisy`.

### 2026-11-18 — Experimental pigtail head

- **[decision]** Bring the approved pigtail head preview into Character Studio as an experimental human preset. Use the existing facial controller and check the neutral, happy and surprised expressions from the front and at 45° before generating variants.
- **[action]** Added Orange Pigtails (Experimental Head) to the human presets. Its rounded capsule and curls come from the preview. Studio drives the surface mouth, brows, pupils and eyelids through the human actor's existing facial controller and projection.
- **[verification]** Six focused headless specs passed. Captures from the running Studio showed the closed neutral mouth, upward smile and surprised O from both angles. Reset restored the original human and its motion controls. The expression sheet is local and can be regenerated with `node artifacts/concept-turnaround/check-studio-pigtails.mjs` followed by `python artifacts/concept-turnaround/studio-expression-sheet.py`.
- **[verification]** The engine library build passed. The records check reported existing issues in Plans 081, 087 and 088 and reported no issue for Plan 074.

### 2026-11-18 — Experimental pigtail speech

- **[action]** Reused the earlier capsule mouth material on the experimental head. The head's proportions set the mouth position and scale. The same facial controller drives the rim, opening and tongue alongside the expression.
- **[action]** Added a fixed speech line to the Studio expression panel. Browser speech starts the existing text-based mouth animation. If the voice is unavailable, the button still animates the line and shows an explanation. The tongue appears with the mouth opening.
- **[verification]** Seven focused specs and the engine build passed. The demo app needed the cache entry in its own path map before the live build succeeded. Headless Chromium started and finished the native utterance in both views, and the mouth opened, exposed the tongue and returned to rest. The check also exercised reset and the silent fallback. The local contact sheet can be recreated with `node artifacts/concept-turnaround/check-studio-speech.mjs` followed by `python artifacts/concept-turnaround/studio-speech-sheet.py`. The preview uses estimated timing from text.

### 2026-11-18 — Experimental pigtail eyes and Awe

- **[action]** Replaced intersecting eyelid meshes with a continuous eye surface. Rounded the eyelid join visible in profile and attached the lashes to the animated upper eye. The lids cover the pupils during blinks.
- **[action]** Added Awe to the experimental preset. The eyes look upward with pupils about twice their neutral diameter, the brows rise and the mouth parts slightly. Speech drives the mouth while the raised gaze holds, then the mouth settles back into Awe.
- **[verification]** All 24 focused Studio specs and the engine build passed. Reviewed front, 45° and profile captures from the running demo. Live browser interaction checks confirmed speech release, reset and switching to the cat. Local-only contact sheet can be regenerated with `node artifacts/concept-turnaround/check-studio-eyes.mjs` followed by `python artifacts/concept-turnaround/studio-eyes-sheet.py`.

### 2026-11-18 — Seeded pigtail heads

- **[action]** Added Plum (7), Honey (4), and Chestnut (25) to the Studio preset list. One recipe varies head proportions, curl shape, palette and freckle placement. The approved orange preset uses the original proportions and colours. All four use the same facial controller and mouth and eye geometry in head-local coordinates.
- **[verification]** All 28 focused Studio specs and the engine build passed. Returning to a seed reproduced its appearance. Reviewed front, 45° and profile captures and Awe at 45° for each variant. The live browser check observed a blink, speech with visible tongue, and return to Awe on all three seeds. Local-only contact sheet can be regenerated with `node artifacts/concept-turnaround/check-studio-variants.mjs` followed by `python artifacts/concept-turnaround/studio-variants-sheet.py`.
- **[next]** Review the head silhouettes with the owner before choosing body proportions.

### 2026-11-18 — Shared standing body for the pigtail presets

- **[action]** Bruno reviewed the head lineup and approved proceeding with a shared body. The four presets now use one short teal torso, a neck matched to the selected head, and the existing procedural gloves, boots and curved limb meshes in a standing pose. The original preset is now labelled Orange Pigtails (Experimental).
- **[action]** Front, 3/4, Profile and Back frame the entire character. Face frames the head for expression and speech checks.
- **[verification]** All 29 focused Studio specs passed. In the live demo, front, 45° and profile stills showed the same grounded body on all four presets. Face zoomed in, Awe enlarged the pupils, and speech exposed the tongue and returned to Awe on all four. Switching back to the existing human and cat restored their controls. Local-only lineup: `artifacts/concept-turnaround/studio-body-sheet.png`. Regenerate with `node artifacts/concept-turnaround/check-studio-bodies.mjs` followed by `python artifacts/concept-turnaround/studio-body-sheet.py`.
- **[verification]** The engine library build passed. The records check continues to report existing issues in Plans 081, 087 and 088. Plan 074 reported no issues.
- **[next]** Review the full-body proportions before animating the standing rig.

### 2026-11-18 — Synchronized concept and 3D review

- **[finding]** The standing-body implementation was checked for grounded feet, connected limbs and working expressions. Its short teal torso and legs depart from the original full-body Orange Pigtails figure. The head preview gave a more direct visual check by putting the concept next to the live model at corresponding angles.
- **[decision]** Carry the same slider, angle presets and overlay into the next Orange Pigtails body blockout. Use one character to compare the full silhouette to the original art before sharing the proportions across seeds or adding motion.
- **[action]** Prepare one cropped reference per available angle with an explicit yaw, a scale and an anchor. Start with the original pigtail figure. Use front, three-quarter and profile references where available, keeping the pose and proportions consistent. Match the apparent angle in the art. For a standing character, anchor each crop on the floor under the body centre and normalize the reference set using a shared measurement such as head width.
- **[action]** Use one yaw value for both panes. On slider input, orbit the live camera around a fixed target and display the reference cutout with the closest recorded yaw. Label the actual model yaw and cutout angle. Angle buttons set the yaw to a reference exactly. Use the same pixels-per-world-unit scale and baseline in both panes. For overlay, snap to a reference yaw and draw its cutout over the model at about half opacity. Suppress the overlay and show an alignment prompt when the slider moves away from a reference yaw.
- **[action]** Compare the collar join, torso width, exposed leg length and boot size in the matched overlay before judging detail or adding variants. The working head example is local under `artifacts/concept-turnaround/`. Open `blockout-preview.html` to try it. The slider and overlay implementation is in `capsule-compare.mjs`, its markup in `blockout-template.html`, and its browser check in `check-blockout.mjs`. To adapt it, supply the new reference crops and scene model.
- **[verification]** In headless Chromium, the model redrew at a one-degree slider step while the cutout held. The cutout switched when the slider crossed the midpoint to the next reference. The overlay snapped to 45°, cleared at 46° with an alignment prompt, and returned at the 45° preset.
- **[action]** Extracted one transparent full-body Orange Pigtails reference from the original three-quarter concept using ImageGen and built a separate procedural blockout around the approved head. The overlay guided adjustments to the collar and torso widths, boot spacing, glove size and backpack. The concept angle is estimated at 38°. Front and profile currently show the 3D model alongside the fixed concept view.
- **[verification]** Confirmed alpha around the figure and between the legs. Headless Chromium verified the orbit, fixed reference, overlay snapping and narrow layout. Evidence is local under `artifacts/concept-turnaround/`. From the saved cutout, run `node artifacts/concept-turnaround/build-full-body.mjs artifacts/concept-turnaround` to rebuild the fragment. The local browser preview is `full-body-preview.html`.

### 2026-11-18 — Approved full-body spacesuit in Character Studio

- **[action]** Replaced the small teal standing body in `experimental-pigtail-body.ts` with the approved cream spacesuit blockout (`artifacts/concept-turnaround/capsule-full-body.mjs`): cream torso and sleeves, charcoal collar/shoulders/cuffs/gloves/legs, orange chest badge, orange backpack with side panels and nozzles, and chunky cream boots with dark soles grounded on the pedestal. Kept the approved head, expressions, Awe, speech, and seeded head variants.
- **[action]** Deleted the old teal-body renders (`artifacts/concept-turnaround/studio-body-*.png`) and the teal-body image-only experiment output folder (`artifacts/sprite-impostor-poc/`). Preserved the original concept art, approved head assets, and new full-body assets.
- **[verification]** All 10 focused specs in `experimental-pigtail-head.spec.ts` passed. Live Character Studio verification (`node artifacts/concept-turnaround/check-studio-bodies.mjs` + `python artifacts/concept-turnaround/studio-body-sheet.py`) confirmed grounded boots, collar join, three-quarter match to `orange-pigtails-full-body.png`, Awe, speech, and switching back to standard human/cat controls with zero console or page errors.

### 2026-11-19 — Capsule parts workshop

- **[decision]** Prototype a prewired parts graph inside Character Studio. Start with editable procedural Pigtails and Shaggy hair, and show how Hair, Head and Suit feed the live character.
- **[action]** Added the [Parts workshop](http://triangular-demo.localhost:4200/character-studio?workshop=1). Each part has an on-demand 3D preview. The Hair node uses the same hairstyle recipe as the assembled human and provides a rotation slider and an adjustable length for the swept locks. Switching hair preserves the existing body and facial performance.
- **[verification]** Passed 39 focused Studio and sandbox specs and the library build. The live demo rendered all three part previews and passed browser checks for style swaps, lock length, rotation, speech fallback, profile and back views, reopening the workshop, and a 390 px viewport. Screenshots are local only. Regenerate with `node artifacts/concept-turnaround/check-workshop.mjs`.
- **[finding]** The first Shaggy recipe aims for the chunky front sweep and staggered nape in the supplied concept. Desktop and narrow renders were inspected. Developer review of the hairstyle and workshop layout is pending.
- **[follow-up]** Developer review found exposed scalp between the Shaggy crown and fringe from an elevated angle. Extended the crown under the fringe. Added a scalp-coverage spec at minimum, default and maximum lock lengths and inspected elevated views from both sides in the live workshop. Captures are local only. Regenerate with `node artifacts/concept-turnaround/check-shaggy-crown.mjs`.
- **[follow-up]** The developer confirmed the crown fix. Compared the existing Shaggy concept with the live character geometry at an estimated 32° yaw and 9° elevation. Widened the swept locks, varied their lengths, and extended the nape in the workshop. The comparison includes an optional proportion study with a shorter suit, taller head, slightly larger eyes, and a more open grin. The study is for review before making a selectable preset.
- **[verification]** All 40 focused Studio and sandbox specs and the library build passed. Checked the workshop hair swap, speech, length slider, and elevated crown views in the running demo. The concept comparison uses the existing supplied image and local renders. The comparison and captures are local only. Regenerate with `node artifacts/concept-turnaround/build-shaggy-review.mjs` and `node artifacts/concept-turnaround/check-shaggy-review.mjs`.
- **[finding]** Developer rejected the first Shaggy fit and supplied a four-view T-pose sheet. It shows a layered silhouette on both sides of the head and dark hair covering the rear scalp nearly to the collar. The views labelled as sides show both eyes and were treated as oblique estimates.
- **[action]** Rebuilt the Shaggy fringe, crown, and rear layers in the workshop. Added side ears and rounded eye whites to the Shaggy assembly, with the eyelid animation still driven by the face controller. Built a local T-pose comparison that syncs model rotation with the four source panels at 0°, 54°, −69°, and 180° and labels intermediate views as nearest references. Used the existing rig for the pose and explored a wider pack and adjusted body and head proportions in the comparison. The proportion study is pending developer review. No new images were generated.
- **[verification]** All 41 focused Studio and sandbox specs and the library build passed. The new rear scalp test checks both ends of the lock-length range. The comparison switched all four panels, orbited between them, and fit a 320 px viewport in the embedded browser preview. The supplied sheet, comparison, and captures are local only. Regenerate with `node artifacts/concept-turnaround/build-shaggy-turnaround.mjs` and `node artifacts/concept-turnaround/check-shaggy-turnaround.mjs`.
- **[verification]** The running workshop passed the hair swap, speech, rotation, and narrow-layout checks. The revised crown stayed covered at the original elevated review angle. Local captures regenerate with `node artifacts/concept-turnaround/check-workshop.mjs` and `node artifacts/concept-turnaround/check-shaggy-crown.mjs`.
- **[action]** Set Shaggy's ears farther back into the gaps in the temple hair. Gave each ear an outward-facing rim, recessed bowl, and narrower lobe. The turnaround comparison uses the same ear geometry as the workshop.
- **[verification]** All 42 focused specs and the library build passed. The new spec checks that the ear bowl sits behind its rim on both sides. Checked the rebuilt workshop and inspected both three-quarter views in the turnaround. At maximum lock length, the locks can cover the ear in profile. Local captures regenerate with `node artifacts/concept-turnaround/check-workshop.mjs` and `node artifacts/concept-turnaround/check-shaggy-turnaround.mjs ears`.
- **[follow-up]** Turned the ear rims to 90° from the forward face direction and reduced the depth, embedding the back of each ear into the temple. The updated spec checks the side-facing orientation, embedded depth, and exposed bowl. All 42 focused specs and the live workshop check passed. The front and three-quarter turnaround renders were inspected. Local captures regenerate with `node artifacts/concept-turnaround/build-shaggy-turnaround.mjs` and `node artifacts/concept-turnaround/check-shaggy-turnaround.mjs flush-ears`.
- **[decision]** The developer accepted Shaggy's overall appearance in the turnaround and flagged the hands for follow-up. This completes the Parts Workshop review. The proposed next slice is to carry the reviewed proportions into a selectable Shaggy preset and run the existing walk on it. Revisit the glove shape and wrist alignment with open-hand gestures and prop grips.

## 2026-11-21 — Classic Stache shape editing

- **[decision]** Prototype direct shape editing in the Parts Workshop using Classic Stache. Fit a short swept hairstyle and an independently removable mustache, then expose a fringe tip and mirrored mustache tips as handles. Use the supplied three-quarter reference locally and share the turn angle with the assembled preview.
- **[action]** Added the Classic Stache workshop entry and a close-up with drag handles and arrow-key controls. The fringe keeps its root fixed and the mustache mirrors the edited tip. Only the affected strand meshes are rebuilt. The authoring view shares its turn angle with the full character and uses an approximate 30° match for the supplied still. Edits and the uploaded reference live in the open page.
- **[verification]** Passed 55 focused Studio and sandbox specs, the engine build, and the demo rebuild. A live Chromium check exercised both drags, keyboard edits, actual camera synchronization, mustache toggle, reset, speech playback and the 390 px layout. The wider demo suite disconnected in Karma. Visual acceptance against the supplied art is pending. Local-only evidence under `artifacts/classic-stache/`. Regenerate with `python artifacts/classic-stache/crop-reference.py <concept-sheet>` and `node artifacts/classic-stache/check-workshop.mjs` while the demo is running.
- **[action]** Narrowed the mustache and lowered its tips. The mesh builder applies the workshop's limits to generated offsets as well as pointer edits. Replaced the crown base with a cap built from the head's own scalp profile and moved the loose temple lock up and back into that cap.
- **[decision]** Use front-view clearance around the eye whites to fit Classic Stache, and check at the limit of each editable dimension. Use the scalp profile to carry the hair between locks and anchor the lock roots under its surface. Refit the clearance range if a future face places or sizes the eyes differently.
- **[verification]** The 57 focused Studio and sandbox specs passed. After aligning the handle with clamped offsets, all 17 head specs passed again. The live workshop check passed, and the front renders showed clearance at the widest and highest edit while both elevated views showed the closed crown and rooted lock. Local-only captures regenerate with `node artifacts/classic-stache/check-fit.mjs` while the demo is running.
- **[decision]** The developer accepted the revised Classic Stache fit. Close the shape-editing prototype with the existing drag, synchronized angle and speech checks. A proposed follow-up is one short beard on the same face to test whether the fitting workflow carries over to a part that follows the jaw and leaves the speaking mouth visible.

## 2026-11-21 — Short beard fit

- **[decision]** Fit the rounded, layered beard in the developer's supplied three-quarter reference as a separate part on the workshop head. Reuse the synchronized view, check the side joins, and keep the existing animated mouth clear.
- **[action]** Fitted a jaw-following base with clay locks and an opening around the shared speaking mouth. The beard can be toggled alongside any workshop hairstyle. The short-beard link opens on Shaggy with a neutral face and an approximate 32° reference angle. The supplied art remains a local upload.
- **[verification]** Passed 59 focused Studio and sandbox specs and the engine build. The new checks sample A, E and O mouth shapes from the front and both three-quarter views for beard coverage. Live browser checks passed for synchronized camera angles, reference loading, hairstyle swaps, speech preview, narrow layout and the Classic Stache handles. Reviewed front, three-quarter and profile renders. Evidence is local only. With the supplied reference at `artifacts/short-beard/short-beard-reference.png` and the demo serving, regenerate the renders with `node artifacts/short-beard/check-workshop.mjs`.
- **[decision]** The developer accepted the beard fit and called out that Shaggy's light brown beard and charcoal scalp hair should share a natural colour. Keep the natural colour on the character so cosmetic scalp or facial hair overrides can be added independently later.
- **[action]** Added a natural hair colour control to the workshop. Hair, brows, beard and mustache take their shades from the selected colour. The assembled character and part previews share the selection. Adding a beard or picking a colour keeps that value through hairstyle swaps.
- **[verification]** Passed 60 focused Studio and sandbox specs. The live short-beard check confirmed the charcoal default, picker updates across the assembled character and both part previews, and colour retention across hairstyle changes. The Classic Stache workshop check also passed.

## 2026-11-21 — WebGPU bob lock

- **[decision]** Test one rounded side lock against the supplied bob concept. Use TSL vertex shaping on native WebGPU and adjust the hem with a uniform. Keep the root and mesh buffers fixed through the length range.
- **[action]** Added the [WebGPU bob lock prototype](http://triangular-demo.localhost:4200/bob-hair-lock-spike) to the demo and spikes catalogs. TSL sweeps a rounded profile along a curve on the workshop scalp and lights it with normals computed from the surface. The angle slider turns the scalp and lock together.
- **[verification]** Native WebGPU rendered the short, default and long settings from the front, three-quarter and profile views. Rendered comparisons confirmed the crown stayed fixed while the hem moved. The same mesh and material stayed live through the edits. Browser checks passed for both catalog entries and the narrow layout. All 61 focused specs and the engine build passed. Evidence is local only. With the demo serving, regenerate with `node artifacts/bob-hair-lock/check-demo.mjs` and compare the captured frames with `python artifacts/bob-hair-lock/check-pixels.py`.
- **[finding]** The side lock's curved crown and rounded end are viable at a single-lock scale. Fitting the full bob will require overlapping side and back locks and an independently shaped fringe. The full character's WebGPU rendering is a separate integration step.

## 2026-11-22 — Bob lock silhouette

- **[finding]** The developer saw the first lock follow the head too closely. The reference bob flares away from the scalp at the bottom and has a broader, blunter hem.
- **[decision]** Keep the crown attachment and give the lower guide its own outward flare. Test the shape with a rounded hem in the existing WebGPU prototype. A subtractive operation remains an option when fitting a solid cap that needs a cavity for the face and scalp.
- **[action]** Added a Hem flare slider independent of Lock length and widened the lock near the rounded cut. The shader applies both edits below the crown on the existing parameter grid.
- **[verification]** The focused demo spec, demo build and engine build passed. The built app passed headless Chrome checks on native WebGPU for angle, length and flare, mesh identity and narrow layout. At fixed length, moving from 0% to 100% flare left the crown pixels identical and shifted the lower outline 77 pixels outward at the test viewport size. Evidence is local only. With the demo serving, run `node artifacts/bob-hair-lock/check-demo.mjs` and `python artifacts/bob-hair-lock/check-flare.py`. For a preview without the demo server, run `node artifacts/bob-hair-lock/build-offline.mjs` and open `artifacts/bob-hair-lock/bob-lock-preview.html` in a WebGPU browser.
- **[action]** Added a local full-volume bob study with a crown, open face and flared side/back shell, alongside the supplied three-quarter concept. Length, flare and viewing angle are adjustable. The concept remains a fixed view, so only nearby angles are directly comparable. This is an early blockout for silhouette review; the fringe, facial features, rounded hem and strand detail remain to be fitted. Local-only preview can be regenerated with `node artifacts/bob-hair-lock/build-silhouette.mjs` and checked with `node artifacts/bob-hair-lock/check-silhouette.mjs`.
- **[finding]** The initial separate crown and skirt had mismatched radii and allowed the head to protrude through the back. Replaced them with one connected parametric surface for the study. Its geometry is generated on the CPU and rendered with WebGPU. The head no longer shows through in the checked rear view at minimum flare. Further visual review across the range is needed.

## 2026-11-22 — Bob in the parts workshop

- **[action]** Ported the approved continuous bob study into the experimental character's interchangeable hair, retaining its five shape parameters and default values. The assembled head and miniatures share the same shape and natural hair colour. Geometry is CPU-generated and compatible with either renderer; the existing studio remains WebGL.
- **[verification]** The focused character spec verifies matching character and miniature geometry, shared colour and shape updates; owner review of silhouette, expression and movement remains pending.

## 2026-11-22 — Parametric Brep bob study

- **[decision]** Try a standalone CAD hair part against the supplied front, side and back turnaround, using the workshop head and its Three.js bob as the comparison.
- **[action]** Added a closed CAD cap with a continuous revolved profile and a cut face opening. Side length, flare and fringe length are independent inputs. The offline comparison uses the existing face and draws both bobs from synchronized angles. The fringe scallops are part of the solid. The groove toggle adds shading in the preview.
- **[verification]** The default and all eight combinations of minimum and maximum inputs passed `brep verify --check`. In headless Chrome the default and both combined extremes each rendered as a single valid solid. Each slider changed the CAD rendering independently. Reset, groove shading, view switching and narrow layout worked. The bracket verification, preview type check and engine build passed. Evidence is local only. From the repo root run `node projects/brep-poc/studies/capsule-bob/verify.mjs` for geometry reports and `node projects/brep-poc/studies/capsule-bob/build.mjs artifacts/brep-bob/reference.png` for the offline preview. Use the retained local `check.mjs` and `comparison.py` in `artifacts/brep-bob/` to recreate the contact sheet.
- **[finding]** The CAD cap follows the turnaround's narrower outline and blunt hem on the default head. The profile and face cut make the major dimensions straightforward to edit. The reference has fuller, more clearly separated locks, especially in profile. Rebuild plus validation and rendering took roughly a second in the local headless preview. This supports trying CAD for offline variants. Live editor performance and animated or helmet fit remain open.
- **[action]** Added two rounded cuts per side where the shaded grooves meet the hem. The depth follows the hem as side length changes. The preview now opens in profile with a 15 mm default. Setting depth to zero restores the smooth hem.
- **[verification]** The default passed `brep verify --check`. The study's verification script also checked for one valid solid and the expected vertical bounds at the default, the smooth default, and all eight length, flare and fringe extremes with 0, 1 and 27 mm cuts. The browser comparison confirmed visible cuts with groove shading disabled. Side comparison evidence is local only. Recreate it with `node artifacts/brep-bob/check.mjs` and `python artifacts/brep-bob/hem-comparison.py artifacts/brep-bob/side-reference.png`.

## 2026-11-22 — Parametric Brep space buns

- **[action]** Fitted a cap, swept fringe, side locks and rear layers to the workshop head. The two fluted buns and their ties share one mirrored recipe. The Classic and Full presets differ in bun size, individual bun placement and side-lock length.
- **[finding]** Smooth lofts through oriented sections made the locks reusable. The initial fit still needed visual work, especially around the back seam. A valid CAD body could produce an incomplete mesh, so the bake checks each body's vertex bounds against its CAD bounds and retries with finer meshing when needed. The baked files use the workshop's unscaled Y-up head coordinates and two materials. The preview loads the GLBs directly without loading a CAD kernel.
- **[verification]** Both presets passed `brep verify --check`. The part also produced 15 valid solids at the default and at all 16 combined parameter extremes. The browser rendered both baked presets from front, three-quarter, side and back. The close-up exports contain 23,525 and 25,385 triangles respectively. The preview type check, bracket verification and engine build passed. Character Studio integration and crowd performance remain open.
- **[reproduce]** The preview and models are local under `artifacts/brep-space-buns/`. From the repository root, run `node projects/brep-poc/studies/capsule-space-buns/build.mjs` to bake both GLBs and the offline preview. Pass the concept PNG path as the optional first argument to include it in the preview. Run `node projects/brep-poc/studies/capsule-space-buns/verify.mjs` to repeat the parameter checks. The local `check.mjs` and `turnaround.py` in the artifact folder regenerate the stills and contact sheet.

## 2026-11-22 — Parametric Brep swept hair and mustache

- **[action]** Fitted an asymmetric swept crown and layered nape to the workshop head. The crown sweep and rear length move the lock tips while keeping their roots attached. The mirrored mustache is a separate GLB, shared by both baked hair presets. The preview uses the workshop's existing Classic Stache face and mouth placement.
- **[finding]** The same oriented-section loft function worked for the space buns, swept locks and curled mustache. The front and side checks still drove the fit. An arched trim and two shorter nape locks softened the visible scalp-cap edge. Authoring and baking share the space-bun loft function and tessellation coverage check.
- **[verification]** Both presets passed `brep verify --check`. The default and all four parameter corners produced 19 valid hair bodies and two valid mustache bodies. The offline browser loaded both styles and the shared mustache without network requests. Checked front, three-quarter, side and back, happy and surprised mouths, the mustache toggle, and mobile layout. The preview type check and engine build passed. Hair exports contain 23,961 and 24,013 triangles. The mustache adds 1,204. These are close-up assets. Character Studio integration and crowd use remain open.
- **[reproduce]** Run `node projects/brep-poc/studies/capsule-swept-hair/build.mjs` from the repository root to regenerate the offline preview and three GLBs under `artifacts/brep-swept-hair/`. Pass the supplied concept PNG path as the first argument to include it. Run `node projects/brep-poc/studies/capsule-swept-hair/verify.mjs` for the geometry checks. Local stills can be regenerated with `node artifacts/brep-swept-hair/check.mjs` and `python artifacts/brep-swept-hair/turnaround.py`.

## 2026-11-22 — Swept hair silhouette and preview orbit

- **[action]** Reworked the loft profiles to make the crown fuller and arch the side locks from temple to cheek, with a forward curl under each ear. The sweep and length controls still make both presets from one recipe. The length now extends the side and rear locks together.
- **[action]** Added a shared orbit and zoom controller to the swept hair, bob, space buns and space cat studies. Drag or zoom either comparison panel to move all cameras on its page. The angle buttons restore the selected angle and default zoom.
- **[verification]** Both revised presets passed `brep verify --check` and the default and four combined extremes passed the geometry check. The revised hair GLBs contain 26,345 and 26,613 triangles. The offline preview still renders both expressions and toggles the mustache. The four previews passed the linked pitch, wheel zoom and reset checks. The swept-hair preview also passed simulated two-finger pinch. The preview type check and engine build passed.
- **[reproduce]** Rebuild the four standalone previews with their `build.mjs` scripts, then run `node projects/brep-poc/studies/verify-preview-orbit.mjs`. The front and side comparison is local under `artifacts/brep-swept-hair/silhouette-comparison.png`. Regenerate it with the sweep study capture and `turnaround.py` above, using `turnaround-before.png` from the first bake.

## 2026-11-22 — Swept hair fringe and profile

- **[action]** Moved the fringe tips and narrowed their final sections so they taper over the forehead. Reworked the rear locks to round out high, tuck toward the nape and then sweep backward and up. Extended the scalp cap under the rear layers to cover gaps between them.
- **[finding]** Several tightly spaced profiles let the smooth loft overshoot. Wider spacing and an explicit width direction kept sections aligned through the rear turn. Easing the length offset near the tips preserved their upward direction as the locks lengthened.
- **[verification]** Both presets passed `brep verify --check` and rendered in the offline preview. Section checks at the default and four parameter extremes confirmed that the three fringe tips narrow and that the rear silhouette tucks in and rises again. The hair GLBs contain 29,309 and 29,355 triangles.
- **[reproduce]** The local comparison at `artifacts/brep-swept-hair/fringe-profile-comparison.png` uses the original reference, the saved `profile-previous.png` and `three-quarter-previous.png`, and the current renders. Run the existing build and capture scripts, then `python artifacts/brep-swept-hair/turnaround.py`.

## 2026-11-22 — Space cat body: single loft replaced with a fused two-lobe solid

- **[action]** The space cat silhouette part now builds the head and body as two overlapping ellipsoids fused into one solid, with a fillet along the join, instead of lofting one oval profile from muzzle to rump. `headRise`, `cheekFullness`, `headSetback` and `joinFillet` control it; the rig anchor follows the head's setback so the face still lands on the head.
- **[finding]** A single loft cannot reproduce the reference. One oval per section has to be the ball head and the barrel body at the same time, so the head either tapers into a long wedge (which reads as a muzzle) or the chest bulges under the jaw. Making the top and bottom the union of the two lobes fixes the side outline but leaves the section, and therefore the front view, too tall and narrow. The reference is two balls with a crease, which is what the fused version is.
- **[finding]** The reference's head and body overlap more deeply than the actor's anchors allow. The head's centre sits 426 mm ahead of the torso origin and the tail base 280 mm behind it. Setting the head back 160 mm to deepen the overlap collapses the head into the body instead of producing the reference's proportions, so closing the remaining gap is an actor-proportion change, not a CAD one.
- **[verification]** Default and nine parameter cases pass `brep verify --check`; one valid manifold solid, volume 288.6 M mm³, bounds x ±345, y −727…340, z −360…460 mm. The three baked GLBs contain 8,451, 8,595 and 6,286 triangles.
- **[reproduce]** `node projects/brep-poc/studies/capsule-space-cat-silhouette/verify.mjs`, then `build.mjs` and `capture.mjs`; the orbitable preview is `artifacts/brep-space-cat-silhouette/preview.html`.

## 2026-11-22 — Space cat body: tube and sphere, with the fat cat kept as an option

- **[action]** Added `capsule-space-cat-tube.brep.ts`: a capsule body with the Concept Fit head ellipsoid fused on and a fillet bevel on the join ring. `bodyLength` is the single length control (560–1100 mm), with `tubeRadius`, `headRise` and `joinFillet` alongside. The earlier fused-two-balls part is kept as `capsule-space-cat-fat.brep.ts` and stays available in the preview.
- **[finding]** A fused tube and sphere reproduces the Concept Fit's body without its mesh join: the tube's front cap is buried in the head, so the only intersection is the ring where the tube's side meets the ball, and the fillet blends that ring. A capsule cannot be shorter than twice its radius, so the builder holds a 40 mm straight run as the lower bound.
- **[finding]** At first the tail and hind legs kept the actor's anchors while the body length changed: bodies below about 780 mm left the tail behind the rump, and longer bodies swallowed its base.
- **[action]** Added a `rearExtension` option to the Concept Fit builder (`experimental-space-cat.ts`). The tube's front tip is fixed inside the head, so a length change only moves the rump; the study passes the rump offset against the 900 mm default, and the hind-leg sockets and ankles plus the whole tail pose slide by it. The front legs and head stay put, and the hind paw keeps its stock distance from the rump at every length.
- **[verification]** Both parts pass `brep verify --check` and 22 case checks (defaults, each parameter at both limits, all-min and all-max corners). Tube at the 900 mm default: one valid manifold solid, 276.1 M mm³, bounds x ±318, y −727…520, z −280…460 mm, 10,023 triangles. Fat cat: 288.6 M mm³, 8,451 triangles. The focused demo spec asserts a 0.2 m rear extension moves the hind paw by −0.2 m and the front paw not at all, and the preview comparison at 780, 900 and 1100 mm shows the rear anchors on the rump.
- **[reproduce]** `node projects/brep-poc/studies/capsule-space-cat-silhouette/verify.mjs`, then `build.mjs` and `capture.mjs`; preview at `artifacts/brep-space-cat-silhouette/preview.html`.

## 2026-11-23 — Space cat body: 50% wider join bevel

- **[action]** Raised the tube body's `joinFillet` default from 90 to 135 mm at Bruno's request. The bevel blends the head-to-tube ring over half again the distance; the rest of the silhouette is unchanged.
- **[finding]** At `bodyLength` 1100 with `tubeRadius` 340 the fused join ring cannot be filleted at any bevel, including the previous 90 mm, so that corner was already outside the usable parameter space. Capped `tubeRadius` at 330 mm, the largest radius that passes every limit and corner.
- **[verification]** `brep verify --check` passes at defaults and all 22 study cases pass for both parts (defaults, each parameter at both limits, all-min and all-max corners). Default body 900 mm with the 135 mm bevel: 276.8 M mm³ and 9,553 triangles, against 276.1 M and 10,023 at 90 mm. The preview and all four comparison views were rebaked.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-change id="SC-074-PERF" date="2026-10-31" kind="addition" origin="requested" disposition="accepted" scope-ids="character-performance-matrix" -->
- Summary: Add a Character Studio performance matrix for one and many capsule humans across idle, walk-cycle and scene-path motion.
- Reason: Visual verification demonstrates appearance and motion but does not establish frame performance or scaling cost as more human actors are displayed and updated.
- Impact: Add reproducible population cases and diagnostic CPU, frame-cadence and renderer-counter measurements; keep performance runs separate from video recording and visual verdicts.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-HAIR" date="2026-10-31" kind="addition" origin="requested" disposition="accepted" scope-ids="hair-generation-coverage,hair-motion-and-helmet" -->
- Summary: Add later visual-verification phases for procedural hair generation, walking behavior and clear dome-helmet fit.
- Reason: Hair is a prominent procedural feature whose silhouette and attachment need close-up multi-view review; walking and helmet cases can expose motion, clipping and occlusion issues that ordinary character sheets miss.
- Impact: Extend Plan 074 with deterministic hair-focused evidence and targeted correction work while leaving physics-based simulation undecided.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-PIGTAIL-HEAD" date="2026-11-18" kind="addition" origin="requested" disposition="accepted" scope-ids="experimental-pigtail-head" -->
- Summary: Add the approved procedural pigtail head as an experimental human preset in Character Studio.
- Reason: Check that the approved head can change expression before building a family of variations.
- Impact: Port the head geometry to the demo app and use the existing facial controller to verify neutral, happy and surprised expressions at two angles.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-PIGTAIL-SPEECH" date="2026-11-18" kind="addition" origin="requested" disposition="accepted" scope-ids="experimental-pigtail-speech" -->
- Summary: Fit the V1/V2 mouth to the experimental pigtail head and preview speech in Studio.
- Reason: The earlier render showed a shaded opening, upper teeth and tongue during speech. The experimental head's surface mouth lost those details.
- Impact: Reuse the existing capsule renderer and facial controller in the experimental preset and verify speech and expressions from two views.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-PIGTAIL-EYES" date="2026-11-18" kind="addition" origin="requested" disposition="accepted" scope-ids="experimental-pigtail-eyes" -->
- Summary: Refine the experimental pigtail head's eyelids and add an Awe expression.
- Reason: Owner screenshots showed angular eyelid edges at oblique angles. Oversized, upward-looking pupils give the character a way to react to something overhead.
- Impact: Update the experimental preset's eye surface and expression options in Character Studio.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-PIGTAIL-VARIANTS" date="2026-11-18" kind="addition" origin="requested" disposition="accepted" scope-ids="experimental-pigtail-variants" -->
- Summary: Add three repeatable variations of the approved concept head to Character Studio.
- Reason: Check whether a shared procedural recipe can generate distinct characters with the same expressive face.
- Impact: Parameterize the head and curls within bounded ranges, and check alternate proportions, palettes and freckles with the existing animation.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-PIGTAIL-BODY" date="2026-11-18" kind="addition" origin="requested" disposition="accepted" scope-ids="experimental-pigtail-body" -->
- Summary: Fit the four reviewed pigtail heads to one small capsule body in Character Studio.
- Reason: Check that the approved head proportions still read well once the characters have torsos, hands and feet.
- Impact: Use one standing body and head attachment across the presets. Fit the wide camera views to the whole character and retain the head close-up.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-PARTS-WORKSHOP" date="2026-11-19" kind="addition" origin="requested" disposition="accepted" scope-ids="capsule-parts-workshop" -->
- Summary: Add a capsule character parts graph with small 3D previews and interchangeable hair.
- Reason: Compare distinct concept-art hairstyles on the same animated character and see how the parts assemble.
- Impact: The app-local workshop adds a hairstyle recipe and previews of the shared head and suit.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-STACHE-FIT" date="2026-11-21" kind="addition" origin="requested" disposition="accepted" scope-ids="classic-stache-shape-editing" -->
- Summary: Try direct editing of two swept procedural parts in the workshop.
- Reason: Evaluate whether editing against concept art makes small shape changes faster.
- Impact: App-local prototype on the existing expressive capsule rig.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-SHORT-BEARD" date="2026-11-21" kind="addition" origin="requested" disposition="accepted" scope-ids="short-beard-fit" -->
- Summary: Fit one interchangeable short beard from the supplied concept in Parts Workshop.
- Reason: Check whether the concept-fitting workflow extends to facial hair that wraps the jaw and borders the animated mouth.
- Impact: Use the existing capsule head and rotation comparison, and keep the beard available separately from the hairstyle.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-WEBGPU-BOB-LOCK" date="2026-11-21" kind="addition" origin="requested" disposition="accepted" scope-ids="webgpu-bob-lock" -->
- Summary: Prototype GPU shaping for one rounded bob lock on the workshop scalp.
- Reason: Check whether a curve-driven lock can keep its attachment and a convincing silhouette as its length changes.
- Impact: Isolated WebGPU demo with length and angle controls.
<!-- /tri:scope-change -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- tri:scope-change id="SC-074-BREP-BOB-STUDY" date="2026-11-22" kind="addition" origin="requested" disposition="accepted" scope-ids="brep-bob-study" -->
- Summary: Prototype a parametric Brep bob on the existing capsule head.
- Reason: Check whether CAD makes shape variations easier to author while preserving the intended appearance and fit.
- Impact: Add an isolated CAD part and visual comparison using the existing character as a baseline.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-BREP-SPACE-BUNS-STUDY" date="2026-11-22" kind="addition" origin="requested" disposition="accepted" scope-ids="brep-space-buns-study" -->
- Summary: Fit and bake two CAD space-bun presets on the workshop head from one recipe.
- Reason: Test whether reusable curved locks are practical for more sculpted concept hairstyles.
- Impact: Add an isolated CAD part and a standalone baked-asset comparison.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-BREP-SWEPT-HAIR-STUDY" date="2026-11-22" kind="addition" origin="requested" disposition="accepted" scope-ids="brep-swept-hair-study" -->
- Summary: Fit a swept crown, layered rear locks and a separate curled mustache to the workshop head.
- Reason: Try the curved loft workflow on an asymmetric concept and check whether facial hair fits the animated face.
- Impact: Add a parametric CAD model and an offline preview of baked variations.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-BREP-HAIR-FEEDBACK" date="2026-11-22" kind="change" origin="requested" disposition="accepted" scope-ids="brep-swept-hair-study" -->
- Summary: Round out the crown and shape the side locks so they curve under the ears.
- Reason: The first bake looked flat at the crown and finished too high beside the face.
- Impact: Reshape the lock profiles while preserving the two preset controls and separate mustache.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-BREP-STUDY-ORBIT" date="2026-11-22" kind="addition" origin="requested" disposition="accepted" scope-ids="brep-study-orbit" -->
- Summary: Add synchronized orbit and zoom to the standalone CAD studies.
- Reason: Inspect the fit between fixed comparison angles and make close-up checks easier.
- Impact: Add shared preview controls for the hair and space-cat studies.
<!-- /tri:scope-change -->
<!-- tri:scope-change id="SC-074-BREP-FRINGE-PROFILE" date="2026-11-22" kind="change" origin="requested" disposition="accepted" scope-ids="brep-swept-hair-study" -->
- Summary: Taper the fringe tips and carry the side silhouette through an inward bend and lift at the nape.
- Reason: The fringe widened where it hooked over the forehead, and the side view was missing the rise at the ends.
- Impact: Rebuild both presets and check the tip taper and the profile at the parameter limits.
<!-- /tri:scope-change -->
<!-- /tri:scope-history -->
