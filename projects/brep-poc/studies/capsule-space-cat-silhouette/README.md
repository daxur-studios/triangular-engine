# Capsule space cat silhouette study

One lofted surface from rump to muzzle replaces the separate head sphere and
capsule torso of the Concept Fit cat. The part is
`projects/brep-poc/src/app/part/capsule-space-cat-silhouette.brep.ts`; this folder holds the
verification, bake, capture and preview scripts.

## Commands

```powershell
npx brep verify projects/brep-poc/src/app/part/capsule-space-cat-silhouette.brep.ts --check
node projects/brep-poc/studies/capsule-space-cat-silhouette/verify.mjs     # 9 parameter cases
node projects/brep-poc/studies/capsule-space-cat-silhouette/profile.mjs 30 # side profile numbers
node projects/brep-poc/studies/capsule-space-cat-silhouette/build.mjs      # weld, bake GLB, preview
node projects/brep-poc/studies/capsule-space-cat-silhouette/capture.mjs    # comparison images
```

Output goes to `artifacts/brep-space-cat-silhouette/`. Open `preview.html` there to orbit the
result; it embeds the GLB bytes that `brep verify` measured.

## State after the first review

- Defaults are `headRise 30`, `cheekFullness 115`, `blendLength 340`. The preview also bakes
  `headRise 70` so the parameter still reads.
- Solid: one manifold body, volume 281,956,474 mm³, bounds x ±362.48, y −728.01…470.00,
  z −307.20…430.13 mm. 13,246 (subtle) and 13,326 (higher) triangles; GLB 319/321 kB.
- Back line: 151 mm drop from crown to shoulder, monotone, no shelf. The belly is drawn 20 mm
  lower at Y=−300 to fill behind the chin.

### Fixed while applying the review

- A 40 mm back lift centred at Y=−180 puts the shoulder above the crown; as a bump it also left a
  ledge visible from behind. The shoulder is now raised through the existing body lift (62 → 88 mm),
  which is monotone and leaves no ledge.
- The head profile used a circular falloff, so the eyes and whiskers floated off the face in the
  three-quarter view. A cubic falloff keeps the face full enough for the rig's anchors.

### Open

- The neck still pinches where the 355 mm head tapers to the 268 mm body. The reference cat's body
  is nearly as wide as its head; closing that needs a body-proportion change, not a parameter.
- The body shader's natural two-tone seam lands mid-body and reads as a faint belt.
- The reviewer recommended keeping one visible mesh and blending baked skin weights between a head
  bone and the torso, instead of splitting the geometry for independent head motion. Not implemented
  here; it belongs to the actor rig.
