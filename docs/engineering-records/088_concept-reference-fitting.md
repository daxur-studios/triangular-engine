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

### 2026-11-17 — concept-measurement: variant-c-profile's split eyeball merged; developer check pending

The developer asked for the variant-c-profile fix (the first open item above).

**Cause.** The near eyeball has a bright highlight arc the colour of the backdrop. Where the arc reaches the
eyeball's front rim, the background fill runs into it. The eye white is left C-shaped, and the circle fitter puts
one small circle on each half (r 22 and 24 px, centres 48 px apart). The two circles came from one eyeball; the
second pupil-like mark past the rim is the far eye.

**Change in `measure.mjs` (`mergeSplitEyeball`).** After the two eyes are selected, a pair whose centre distance is
under 1.1 times the sum of their radii (`SPLIT_EYEBALL_RATIO`) is refitted as one eyeball. The refit starts from a
circle around both and uses `refitEyeball`. The pair is replaced by the one circle only when the fit's rim residual
is within `RIM_RESIDUAL_LIMIT` (2 px) and it sees at least as much rim as either half. The spec marks such an eye
`fit: "merged-eyeball"`. Applying the merge to all candidate circles, before selection, also moved three approved
crops (variant-c-three-quarter far eye by 6 px, orange-pigtails-up by 12 px, goofy-front by 0.5 px), because
duplicate fits of one eye were merged into a wider fit. The merge was therefore limited to the final pair.

**Result.** variant-c-profile now has one eye: centre (220.78, 196.07), r 39.39 px, rim residual 1.09 px, rim
visible on 69%. The pupil is found, and the flag "no pupil inside the circle" becomes "found 1 eye", as on
goofy-profile. The eyeball is a slightly tall oval, about 81 px wide and 84 px high, so the circle's top sits about
4 px inside the drawn top. Close pairs on the other crops have centre distances of 1.17 to 1.33 times their radius
sum; there the merge is not tried. Every other crop's landmarks and flags are identical to the approved spec. Two
reruns gave spec sha256 `da3c39e4…ad6f` and board sha256 `e45a4900…5256`.

**Tests.** Two specs were added. Two small circles on halves of one 40 px eyeball must merge to within 1 px of its
centre and 1.5 px of its radius. Two overlapping 30 px eyes must not merge. A full synthetic face that reproduces
the background leak was tried and did not split the eye the same way, so the merge rule is tested directly. All
13 specs pass.

**Review.** The before-and-after zoom and the new board were sent to the developer. This one crop changes the
approved measurement, so it needed the developer's check. The developer answered "Looks right" on 2026-11-17.
Spec sha256 `da3c39e4…ad6f` is now the approved measurement for this sheet, and the camera-and-shape-fit phase may
use variant-c-profile's eye.

### 2026-11-17 — model-probes done: probes, projection and ID render agree within one pixel

The developer asked to start the model-probes phase.

**Change.**

- **Probes** (`characters/core/capsule-face-probes.ts`). The face placement maths now lives in the framework-free core.
  - `computeCapsuleFaceProbes(dna, pose)` returns the head axis, radius and skin bottom; eye-white and pupil ellipsoids, which follow the gaze; mouth centre and corners on the head surface, which follow the mouth state; and the brows and nose.
  - `buildCapsuleFaceRig` builds from these functions. A spec checks that every rig mesh lies on its probe to 1e-9 for two DNAs.
- **Projection** (`characters/core/character-camera-projection.ts`). A pinhole camera matching three.js `lookAt`, plus:
  - point and ellipsoid projection, with the outline as an image ellipse and a signed pixel distance to it;
  - 3D contour points for ellipsoids and capsule sides;
  - line-of-sight tests and torso-to-world transforms.
- **ID render** (`procedural/characters/capsule/capsule-id-colours.ts`). `CapsuleCharacterActor.setIdColourMode` draws each part in one flat, unlit colour. The colour components are 0, 0.5 or 1, so any two parts differ by at least 128 in one channel.
  - The body uses a shader that shares the shaded body's suit split and mouth outline (`CAPSULE_MOUTH_SDF_GLSL`). The mouth edge in the ID render is therefore the same maths as in the shaded render.
  - The helmet dome is not drawn.
  - The mode is restored and reapplied when `setDna` rebuilds the face.
  - The character studio has a Render mode control: shaded or ID colours.

