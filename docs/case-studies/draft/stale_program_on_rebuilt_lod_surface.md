# Case Study: A Rebuilt LOD Surface Reused a Stale Shader and Stayed Glued to the Camera

## Summary

After switching quality in the LOD water spike and then moving the camera, the water, its wave crescent and
the terrain it cut through moved with the camera, and rectangles of water went missing. A fresh page load
looked fine. The cause was one missing flag: `createLodSurfaceMesh` rewired a **shared, caller-supplied
material** for a new surface without setting `material.needsUpdate`, so three.js reused the compiled program
of the discarded surface. The fix is one line plus a spec. Finding it took a long time because the existing
test host froze the camera and the clock, which is exactly the condition under which the bug cannot show.

Plan and records: [Plan 080](../../plans/080_lod-water.md), [ER 080](../../engineering-records/080_lod-water.md)
(entry "the water stayed fixed to the camera after a quality change").

## Symptoms

- Page load and the first quality: correct.
- Switch quality (observed on Low), then rotate, pan or zoom: waves and the crescent follow the camera, the
  water plane cuts through terrain, and blocks of water disappear and reappear as the camera moves.
- Holding the camera still after the switch looked correct.

## Mechanism

1. Every quality tier changes the leaf cap, so a quality change always builds a new selector **and** a new
   surface mesh (the instance capacity is part of the build key).
2. Each surface owns per-surface uniforms (`uAnchor*`, `uBendShift`) that are rewritten from the camera
   every frame, and its vertices are camera-relative.
3. The water body passes one shared material to every surface it builds. `createLodSurfaceMesh` assigned a
   new `positionNode` to that material but never flagged it as changed.
4. three.js (0.187) caches the compiled node builder state per render object, and the material's program
   cache key is recomputed only when `material.version` changes. The new mesh therefore reused the old
   build, which was bound to the **old** surface's uniforms. Nothing updated those any more.
5. Result: positions were computed against a frozen anchor while the object followed the camera, so the
   surface stayed rigidly in front of the camera and rotated with it.

The land body was not affected by the cache itself: it has no material input, so it creates a fresh material
per surface. Its odd look was the camera-locked water slicing through it.

## Why it was hard

- **The test host hid it.** The camera-quality probes used a held view (camera and wave time frozen). A stale
  anchor and a correct anchor are indistinguishable when the camera never moves.
- **It looked like several bugs.** A moving crescent, terrain "swimming" and culled blocks pointed at the
  selector, the morph, the cull and the wave shader; none of them was wrong.
- **Page load worked**, so it looked like a state or ordering problem in the quality switch rather than
  program reuse.
- **It can contaminate earlier measurements.** Any run that switched quality before measuring drew the
  stale surface.

## How it was found

1. The owner recorded the symptom as video. A new test suite (`water-lod-spike-camera-quality`) drives a
   *live* camera (orbit, zoom and pan) across quality switches and records short clips with a headless
   Chrome on the real GPU. The built-in browser pane renders at about 1 fps, so it cannot judge motion.
2. The owner's read of the clips ("something is not rebuilt, or added twice and not stopped from a previous
   build") narrowed it to rebuild state.
3. A review agent was given a pre-gathered brief (code paths, the three.js cache logic, the symptom list)
   and answered questions instead of exploring. It ranked a stale cached program on the shared material
   first, at about 80% confidence. The code path in step 4 above matched.

## Fix

In `projects/triangular-engine/lod-surface/core/lod-surface-mesh.ts`, after wiring a *supplied* material:

```ts
if (!ownMaterial) material.needsUpdate = true;
```

The default material is new per surface, so it compiles fresh and is left alone. A spec
(`lod-surface-mesh-supplied-material.spec.ts`) builds two surfaces on one material and asserts that the
version rises and `positionNode` changes, and that the default material's version stays 0. It is a public
behaviour fix with a CHANGELOG entry and no API change; it also covers any page that passes `[material]`
to a terrain component.

## Verification

- The new spec passes headless.
- The six-case camera-quality suite on the real GPU passes (median frame 6.1 ms). In the switch-then-orbit
  clip, a frame that had a rectangle of water missing is whole afterwards. One blank frame remains at the
  switch: that is the pipeline compile, not this bug.
- The owner reviewed the new clips and judged it fixed.
- Not done: the cache was never inspected directly (for example the render object's builder state before and
  after the flag). The evidence is the code path, the review, and the before/after clips.

## Lessons

1. **A material that outlives its mesh must be re-flagged when the mesh rewires it.** Mutating a node graph
   on a shared material (`positionNode`, uniforms captured in nodes) needs `needsUpdate`; three.js will not
   notice on its own. Prefer a fresh material per surface when sharing is not needed.
2. **A test that freezes time or the camera cannot catch a bug that only exists in motion.** Cover state
   transitions (quality, rebuild, resize) with a live-motion case and a recorded clip, not only frozen-pose
   assertions.
3. **When symptoms span several unrelated systems after a rebuild, suspect reuse of build state** (caches,
   compiled programs, pipelines) before the systems themselves.
4. **Hand a reviewer a gathered brief and ask questions.** A focused Q&A against pre-collected code paths was
   faster than another round of open-ended probing here.
5. **Re-check measurements taken across the faulty path.** Performance numbers that switched quality before
   measuring need a clean rerun.
