# External review: Plan 059 G6 (globe-to-map morph), second reader

Reviewer: independent agent, 2026-10-31. Read-only review of the working tree and index against `HEAD`
(staged and unstaged). I read the plan and record D-G6m sections, the entry README, the frame/metric/selector,
mesh/pack/memo, floor-fan stage, body/component wiring, the bench, settle, churn, order/skip and material
specs, and the `planet-scene` v2 definitions. Fan vertex maths and the frame trig internals were read, not
re-derived. The two budget-300 bench cases and the settle set bound failed exactly as documented.

## Verdict

Safe to build on with fixes: I found no wrong-output defect in the morph, pack, memo or selector paths, and
the memoised pack is bit-identical over a varied 160-frame sweep. The biggest problem is the amortised
refresh: under a morph animation it never settles, so nodes are measured at morphs far from the live one
while the docs claim a one-step lag bound, and most frames end with a stale tree (164 of 180 refreshes
superseded, 716 of 835 frames end stale at the default budget). Second, the pole-fan pipeline is never
pre-warmed, which explains the `orbit-morph-0.5` readback timeout.

## Findings

| # | Severity | File:line | Defect | Sureness |
|---|---|---|---|---|
| 1 | major | `core/lod-morph-metric.ts:21-31`, `:296-321`; `core/lod-selector.ts:680-688` | The refresh lag is genuinely bounded by `morphStep` only when the view stops; under animation refresh passes are superseded and per-node geometry ages without limit, but the docs claim and pad for one step. | Confirmed by running the bench; visual effect suspected |
| 2 | major | `components/attach-lod-terrain.ts:107-116`; `core/lod-morph-fan-stage.ts:186,211` | Only `surface.mesh` is pre-compiled; the pole-fan mesh is created hidden, shown on the first morph pack, and its pipeline compiles on its first draw. | Confirmed by reading |
| 3 | major | `demo-app/.../planet-scene-test-adapter.ts:63-64,214-219` | The "no rebuild storm" check is a per-frame **max** under 8 ms, while the accepted fan rebuild alone is 5-10 ms and the bench only targets a p95 under 8 ms. | Confirmed by running the bench |
| 4 | minor | `core/lod-morph-sweep.bench.spec.ts:27-29` vs `:237-245` | The file header still says the budget-300 bounds are 720 packs and 5/15 ms; the assertions are 80 packs and 2/8 ms. | Confirmed |
| 5 | minor | `terrain-planet-material.spec.ts:319-321` | The "draws ... at morph 0 and 1" test asserts only `globe[3] > 0.99`; a morph-1 draw that covers nothing passes. | Confirmed by reading |
| 6 | minor | `core/lod-morph-settle.spec.ts:76-81` | The 2 % drawn-*count* tolerance passes while the leaf *sets* differ by 10.3 %; it is not by itself a statement of settling. | Confirmed by running |
| 7 | minor | `core/lod-terrain-body.ts:316,396`; `core/lod-surface-mesh.ts:604-606` | `morphState` is a getter returning a new object, called twice per `update`, so the body path does allocate per frame (small objects). | Confirmed |
| 8 | nit | `core/lod-surface-mesh.ts:566-579` | The pack key stores `forward` and `up` but not `right`, although the pack reads `right` (`longitudeOf`, pole longitudes); a hand-built `MorphBasis` can skip a needed pack. | Confirmed; unreachable through `<planet>` |
| 9 | nit | `core/lod-surface-mesh.ts:135-137,196-201`; `core/lod-terrain-body.ts:76-79`; `README.md:200` | TSDoc/README still say `<planetTerrain>` does not use the morph, that the selector selects in the unbent frame, and that instance buffers change only when the drawn leaves change. | Confirmed |

## The two real-GPU failures

- **`orbit-morph-0.5` GPU readback timeout: the code explains it, with a suite assist.** In a v2 run (or a
  batch of the five morph cases) this still case is the first at morph > 0. The terrain group stays hidden
  until the *surface* pipeline warms; the pole-fan mesh is then uploaded (its first non-empty geometry),
  becomes visible and draws, compiling its own pipeline. `attachLodTerrain` never warms `poleFanMesh`, and
  the settle loop waits for rendered frames, not for that compile, so the 500 ms timestamp readback can
  expire after settling or in the measured window. The adapter tolerates `GpuReadbackTimeoutError` only
  while settling and only three times; the record's G6f claim that "the first GPU draw gets a long timeout"
  is not implemented (record:1997). The suite's contribution is running it first among the morph cases.
- **`morph-sweep` 20.6 ms selection: the code explains it; the suite's statistic makes it certain.** My bench
  run of the page path at budget 300: packing frames p95 13.3 ms, max 28.4 ms; non-packing frames max 3.7 ms;
  pole-fan rebuilds max 10 ms. A single 20.6 ms frame is a pack frame with a fan rebuild, i.e. the accepted
  "fan topology rebuilds can spike up to about 30 ms" item. The suite asserts the **maximum** of ~375 frames
  under 8 ms, which is the bench's p95 target, so a red result is guaranteed by design, not just by this run.

## Per finding

1. During the 0->1->0 sweep at budget 300, invalidations arrive every ~4.6 frames but a full tree needs ~14
   passes; 164 of 180 refreshes are superseded and 716 of 835 frames end with stale nodes (median 3278 of
   ~4000). `takeSnapshot` moves `measuredAt` on every invalidation, while nodes not reached keep their old
   `geoStamp` geometry; the pad is `3 * 0.01 = 3 %`, so a node lagging 0.1-0.2 morph (plausible here) is
   under-padded. `measuredMorph` reports the newest snapshot, not each node's measurement. Smallest fix:
   do not start a new snapshot while a spread is open (keep selecting in the measured frame until
   `geometryStale` is 0), or store each node's measured morph and force a full refresh past a lag of N
   steps; then make the docs state the real bound.