**Decision: the agreement test is a Karma ChromeHeadless spec, not a `triangular-engine/testing` suite.** The plan says
renders go through `triangular-engine/testing`. That harness runs pages in the served demo app and saves media and
timings. This check needs neither: WebGL works in plain headless Karma (Chrome 157), and the test reads its pixels back
in memory. A Karma spec runs with the other unit specs on every `npm run test:triangular-engine:procedural`, needs no
served app and saves nothing. The calibration phase, which compares renders with the concept sheets, may still need
the testing harness.

**Test** (`capsule-face-probe-agreement.spec.ts`).

- **Benchmark actor:** the curly-pigtails preset without helmet or jetpack, with orange pigtails, happy expression, idle, after 10 updates of 0.1 s.
- **Camera:** framed on the head the way the studio frames it, FOV 25°, elevation 0.04 rad. Azimuths: front 0, three-quarter −0.55, profile −1.18.
- **Resolution:** 640×360, the capture size of the benchmark sheets in phase 1. At this size the head is about 200 px per world unit, an eye white about 27 px in radius and a pupil about 7 px.
- **Method:** sample each probe outline at 360 points and drop the samples another part hides. Hidden means behind the head capsule or the other eye white. A pupil is also dropped behind its own eye white, with a slack of 0.02 eye radius.
  - **Safety net:** a sample counts only when the pixel 3 px inside is the part's own ID and the pixel 3 px outside is an allowed neighbour. The 3 samples on each side must pass too.
  - **Residual:** for each pixel centre within 3.5 px, the test compares the ID with the side of the analytic edge. Each disagreement counts as its distance to the edge.
  - **Head sides:** checked against the capsule's projected side lines.
  - **Mouth corners:** the farthest mouth pixel along the projected surface tangent.

**Result: all three views pass; the worst residual is 0.56 px.**

| Probe              | Front n / max (px) | Three-quarter n / max (px) | Profile n / max (px) |
| ------------------ | ------------------ | -------------------------- | -------------------- |
| left eye white     | 112 / 0.000        | 187 / 0.202                | 26 / 0.036           |
| left pupil         | 360 / 0.058        | 360 / 0.063                | 190 / 0.017          |
| right eye white    | 110 / 0.000        | 96 / 0.109                 | 127 / 0.079          |
| right pupil        | 360 / 0.068        | 206 / 0.024                | 107 / 0.000          |
| head edges         | 62 / 0.000         | 76 / 0.096                 | 61 / 0.000           |
| right mouth corner | 1 / 0.560          | 1 / 0.146                  | not measured         |
| left mouth corner  | 1 / 0.529          | 1 / 0.042                  | not measured         |

The front mouth corners measure about half a pixel because the extreme mouth pixel centre can lie up to one pixel
from the true corner. This is quantisation, not a placement error.

**Sensitivity.** With a 1.5 px safety net, a 3% larger eye white was not caught: the net threw out exactly the
samples that were wrong. The final 3 px net and 3.5 px window catch it.

- **About 2 px errors:** eye white ×1.08, pupil ×1.3 and head radius ×1.03 failed all three views. Residuals were 1.1 to 2.4 px, or the probe's samples dropped to zero.
- **Mouth corner:** x ×1.04 was caught at 1.7 px.
- **Sub-pixel changes:** these reported 0.4 to 0.95 px and passed. The test proves "within one pixel", not tighter.

The mutations were temporary edits and were reverted.

**Limits.**

- **Profile eyes:** in profile the near eye white is mostly covered by the lids, with the far eye white behind it, and the far pupil stands out against the background.
  - The profile view therefore requires one of the two eye whites, one of the two pupils and the head edges, not every probe.
  - Mouth corners are not measured past |azimuth| 1.
- **Covered eye outlines:** in the front view, lids and brows cover about two thirds of each eye-white outline. Those samples are dropped, not measured.
- **Scope:** only the benchmark DNA and expression are tested. The rig-to-probe spec covers a second, asymmetric DNA without a render.
- **Studio toggle:** not checked in the served demo app. Its control is wired and the studio specs pass.

**Verification.**

