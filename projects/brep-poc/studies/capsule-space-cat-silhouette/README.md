# Capsule space cat silhouette study

The first [fused rear hip](#fused-rear-hip) is the baseline for
[fusing all four legs](#all-four-legs). Run `build.mjs` and open
`artifacts/brep-space-cat-silhouette/fused-legs.html` to compare them.

Two catalogued bodies for the Concept Fit cat, both single manifold solids:

- **Tube and sphere** (`capsule-space-cat-tube.brep.ts`) — the intended shape. A
  capsule body with a sphere head fused on and a fillet bevel where they meet.
  The body length is one parameter, so the cat can be short or long.
- **Fat cat** (`capsule-space-cat-fat.brep.ts`) — a kept option. Two overlapping
  balls (head and body) fused and filleted. Funny, not the target.

Both keep the Concept Fit head ellipsoid in the same size and place, so the
existing eyes, ears, whiskers and nose keep their anchors. The study scripts and
the preview bake from both parts side by side.

The legs are baked too: **`capsule-space-cat-leg.brep.ts`** fuses a straight leg
tube to a paw ball and bevels the join, the same operation as the head and body.
The baked leg is skin-weighted to a hip → knee → ankle chain, so it still bends.
See [Rigged legs](#rigged-legs).

An earlier version lofted one oval profile from rump to muzzle. It is kept only
in the history as a rejected approach: one profile cannot be a ball head and a
barrel body at once, so the head turned into a wedge and the chest bulged under
the jaw.

## Commands

```powershell
npx brep verify projects/brep-poc/src/app/part/capsule-space-cat-tube.brep.ts --check
npx brep verify projects/brep-poc/src/app/part/capsule-space-cat-leg.brep.ts --check
node projects/brep-poc/studies/capsule-space-cat-silhouette/verify.mjs        # all three parts, 35 cases
node projects/brep-poc/studies/capsule-space-cat-silhouette/profile.mjs 900   # tube numbers
node projects/brep-poc/studies/capsule-space-cat-silhouette/build.mjs         # bake GLBs, preview and walk pages
node projects/brep-poc/studies/capsule-space-cat-silhouette/capture.mjs       # comparison images
npx --no-install stop-motion-ui run projects/brep-poc/studies/capsule-space-cat-silhouette/walk.video.mjs --out artifacts/videos/space-cat-legs --codec h264 --fps 20
```

Output goes to `artifacts/brep-space-cat-silhouette/`. Open `preview.html` there
to orbit the result; it embeds the GLB bytes that `brep verify` measured. The
preview has a `Tube · default (hose legs)` stage next to the baked-leg stage, so
the leg change can be judged on the same body.

## Tube parameters

- `bodyLength` (mm, 560–1100, default 900): total body length, front tip buried in
  the head to the rump tip. The capsule cannot be shorter than its two end caps
  (`2 × tubeRadius`), so the builder holds a 40 mm straight run as the minimum.
- `tubeRadius` (mm, 200–330, default 280): body radius, the Concept Fit
  `bodyRadius`. 340 mm with the longest body leaves a join the fillet cannot
  solve, so 330 is the largest offered radius.
- `headRise` (mm, default 30): lifts the head; the rig anchor follows it.
- `joinFillet` (mm, default 135): radius of the bevel where the tube's side meets
  the head's ball. 0 leaves the sharp intersection.

Rear tip = `BODY_FRONT (-380) + bodyLength`. Because the front tip is fixed in the
head, a length change only moves the rump backwards. The preview passes that
distance (against the 900 mm default) to the Concept Fit builder as its rear
extension, so the hind legs and tail base slide with the rump instead of staying
where the stock body ended. The preview shows 780, 900 and 1100 mm.

## Fat cat parameters

`headRise`, `cheekFullness`, `headSetback`, `joinFillet`; see the part's TSDoc.
Defaults: 30, 115, 0, 85.

## Rigged legs

`capsule-space-cat-leg.brep.ts` bakes one leg: a capsule tube fused to a paw
ellipsoid, filleted where the tube leaves the paw. The origin is the ankle joint
and the leg rises along +Z to the hip, straight on purpose — the bend comes from
the rig, not the shape.

Parameters: `legLength` (mm, default 265, the measured hip-to-ankle distance on
the Concept Fit cat), `legRadius` (62), `pawScale` (1.25, always above 1 so the
paw is wider than the leg and the fuse has a join to bevel), `pawForward` (16) and
`joinFillet` (60 mm; 90 and above cannot be solved, 85 is the widest that passes
every corner).

`CapsuleCatLegMesh` (`triangular-engine/procedural`) turns the bake into a
`SkinnedMesh` with three bones — hip, knee, ankle. Skin weights are generated from
the rest geometry, not painted: one smooth ramp down the leg that splits at the
knee and hands the last 10% to the ankle bone, so the paw stays rigid and the
modelled bevel survives the bend. `pose(hip, knee, ankle, pawPitch)` places the
chain exactly on the gait's joints and pitches the paw about X, which is what
`paw.root.rotateX(...)` did for the hose leg. The studio passes the hose's Bézier
*control* point as `elbow`; the knee has to be the curve's midpoint instead
(`0.25·hip + 0.5·elbow + 0.25·ankle`), or the leg bends around a point that is not
on the leg.

The preview mounts the baked legs through the Concept Fit builder's `legFactory`
option. The fat cat keeps the stock hose legs so its silhouette stays the subject.

### Walking A/B

`walk.html` is the animation page: the default tube body twice, baked legs on the
left and stock hose legs on the right, both driven by the actor's own gait and
stepped with the same delta. `window.__walk.setGait(mode, speed)` switches
between `idle`, `goofy_walk`, `bound_run` and `float`; `setView(degrees)` turns
the camera around the pair. The page renders with the real GPU — headless ANGLE
D3D11 — because SwiftShader cut the capture rate.

`walk.video.mjs` is the stop-motion-ui recipe (idle, walk, bound run, idle) with
short narration and a baked caption per segment. Capture delivers about 20 fps,
so encode at 20 to keep source and output frames 1:1; at 30 the encoder repeats
one frame in three and the motion looks stepped. Output goes to
`artifacts/videos/space-cat-legs/run-*/demo.mp4`.

### Feasibility probes

`probe-leg.brep.ts` and `probe-hip.brep.ts` are throwaway parts that answered the
first two questions — can a leg-to-paw join be filleted, and can a leg-to-body
join be filleted? Both can. `probe-leg.mjs` bakes them and writes `leg-probe.html`
and `leg-probe.png` with the with/without-bevel pairs. The hip probe fuses one leg
into the tube body and bevels the hip ring.

### Fused rear hip

`rear-hip.brep.ts` fuses the camera-facing rear leg and paw into the default
900 mm tube and rounds the hip with a 55 mm fillet. The bake keeps the original
neck and paw bevels. The study blends the same hip, knee and ankle bones into a
fourth bone fixed to the torso.

Run `build.mjs` and open `artifacts/brep-space-cat-silhouette/rear-hip.html`.
The left cat has the fused rear hip. Both cats use the same gait, fur and other
three baked legs, with the gear hidden to expose the joins.

```powershell
npx brep verify projects/brep-poc/studies/capsule-space-cat-silhouette/rear-hip.brep.ts --check
node projects/brep-poc/studies/capsule-space-cat-silhouette/capture-rear-hip.mjs
npx --no-install stop-motion-ui run projects/brep-poc/studies/capsule-space-cat-silhouette/rear-hip.video.mjs --out artifacts/videos/space-cat-rear-hip --codec h264 --fps 20
```

### All four legs

The same 900 mm body and original rounded paws, with both hips and shoulders
fused into the torso. The original face, separate animated tail and goofy
walk are shared with the first rear-hip study. The same three bones drive
each leg. In `fused-legs.html`, all four legs are fused on the left. The first
rear-hip cat is on the right.

```powershell
npx brep verify projects/brep-poc/studies/capsule-space-cat-silhouette/rear-hip.brep.ts --check --param allLegs=true
node projects/brep-poc/studies/capsule-space-cat-silhouette/capture-rear-hip.mjs --fused-legs
```

### Original tail fused

Run `build.mjs` and open `artifacts/brep-space-cat-silhouette/fused-tail.html`.
Both sides use the four-leg bake and the original gait. The left tail joins
the rump with a 32 mm fillet and bends along an eight-segment bone chain.
The right tail still follows the original animated curve as a separate mesh.

In the tail or four-leg preview, use **Bones** to overlay the actual joints
and chains. Use **Pause** and **Step frame** to inspect the same pose on both
sides. Pick a slower speed or another angle to follow the legs and tail.

```powershell
npx brep verify projects/brep-poc/studies/capsule-space-cat-silhouette/fused-tail.brep.ts --check
node projects/brep-poc/studies/capsule-space-cat-silhouette/capture-rear-hip.mjs --fused-tail
```

### Joined legs and tail

`joined-cat.brep.ts` rounds both shoulders, both hips and the tail root on one
solid. The four legs taper to small rounded tips, about 90 mm across in the
rest bake. The preview reuses the leg gait and drives the tail from the existing
curve, with a blend into the torso at the root.

The owner set this experiment aside. To reproduce it, run
`build.mjs --experiments` and open `artifacts/brep-space-cat-silhouette/joined-cat.html`.
The experiment is on the left, with the first rear-hip study on the right.

```powershell
npx brep verify projects/brep-poc/studies/capsule-space-cat-silhouette/joined-cat.brep.ts --check
node projects/brep-poc/studies/capsule-space-cat-silhouette/capture-rear-hip.mjs --joined
npx --no-install stop-motion-ui run projects/brep-poc/studies/capsule-space-cat-silhouette/joined-cat.video.mjs --out artifacts/videos/space-cat-joined --codec h264 --fps 20
```

### Compact concept proportions

The compact joined bake uses the 780 mm torso, shorter rounded legs and a
lower tail that sweeps back. Its eyes sit deeper in the cheeks. The smaller
mouth, short whiskers and forward-facing ears follow the supplied Space Cat
sketch. Both models wear the same helmet and suit band for the comparison.

The owner set this experiment aside. To reproduce it, run
`build.mjs --experiments` and open `artifacts/brep-space-cat-silhouette/concept-fit.html`.
The compact fit is on the left, and the joined legs and tail experiment is on the right.

```powershell
npx brep verify projects/brep-poc/studies/capsule-space-cat-silhouette/joined-cat.brep.ts --check --param compact=true
node projects/brep-poc/studies/capsule-space-cat-silhouette/capture-rear-hip.mjs --concept
```

## Current state

- Tube (body 900): volume 276.8 M mm³, bounds x ±318, y −727…520, z −280…460 mm.
  9,553 triangles. Verified at defaults, each parameter at both limits, and both
  all-min / all-max corners.
- Fat cat: volume 288.6 M mm³, bounds x ±345, y −727…340, z −360…460 mm.
  8,451 triangles. Verified the same way.
- Leg (defaults): volume 5.21 M mm³, bounds x ±89.1, y −112.9…80.9, z −108.5…265 mm,
  2,018 triangles at the 60 mm bevel. Verified at defaults, both limits of every
  parameter, and both all-min / all-max corners; `verify.mjs` checks all three
  parts (35 cases).
- Baked presets: fat cat, tube 780, tube 900, tube 1100, plus one leg.

## Open

- The rigged legs live in this study only. The production actor still swaps in
  `RubberHoseLimbMesh`, because the baked leg arrives as a GLB and the app has no
  baked-geometry path yet. The first fused rear hip remains in the study preview.
- The knee reads as a soft crease at close range: two segments concentrate the
  bend at one joint. More bones, or a knee blend that follows the curve, would
  smooth it.
- The hind legs and tail follow the body length in the study through the Concept
  Fit builder's `rearExtension` option: they keep their stock distance from the
  rump instead of stretching with it. A production bake still has to pass the
  baked body's rump offset to the actor the same way.
- The body shader's natural two-tone seam still lands mid-body and reads as a
  faint belt on the assembled cat.
- The rig advice from the first review still stands: keep one visible mesh and
  blend baked skin weights between a head bone and the torso for head turns.
  Not implemented here; it belongs to the actor rig.
