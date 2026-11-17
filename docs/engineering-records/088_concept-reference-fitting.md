---
type: EngineeringRecord
title: "Concept reference fitting"
description: "Dated decisions, findings and evidence for Concept reference fitting."
timestamp: 2026-11-16T00:00:00Z
tags: [engineering-records, procedural, characters, testing]
record_id: er-088
scope_history_schema: 1
plans:
  - /docs/plans/088_concept-reference-fitting.md
performance: []
---

# Engineering Record 088: Concept reference fitting

Plan: [PLAN-088](/docs/plans/088_concept-reference-fitting.md).

## 2026-11-16 — Starting

**Goal.** Measure concept art once, fit camera and generator parameters to it, and gate procedural characters and
parts on numbers, so that a human approves one measurement overlay per reference set instead of comparing two
pictures on every pass.

**Why now.** Four passes on one benchmark head under [ER 074](/docs/engineering-records/074_procedural-character-studio.md)
each needed a developer round trip. Concept landmarks and render landmarks were both placed by hand, the concept's
camera was unknown, and a change to a shared eye constant altered other presets without a check. Every suite
reports an automated pass that only means the case ran. [Plan 068](/docs/plans/068_procedural-shape-verification.md)
is the intended verification layer but none of its phases is built, and it excludes hair and cloth.

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/088_concept-reference-fitting.md).

**Checks.** None yet. Functional, performance and human visual evidence will be recorded separately.

## History

### 2026-11-16 — Direction (agent proposal; the developer asked for this draft, scope is not baselined)

The developer asked for a plan to turn concept art into procedural assets with fewer human checkpoints, for capsule
humans first and then cats and vessel parts, and asked whether to reuse or restart the first capsule-human attempt.