- procedural: 278 specs SUCCESS
- characters: 153 SUCCESS
- character-studio demo specs: 19 SUCCESS
- `npm run build:triangular-engine`: exit 0

### 2026-11-17 — camera-and-shape-fit done: solver, synthetic recovery, fit report and board

**Where it lives.** `tools/concept-fitting/fit.mjs` (solver, report, board), `fit.spec.mjs`, `load-core.mjs` and `core-entry.ts`.
The solver imports the framework-free core (probes, projection, side contour) by bundling `core-entry.ts` in memory with esbuild, so it runs in node with no browser and no second copy of the face mathematics.

```bash
node tools/concept-fitting/fit.mjs --spec artifacts/concept-fitting/headshots-and-angles/measured-spec.json
```

It writes `fit-report.json` and `fit-board.png` next to the spec. Both stay local under `artifacts/` (Q1 is still open).

**Model.**

- **Camera per view:** an orbit camera aimed at the capsule centre. Parameters are yaw, pitch, field of view, `logPpm` (pixels per metre at the head centre, which sets scale and distance) and an image offset `ox`, `oy`.
- **Shared per head:** eye spacing, eye scale, eye size and height asymmetry, body height, mouth width and four gaze angles. They use the DNA ranges. Body radius (0.36) and suit split are fixed.
- **Not fitted:** pupil scale. The measurement records pupil centres only, so a size would be unconstrained.
- **Residuals:** pixels divided by one fitted head width in pixels, with a soft-L1 loss (delta 0.03). Left and right are matched to the model by the best assignment, because which eye is "left" depends on the view.
- **Terms:** eye centre, eye radius, pupil centre, mouth corners and head side edges (point to the projected side contour). Hidden-surface and unmeasured-eye terms are soft penalties. Each view also carries a weak field-of-view prior and soft limits on yaw and pitch from its label, so a profile cannot become a front view.
- **Solve:** Levenberg–Marquardt on parameters scaled to [0,1]. First the front view alone with shared parameters free, then each other view's camera from label-informed starts, then all views jointly.

**Flagging.** A view is judged on its held-out RMS: shared parameters are refitted without it, then only its camera is fitted.

- **Why held out:** the in-sample RMS alone rewards a flexible camera.
- **Rule (provisional, calibration sets the final values):** flagged above 0.06 head widths, or above 3× the median of the other views (median floored at 0.01).
- **After flagging:** the shared parameters are refitted without the flagged views, then the flagged views' cameras are fitted alone, so a flagged view is shown but does not pull the head.
- **Weak views:** each view reports its measured numbers minus its six camera parameters. Under 4 is marked `weak`, and its low residual is not evidence.

**Synthetic recovery (acceptance).** Five views of a known head (yaw 2° to 75°, pitch −35° to 30°) with 0.6 px Gaussian noise.

| Quantity               | Worst error, six seeds | Tolerance in the spec |
| ---------------------- | ---------------------- | --------------------- |
| eye spacing            | 0.0055                 | 0.015                 |
| eye scale              | 0.013                  | 0.04                  |
| body height            | 0.013                  | 0.06                  |
| mouth width            | 0.020                  | 0.08                  |
| yaw                    | 1.0°                   | 3°                    |
| pitch                  | 7.0°                   | 10°                   |
| scale (`logPpm`)       | 0.009                  | 0.03                  |
| in-sample RMS          | 0.0034                 | 0.01                  |

Pitch is the loosest camera angle because it trades against the vertical offset. No view was flagged in any seed.
A view with its eyes moved 40 px and mouth corners 30 px is flagged, nothing else is, and the shared parameters stay within tolerance.
Two runs are byte-identical. `fit.spec.mjs` has 6 specs, and the three concept-fitting spec files pass together (19).

**Result on the three approved heads.** Held-out RMS in head widths (in-sample RMS is lower).

| Head            | front  | three-quarter | profile | up     | down              |
| --------------- | ------ | ------------- | ------- | ------ | ----------------- |
| orange-pigtails | 0.024  | 0.016         | 0.020   | 0.010* | 0.036             |
| goofy           | 0.010  | 0.011         | 0.012*  | 0.014  | **0.048 flagged** |
| variant-c       | 0.031  | 0.024         | 0.007*  | 0.017  | 0.026             |

