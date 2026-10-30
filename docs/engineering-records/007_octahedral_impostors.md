# 007 — Octahedral impostor POC

## Status

The demo page lives at `projects/demo-app/src/app/pages/impostor-baker`.

## Progress

1. Added cube and tree source models.
2. Added octahedral atlas baking with configurable grid resolution.
3. Added crisp discrete-frame runtime.
4. Added reference-style shader blend runtime for comparison.
5. Added wireframe overlay and deterministic camera-cell locking.
6. Added camera-position markers on the atlas direction sphere.
7. Added a stress-grid control for large-scale performance testing.
8. Reworked the stress grid as one GPU-instanced mesh: every impostor retains its own world-space X/Z position and derives its own local camera direction in the vertex shader. There are no per-frame CPU instance-matrix updates.
9. Unified both runtime modes on this GPU path: **Crisp frame** samples the highest-weight octahedral frame; **Reference blend** samples the reference-style three-frame blend.
10. Matched the shader plane basis to the bake camera's projected world-up basis, with Z as the pole fallback.
11. Corrected shader atlas-row addressing for the canvas' top-to-bottom layout.

## Known issues / next work

- Visually verify the latest atlas-row correction: with the **tree** and a 100 × 100 grid, looking down from above must show tree tips, while looking up from below must show trunks. This was built but not visually checked after the final change.
- Validate lower-hemisphere roll and semi-polar aspect behavior for both runtime modes.
- Add deterministic regression tests for shader-equivalent atlas-row addressing, atlas cell selection, and octahedral direction mapping.
