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

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