`*` weak view (fewer than 4 measured numbers beyond its camera).

**I2 (are the five views of one head consistent enough to share parameters?).** Yes, with one caveat. No head has more than one view in five flagged, so no no-go is recorded. Only goofy-down is flagged, and that is exactly one in five.
Every other view is within 0.036 head widths held out. The thresholds are provisional, and calibration decides whether 0.06 is tight enough to catch the wrong variants.

**A1 (up and down views).** The solver used eyes, pupils, mouth corners and side edges only, never the flat cut base.

- The up views fit well (held out 0.010 to 0.017), though orange-pigtails-up is weak.
- The down views fit worst for all three heads. goofy-down is flagged, with head-edge residual 0.075 and a pitch of about 59°. orange-pigtails-down is next, with eye centres at 0.050.
- Reading: the model has no counterpart for what the concept draws from below. A1 stays open. The down view is the first thing to check if calibration finds a gap.

**Findings to carry into calibration.**

- **Mouth width at its bound:** goofy fits 0.22, the bottom of the DNA range. Its mouth corners are measured in the front view only, so the concept mouth may be narrower than the generator allows.
- **Body height:** goofy fits 1.397, just under the 1.4 bound. The head-only crops constrain it weakly, so treat it as unidentified, not as a measurement.
- **Field of view:** several views settle at the 10° lower bound (pigtails three-quarter and up, goofy profile, up and down). Field of view is not identifiable from these crops, so it is held with a weak prior and not reported as a result.
- **Profile yaw:** the fitted yaws are 43° (pigtails), 59° (goofy) and 71° (variant-c), not 90°. The label prior is soft, so the data pulled them back. Either the concept profiles are not true profiles or the model eye placement differs from the concept. Calibration should check this before trusting a profile residual.
- **Gaze:** the four gaze angles can absorb pupil offsets. They are fitted, so the pupil residuals are low by construction. Calibration's "pupil offset" variant is the check on that.

**Not checked.**

- **Boards:** the fit board was sent to the developer. Only the first version was viewed by the agent, so the final board has not been checked for drawing errors.
- **Real-data accuracy:** none. There is no ground truth for the concept art, so recovery is proven on synthetic data only.
- **Studio render:** the studio Render-mode toggle is still unchecked in the browser, as in the model-probes entry.

**Verification.**

- `node --test tools/concept-fitting/*.spec.mjs`: 19 passed
- No engine code changed in this phase, so no library build was run.

### 2026-11-18 — calibration done: the gate catches every wrong variant, but only in its final form; go with limits

**What was done.** `tools/concept-fitting/calibrate.mjs` builds eight deliberately wrong variants of each of the three fitted heads (24 in all) and runs them through the gate against the real measurements. Results are in `artifacts/concept-fitting/headshots-and-angles/calibration.json` (local, regenerable).

Variants: eyes moved out or in by 10% of head width, eye radius ±15%, both pupils offset by 0.3 rad (yaw, then pitch), head height ±10%.

**The first gate did not work.** Refitting every view's camera and judging one mean residual let the cameras absorb the error. Eye radius, pupil offset and head aspect came out at only 1.03 to 1.35 times the good head, inside the spread between good heads (0.012 to 0.018). Eye moved in was 1.02 times on goofy.

**The gate that works.** Hold the fitted cameras fixed and compare each landmark kind (eye centre, eye radius, pupil, mouth corner, head edge) with the same kind in the head's own fit. A model fails when any kind rises by more than a factor of 1.25 and by at least 0.003 head widths (`GATE_FACTOR`, `GATE_MIN_RISE`).

| | Result |
| --- | --- |
| Wrong variants that fail | 24 of 24 |
| Smallest margin (worst kind, vs the good head) | 1.59 times (goofy, eye radius −15%); threshold is 1.25 |
| Eye moved 10% | 2.2 to 7.0 times |
| Pupil offset | 2.2 to 2.7 times |
| Head height ±10% | 3.3 to 5.2 times |
| Good heads | 1.0 by construction |

**Go or no-go: go, with two limits.**

