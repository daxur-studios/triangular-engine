# External review prompt: Plan 059 G6 (globe-to-map morph), work done by Haiku 5.5 agents

Paste everything below the line into the reviewing agent. It is self-contained. It asks for a review report only; the reviewer changes nothing.

---

## Your role

You are an independent reviewer. You did not write this code and you have no stake in it. Review a body of uncommitted work in the repository at the current working directory (a TypeScript / Angular / three.js (WebGPU, TSL) workspace) and write a report. **You review. You do not fix.** Do not edit, create or delete any file in the repository except the one report file named at the end. Do not commit. Do not run git commands that change state (no add, restore, stash, reset, checkout, clean). Reading git state (`git status`, `git diff`, `git diff --cached`, `git log`) is fine; many files are staged by other people, so compare the working tree and the index against HEAD to see the whole change.

## Background (what was built and why)

Plan 059 builds a level-of-detail terrain library, `projects/triangular-engine/lod-surface`. Step G6 adds a **globe-to-map morph**: a planet-sized sphere terrain bends continuously into a flat map projection (equal-earth, selectable centre), driven by a `morph` value from 0 (globe) to 1 (flat map). The work was split into units G6a to G6i. Each unit was implemented by a Haiku 5.5 agent from a written brief, and each was reviewed by a coordinating session, but never by a second independent reader. Your review is that second reader.

Units, by what they added:
- G6a to G6c (earlier): the morph map maths (`core/lod-morph-frame.ts`), the mesh bend, and `StretchMetric` (`core/lod-morph-metric.ts`), which measures how much each node stretches under the bend so the selector can pick levels in the bent frame.
- G6d: the **pole fan** (`core/lod-morph-fan.ts`, `core/lod-morph-fan-stage.ts`, `core/lod-morph-fan.testing.ts`): the leaves that hold a projection pole are drawn as one fan in the vertex stage so there is no seam at the pole above morph 0. Limit by design: the fan is the base sphere in a flat colour (no height, detail or terrain material).
- G6e: `StretchMetric` re-measures a bounded number of nodes per selection pass (`refreshBudget`, default 300); `LodSurfaceNodes.globePosition` / `globeNormal`; `TerrainPlanetMaterial({ morphUniforms })` (cells and relief stay on the globe, shading normal blends to the bent up, direct shadows off above morph 0); `<planetTerrain>` inputs `morph`, `projection`, `projectionCentre`; `LodTerrainBody.setMorphMetric`; `'bent-bounds'` culling.
- G6f: new cases in the demo page's browser test suite `planet-scene` version 2, under `projects/demo-app/src/app/pages/planet-scene/`.
- G6g: measured the per-frame selection cost of the morph sweep (a camera sweep at several morph values).
- G6h: removed per-frame allocations and an unstable selector camera (`placeCamera` now uses the map the metric last measured at, `measuredAt`); added `core/lod-morph-sweep.testing.ts`, `core/lod-morph-sweep.bench.spec.ts` (rewritten, 6 cases) and `core/lod-morph-settle.spec.ts`.
- G6i (may still be running when you start; treat its files as in flux and say so): memoising per-leaf pack records / packing incrementally in `core/lod-surface-mesh.ts`, with a buffer-comparison spec and `core/lod-morph-leaves-memo.spec.ts`.

