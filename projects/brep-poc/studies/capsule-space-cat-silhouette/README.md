# Capsule space cat silhouette study

Two catalogued bodies for the Concept Fit cat, both single manifold solids:

- **Tube and sphere** (`capsule-space-cat-tube.brep.ts`) — the intended shape. A
  capsule body with a sphere head fused on and a fillet bevel where they meet.
  The body length is one parameter, so the cat can be short or long.
- **Fat cat** (`capsule-space-cat-fat.brep.ts`) — a kept option. Two overlapping
  balls (head and body) fused and filleted. Funny, not the target.

Both keep the Concept Fit head ellipsoid in the same size and place, so the
existing eyes, ears, whiskers and nose keep their anchors. The study scripts and
the preview bake from both parts side by side.

An earlier version lofted one oval profile from rump to muzzle. It is kept only
in the history as a rejected approach: one profile cannot be a ball head and a
barrel body at once, so the head turned into a wedge and the chest bulged under
the jaw.

## Commands

```powershell
npx brep verify projects/brep-poc/src/app/part/capsule-space-cat-tube.brep.ts --check
node projects/brep-poc/studies/capsule-space-cat-silhouette/verify.mjs        # both parts, 22 cases
node projects/brep-poc/studies/capsule-space-cat-silhouette/profile.mjs 900   # tube numbers
node projects/brep-poc/studies/capsule-space-cat-silhouette/build.mjs         # bake GLBs, preview
node projects/brep-poc/studies/capsule-space-cat-silhouette/capture.mjs       # comparison images
```

Output goes to `artifacts/brep-space-cat-silhouette/`. Open `preview.html` there
to orbit the result; it embeds the GLB bytes that `brep verify` measured.

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

## Current state

- Tube (body 900): volume 276.8 M mm³, bounds x ±318, y −727…520, z −280…460 mm.
  9,553 triangles. Verified at defaults, each parameter at both limits, and both
  all-min / all-max corners.
- Fat cat: volume 288.6 M mm³, bounds x ±345, y −727…340, z −360…460 mm.
  8,451 triangles. Verified the same way.
- Baked presets: fat cat, tube 780, tube 900, tube 1100.

## Open

- The hind legs and tail follow the body length in the study through the Concept
  Fit builder's `rearExtension` option: they keep their stock distance from the
  rump instead of stretching with it. A production bake still has to pass the
  baked body's rump offset to the actor the same way.
- The body shader's natural two-tone seam still lands mid-body and reads as a
  faint belt on the assembled cat.
- The rig advice from the first review still stands: keep one visible mesh and
  blend baked skin weights between a head bone and the torso for head turns.
  Not implemented here; it belongs to the actor rig.