1. The concept sheets are consistent enough to fit (Q I2: one view in five flagged, goofy-down only), and the gate separates wrong variants from the fit with margin.
2. The gate compares a model with the head's own fit, so it detects *drift from the accepted fit*. It does not prove the fit matches the artist's intent: there is still no ground truth. Fine for preset-regression; do not read it as "the face is right".
3. The 1.25 factor is untested against re-measurement noise (a fresh measurement of the same sheet). Preset-regression should accept a measurement re-run before the factor is called final.

**Not checked.** Variant sizes beyond those listed (a 5% eye move was not tried). The pupil variants shift both eyes the same way. The final fit board is still unviewed by the agent.

**Verification.** `node --test tools/concept-fitting/*.spec.mjs`: 21 passed (2 new in `calibrate.spec.mjs`, synthetic head, every variant fails). No engine code changed.

### 2026-11-18 — preset-regression: three presets and the ratio check are in; the pupil gate fails and the contact sheet is not made

**What was done.**

- `CAPSULE_CONCEPT_FIT_PRESETS` in `characters/core/capsule-dna.ts`: `concept-fit-orange-pigtails`, `concept-fit-goofy`, `concept-fit-variant-c`, appended to `ALL_CAPSULE_CHARACTER_PRESETS` so the studio lists them. Only the fitted face fields are set; the rest is the default astronaut (orange pigtails also gets pigtail hair).
- `tools/concept-fitting/preset-ratios.mjs` prints ten probe ratios (in head widths) for all 23 presets and fails on drift above 0.002 against `preset-ratios.baseline.json`. `--accept` rewrites the baseline after a reviewed change; `--spec` also gates the three concept presets against the measurements.
- No hidden floors: the check reads the model's own probes, and the presets store the fitted numbers unchanged.

**Gate result: the presets fail on pupils only.** With the fitted cameras held, eye centre, eye radius, mouth corner and head edge match the fit exactly. The pupil residual is 0.033, 0.037 and 0.022 against 0.010, 0.013 and 0.013 for the fit (2.3 to 3.4 times; the limit is 1.25). Two reasons, both in the DNA and not the fit:

1. The fit used a shared gaze direction per eye. DNA keeps only the difference between the eyes (`gazeAsymmetryYaw`), and all three fitted a difference beyond the ±0.45 rad limit, so they sit at the clamp.
2. DNA has no resting gaze direction at all.

Also at a limit: goofy `bodyHeight` 1.397 against 1.40.

**Not done.**

- **Contact sheet:** not rendered, so the single visual check by the developer has not happened.
- **Studio benchmark:** the presets were not run through the studio benchmark in a browser.
- **Pupil gate:** left failing on purpose. Fixing it means either a resting-gaze field in the DNA (a public API change) or wider asymmetry limits. Developer decision.

**Verification.** `node --test tools/concept-fitting/*.spec.mjs`: 25 passed. `npm run test:triangular-engine:characters`: 153 passed. No library build run.

### 2026-11-18 — preset-regression: resting gaze added, all three presets pass the gate

Developer approved adding a resting gaze to the DNA. `gazeRestYaw` and `gazeRestPitch` ([-0.6, 0.6], default 0) are added to every character's gaze, in `capsule-face-projection.ts`. A search over the four gaze values per head, against the measured pupils with the fitted cameras held, gave the preset values.

**One further public change, flagged:** the means alone were not enough (variant C and orange pigtails still failed at 1.43 and 2.6 times). The fit needs a larger eye-to-eye yaw difference than ±0.45, so `gazeAsymmetryYaw` is now limited to ±1.2. Orange pigtails sits at -1.15 rad, which is a strongly cross-eyed look. The fit says the concept pupils are placed that way, but it may also be the gaze absorbing a different pupil placement in the model; the contact sheet is the check.

**Gate result.** All three concept presets pass: pupil residual 0.0089, 0.0122 and 0.0125 against 0.0096, 0.0125 and 0.0129 for the fit. The baseline table was re-accepted.

**Verification.** 25 fitting specs and 153 character specs pass. The DNA spec's clamp test now expects 1.2.

**Visual check (2026-11-18).** Contact sheet of the three presets in the studio Face view (dark backdrop) sent to the developer, who judged it fine, including the orange pigtails gaze. Local copy: `artifacts/concept-fitting/headshots-and-angles/preset-contact-sheet.png`. The library build passes.

**Still not done.** The studio benchmark run in a browser, and a light-backdrop render.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