Decisions the authors made, which you should check were honoured and also challenge if they look wrong:
- Public signatures do not change except where the plan says so. Refresh policy, morph step and hysteresis were not to be changed to make a test pass.
- A test or benchmark that misses its target is to be reported with the numbers, never loosened. **Two budget-300 bench cases in `lod-morph-sweep.bench.spec.ts` fail on purpose** (targets: packs at most 80, median under 2 ms, p95 under 8 ms; after G6m, 247 packs and a median of about 2.2 to 2.4 ms). G6i (memoised pack) and G6m (order-insensitive signature) reduced the cost but did not meet them. The bounds were loosened by G6h and G6i and restored by the coordinator; a loosened bench is a finding. `lod-morph-settle.spec.ts` also fails on purpose (leaf-set difference 10.3% against 5%). G6j to G6m (churn measurement, hook and culling rules, spec strengthening, order-insensitive signature) are also in scope: see the record. A failing bench that honestly reports a miss is expected; a bench that was quietly loosened is a finding.
- `lod-morph-settle.spec.ts` asserts the drawn leaf count within a **2% tolerance**, not exact equality, because hysteresis plus the leaf cap make exact settle-equality impossible. Judge whether 2% is a sound statement of the property or a way to hide drift.
- G6h added a **tree-signature check** in `lod-surface-mesh.ts`; this was a deviation from its brief and was accepted by the coordinator. Judge it on its merits.
- Known and accepted open items (do not report these as new findings unless you find they are worse than described): the fan has no terrain material, height or detail; fan topology rebuilds can spike up to about 30 ms; 16 of 4096 pixels reach a 3e-3 normal error in the globe-normal GPU spec (cause unknown); relief fades as the map flattens; the pole-zone float32 precision floor within about 60 m of a pole is unmeasured on a real GPU and there is no pole-camera test case; the `'bent-bounds'` culling error is unmeasured; the atmosphere, clouds and scatter do not morph; the refresh budget default of 300 is a guess.

## What to read

Start with the plan and record for intent and the claimed results: `docs/plans/059_lod_surface_core.md`, `docs/engineering-records/059_lod_surface_core.md` (the dated sections for G6d, G6e and later), and `projects/triangular-engine/lod-surface/README.md` (the morph sections). Then read the changed code. The change set (compare against HEAD; includes staged and unstaged):

Library, `projects/triangular-engine/lod-surface/`:
- `core/lod-morph-frame.ts`, `core/lod-morph-metric.ts` (+ `.spec.ts`), `core/lod-morph-leaves.ts`, `core/lod-selector.ts` (+ `.spec.ts`)
- `core/lod-morph-fan.ts`, `core/lod-morph-fan-stage.ts`, `core/lod-morph-fan.testing.ts`, `core/lod-morph-fan.spec.ts`, `core/lod-morph-fan-vertex.spec.ts`
- `core/lod-surface-mesh.ts` (+ `.spec.ts`, `-globe.spec.ts`, `-pole-fan.spec.ts`), `core/lod-terrain-body.ts` (+ `lod-terrain-body-morph.spec.ts`), `core/public-api.ts`
- `core/lod-morph-sweep.testing.ts`, `core/lod-morph-sweep.bench.spec.ts`, `core/lod-morph-settle.spec.ts`, `core/lod-morph-leaves-memo.spec.ts`
- `terrain-planet-material.ts` (+ spec)
- `components/planet-terrain.component.ts` (+ spec), `components/planet.component.ts`, `components/attach-lod-terrain.ts`
- `README.md`, and `projects/triangular-engine/CHANGELOG.md`

Demo app, `projects/demo-app/src/app/pages/`: `planet-scene/` (`planet-camera.ts`, `planet-scene-page.component.ts`, `planet-scene-test-adapter.ts`, `planet-scene-tests.ts`, `planet-scene.spec.ts`) and `lod-surface-lab/lod-surface-lab-page.component.ts`.

Do not review, and do not comment on: the character studio, capsule or characters-lab code, plans/records 070, 073, 074, `AGENTS.md`, `planet-surface-detail-spike`, or the older terrain entry. Other people's work lives there.

## What to look for

Rank findings by severity. For each, give the file and line, what is wrong, a concrete failing scenario (inputs or state, then wrong output), and how sure you are (confirmed by running or reading, or suspected).

