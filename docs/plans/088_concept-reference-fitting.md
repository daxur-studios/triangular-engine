---
type: Plan
title: "Concept reference fitting"
description: "Measure concept art once, fit camera and parameters to it, and gate procedural characters and parts on numbers instead of repeated visual review."
timestamp: 2026-11-16T00:00:00Z
tags: [engineering-records, procedural, characters, testing]
record: /docs/engineering-records/088_concept-reference-fitting.md
map_schema: 1
document_id: plan-088
initiative_id: "concept-reference-fitting"
performance: []
---

# Plan 088: Concept reference fitting

Status: **planned**. Evidence and decisions: [ER 088](/docs/engineering-records/088_concept-reference-fitting.md).

<!-- tri:scope -->

## Intended outcome

An agent can take concept art for a procedural asset, measure it, fit the generator to it and get a numeric
verdict, without a human comparing two pictures on every pass. The first asset is the Capsule Doodle human head;
the same tools must then serve bodies, hair, capsule cats and vessel parts.

The loop has five steps:

1. **Measure the concept.** A script fits shapes to each concept crop (eye ellipses, pupil centres, head edges,
   mouth corners, part outlines) and writes a measured spec in units of the subject itself, such as head widths.
2. **One early human checkpoint.** The developer approves or corrects an overlay board showing those measurements.
   Approved values are frozen and never re-estimated.
3. **The model reports its own landmarks.** The generator exposes named probes computed from its parameters, so
   the render side is exact and needs no marking.
4. **Fit camera and parameters together.** A headless solver finds the per-view camera and the shared shape
   parameters that best explain the measurements, and flags views that cannot be explained.
5. **Gate on numbers.** Residuals are compared with calibrated thresholds, deliberately wrong variants must fail,
   and every preset is re-measured so a shared change cannot alter other characters unseen.

Constraints:

- Gates are deterministic numbers. Vision-model judgement is advisory, is recorded separately and never gates.
- Human checkpoints are limited to the measurement overlay for each reference set and one contact-sheet check for
  each finished batch.
- Measurement and fitting run headless without a browser. Anything that needs a render goes through
  `triangular-engine/testing`.
- Probe mathematics lives in the framework-free `triangular-engine/characters` core; the Three.js rig consumes it.
- Comparison boards use a light-backdrop studio preset so that lighting differences do not dominate visual checks.
- Concept images are not committed until Q1 is decided, and no consumer app is named.

Out of scope: rebuilding how characters are drawn (instancing, merged geometry, a WebGPU body material, crowd
tiers), a new hair generator, clothing, animation and expression checks, frame-time evidence, and image
generation itself. ER 088 lists these as candidate later plans.

## Phases and acceptance

- **concept-measurement** — A manifest lists each concept crop (source image content hash, crop rectangle, subject, labelled view). A measurement script fits eye ellipses, pupil centres, head side edges and mouth corners by colour segmentation and shape fitting, and writes a measured spec (JSON, in image pixels and head-width units) plus one overlay board. Developer corrections are stored as overrides. Acceptance: for three heads in five views each from the headshots-and-angles sheet, a rerun gives identical output, the overlay board is sent to the developer, and the developer's approval or corrections are recorded in the ER.
- **model-probes** — The face placement mathematics moves into the framework-free core as named probes (eye centres and radii, pupil centres, head axis and radius, mouth corners) with a projection helper for a given camera; the existing face rig builds from the same probes. The character studio gains a flat ID-colour render mode for head skin, eye whites, pupils and hair. Acceptance: a headless test shows projected probes agree with the ID-colour render of the current actor to within one pixel at benchmark resolution in front, three-quarter and profile views, and the existing studio unit specs still pass.
- **camera-and-shape-fit** — A headless solver fits, for each view, yaw, pitch, field of view, scale and offset, and for each head one shared set of face parameters, to the approved measurements. It reports residuals per landmark and view in head-width units and flags views whose residual stays high as inconsistent instead of forcing a fit. Acceptance: on synthetic measurements made from known parameters with added noise the solver recovers the parameters within a stated tolerance, and for the three approved heads it produces a fit report and a board with the projected model landmarks drawn on each concept crop.
- **calibration** — Deliberately wrong variants of each fitted head (an eye moved by 10% of head width, eye radius changed by 15%, a pupil offset, head aspect changed by 10%) are run through the gate, and thresholds are set from the margins. Acceptance: every wrong variant fails, each fitted head passes, the thresholds and margins are recorded in the ER, and the ER states a go or no-go on whether these concept sheets are consistent enough to fit.
- **preset-regression** — Face parameters are expressed as the measured ratios with bounded, tested relations and no hidden floors that mask a change. A headless command prints the probe ratios for every preset and fails on drift that has not been accepted. Acceptance: the three fitted heads exist as presets and pass their gates through the studio benchmark, the ratio table covers all presets, and one contact sheet in the studio preset is sent to the developer for a single visual check.
- **organic-silhouette** — Hair and other organic parts are measured with the fitted head as the ruler: concept hair masks from the bald-head front, side and back sheets are compared with ID-colour hair renders for outline overlap, boundary distance, hairline height, back coverage and widest extent in head widths. A pairwise vision-model judgement is recorded as advisory. Acceptance: three hairstyles have a report and overlay, a deliberately swapped hairstyle fails, and thresholds are recorded in the ER.
- **body-proportions** — Whole-body ratios (body aspect, suit split height, limb thickness and length, boot and hand size) are measured across the turnaround and variant sheets as ranges, and the generator's parameter ranges are compared with them. Acceptance: a measured-ranges table is approved by the developer as the canon (Q2), and a headless check shows seeded random characters stay inside it.
- **second-asset-class** — One capsule cat head or one vessel part goes through measurement, probes, fit and calibration with the same tools. Acceptance: it passes with only asset-specific landmark and probe definitions added, and an ER entry records what was reused and proposes the resulting scope changes to Plan 068 and Plan 070.