2. Scenario above. Smallest fix: gate the terrain group's visibility on the surface *and* (once it exists)
   the fan mesh having warmed, e.g. extend `warm()` to compile `body.surface.poleFanMesh` when it is
   non-empty and re-run it when the fan is first uploaded; alternatively build the fan before settling and
   compile it there.
3. 20.6 ms is within the known fan-rebuild tail and below the accepted ~30 ms. Smallest fix: assert the
   p95 (or the 99th percentile) against 8 ms and keep the max as a reported number, or exempt the frames
   that cross morph 0 / rebuild the fan; separately, `selectionMs` includes the fan rebuild, so the check
   is not measuring only the quadtree.
4. Replace the header paragraph with the current targets and current numbers (247 packs, median 2.3-2.5 ms,
   p95 ~5-7 ms isolated), and say the bound is the brief's, restored after G6h/G6i.
5. Add `expect(flat[3]).toBeGreaterThan(0.99)` (and ideally that the pixel differs from `globe` at morph 1);
   otherwise the test cannot distinguish a flat draw from an empty one.
6. Keep the count check only as a secondary guard; the set bound is the property and it fails honestly.
   Consider running one case below the leaf cap, where exact equality should hold.
7. Reuse a `morphState` object (or expose `morph` as a number) and read it once per update; the allocation
   is small but the record's "no per-frame allocations" wording should not be widened to the body path.
8. Include all three basis vectors in `fillPackKey`; cost is one compare. Or document that the basis must be
   orthonormal with `right = up x forward`, which the framework guarantees but the public type does not.
9. Update the three TSDoc blocks (the README morph section is already correct) and the README sentence
   about when instance buffers are rewritten (projection/basis and pole-flag changes also pack).

## Claims checked and held up

- Memo pack bit-identical: `lod-morph-leaves-memo.spec.ts` compares whole `Float32Array`s (including the
  unused tail) over 160 states with cut/pole crossings, morph 0->1->0, a projection-centre change, and
  skip/duplicate toggles; green.
- `stretchMapXY == planetMapXY` bitwise (`toBe`), and the new `morphMapXY` is what `stretchMapXY` calls; green.
- Order-insensitive signature: reversed and seeded-shuffled orders do not pack; one leaf swapped or one
  first-position leaf changed does; post-skip records equal a full pack as a multiset; green.
- Globe fields on the GPU: morph 0 gap 0.00 m, radius error 0.083 m; morph 1, 4096 pixels, normal p99 6.9e-6,
  max 2.7e-3 - matches the recorded known item.
- Hook/metric exclusivity and culling restore match the README and the new body specs; `<planetTerrain>` at
  morph 0 draws the same leaves as a body without the morph.
- Public API additions are only `POLE_FAN_DEFAULT_RAYS`, `PoleFanStats` (plus the documented
  `MorphLeafMemo`/`packMorphLeavesMemo`); every new public symbol has TSDoc; no private repos named.
- G6i looks finished, not in flux: its spec and the buffer-comparison spec pass; no other failure was attributed to it.

## Claims checked and not held up / could not check

- G6h "in-place map and frame maths bit-identical, 21,204 checks, 0 mismatches": no spec reproduces it, and
  against `HEAD` it is false for the Equal Earth branch of `morphMapXY` (split form vs row factor; most
  random samples in a quick comparison differed by ~1 ulp). It now agrees exactly with `planetMapXY`, which
  is the better target; the record's wording is what is wrong.
- Record G6f: "the first GPU draw gets a long timeout" - not implemented (only 3 settle-time tolerances).
- Not run (per brief): the browser perf suite. Real-GPU pole precision, the `'bent-bounds'` culling error,
  and whether an order-only skip's stale fan numbering is invisible remain unverified.
- Fan vertex maths: specs (rim within 1 px, zero holes, cut copy) were read but not re-derived.

## Test results

- `npx ng test triangular-engine --watch=false --browsers=ChromeHeadless --include="../lod-surface/**/*.spec.ts" --include="../planet-material/**/*.spec.ts"`:
  469 executed, **466 pass, 3 fail**, all three the documented expected failures:
  bench body-300 (247 packs, median 2.5), bench sweep-300 (247 packs, median 2.3), settle (10.34 % set difference).
- `npx ng test demo-app --watch=false --browsers=ChromeHeadless --include="**/planet-scene/**/*.spec.ts"`: **36/36 pass**.
- `npm run build:triangular-engine`: OK (46 s).
- `npm run triangular -- docs records check`: **OK** (11 mapped, 22 legacy).

## Questions for the owner

1. Animation-time refresh: (a) block new snapshots until the spread settles, (b) track per-node lag and
   force a full refresh past N steps, or (c) accept unbounded lag and correct the docs/padding. The choice
   changes the morph's frame cost and the popping behaviour near the pole.
2. Fan first draw: (a) pre-warm the fan and gate visibility on it, (b) treat a first-fan-draw timeout as
   settle, or (c) pre-build the fan topology before the morph cases run. Pick one before re-running v2 on
   hardware.
3. Storm bound: (a) p95, (b) exempt morph-0 crossings and fan rebuilds, or (c) keep the max and budget the
   fan rebuild down. The current check cannot be green with the accepted fan cost.
4. Settle: (a) keep the 5 % set bound red until the cause is known, (b) set a measured bound and record it,
   or (c) add a below-the-cap case where exact equality is required.