1. **Correctness of the morph maths and the mesh.** Does the bend, the unbend (camera into the globe frame), the `globePosition` / `globeNormal` pair and the camera-relative offsets (`uBendShift`) agree with each other and with the README? Float32 loss anywhere camera-relative maths could be done in double on the CPU first. Behaviour at the poles, at the antimeridian and for a non-zero `projectionCentre`.
2. **Bit-identical claims.** G6h states the in-place map and frame maths are bit-identical to the old code (21,204 checks, 0 mismatches). G6i states the incremental pack is bit-identical to a full pack. Read the specs that claim this: do they actually compare full buffers, over enough varied states (level changes, leaves entering and leaving, morph changes, projection centre changes), or only a lucky subset? Is a stale-cache path possible (a memoised record reused after its inputs changed: height source, settings, morph, projection, domain)?
3. **Selector behaviour.** The metric refresh is amortised across frames. Look for flicker, popping, a drawn set that depends on frame history in a way that is not bounded, culling that drops visible terrain (`'bent-bounds'`), and any path where the leaf cap or hysteresis can lock in a wrong result.
4. **Allocation and performance claims.** G6h says there are no per-frame allocations. Check the hot paths (`select`, `refresh`, `upload`, fan update, `setMorph`) for hidden allocations: closures, array literals, spreads, `map`/`filter`, `new Float64Array`, string keys, iterators.
5. **Tests that cannot fail, or that were weakened.** Assertions that compare a value to itself, thresholds that were loosened, a `console.log` standing in for an assertion, tests that pass because nothing is drawn (covered-pixel counts of zero), or bench cases that measure the wrong thing. Compare the bench's stated targets with its assertions and with the numbers in the record.
6. **Public API and docs.** Anything exported that was not meant to be (`public-api.ts`), a signature change not listed in the CHANGELOG, TSDoc missing on a public symbol, and any README or CHANGELOG sentence that is false or overstated against the code. Examples to check specifically: that `body.setMorphCulling` and `setGeometryHook` / `setMorphMetric` are described as exclusive in the way the code actually enforces; that the pole fan limit is stated.
7. **Demo-app suite (`planet-scene` v2).** Do the cases measure what their names claim? Is a judgement threshold set so loosely that it cannot fail? Is the `orbit-morph-0.5` case first in its run and prone to a one-off GPU readback timeout, and does the code handle that?
8. **Conventions of this repo.** No private repositories or consumer apps named anywhere; colocated specs for behaviour changes; no generated output edited; Angular and TSDoc style matching the surrounding code; comments that match the density and tone of nearby code.

## What you may run (read-only commands and headless tests)

You may run these. Tests must be headless and non-watching. **Never** start `ng serve` or any dev server, never open a visible browser for tests, and do not run `triangular docs records baseline`.

```bash
npx ng test triangular-engine --watch=false --browsers=ChromeHeadless --include="../lod-surface/**/*.spec.ts" --include="../planet-material/**/*.spec.ts"
npx ng test demo-app --watch=false --browsers=ChromeHeadless --include="**/planet-scene/**/*.spec.ts"
npm run build:triangular-engine
npm run triangular -- docs records check
```

Expected: the lod-surface and planet-material suites pass except the budget-300 bench cases if G6i has not finished; the library builds; the records check reports OK. Report any other failure with its output. If G6i is mid-edit and a spec fails for that reason, say so and move on rather than chasing it.

Do not run the browser perf suite (`npm run test:run`); it needs a GPU session and the coordinator's receiver.

## Report format

Write one file, `docs/handover/external-review-report-plan-059-g6.md`, and nothing else. Keep it under about 120 lines.

1. **Verdict** (3 sentences): safe to build on, safe with fixes, or not safe, and the single biggest reason.
2. **Findings table**: severity (blocker / major / minor / nit), file:line, one-sentence defect, how sure.
3. **Per finding**: the failing scenario and the smallest fix you would suggest, as prose or a short snippet. Do not apply it.
4. **Claims checked and held up**: a short list (for example "bit-identical frame maths: spec compares whole buffers, 4 states, OK").
5. **Claims checked and not held up**, and **claims you could not check** with the reason.
6. **Test results**: the commands you ran and the pass and fail counts.
7. **Questions for the owner**: any choice you found that the code makes silently and a human should decide, each with its options.

Be specific and sceptical. Praise is not needed. A finding you are not sure of is still useful if you say how sure you are. If you find nothing in a category, say what you looked at so the coordinator knows the category was covered.