## Relationships

- **builds-on**: [Plan 074: Procedural character studio](/docs/plans/074_procedural-character-studio.md)
- **related-to**: [Plan 068: Procedural shape verification](/docs/plans/068_procedural-shape-verification.md)
- **related-to**: [Plan 073: Visual verification evidence and retention](/docs/plans/073_visual-verification-evidence-retention.md)
- **related-to**: [Plan 070: Capsule Doodle Space Cats](/docs/plans/070_capsule-doodle-space-cats.md)
- **related-to**: [Plan 086: Island crowd navigation](/docs/plans/086_island-crowd-navigation.md)
<!-- /tri:scope -->

## Current phase status

| Phase                | State   |
| -------------------- | ------- |
| concept-measurement  | done    |
| model-probes         | planned |
| camera-and-shape-fit | planned |
| calibration          | planned |
| preset-regression    | planned |
| organic-silhouette   | planned |
| body-proportions     | planned |
| second-asset-class   | planned |

<!-- tri:review version="1" scope-hash="4d9725373fb1866c5393da01845db4bde6a9bd1d6e77ca2c5f89d1fcd4c2610f" reviewed="2026-11-17" reviewer="agent" -->
<!-- tri:item id="Q1" kind="intent" applies-to="concept-measurement,preset-regression" blocks="none" state="open" -->

- [ ] Where do concept images and measured specs live: may crops be committed to this public repository, or do
      only the numbers go in?
  - Why it matters: gates that run from a clean checkout need the measured spec; the overlay boards need the
    images. If images stay local, boards can only be regenerated on a machine that has them.
  - Next action: the developer decides. Until then the measured spec (numbers and image content hashes) is
    written under `artifacts/` and nothing from the concept sheets is committed.
    <!-- /tri:item -->

<!-- tri:item id="Q2" kind="intent" applies-to="body-proportions" blocks="body-proportions" state="open" -->

- [ ] Which body proportions are canon? The sheets show a tall pill, a shorter bean that widens below the collar
      and an egg-shaped turnaround body.
  - Why it matters: it decides whether body shape is one target or a range the generator must cover, and whether
    a capsule is enough or the body needs a profile curve.
  - Next action: the developer decides after seeing the measured-ranges table from the body-proportions phase.
    <!-- /tri:item -->

<!-- tri:item id="I1" kind="investigation" applies-to="concept-measurement,camera-and-shape-fit" blocks="camera-and-shape-fit" state="resolved" -->

- [x] Can colour segmentation and shape fitting measure eyes, pupils and head edges on these sheets well enough
      that the developer corrects few of them?
  - Why it matters: hair covers head edges, eyes overlap each other in three-quarter and profile views, and
    helmets add reflections. If most crops need hand correction, the early checkpoint is no smaller than today.
  - Next action: an agent runs the measurement on the fifteen crops and records repeatability and the number of
    developer corrections in the ER.
  - Resolution: yes. The developer corrected 4 of 15 crops (7 of 27 eye circles, all placed high). Every miss was
    flagged and reruns are identical. The corrections share one cause, a shaded eyeball underside. The script
    now measures the whole eyeball, the developer approved its output without corrections, and the overrides
    were retired (ER 088, 2026-11-17).
    <!-- /tri:item -->

<!-- tri:item id="I2" kind="investigation" applies-to="camera-and-shape-fit,calibration" blocks="calibration" state="open" -->

- [ ] Are the five concept views of one head consistent enough to share one set of face parameters?
  - Why it matters: the sheets are generated images and each view may be a slightly different head. If they
    disagree, a fit across views chases noise.
  - Next action: the fit report records residuals per view. If more than one view in five is flagged for a head,
    record a no-go and either fit front and profile only or generate fixed-layout sheets with the Plan 068
    reference prompts.
    <!-- /tri:item -->

<!-- tri:item id="A1" kind="assumption" applies-to="model-probes,camera-and-shape-fit" blocks="none" state="open" -->

- [ ] The head is modelled as a cylinder with a rounded top and the eyes as spheres. The flat cut base in the
      concept's up and down views has no counterpart in the game model.
  - Why it matters: fitting to the base would distort the camera pitch and the head height.
  - Next action: the solver uses eyes, pupils, mouth corners and side edges only; the ER records whether the up
    and down views still fit.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