**What the concept sheets show** (eight sheets in a consumer app's concept folder, all viewed):

- The sheets disagree with each other. Bodies are tall pills on one variant sheet, shorter beans that widen below
  the collar on another, and egg-shaped on the turnaround. Eye diameter relative to head width varies between
  sheets, and in several full-body figures the two eyes together are wider than the head.
- The headshots-and-angles sheet gives four heads in five views (front, three-quarter, profile, up, down). It is
  the richest multi-view reference and the reason the head is the first asset.
- Three hair sheets show front, side and back on a bald head at one scale, which makes the head usable as a ruler
  for hair. Every style is a mix of four building blocks: leaf-shaped tufts, blob clusters, smooth grooved shells
  and long strands.
- Pupils are small dots, often pointing in different directions. Mouths are sculpted in the art; the existing
  shader-drawn mouth is an accepted simplification.
- There is no clothing art beyond the suit, collar, helmet, jetpack and accessories, and no run or pick-up poses.

**Findings in the current code** (read, not run):

- Face placement is computed inside the Three.js face rig with fixed multipliers and a floor on eye angle
  (`max(0.45, eyeSpacing * 1.72)`), so a parameter change below the floor has no effect and no test reports it.
- The DNA has one spacing value and one eye scale; it does not express the ratios a person would measure on the
  art (eye diameter over head width, eye centre height, protrusion).
- Hair is built as one mesh per lock in loops, and space gear has about fifty mesh construction sites. This is
  consistent with the stale 31 Oct measurement of about 200 draw calls and 97k triangles per human
  ([ER 079](/docs/engineering-records/079_playable-capsule-human-sandbox.md)); that run predates the hair rebuild
  and did not record its GPU adapter, so it is an order of magnitude only.
- The body material patches a standard material with GLSL through `onBeforeCompile`. Whether it works under the
  WebGPU renderer is open item I3 in [Plan 086](/docs/plans/086_island-crowd-navigation.md).
- The benchmark renders on a dark floor while the concept is soft clay on cream, so part of the perceived mismatch
  is lighting, not shape.

**Chosen approach for this plan.** Measure ratios in the subject's own units, have the generator report exact
landmarks, and solve camera and shape together. The fit needs only projection mathematics, so it runs in Node in
seconds with no browser. A view that cannot be fitted is evidence that the art is inconsistent, not a target.

**Alternatives not chosen:**

- Continue per-pass visual comparison with hand-placed landmarks: this is what was slow.
- Build all of Plan 068 first: its reference spec is an orthographic three-view drawing, which suits hard-surface
  parts but must be traced by hand for each character, and it does not cover hair.
- Vision-model scoring as the gate: not repeatable enough; kept as an advisory pairwise judgement.
- Pixel or image-similarity comparison against concept crops: dominated by lighting, camera and pose.

**Reuse or restart (recommendation, outside this plan's scope).** Keep the framework-free core: locomotion, face
controller, visemes, reach, poses and the DNA concept, with face parameters re-expressed as measured ratios (the
preset-regression phase). Rebuild how a character is drawn: merged or instanced geometry, hair as instanced
building blocks, eyes and lids as few instanced shapes, and a body material in the WebGPU shading language. The
existing actor stays until the new one matches it; that comparison is render against render with exact cameras, so
this plan's probes and ID-colour mode make it automatic.

**Candidate later plans** (each needs its own pair and the developer's go-ahead):

1. Capsule character render rebuild and crowd tiers, after a fresh per-part cost measurement (Plan 079 A2) and
   the answers to Plan 086 I2 and I3. Needs a target device and frame budget from the developer.
2. Hair generator from the four building blocks, verified by the organic-silhouette phase.
3. Clothing and gadgets, which first need concept sheets in a fixed layout.
4. Expression, speech and motion checks: an agent names each emotion from a still, viseme shapes are measurably
   distinct, feet do not slide during stance, and a reaching hand lands on its target.
5. Capsule cats on the same pipeline (Plan 070), after the second-asset-class phase.

**Relationship to Plan 068.** Plan 068 stays the hard-surface branch. Its `capsule-character-spike` phase overlaps
this plan's head and body phases; no change is made to Plan 068 now. The second-asset-class phase ends with a
proposed scope change for it.

**Starting thresholds.** A residual of about 3% of head width is a starting guess only. The calibration phase sets
the real values from mutation margins.

**Checks.** After drafting, the plan's review fingerprint was refreshed with reviewer `agent` (this is not
developer approval) and `triangular docs records check` reported nothing for Plan 088. It reported three existing
errors in Plans 081 and 087, which were left alone.

### 2026-11-16 — Model assignment by phase (agent proposal, a judgement and not measured)

The developer asked which model tier should do which phase. The metered frontier model does no phase work: under
the oracle-question rules implementation, reviews and first-try debugging are not oracle questions. It is kept for
named decisions that pass that test.

| Phase                | Lead   | Support                                                         | Escalate when                                                           |
| -------------------- | ------ | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| concept-measurement  | Opus   | Sonnet: crop manifest, overlay board, ER entry                  | —                                                                       |
| model-probes         | Sonnet | —                                                               | To Opus if probes and the ID-colour render still disagree after one fix |
| camera-and-shape-fit | Opus   | Sonnet: fit report and board                                    | Nominate an oracle question if two different formulations fail the synthetic recovery test |
| calibration          | Opus   | Sonnet: run the wrong variants and tabulate                     | The go or no-go is the developer's decision                             |
| preset-regression    | Opus   | Sonnet: convert presets, regression command. Haiku: later runs  | See the candidate below                                                 |
| organic-silhouette   | Opus   | Sonnet: reports and overlays. Haiku: advisory pairwise judging  | To Opus if Haiku's judgements disagree with a spot-check sample         |
| body-proportions     | Sonnet | —                                                               | To Opus if the head tools do not transfer to whole bodies               |
| second-asset-class   | Sonnet | Opus: the scope-change proposal for Plans 068 and 070           | —                                                                       |

Reasons: Opus leads where the open investigations sit (I1 in measurement, I2 in the fit) and where a design choice
shapes later phases. Sonnet leads bounded work that has an objective test. Haiku only repeats a finished procedure:
rerunning the regression, reading result tables, and high-volume advisory comparisons that never gate.

**[oracle-candidate]** Should face DNA move to measured ratios as a new schema version, or keep the version 1 fields behind a mapping layer? — R,D — evidence: `CapsuleCharacterDNA` is exported from `triangular-engine/characters` with `schemaVersion: 1` and consumer apps hold presets in it (R); both options reproduce today's presets, and they are expected to split when cats share the face model and when DNA is packed per instance for crowds (D).

Not nominated: the later render-rebuild architecture. It would be costly to undo, but the facts are missing (per-part
cost since the hair rebuild, Plan 086 I2 and I3), so it fails on X5 until a cheaper model gathers them.

### 2026-11-16 — concept-measurement started: crop manifest done, measuring script not yet written

Run on Sonnet at the developer's request, which is the support tier for this part. The segmentation and shape-fitting
script is the Opus-led part and has not been started.

**Done.**

- `tools/concept-fitting/manifests/headshots-and-angles.json` lists 20 crops on the headshots-and-angles sheet (4
  subjects, 5 views). Fifteen are included: orange pigtails, goofy and variant C in front, three-quarter, profile, up
  and down. The sheet is identified by its SHA-256 hash and size; no path to the concept art is recorded, and the
  script finds the sheet by hash in a folder passed with `--source-dir` or `CONCEPT_SOURCE_DIR`.
- `tools/concept-fitting/crop-board.mjs` writes the crops and one board with every crop rectangle drawn on the sheet,
  and `crop-report.json` with each crop's hash. Output goes to `artifacts/concept-fitting/` (gitignored); nothing from
  the concept sheets is committed, as Q1 requires.
- `tools/concept-fitting/crop-board.spec.mjs`: 4 `node --test` cases pass (manifest valid, no path in it, bad crops
  rejected, hash lookup and byte-identical rerun on a synthetic sheet).
- Two runs on the real sheet produced the same `crop-report.json` hash. The developer received the board image.

**Findings.**

- The wacky-hair row is excluded from the first fifteen crops: the helmet glass adds reflections and edges that
  would test I1 harder than the plain heads. The crops stay in the manifest with `include: false` for a later trial.
- Crop boxes first cut off buns and the profile eye; they were widened after looking at the board. Adjacent heads in
  row one come within a few pixels, so the measuring script must keep the largest connected shape in each crop and
  not assume the box holds only one head.
- `sharp` is used for image reading and cropping. It is present in `node_modules` as a transitive dependency and is
  not declared by this workspace. Declaring it (or choosing another reader) is left for the developer.

**Not done.** Eye, pupil, head-edge and mouth measurement; the measured spec; the overlay board for approval. I1 and
the phase's acceptance are untouched.

**Checks.** `node --test tools/concept-fitting/crop-board.spec.mjs`: 4 passed. Visual check of the manifest board and
two re-cut crops by the agent only.

### 2026-11-17 — concept-measurement: measuring script done, board sent, developer review pending

Run on Opus, the lead tier for this part.

**Done.**

- `tools/concept-fitting/measure.mjs` measures each included crop and writes `measured-spec.json`, one
  `measurement-board.png` and a class image per crop under `artifacts/concept-fitting/headshots-and-angles/`. Each
  crop records eye circles (centre, radius, rim residual, rim coverage), pupil centres, the two head side edges
  (width, centre, tilt), mouth corners, flags, and ratios in head widths (pupil offsets in eye radii).
- Method: pixels are classified by colour (background grown from the crop border; skin, eye white, dark, hair, lip,
  other). Pupils are dark shapes with eye white three pixels out. Eyes are circles fitted to eye-white outlines that
  hold a pupil; a circle is kept only when it is mostly eye white inside, is not a duplicate fit of a better circle,
  and is at least 45% of the largest radius. At most two are kept. Head sides are two parallel lines fitted to the
  widest skin rows outside the eye band. The mouth is the wide lip or dark-line shape farthest from the line through
  the eyes, away from the outline; no side is assumed to be down.
- Developer corrections go in `manifests/headshots-and-angles.overrides.json` (keyed by crop id; an `eyes`, `head`
  or `mouth` key replaces that landmark). The file does not exist yet.
- The board was sent to the developer.

**Results on the fifteen crops (agent's own reading of the board; not yet the developer's).**

| Crop                          | Flags                                                                  |
| ----------------------------- | ---------------------------------------------------------------------- |
| orange-pigtails-front         | mouth from the lip only                                                |
| orange-pigtails-three-quarter | none                                                                   |
| orange-pigtails-profile       | mouth not found                                                        |
| orange-pigtails-up            | 1 eye, no pupil inside it; mouth not found                             |
| orange-pigtails-down          | 1 eye (the right eye is visible but was missed)                        |
| goofy-front                   | mouth from the lip only (under the moustache)                          |
| goofy-three-quarter           | far eye rim visible on 19%; mouth not found                            |
| goofy-profile                 | mouth not found                                                        |
| goofy-up                      | far eye rim visible on 17%; head edges only 10 px long; mouth not found |
| goofy-down                    | head edges 24 px long and tilted 28° (wrong); mouth not found          |
| variant-c-front               | none                                                                   |
| variant-c-three-quarter       | none                                                                   |
| variant-c-profile             | far eye has no pupil; mouth not found                                  |
| variant-c-up                  | 1 eye (the second is visible but was missed); head edges only 14 px    |
| variant-c-down                | head edges only 20 px long                                             |

- 27 eye circles were kept and all sit on real eyes. Two or three visible eyes were missed, all in up and down
  views. Earlier runs also fitted circles to headset cups, hair and the skin around a hidden eye; the selection rule
  now drops these (18 circles dropped in total).
- Head edges were found on all fifteen; one (goofy-down) is wrong and flagged. Up views give wider heads (213 and
  228 px against 168 to 189 px elsewhere), which is perspective, not an error.
- Mouths were found on eight crops (two from the lip only) and not found on seven: the three profiles, where the mouth
  sits on the outline, and four where a moustache or the view hides most of it.
- **No unflagged landmark looks wrong to the agent.** If the developer agrees, review time goes only to flagged
  crops.
- Front views agree with each other: eye radius 0.20 to 0.23 head widths and eye spacing 0.61 to 0.69.

**I1, preliminary (not closed).** On the agent's reading, front and three-quarter views need at most mouth
corrections. Up, down and profile views need about ten corrections, mostly mouths. Some of those may be "not visible"
rather than a correction. The count of developer corrections, which is I1's measure, is not known until the
developer reviews the board.

**Evidence for I2.** goofy-down is drawn upside down (face toward the bottom of the cylinder, hair below the eyes).
A camera fit must allow roll, or that view is evidence that the sheet is inconsistent.

**Risks.**

- The colour thresholds and size rules were tuned on this one sheet over four runs. The excluded helmet row and the
  other sheets will show whether they hold.
- The mouth rule needs mouth lines to have a dark core. On this sheet mouth lines are 10 to 35% dark pixels; brows
  have none.

**Checks.**

- `node --test tools/concept-fitting/measure.spec.mjs tools/concept-fitting/crop-board.spec.mjs`: 9 passed. The
  synthetic head is measured within 1 px, a decoy grey disc is dropped, the mouth is found upside down, a rerun is
  identical and an override replaces one landmark.
- Three runs on the real sheet gave the same `measured-spec.json` hash (`9543d86b…`).
- Board read by the agent only. Developer approval or corrections pending.

### 2026-11-17 — concept-measurement done: developer review, 4 corrections

**Developer review.** The developer checked the board and found that all other marks sit on the right spots and all
misses are properly flagged. The developer asked for four corrections, all eye circles placed slightly high:

| Crop                    | Correction                                           |
| ----------------------- | ---------------------------------------------------- |
| variant-c-front         | both eye circles high; centre should be lower        |
| variant-c-three-quarter | both eye circles high                                |
| goofy-front             | both eye circles high                                |
| goofy-three-quarter     | left eye circle high (right eye accepted as measured) |

**Cause.** The four crops have the same fault. The lower part of each eyeball is drawn in shadow, and the shaded part
counts as skin under the eye-white rule (S < 0.23). The circle is then fitted to the bright upper part only. Down
through the variant-c-front left eye, saturation rises smoothly from 0.18 to 0.33 inside the eyeball and jumps to
0.45–0.50 at the skin. This is a systematic bias, not noise. On these four crops the circle centres were 3 to 8 px
too high and the radii 5 to 7 px too small.

**Corrections.** The new values come from a one-off refit with a looser "eyeball" mask (S < 0.38 and V > 140,
plus the pupil), taken within 1.5 radii of the measured circle. A zoomed overlay of each eye was checked before the
values were used. The goofy-three-quarter right eye was left as measured, because the developer accepted it and the
looser mask leaked into the background there. The corrections are in
`tools/concept-fitting/manifests/headshots-and-angles.overrides.json`. They contain coordinates only, no image
content, and each entry carries a note. With the corrections the front-view eye radius is 0.24 to 0.27 head widths
instead of 0.20 to 0.23. The earlier front-view figures understated the eyes.

**I1 resolved: yes.** The developer corrected 4 of 15 crops (7 of 27 eye circles). No head edge, pupil or mouth
needed a correction, and every miss was flagged. The early checkpoint took one short review instead of a
picture-by-picture comparison. The one correction pattern has a single cause the script can learn.

**Repeatability.** Two runs with the overrides gave the same `measured-spec.json` hash (`6065cadb…`), and 4 overrides
were applied. The corrected board was sent to the developer.

**Follow-up (not done).** Teach the measuring script the shaded eyeball, for example by growing the eye-white region
into neighbouring pale, low-saturation pixels before the circle fit. The synthetic test should then gain a shaded
eyeball. Without this, every new sheet with shaded eyes needs the same corrections.

**Regenerating the concept art (developer question).** The developer offered to regenerate the sheets with flat
colours, or with coloured marker dots. The agent's view, a judgement and not tested:

- Not needed for this phase. The task was to find out whether art as it comes can be measured, and it can.
- Flat colouring with no shading on the eyes would remove the one bias found here. It is worth asking for when new
  sheets are made anyway.
- Marker dots drawn by an image generator are risky. The generator decides where each dot goes, and nothing checks
  that it sits on the true eye centre. A misplaced dot would give a confident wrong number that no flag catches.
  Measuring the drawn shapes keeps the error visible.
- The fallback for I2 already names fixed-layout sheets made from the Plan 068 reference prompts. If I2 fails, a
  regenerated sheet should ask for flat colours there.

### 2026-11-17 — Second-model review of phase 1 (Fable subagent, Q&A; corrections to the entry above)

The developer asked for a Fable review of the phase-1 work. The image-generation idea above is parked. The agent
checked the review's concrete claims against the spec and on close-ups.

**Corrections to the previous entry.**

- "Front-view eye radius is 0.24 to 0.27" holds only for the two overridden fronts. orange-pigtails-front is still
  0.21 to 0.22. The spec now mixes two methods: 7 circles from the loose whole-eyeball mask, 20 from the strict
  eye-white mask. The 20 probably carry a smaller bias of the same sign.
- "Every miss was flagged" is misleading. The flags covered the misses (landmarks not found). They did not cover the
  errors that mattered: two of the four corrected crops had no flags at all, and no flag pointed at the eye bias.
- Two further unflagged errors were missed by both the agent and the board review, and the agent confirmed them on
  close-ups:
  - goofy-profile: the far eye circle has a 19 px radius against 40 px for the near eye; the visible crescent
    belongs to a full-size eyeball.
  - variant-c-profile: two 21 px circles sit on one large near eyeball, which has a radius of roughly 35 to 40 px.
- The board is too small to show a 3 px bias. The zoomed overlays, not the board, settled the corrections.

**I1 stands, with a caveat.** The correction count is low, but unflagged errors exist, so the checkpoint cannot
yet be limited to flagged crops. The helmet row has not been tried.

**Risks the review raised in `measure.mjs`** (not yet acted on):

- No flag fires when two eye radii differ strongly, or when one pupil could belong to two circles.
- Overrides are applied after measurement, so head, mouth and flags are not recomputed. Overrides replace the whole
  eyes array and are keyed by crop id without the crop hash.
- Ratios use image axes, not head axes, so they are wrong under roll.
- The tests have no shaded, overlapping or tilted eye, and no test makes a flag fire.
- The refit that produced the override values lives in a scratch script outside the tool.

**Proposed order (the review's ranking, which the agent agrees with).**

1. Teach the script the shaded eyeball and add an eye-radius mismatch flag. Acceptance: it reproduces the seven
   corrected circles within about 2 px without overrides. This moves the other 20 circles, so the developer needs
   one more board review, against the plan's "approved values are frozen" rule. Say so when asking.
2. Then a quick check that the views agree, using only measured ratios that do not depend on yaw.
3. Model-probes in parallel.
4. Ask Q1 and declare `sharp`.

The review also lists gaps in the plan: a defined mapping from concept landmark to model probe, a way to mark
landmarks that are visible but missed, weights per landmark for the solver, and a trial on a second sheet.

### 2026-11-17 — concept-measurement: the script measures the whole eyeball; board sent for a second review

The developer approved item 1 of the order above ("Yes, fix the script").

**Change in `measure.mjs`.** Each eye circle fitted to the eye-white class is refitted to the whole eyeball
(`refitEyeball`):

- The eyeball mask takes every non-background pixel within 1.5 radii of the first circle whose saturation is under
  0.38 with a value over 140, or whose value is under 80.
- The fit uses the connected region with the most pixels inside the first circle, with holes filled.
- Rim points on the search window or the image edge are ignored. The circle is fitted once, then again without
  points more than 3 px off.
- The refit is rejected, and the first circle kept, if the radius shrinks by more than 10%, more than doubles, or
  the centre moves outside the first circle.
- The whiteness test in eye selection still uses the first circle. The spec records which fit each eye has
  (`fit: "eyeball"` or `"eye-white"`).
- A new flag fires when the smaller eye radius is under 0.7 of the larger (`EYE_RADIUS_RATIO_LIMIT`). Far eyes in
  three-quarter views measure 0.75 to 0.8 on this sheet.

Head edges and mouths are unchanged to within 1 px.

**Acceptance against the seven corrected circles, run without overrides.**

| Circle | Distance from the override (px) |
| --- | --- |
| variant-c-front, both eyes; goofy-front, both eyes; goofy-three-quarter left; variant-c-three-quarter left | 0.07 or less |
| variant-c-three-quarter right | 3.25 (centre 3 px lower than the override) |

The scratch refit that produced the overrides also counted background pixels. The tool does not, and that explains
the 3.25 px gap. Counting background reproduces all seven within 0.07 px, but it lets the far eye of
goofy-three-quarter grow into the background and drops an eye on variant-c-profile. So the tool keeps background
out. The far eye is an oval, which a circle cannot match exactly; both fits fall inside it.

**Other changes on the board.**

- All other eye circles grow by 3 to 13 px in radius and move down to cover the shaded underside. Zoomed overlays
  of all five up and down views, both profiles and orange-pigtails-front show the new circles on the eyeball
  outline.
- goofy-three-quarter right eye, which the developer had accepted as measured, moves 7.6 px. The radius goes from
  28.9 to 33.0 px.
- goofy-profile: the too-small far eye is gone, and the crop is flagged "found 1 eye". The near eye now covers
  the whole eyeball (r 47.8 px).
- orange-pigtails-profile is newly flagged "eye radii differ: 29.33 px against 42.41 px".
- Two "rim visible on under 25%" flags disappear: goofy-three-quarter and goofy-up far eyes.
- Not fixed: variant-c-profile still has two 22 to 24 px circles on one large eyeball. The crop stays flagged
  ("eye 0: no pupil inside the circle"), but the flag does not name the real problem.

**Tests.** Two specs were added. In the first, a synthetic eye with its lower part drawn in a shaded colour, which
segmentation classes as skin, must come out within 1 px of its true centre and radius. Without the shaded pixels
the same eye measures 6.4 px high and 4.8 px small. In the second, a 18 px eye beside a 30 px eye must raise the
radius flag. All 11 specs pass. Two reruns without overrides give an identical spec (sha256 `3570ca06…ca1b`) and
an identical board.

**Overrides.** The overrides file is unchanged. The output under `artifacts/` was written without it, so the board
shows only the script. The developer reviews that board. If it is approved, the overrides become redundant and
can be retired, so all 27 circles come from one method. This second review is an exception to the plan's
"approved values are frozen" rule, because every eye circle moved.

### 2026-11-17 — concept-measurement: developer approves the script-only board; overrides retired

**Developer review.** The developer checked the script-only board (spec sha256 `3570ca06…ca1b`, board sha256
`f0c8cf5a…cf43`) and answered "Looks right". No corrections were asked for. This includes the three cases the
previous entry pointed out: the variant-c-three-quarter far eye 3 px below its old override, the moved
goofy-three-quarter right eye and the dropped goofy-profile far eye.

**Overrides retired.** `tools/concept-fitting/manifests/headshots-and-angles.overrides.json` was deleted from the
working tree; the staged copy in the index is still there until the developer stages the deletion. The four
corrected crops are recorded in the entry "concept-measurement done: developer review, 4 corrections" above, and
the override mechanism and its spec stay in place for future corrections. Two runs of the default command, now
without overrides, gave spec sha256 `3570ca06…ca1b` and the same board. This is the approved measurement for this
sheet. All 27 eye circles come from one method.

**Still open from this phase, not blocking model-probes.**

- variant-c-profile has two small circles on one large eyeball. The developer accepted the board with this crop
  flagged. The camera-and-shape-fit phase must not use its eyes until the flag names the real fault or the crop
  is corrected.
- `sharp` is still an undeclared dependency, and Q1 (where concept images and specs live) is still open.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
