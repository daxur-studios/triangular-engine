# Review brief: capsule space cat, single-surface silhouette (BRep study)

Paste everything below the line into the reviewing agent, and attach (or open) the images listed
in the manifest. Replace `D:/code/triangular-workspace/` with the reviewer's path if it is not on
this machine.

---

## Role

You are reviewing a geometry/character-modelling prototype as a critical design reviewer. You are
not implementing anything. Judge the shape against the reference, name the specific failures, and
say what you would change in numbers that the author can apply.

## The goal

The current space cat is a horizontal capsule torso plus a separate, larger head dome. The head and
torso meet at a visible intersection, and the brief is to replace both with **one continuous
surface**: a single loft through oval cross-sections running rump → muzzle, where the shoulder
widens into the cheeks, the back is rounded, and the belly sweeps up into the chin. No seam, no
separate head sphere, no neck ring.

Reference: the rightmost cat in the attached concept sheet, labelled "SCRUFFY CAT". The target is a
soft, chunky, slightly scruffy small cat with a big rounded head/cheek mass that flows into a
shorter body, sitting low, with the head reading as distinct from the body *by volume*, not by an
intersection.

Constraints that must survive the change:

- The existing face rig (eyes, ears, whiskers, nose, mouth) is built against a head ellipsoid of a
  known size and place, so the head mass cannot move or resize freely.
- The existing legs and tail are reused unchanged.
- The part is a real CAD solid, in millimetres, Z-up, −Y forward, 1000 mm = 1 m at the engine
  boundary. It ships as a baked GLB, not as a runtime parametric mesh.
- Mesh budget is roughly 13k triangles; the current bake is 13,118 (reference variant).

## What was built

`capsule-space-cat-silhouette.brep.ts` — analytic oval sections (width/height/centre per Y), lofted
with a smooth (non-ruled) loft, capped at the muzzle and at the rump tip. Three parameters:

| Parameter | Default | Range | What it drives |
| --- | --- | --- | --- |
| `headRise` | 70 mm | −40 … 140 | vertical placement of the head mass relative to the body |
| `cheekFullness` | 115 % | 70 … 140 | lateral cheek bulge centred ~70 mm behind the face |
| `blendLength` | 340 mm | 200 … 380 | length of the shoulder→head transition |

Two variants were baked and compared:

- **Reference fit** — `headRise 70`, `cheek 115`, `blend 340`.
- **Subtle rise** — `headRise 30`, `cheek 115`, `blend 340`.

## What is verified (trust these, they are kernel measurements)

- One valid, manifold solid; 2 faces, positive volume. `ok: true` at defaults and at all 8
  combinations of parameter extremes (9 cases).
- Volume 268,098,537 mm³; surface area 2.29 m².
- Bounds: x ±359.27 mm, y −728.01 … 470.00 mm, z −301.05 … 470.08 mm.
- Tessellation matches CAD extents within 6 mm; GLB is 315,928 bytes (reference) and 312,040 bytes
  (subtle). Seam vertices were welded at bake time so the loft seam does not shade as a band.

## What is NOT verified, and where I want your judgement

1. **Does the transition read as one animal, or as a snowman with a long neck?** My own read: the
   reference-fit keeps head separation but the neck/shoulder is still slightly tube-like from the
   side; the subtle variant reads flatter and loses the head definition.
2. **Cheek placement.** The cheek bulge is a Gaussian centred at y = −506 (70 mm behind the head's
   widest section). Is it too far back, i.e. does it read as a jowl/neck rather than a cheek?
3. **Back line.** The body carries a 62 mm shoulder lift and an 8 mm mid-back bow so the back keeps
   rising into the head. Is that enough, or does the spine still dip before the head?
4. **Belly→chin sweep.** The brief asks for the belly to sweep up into the chin. Looking at the side
   view, is the chest-to-chin line right, or is the chest still too vertical?
5. **Front view.** Width continuity where the cheeks meet the chest — any pinch, shelf or flat spot?
6. There is a faint bright band at the cheek/head junction in the three-quarter view. I believe it is
   a highlight on the bulge, not geometry. Confirm or refute from the images.

## Rig implications I already know about

- The face rig anchors on the head group's position, so the preview moves the whole head group down
  by `headRise`. Independent head yaw/tilt would now rotate the entire merged surface unless a neck
  pivot or split is introduced.
- The body shader's painted mouth is gated on a collar coordinate; it had to be remapped
  (`uNeckZ = 0.5`, mouth centre pinned under the nose) to land on the new muzzle.
- Whisker and ear anchors assume a ~315 mm head radius. They still land, but the silhouette no
  longer guarantees the same clearance everywhere.

## What I want from you

Answer in this order, concretely:

1. **Verdict** — one paragraph: is the single-surface approach closer to the reference than the
   current separate head+torso? Which of the two variants is closer, and why?
2. **Top three failures**, ranked, each tied to a specific image and a specific region (e.g. "side
   view, y ≈ −300 to −420, the upper back"). No vague "needs more organic feel".
3. **Parameter changes**, as numbers: which of `headRise` / `cheekFullness` / `blendLength` you would
   move, to what, and what you expect to see. If the fix is structural rather than parametric, say so
   and describe the section-profile change instead.
4. **Rig risk** — is the merged surface worth losing independent head motion, or should the study
   keep a hidden neck split? Give a recommendation, not a list of options.
5. **Anything that looks wrong that I did not ask about.**

Do not rewrite the part. Do not propose a different modelling approach unless the current one cannot
reach the reference; if you do, justify it against the images.

## Image manifest

Attach these five images (paths are absolute):

1. `D:/code/triangular-workspace/artifacts/brep-space-cat-silhouette/compare-side.png`
   Three cats at the same camera scale, side view. Left: current Concept Fit (separate head dome).
   Middle: reference-fit loft. Right: subtle-rise loft. **This is the main check.**
2. `D:/code/triangular-workspace/artifacts/brep-space-cat-silhouette/compare-three-quarter.png`
   Same three cats, three-quarter view. Use this for cheek volume and the junction highlight.
3. `D:/code/triangular-workspace/artifacts/brep-space-cat-silhouette/compare-front.png`
   Same three cats, front view. Use this for width continuity and symmetry.
4. `D:/code/triangular-workspace/artifacts/brep-space-cat-silhouette/silhouettes-side.png`
   The two new bodies alone, plain material, no face or limbs. Judge the pure outline here first,
   before the face biases you.
5. `D:/code/triangular-workspace/artifacts/space-cat-turnaround/concept.jpg`
   The concept sheet. The target is the rightmost cat, the all-fur "SCRUFFY CAT" without the white
   suit. (`concept.png` in the same folder is the helmeted five-view turnaround and is *not* the
   reference for body shape.)

## Files, if you have repository access

- Part: `projects/brep-poc/src/app/part/capsule-space-cat-silhouette.brep.ts`
- Verification (9 parameter cases): `projects/brep-poc/studies/capsule-space-cat-silhouette/verify.mjs`
- Bake + embed preview: `projects/brep-poc/studies/capsule-space-cat-silhouette/build.mjs`
- Captures: `projects/brep-poc/studies/capsule-space-cat-silhouette/capture.mjs`
- Rotatable page: `artifacts/brep-space-cat-silhouette/preview.html`
- Kernel report: `artifacts/brep-space-cat-silhouette/report-reference.json`
- Current cat to beat: `projects/demo-app/src/app/pages/character-studio/experimental-space-cat.ts`
