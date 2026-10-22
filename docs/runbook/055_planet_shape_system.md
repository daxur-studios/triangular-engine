---
type: Runbook
title: Planet Shape System
description: Findings, decisions, race results and timings for terrain attempt 5.
timestamp: 2026-10-19T00:00:00Z
tags: [terrain, planet, lod, raymarching, sdf, tsl, webgpu, performance, testing, morph, cell-planet]
plans: [/docs/plans/055_planet_shape_system.md]
performance: []
---

# Runbook 055: Planet Shape System

Plan: [Plan 055](/docs/plans/055_planet_shape_system.md).

## 2026-10-19 — Plan written (code reading and web research only)

Nothing was built, run or measured.

### Owner's asks

- Start terrain fresh, with performance measured and correctness tested at every step and for every addition,
  each enhancement measured on and off. The cloud volumes lab (Plan 051) is the model process.
- Targets: 150–160 fps at planetary scale; stylized mountains and surface features; real-time edits (base pads, a
  growing volcano, rivers, roads); cliffs, overhangs and tunnels past what a heightfield allows; fast zoom, orbit
  and time warp.
- Cell planets stay, as a data model. How a cell becomes shape is decided per game.
- The sphere-to-2.5D-map morph is required, as a visual change only.
- Get the CPU/GPU data flow right, and reuse a core where possible.
- Test scenarios the owner asked for: silhouette against an ideal reference render; a volcano that keeps its shape
  at low LOD; a placed base that never floats or sinks with zoom; waterline and river shape, with no lakes or islands
  appearing or vanishing, and a base on a small island never looking like it is in water.
- Interest in raymarched planets, and whether fur, plants and fuzzy surface detail could share a core with the
  clouds.
- Run several spikes at once as a race.

### Owner's decisions

- `WebGPURenderer` becomes the engine default. Recorded as Plan 055 D3. The switch needs its own plan.
- The raymarched hybrid (contender C) is in the race (D5).
- A contender that fails a gate pauses for owner review, with the options stop, push or harvest (D6).

### Findings: why attempts 1–4 failed

From [Runbook 028](/docs/runbook/028_planet_terrain_attempt_history.md) and the consumer game's terrain notes:

- Each attempt picked an architecture before measuring. In-game draw calls and frame times for attempts 1, 2 and 4
  were never captured.
- Several failures were scaling problems: uniform triangle density reaching about 1.1M triangles (the error metric
  used the body's global elevation span), and a CDLOD geometry cache that grew without bound.
- The CDLOD ground flicker on a still camera was never explained. A still-pose flicker test would have caught it.
- Attempt 4 (the cell planet) was the only one with the right variety, but its performance complaint was never
  measured, and its edits stop at one cell's resolution (0.5 km or more).

### Findings: the cloud volumes process and its gaps

The parts worth copying: a lab page per feature, go/no-go lines with numbers, every timing taken still and in a
moving worst case, dated runbook entries with Built / Checked / Not measured / Found, corrections recorded when a
run was invalid, and the generic runner in `triangular-engine/testing` (`TestSuite`, `TestScenario`,
`TestRunAdapter` with capture / apply / ready / measure / restore; results POSTed to `artifacts/test-runs/`).

Gaps that Plan 055 Phase 0 closes:

- One whole-render GPU number; attribution only through toggles, which recompile shaders and can distort results.
- No draw-call or triangle counters in the lab, no streaming or edit metrics, thin tails (6–20 samples for still
  cases), no histograms.
- The timer once read mid-frame; in-flight readbacks survived resets.
- Correctness by eye only: no golden-image or depth checks.
- `performanceVerdict` is always "unassessed": no budget or baseline store. (Closed 2026-10-20, see the last entry.)
- The runner and the lab compute p95 with different indices.
- The real-GPU Playwright profile (`playwright.cloud-feasibility.config.ts`) exists but drives only the probe, not the lab.
- WebGPU's 16 samplers per stage capped clouds at about 7 volumes per pass, so the terrain must pick its atlas and
  `textureLoad` strategy early.

### Findings: platform

- three.js `0.186.1`. The engine defaults to `WebGLRenderer`; `WebGPURenderer` is opt-in via
  `preferredRenderer: 'webgpu'` (`engine.service.ts`, `initRenderer`). The postprocessing composer and the takram
  clouds and atmosphere require WebGL.
- No compute shaders, storage buffers or indirect draws anywhere in the engine yet. The cloud bakes are fragment
  passes.
- GPU timing exists: opt-in `gpuTiming` sets `trackTimestamp` and keeps one `resolveTimestampsAsync('render')` in
  flight. `FrameSampler` gives CPU, wall and GPU medians and p95 with a verdict. `FPSController` keeps per-second stats.
- `FloatingOrigin` exists but the old terrain lab sets its own render origin. Jolt has `joltMeshShape`,
  `joltHeightFieldShape` (capped at 4096 samples) and `TerrainJoltColliderAdapter`.
- `terrain/clipmap` renders one `InstancedMesh` per level with an analytic GLSL height; `CdlodV3InstancedRenderer`
  has no consumers. No isosurface meshing exists in the engine.

### Findings: research (web)

- Unreal Engine 5.8 added an experimental Mesh Terrain: editor-authored 3D-mesh terrain with overhangs, floating
  islands and tunnels, built on Nanite and virtual textures
  ([GamesBeat](https://gamesbeat.com/epic-games-launches-unreal-engine-5-8/),
  [CG Channel](https://www.cgchannel.com/2026/06/see-5-key-features-for-cg-artists-in-unreal-engine-5-8/)).
  Runtime creation appears unsupported, per a community forum reply only
  ([forum](https://forums.unrealengine.com/t/does-5-8-mesh-terrain-support-creation-of-a-terrain-at-runtime-in-a-packaged-build/2730244/1)). Unconfirmed by Epic.
- Nanite builds its cluster hierarchy at import, and Nanite Landscape's live rebuild on modification is off by
  default because it "can noticeably hurt performance"
  ([Epic](https://dev.epicgames.com/documentation/unreal-engine/using-nanite-with-landscapes-in-unreal-engine)).
  Conclusion: borrow Nanite's ideas (bounded-error LOD, crack-free borders, GPU culling, constant draw count), not
  the system.
- WebGPU: compute and `drawIndirect` / `drawIndexedIndirect` are core. Multi-draw-indirect is a Chromium
  experimental feature only ([Chrome 131](https://developer.chrome.com/blog/new-in-webgpu-131)). No general
  64-bit atomics. Subgroups shipped in Chrome 134. Timestamps are quantized to 100 µs unless the WebGPU Developer
  Features flag is on ([Chrome 121](https://developer.chrome.com/blog/new-in-webgpu-121)).
- three.js has `BufferGeometry.setIndirect`, `computeAsync` and `resolveTimestampsAsync` on `WebGPURenderer`.
- Shipped planetary or cave terrain (No Man's Sky, Astroneer, Space Engineers, Enshrouded) is mostly voxel based,
  but the meshing algorithms and seam handling could not be confirmed from public sources. Not relied on.

### Findings: the morph

- The morph runs in the vertex stage: `mapXY = mix(eqXY, flatXY, morph)` and a height mix, with the default
  `'bend'` shape keeping every in-between point on a sphere of radius 1/k
  (`planet-material/planet-morph-nodes.ts`, `planetMorphGraph`, `planetBentSurfaceNodes`). CPU twins exist
  (`bendPlanetSurfacePoint`, `CellPlanetMorphCameraRig`, the morph raycast). Projection is equirectangular or Equal Earth.
- Atmosphere problems during the morph and their fixes are in Runbook 049 (masked per-ray march, `sunDip`, the slab
  elevation floor, edge-aligned baking). Tables are baked for one radius.
- Not yet bent: the cell planet's patch bounds (`cell-planet-morph-patch-bounds.ts` uses the straight mix) and the
  shadow pass (a morphed planet should not cast, per the CHANGELOG). The 049 docs lag the code: the bend is in GLSL
  and TSL since 2026-10-18.
- A raymarched contender must invert the morph per ray step. That is recorded as contender C's main risk.

### Findings: CPU/GPU data flow in a GPU gravity prototype (another project)

- Bulk particle and tree state stayed on the GPU; the CPU got only small readbacks (128–192 B per credit).
- A three-slot async readback ring removed the stall on submission, but round-trip latency stayed at about 42–61 ms.
- A page that awaited the GPU step and then a worker reply ran in lockstep.
- A credit buffer reached 163,584,000 bytes, above the default 134,217,728-byte binding limit.
- Lessons carried into Plan 055's data-flow core: never await the GPU in a frame, keep CPU-needed results small
  and frame-tagged, budget uploads, guard capacity against device limits, measure the whole round trip.

### Findings: consumer requirements (generic)

- Body radii in use range from 2 km to 6,371 km; relief is the smaller of 2 % of radius and 12 km.
- Time warp goes to 1,000,000x; a medium planet then turns about 240° per 60 Hz frame. Everything must be body-fixed.
- Many gameplay systems query height on the CPU (landing, base grading, placement, scatter, trajectory, ocean).
  So the CPU evaluator is the reference, and overhangs need a surface query beyond height.
- The consumer game's written target was 60 fps at 1080p, with no reference machine. Plan 055 replaces that with
  T1 and D1.

### Next

Owner review of Plan 055: confirm D1 (reference machine), D4 (WebGL2 fallback or WebGPU only) and D8 (terrain
budget), then Phase 0.

## 2026-10-19 — Owner review of D1, D4 and D8

Documentation only; nothing built or measured.

- **D1 decided:** the reference machine is the owner's desktop GPU at 1440p, DPR 1.
- **D4 decided:** WebGPU backend only. No WebGL2 fallback for the shape system, so compute, storage buffers and
  indirect draws are allowed in every contender. This applies to the shape system, not to the engine's renderer
  fallback in general, which the WebGPU-default plan decides.
- **D8 accepted as a working number:** terrain ≤ 2.0 ms GPU p95 including shadows, ≤ 0.5 ms main thread. The owner
  left the number to the plan's judgement and may move it once Phase 0 has measured the fixed costs (empty frame,
  atmosphere, clouds). Any change is recorded here before the race starts.

### Next

Phase 0: the test track and platform ceiling on `/planet-shape-lab`.

## 2026-10-19 — Testing entry point: cheap reading of results

**Built** (generic, in `triangular-engine/testing` and its bins; see the CHANGELOG):
- `TestSession` adds a nearest-rank `summary` (`count`, `min`, `median`, `p95`, `max`) to every metric with finite
  samples; `nearestRankPercentile` and `summarizeTestSamples` are exported, and `<tri-test-runner>` uses them.
- The receiver stores samples at 3 decimals with numeric arrays on one line, and writes `errors` plus per-scenario
  summaries and failed checks into each `index.jsonl` line.
- `npm run test:summary` reads only the index for new lines (older lines fall back to the file), prints constant
  metrics once and takes `--metric <text>`.

**Checked:** 25 headless specs in `test:triangular-engine:testing` and 4 Node tests in `test:triangular-engine:sink`
passed. Two existing results re-serialized with the new writer: 131,130 → 38,252 bytes and 108,766 → 30,689 bytes;
their index summaries are 1,178 and 2,401 bytes. Existing files and index lines were not rewritten.

**Found:**
- The summary command already existed (Plan 052); this change makes it cheaper. All three
  percentile implementations in the engine (runner panel, summary bin, `FrameSampler`) were already nearest rank;
  the disagreement recorded under Plan 051 is in the cloud lab's own fly-by helper.
- Stored `illustrative-terrain-cost@v1` runs: the `headless-hardware` runs (build `7efd040a`) show flyover frame
  intervals with medians of 73–164 ms, while the `visible-browser` run (build `3fdcef95`, a later commit with an
  unrelated material change) shows 6.1 ms. The two `visible-browser` runs on build `7efd040a` recorded no metrics,
  so there is no same-build pair. Not a controlled comparison, but large enough that Plan 055 takes timings from
  `visible-browser` until Phase 0 shows a matching headless profile.

**Not measured:** no new runs were made.

### Plan changes

Phase 0 gains **machine context** (the local receiver samples GPU, CPU, memory, power and the heaviest other
processes between the page's measuring-start and -stop messages), a **preflight gate** (wait or invalidate when
the GPU is busy, the machine is on battery or the GPU is hot) and an **empty-frame noise floor** before and after
each timing suite. Process names stay in local, gitignored results.

### Survey: machine-state sources on the owner's machine (read-only, via a Haiku subagent)

The owner pointed at a private local tool that already monitors this machine. Its code was surveyed, and its
commands run read-only. Findings, kept generic:

- **The machine is a laptop:** NVIDIA GeForce RTX 3080 Laptop GPU, 16 GB, driver 596.49. D1 said "desktop" and
  was corrected the same day (next entry).
- A one-off `nvidia-smi` query at survey time read 27 % GPU utilization at P5, 450 MHz SM clock, 53 °C and 19.6 W,
  with no test running. The machine is not idle by default, which is why the preflight gate is needed.
- The existing tool samples only VRAM, through `nvidia-smi --loop-ms`. It reads no GPU utilization, temperature,
  power or clocks, and attributes no GPU use to processes. It gives AC and battery state through the Win32
  `GetSystemPowerStatus` call, idle time through `GetLastInputInfo`, the foreground process, and per-process CPU
  and memory. It does not read the Windows power mode.
- Its CLI calls take 3.6–8.6 s each (PowerShell start-up plus a 1 s sample), and it is packaged only as a CLI. Too
  slow to sample inside a measurement window. Fine for a one-off preflight check.
- That tool can schedule local GPU jobs, but the owner runs no local AI models and does not plan to. So there is
  no GPU-lease hook; other GPU users (games, video) are caught by the preflight gate instead.

**Design taken into Phase 0:**
- During measurement the receiver runs its own `nvidia-smi --query-gpu=utilization.gpu,memory.used,temperature.gpu,`
  `power.draw,clocks.sm,pstate,clocks_event_reasons.active --format=csv,noheader,nounits -lms 500` and reads CPU
  from `os.cpus()` deltas. Both are cheap.
- Preflight runs once per suite: AC or battery, idle time and foreground process, the heaviest processes.
- Per-process GPU use on Windows needs the `GPU Engine` performance counters. Not yet tried; cost unknown.
- Other GPU vendors and operating systems report `unavailable` with a reason, as optional metrics already do.

## 2026-10-19 — Reference display and race layout

Documentation only. One read-only system query; nothing built or measured.

- **Display:** the built-in screen is 2560 × 1440 at 165 Hz, with Windows scaling at 150 %, so the browser reports
  DPR 1.5. It is driven by the integrated AMD Radeon GPU; the RTX 3080 Laptop GPU has no display attached
  (hybrid graphics). Read from `Win32_VideoController` and the screen bounds.
- **D1 corrected:** the reference is the owner's laptop on AC, with a 2560 × 1440 drawing buffer on the NVIDIA
  adapter. Gates are stated in drawing-buffer pixels, not DPR. Plan 051's "DPR 1" would render a full-screen canvas
  at 1707 × 960 on this screen.
- **Adapter risk:** with hybrid graphics, Chrome may give WebGPU the integrated adapter. Untested hypothesis: this
  could explain the slow `headless-hardware` runs above. Phase 0 records `GPUAdapter.info` in every run and checks
  which adapter headless and visible Chrome get.
- **Race layout (owner):** one folder per contender in one checkout, switched on the lab page, with no worktrees.
  Timing runs go one at a time through a single queue.

## 2026-10-19 — Owner review of scope, D9–D13

Documentation only.

- Deletions accepted as planned: Takram removal and legacy terrain on classic WebGL (Plan 056), targets T1–T10 and
  the out-of-scope list as written.
- **D9, D10 decided** as proposed.
- **D11:** 1440p only, no 4K tier; the aim is still efficient code. Smallest contact edit is a 2 m footpath (working
  number); the main target is base building: landing pads, runways, hangars, up to a whole base. Footprints, vehicle
  tracks and snow deformation are a separate system for later.
- **D12:** lava is a surface material on the volcano op (owner: whatever runs well; surface-only looked fine in
  Black & White 2). Rivers carve a channel op so water can flow in it.
- **D13:** the owner had no preference; the plan picked the cheapest rule that locks nothing in. Caves below sea level
  are flooded. The flat map shows the outermost surface. Dry under-sea caves and a tunnel overlay can come later
  without changing the shape core.
- Only D11 changes the race: it sets the contact gate's smallest case (R4 now includes the footpath and a whole-base
  flatten). D12 and D13 touch Phase 4 (water, look), not the contenders.

## 2026-10-19 — Phase 0 slices: machine context, lab skeleton, timer survey

Built in parallel by three agents in one checkout with disjoint files, then reviewed. Nothing measured yet.

### Built
- **Machine context** (`triangular-engine/testing` + receiver): `describeGpuAdapter`, `describeRendererGpu` (reads
  `renderer.backend.device.adapterInfo`; three.js 0.186.1 keeps no `GPUAdapter`), `gpuVendorIssue`,
  `TestSuite.expectedGpuVendor`, and `prepare`/`start`/`stop` machine messages to the receiver (performance
  suites only, fire-and-forget, 1 s timeout). The receiver samples `nvidia-smi`, CPU and RAM every 500 ms during a
  case and stores a per-case `machine` summary; preflight (power, power mode, heaviest processes) runs on `prepare`
  because the probe takes about 3.4 s. Warnings, not failures: `on-battery`, `gpu-busy-before-start`,
  `gpu-hot-before-start`, `gpu-throttled`, `gpu-adapter-unrecorded`, `preflight-overlapped-measurement`.
- **`/planet-shape-lab` skeleton** (demo app): plain sphere at 64 km, 600 km, 6,371 km with a split high/low float
  position so the largest body does not jitter; named poses (`orbit`, `low-flyover`, `ground`, `horizon-grazing`);
  body-fixed frame with sun spin and time warp to 1,000,000x; feature registry (only `shadows` so far); "WebGPU
  required" overlay. Suite `planet-shape-baseline` v1 (performance, `expectedGpuVendor: 'nvidia'`): empty frame
  before and after (noise floor) and orbit/ground at each body size.

### Checked
- Testing entry 35/35, receiver and summary 10/10, lab specs 14/14 (all headless), library and demo builds pass.
- The page renders in the desktop app's built-in browser with no console errors. **That browser got the AMD
  integrated GPU (`amd / gcn-5`) at a 1512 × 1152 drawing buffer**, so the hybrid-GPU risk is real for at least one
  Chromium on this machine. Which adapter the owner's Chrome gets is still unchecked.

### Found (timer survey, read only)
- three.js 0.186.1 on WebGPU writes a timestamp pair for every `renderer.render()` call and every compute dispatch,
  but publishes only the frame sum (`info.render.timestamp`). Per-call values sit in
  `renderer.backend.timestampQueryPool.render` keyed by uid, cleared on each resolve. Per-pass timing therefore means
  one render call per pass plus reading those entries; no hand-written query sets. The pool holds 2048 slots and
  resolves itself when full, which would split a frame: the timer self-test must catch that.
- Plan 051's mid-frame read is fixed in the cloud lab (ticks from `renderComplete$`, generation counter).
- Phase 0b targets: `/cdlod-planet-lab` (v2/v3, classic WebGL, no camera setter), `/cell-planet-tsl` (WebGPU, view
  presets), `/clipmap-far-coverage-spike` (classic WebGL, `flyToDistance`). None has a test adapter yet.

### Next
- Owner: open `/planet-shape-lab` in Chrome on AC and run the suite once, to see which adapter Chrome reports and the
  idle machine readings (the idle NVIDIA load of about 26 % already exceeds the 20 % placeholder).
- Per-pass GPU timers with the self-test; morph wiring; then budgets and baselines.

## 2026-10-19 — First owner run lost; free camera

- The owner's first `planet-shape-baseline` run was not saved: the page's runner lacked `[resultSink]="true"`, so
  nothing reached the receiver. The run must be repeated. Fixed at the root: `resultSink` now defaults to `true` in
  dev builds (owner: fewer agent mistakes), with `false` as the opt-out.
- `npm run test:summary -- --suite …` from PowerShell drops the `--`, so npm eats the flags and the summary prints
  every suite. Quote it: `npm run test:summary '--' --suite …` (AGENTS.md).
- **Free camera** (owner request): a toggle that starts from the current named pose. Left drag pans over the surface
  at a speed that follows altitude, right drag (or shift) turns and tilts, the wheel changes altitude by 1.2x per step
  between 2 m and 6 radii. Any pose button or test run returns to the named poses, so tests stay deterministic. Pure
  helpers in `planet-shape-camera.ts` with specs (lab specs 16/16).

## 2026-10-19 — Second owner run: Chrome on the AMD iGPU

- Saved (`planet-shape-baseline@v1/2026-10-19T19-01-22-873Z_visible-browser_*.json`). Chrome reported
  `gpu.vendor amd / gcn-5`: the integrated GPU, not the NVIDIA one. The case recorded "GPU vendor amd differs from
  expected nvidia", but `test:summary` did not print case validity issues. It now prints them as `INVALID` lines
  (index lines written from now on carry `invalid`; sink specs 10/10).
- Machine warnings: `gpu-busy-before-start` (NVIDIA load 32 % median while idle) and
  `preflight-overlapped-measurement`. Empty frame on the iGPU: frame interval median 6.0 ms, CPU submit 0.3 ms,
  whole-render GPU median 0.59 ms. Not a hardware number for the target GPU.
- The empty-frame check failed on one draw call: three.js finishes each frame with an output pass (colour space, tone
  mapping) that draws one full-screen triangle. The check is now "Planet not drawn" and allows that one call. A failed
  check stops the suite, so only `empty-frame` ran.
- Owner: set Chrome to the high-performance GPU (Windows Settings → System → Display → Graphics), restart Chrome, rerun.
- Third run (`…T19-24-35-016Z_human-observed_…`): all 8 cases pass, still `amd / gcn-5`, every case INVALID for the
  vendor. Frame interval median about 6.0 ms in every scenario: that is the display refresh (about 165 Hz), not GPU
  cost. Cause found: the lab never set `powerPreference`, which three.js passes to `navigator.gpu.requestAdapter`.
  The lab now asks for `'high-performance'` and records it as `gpu.powerPreference`. If Chrome still picks the iGPU,
  the fallback is adding `chrome.exe` with "Add desktop app" under Windows Graphics settings.
- Owner: high-performance should be the engine default. Done: both engine renderers now pass
  `powerPreference: 'high-performance'` unless the scene sets its own (`'low-power'` / `'default'`), through the internal
  `withRendererDefaults` (spec added). The lab drops its own setting and records `gpu.powerPreference`.
- Fourth run (`…T19-46-35-066Z_visible-browser_…`), with a game running on the NVIDIA GPU: all 8 pass, still
  `amd / gcn-5` with `gpu.powerPreference` recorded as high-performance. Chrome on Windows ignored the request, so the
  Windows Graphics setting for `chrome.exe` is the remaining route. The machine block caught the game: the preflight
  listed it as the heaviest process and the only GPU app, NVIDIA load median 41 %, `gpu-busy-before-start`.
  iGPU whole-render GPU medians: empty 0.52 ms, plain sphere 1.05–1.44 ms (ground poses highest). Frame interval stays
  at the 165 Hz refresh. One 88 ms hitch (57 ms CPU submit) in `plain-sphere-ground-6371km`.
- Fifth run (`…T20-06-19-727Z_visible-browser_…`), after the Windows Graphics setting for `chrome.exe` and
  `chrome://restart` (closing windows had left the 08:27 GPU process alive): **`nvidia / ampere`**, no INVALID lines,
  `perf=unassessed`. Whole-render GPU medians: empty 0.066 ms, plain sphere 0.20 ms from orbit and 0.33 ms from the
  ground, about 5x the iGPU. Still not a clean baseline: the game was running (`gpu-busy-before-start`, NVIDIA load
  median 51 % during the empty frame).
- **Timestamps are quantized:** every median is a whole multiple of 65,536 ns (0.066, 0.197, 0.328 ms). Chrome
  quantizes timestamp queries unless WebGPU developer features are on (`chrome://flags/#enable-webgpu-developer-features`).
  Per-pass timers need that flag, and their self-test must flag quantized samples.
- Sixth run (`…T20-21-18-703Z_visible-browser_…`), game closed: `nvidia / ampere`, only Chrome on the GPU, SM clock
  1860 MHz at P0. First usable look at the target GPU: whole-render medians empty 0.03–0.07 ms, sphere 0.066 ms from
  orbit and 0.13 ms from the ground; CPU submit 0.3 ms; frame interval at the 165 Hz refresh.
- Still quantized: every median is 0, 1, 2 or 4 × 32,768 ns, the 65,536 ns step of Chrome's timestamp quantization
  (half-steps are medians of an even count). Sub-0.1 ms differences are unreadable until developer features are on.
- `gpu-busy-before-start` is a false positive here: the preflight's "idle" NVIDIA load of 41 % is the lab page itself,
  rendering at 165 Hz while preflight runs, not another app. The warning should key on another GPU app being present
  (the preflight already lists them), not on a load threshold. `gpu-throttled` is real: one case
  (`plain-sphere-orbit-600km`) recorded `0x48` (HW slowdown + HW thermal slowdown), with no visible effect on its median.
- Seventh run (`…T20-24-14-021Z_visible-browser_…`), with WebGPU developer features on and `chrome://restart`: the
  first unquantized timings. Medians now fall between the old steps, at about 1 µs resolution: empty 0.045–0.046 ms,
  sphere 0.091 ms from orbit and 0.134–0.136 ms from the ground, the same at all three body sizes. The planet costs
  about 0.045 ms (orbit) to 0.09 ms (ground) of GPU time above the empty frame. CPU submit 0.3–0.4 ms; frame interval
  at the 165 Hz refresh; no throttle bits; SM clock 1830 MHz at P0. Only warnings: the false-positive
  `gpu-busy-before-start` (NVIDIA load 45 % from the lab page itself) and `preflight-overlapped-measurement`. This is
  the reference for the plain sphere on the target GPU until a controlled-machine profile exists.
- `gpu-busy-before-start` now keys on a non-browser process in the preflight's GPU process list; the 20 % load
  threshold is only the fallback when `nvidia-smi` lists no processes. Replayed on the saved runs: the seventh run no
  longer gets it, the fifth (game running) still does. Spec added in `triangular-test-sink.spec.mjs`.
- 2026-10-19: Phase 0 ablation math added as `compareAblation` in `triangular-engine/testing` (`test-ablation.ts`). It takes alternating A/B rounds, reduces each to its median or p95, and returns `difference`, `relative`, per-arm spread, a noise band (half the min-to-max range of each arm's round numbers, combined as a root sum of squares) and a verdict (`faster`, `slower`, `no-difference`, `rejected` above 15 % spread, `invalid` with reasons). Pure and specced; not yet wired into the lab page, the runner or the receiver.
- Eighth run (`…T20-51-46-230Z_visible-browser_5d7b3c5c-…`), after the receiver restart: the new rule drops
  `gpu-busy-before-start` (only Chrome on the GPU, idle load 42 % from the page itself); the only warning left is
  `preflight-overlapped-measurement`. GPU medians repeat the seventh run within 1 µs: empty 0.046 ms, sphere
  0.090–0.091 ms from orbit and 0.134–0.135 ms from the ground; no throttle bits. CPU load median 53 % (11 % before),
  from other work on the machine; CPU submit stayed at 0.3–0.5 ms.
- Chrome logs "The powerPreference option is currently ignored when calling requestAdapter() on Windows"
  (crbug.com/369219127). That confirms the earlier finding; the engine keeps the request for platforms that honour it.
- 2026-10-19: `preflight-overlapped-measurement` fixed at the source. The receiver now answers `/machine/prepare` only
  after the preflight settles (bounded at 8 s; a hung probe replies `preflight: 'pending'`), and `TestSession` awaits that
  reply (up to 10 s, never failing the run) before the first case. `overlapped` and its warning stay for pages or
  receivers that still overlap. Specs in `test-session.spec.ts` and `triangular-test-sink.spec.mjs`.
- 2026-10-19: per-pass GPU timers and the timer self-test built (engine `gpuTiming`, `gpu-pass-timing.ts`).
  - **How it works.** Three.js 0.186 already writes one timestamp pair per render pass. It keys each by a uid ending
    in the renderer frame (`r:<call>:<context>:f<frame>`) and keeps the whole resolved batch in the render query
    pool's `timestamps` map; `resolveTimestampsAsync` returns only the last frame's sum. The engine wraps
    `inspector.beginRender` to name each pass (`scene`, `shadow` by the `Shadow Map [ … ]` scene name, `output` for
    the tone-mapping quad, other `fullscreen` quads). Each readback is then split into whole frames.
  - **Self-test.** A frame missing a pass is dropped, not under-counted. The self-test fails on:
    - a timestamp with no recorded pass;
    - a frame missing a pass;
    - a repeated batch;
    - a last frame that does not add up to the Three.js total;
    - rounded timestamps (the step inferred as the GCD of whole-ns durations; 10 µs or more counts as rounded).
  - **Lab.** The placeholder `gpuPerPass` is replaced by `gpuScenePass` (the terrain here: the body is the only mesh),
    `gpuShadowPasses` (terrain shadows: only the body casts) and `gpuOutputPass` (everything else). A
    `GPU timer self-test` check is added, and the details gain `gpuTimestampStepNs`, `gpuPassFrames` and
    `gpuPassLabels`.
  - **Not yet.**
    - Compute passes are not split.
    - Plan 051's mid-frame read is answered by construction (a frame counts only when all its passes resolved), not
      yet by an end-to-end parity probe: alternating heavy and light frames, checked per frame number.
    - Not yet run on the owner's machine.
  - Specs: `gpu-pass-timing.spec.ts` and `planet-shape-lab.spec.ts`.
- Ninth run (`…T21-29-11-276Z_visible-browser_a5d329b3-…`): the first run with per-pass timers and the preflight wait.
  - The `GPU timer self-test` passed in all eight cases: about 825 complete frames each from 390–650 readbacks, a
    timestamp step of 1,024 ns, and per-pass totals equal to the whole-render medians.
  - **Scene pass** (the planet):
    - empty frame: 0.00 ms (the clear alone);
    - sphere from orbit: 0.04–0.05 ms;
    - sphere from the ground: 0.09 ms;
    - the same at all three sizes.
  - **Output pass** (tone mapping, colour space): a constant 0.04–0.05 ms. It is the whole of the empty frame's
    0.045 ms.
  - No shadow pass, since the shadows feature is off in the baseline.
  - `preflight-overlapped-measurement` is gone. `gpu-busy-before-start` is real this time: a non-browser app held the
    GPU during the preflight (process names are in the result file).
  - Frame interval was at the 165 Hz refresh. CPU load median 73 %.

## 2026-10-20 — Shorter runs, focus redo, shadows A/B

- **Why.** The owner found the runs long and the 6,000-pixel result list unread; they hand each run to an agent.
  Run 9's samples showed the GPU pass medians settle within about 10 frames, while the 0.1 ms CPU timer never
  settles a 0.3–0.5 ms median to 2 %: more frames do not fix a coarse timer.
- **Built** (`triangular-engine/testing`, shared by every lab):
  - **Modes:**
    - `quick`: warmup at most 0.5 s; each window stops once its series settle (the halves agree, or the difference
      is within one timer step), from 1 s up to `durationMs`.
    - `standard`: as before.
    - `soak`: windows of 60 s or more, with drift from the first to the last quarter.
    - Adapters opt in with `measureWindow` and `windowModes`. Labs whose `durationMs` drives motion stay standard.
  - **Focus loss** stops the case, pauses the run until the page is back, and redoes the case (at most two redos).
  - **Runner:** one result card with **Copy for agent**; per-case output under Details.
  - **A/B suites:** `ablation` on the suite and its rounds. The session runs `compareAblation` per group and
    metric.
- **Lab:**
  - Watches frame interval, submit CPU and whole-render GPU (with timestamps) for the quick stop.
  - New metric `gpuPassTotal`: all timed passes, summed per frame.
  - New suite `planet-shape-shadows-ab` v1: 600 km at orbit and at ground. Three rounds per arm, shadows off (A)
    and on (B). It compares `gpuPassTotal` and `gpuScenePass`.
- **Checked:** testing specs, receiver specs and lab specs all pass, and the library builds. Not yet run on the
  owner's machine.

## 2026-10-20 — First shadows A/B runs on the owner's machine

- **Quick run, saved** (`planet-shape-shadows-ab@v1/2026-10-20T19-28-43-623Z_visible-browser_quick_*.json`, 19:28):
  NVIDIA adapter, 12 valid cases (600 km, orbit and ground, three rounds per arm), 23 s. Numbers below are from
  `test:summary`; they match the owner's figures.
  - **Shadows cost about 0.1 ms of GPU time.** `gpuPassTotal` median: orbit 0.091 → 0.187 ms (+0.096 ms), ground
    0.135 → 0.236 ms (+0.101 ms); noise 0.002 ms or less. `gpuScenePass` also rises: orbit 0.046 → 0.067 ms, ground
    0.089 → 0.115 ms. The shadow passes themselves take 0.07–0.08 ms. The relative gain (+106 %, +74 %) is large only
    because the base frame is tiny.
  - **Frame interval says nothing:** 6.0–6.1 ms in both arms is the 165 Hz display cap.
  - **Warning `gpu-busy-before-start`** (NVIDIA load 53 % median): another app was running timed work. The
    cross-app test lock now addresses this.
- **Earlier run at 19:04 was INVALID:** Chrome had the AMD iGPU and the WebGPU developer-features flag was off (GPU timer
  self-test failed, timestamps rounded to 65,536 ns). One case ran, then the suite stopped; no A/B result. The
  `planet-shape-baseline` quick runs at 19:48–19:49 failed the same way (AMD, page not focused).
- **Standard A/B at about 20:58** agreed with the quick run within about 2 % (81 s) but was **not saved**: the gateway's
  built-mode SPA fallback answered the sink POST with `index.html`. Not in `test:summary`, so its numbers are unchecked
  here.
- **Fix:** the gateway now owns one receiver per app (ports 4700–4799, `DAXUR_TEST_SINK=1`), and the demo sink answers
  with identity. Confirmed live on 2026-10-20.
- Not measured: a saved standard run; shadows at 64 km and 6,371 km.

## 2026-10-20 — Budgets and a committed baseline: the verdict is computed

- **Built** (`triangular-engine/testing`): `TestScenario.budgets` (`{ metric: { p95?, median? } }`), `TestSuite.baseline`
  (`TestBaseline`, with `maxRegression` 0.10 and `minRegression` 0.05 ms), `TestCaseResult.performanceChecks`,
  `TestRunResult.performanceNotes`, and `pass` / `fail` for `performanceVerdict`. `assessPerformance` is pure and
  `TestSession` calls it. A baseline regression fails only above both the relative and the absolute bound, because the
  GPU numbers here are about 0.1 ms. A baseline of another mode is skipped with a note. A budgeted metric without a
  summary makes the run `inconclusive` unless it is `optional` (the per-pass GPU metrics are). Rules in
  `projects/triangular-engine/docs/testing.md`, "Budgets and baselines".
- **Baseline file.** `baselineFromRun` and `npm run test:baseline` turn a saved result into the JSON. The receiver adds
  failed checks to the case summary (`FAIL PERF ...`), so `test:summary` and the results page show them.
- **Lab data.** `planet-shape-baseline.v1.json` is made from the owner's quiet standard run saved 2026-10-20 21:57
  (RTX 3080 Laptop, WebGPU, 8 valid cases, first run judged by the new verdict: `pass`) with `gpuPassTotal`,
  `gpuScenePass` and `gpuOutputPass`. Left out: `frameInterval` (the display refresh cap, not a cost) and the CPU
  submit timer (too noisy). Measured `gpuPassTotal` p95: 0.092 ms at orbit, 0.135–0.137 ms on the ground at all three
  sizes, 0.046 ms for the empty frame. Budgets (`gpuPassTotal` p95): 0.5 ms for the sphere cases and 0.2 ms for the
  empty frames, guards against a broken measurement; the baseline catches smaller changes (above both +10 % and
  +0.05 ms). The suite stays `planet-shape-baseline@v1`: the experiment did not change.
- **Standard A/B saved** 2026-10-20 21:58 (12 valid cases, 83 s), matching the quick run: shadows add 0.097 ms
  `gpuPassTotal` at orbit (0.090 → 0.186) and 0.098 ms on the ground (0.134 → 0.232), noise ±0.002 ms.
  The shadows A/B suite has neither (it compares arms).

## 2026-10-20 — Morph slider in the lab

- **Built** (`projects/demo-app/src/app/pages/planet-shape-lab/`): a `morph` setting (0..1, default 0) in
  `PlanetShapeTestSettings`, a slider on the page, and the adapter/host read, apply, check (`settingsMismatches`) and
  restore it. The plain sphere material now runs the engine's `planetMorphGraph` (default `'bend'`, the same call
  `PlanetSurfaceMaterial` makes) in the vertex stage, driven through `createPlanetMorphUniforms`, `setPlanetMapExtent`
  (per body) and `setPlanetProjectionCentre`. No engine change, no new public API, no parallel morph.
- **Visual only.** The graph's position replaces the vertex position (`positionNode`), so the camera-relative
  high/low split is kept and the morph enters as the displacement `graph.positionNode - positionGeometry`, exactly 0 at
  morph 0. Body radius, sun and spin stay body-fixed and spherical; the camera follows the morph (below).
- **Dynamic projection, centred on +Z (longitude 0).** The graph needs `aFlatPos`/`aFlatNorm`; the geometry carries
  zeros and the flat map is projected in the shader (dynamic mode). Every camera pose sits at longitude 0, so the map
  faces the camera at morph 1. The sphere geometry is built with `phiStart` -90° so its UV seam is at -Z, the
  projection's antimeridian: no triangle spans the cut and no seam cull is needed. (First built centred on +X; the owner
  saw the map edge-on, as an invisible plane, at morph 1.)
- **Far plane: 100 body radii** (`CAMERA_FAR_RADII`), was 1.25 × the horizon distance, which clipped the flattening
  surface (the map runs past the sphere's horizon). Not `Infinity`: three.js's projection matrix is NaN for an infinite
  far plane.
- **Lit with the sphere normal** (the graph's `lightingTurn` option, identity turn), not the morphed one. The owner saw
  two faults with the morphed normal:
  - At morph 1 it is +Z over the whole map, so the map was lit all alike and flipped between lit and dark as the body
    spun. The sphere normal keeps the globe's day/night terminator on the map.
  - At morph 0.5 there was a hard lighting line down the middle of the screen. `planetMorphGraph` builds the morphed
    normal in the fragment stage from `positionLocal - positionGeometry` (its batch offset). This lab's `positionNode`
    is camera-relative, so there that offset is minus the camera position, and the projected longitude became the view
    direction's, which wraps at the screen centre. Fixed in the engine the same day: the graph now builds the morphed
    normal in the vertex stage (`vMorphedNormal` varying), so it no longer depends on the material's `positionNode`.
    Batched terrain had a milder form of the same error for 0 < morph < 1. The lab keeps `lightingTurn` for the first
    reason only.
- **Shadows: off while morph > 0** (`shadowsActive` in `planet-shape-features.ts`). The shadow pass does not morph, so
  the sphere neither casts nor receives (the sun's shadow pass is skipped too) instead of morphing the shadow geometry.
  The `shadows` feature keeps its stored value and comes back at morph 0.
- **Camera rides the morph** (added 2026-10-21; first built without it). At morph 1 the bend puts the flat map in the
  plane through the planet centre (z = 0 in the map frame), not tangent at radius R, so fixed poses ended up one
  radius above the map: the ground pose looked along it from R + 2 m and the morph suite's ground cases timed
  near-empty frames. `resolveCameraView(def, body, id, morph)` (`planet-shape-camera.ts`) now carries the resolved
  pose rigidly from the globe's ground frame under the pose's lon/lat to that point's frame at `morph`, using the
  engine's `CellPlanetMorphCameraRig.groundFrame` (the CPU twin of the bend, Equal Earth, default basis = the lab's
  `MORPH_CENTRE`). Height, pitch and heading over the same ground stay as they were, for named poses and the free
  camera; `setMorph` re-resolves the pose. Only `groundFrame` is used, not the rig's orbit-controls `update`: the lab's
  poses are closed-form, so a pose at a given morph is deterministic, as a test case needs. Ground relief is ignored
  (the plain sphere has none). The morphed surface is float32 in the shader, so on the 6,371 km body the ground under
  the 2 m pose can sit a few decimetres off the double-precision frame. Specs: identity at morph 0, ground pose at
  (0, 0, 2) facing +X at morph 1, height/pitch/heading kept at morph 0–1 off the map centre. Checked in the browser
  2026-10-21: the ground pose stays 2 m over the surface at morph 0.5 and 1, orbit sees the map face-on, no console
  errors. Earlier check (2026-10-20): morph 0.5 bends toward the camera, no clipping.
- **New suite** `planet-shape-morph` v1 (performance, `expectedGpuVendor` nvidia): 600 km, morph 0 / 0.5 / 1 at orbit
  and ground, six cases `morph-000|050|100-orbit|ground-600km`, `gpuPassTotal` p95 budget 0.5 ms (as the sphere cases),
  baseline recorded 2026-10-21 (see the entry at the end).
  Existing suites and their scenarios are unchanged (morph 0), but every sphere case now includes the morph graph's
  vertex work, so a baseline drift of the first suite is possible and would be real.
- **Checked:** the lab specs (unit level: material uniforms, clamping, geometry attributes, shadow policy, suite ids and
  scenarios, adapter apply/restore). Not checked: the visual look and GPU cost, which need the owner's browser.

### 2026-10-21: morph baseline and unattended runs

- **Baseline.** `planet-shape-morph` v1 now has a baseline (`planet-shape-morph-baseline.v1.json`) from a quiet
  standard run on the RTX 3080 at 11:57. `gpuPassTotal` p95: orbit 0.11 / 0.18 / 0.33 ms and ground 0.16 ms at every
  morph (0 / 0.5 / 1). A run at 11:21 agreed within 0.01 ms. Orbit at morph 1 costs about 3x morph 0 because the
  flat map covers more of the screen. Ground stays flat because the camera rides the morph. Morph 0 matches the plain
  sphere baseline, so the morph graph's vertex work costs next to nothing.
- **Unattended runs.** The run was made with the new `triangular-test-run` bin (`npm run test:run`, see
  `projects/triangular-engine/docs/testing.md`, "Unattended runs"). It queues machine-wide, waits for a quiet GPU, opens
  a throwaway full-screen Chrome with `--enable-webgpu-developer-features`, waits for the saved row and closes that
  Chrome. Without the flag a fresh profile rounds GPU timestamps and the timer self-test fails (the 11:20 run).
- **Warning fix.** `gpu-busy-before-start` fired on every Windows run because `nvidia-smi` lists the compositor
  (`dwm.exe`) as `[Insufficient Permissions]`. The receiver now skips it; the fix applies once the receiver restarts.
- **Fingerprint.** `triangular-test.config.json` now includes the lab folder in `fingerprintPaths`, so a change to the
  lab marks earlier runs `STALE`. Also applies once the receiver restarts.
- **Morph camera at edges and poles.** `planet-shape-lab.spec.ts` now checks the camera at eight spots (incl. lon
  180 / 179.9 / -170, lat 80 / -85 / 89.9) at morph 0 to 1: height, pitch and heading hold everywhere, and at morph 1
  the camera lands on the map plane inside the Equal Earth outline. Lon 180 maps to the right edge, -179.999 to the
  left. A browser check of the lab (600 km at 50 m and 2 km; 6371 km at 2 m and 50 m, morph 1) found the GPU ground
  where the camera expects it at every spot, with no seam cracks. Expected, not bugs: at lon 180 the camera sits on the
  map's right edge, so half the view is empty past it; at lat 89.9 facing north it looks past the map's pole edge.
  There is no wrap-around at the seam or pole (a flat map has edges); a game that needs one handles it itself.
  Night-side spots look black at the default ambient light, which is lighting, not a camera fault.

### 2026-10-21: quality metrics on the plain sphere

- **Probe.** `planet-shape-quality.ts` plus a probe material that shares the sphere's vertex stage and writes the distance
  from the camera (red) and a drawn flag (green) into a 1280 x 720 float target (half the reference drawing buffer). The
  page draws it between engine frames in its own scene and reads it back twice. The reference is the exact sphere,
  ray-traced on the CPU in doubles at pixel centres, clipped by view depth like the GPU. Contender C replaces it later.
- **Metrics.** `silhouetteErrorPx`: per column, |drawn px - exact drawn px|. `depthErrorM` and `depthErrorRelative`:
  every 16 px where both draw. `cracks`: undrawn pixels enclosed by the surface (flood fill from the border; plan 055's
  magenta count). `flickerPixels`: pixels that differ between the two frames of a still pose. Checks fail on any crack or
  flicker; silhouette and depth are reported, not judged.
- **Suite.** `planet-shape-quality` v1, functional: 4 poses x 3 bodies, morph 0, spin paused. First run, 12:36,
  unattended on the RTX 3080: all pass, 0 cracks, 0 flicker everywhere.

  | Pose | Silhouette max px (64 / 600 / 6,371 km) | Depth error median, p95 (600 km) |
  |---|---|---|
  | orbit | 0 / 0 / 0 | 21 m, 54 m |
  | low flyover | 1 / 1 / 1 | 35 m, 133 m |
  | ground | 3 / 6 / 7 | 0.26 m, 15 m |
  | horizon grazing | 1 / 1 / 1 | 48 m, 193 m |

  These are the plain sphere's own tessellation (512 x 256, inscribed), the floor a contender is compared against, not
  faults. Depth error grows with the body (facets are wider), except at the ground pose, where the camera stands over
  one flat facet. There the horizon is 3 to 7 probe px off the true one, and grazing rays near it carry the depth p95.
- **Not measured yet:** popping during a slow zoom (no LOD), per-fidelity-class metrics (no terrain), collider parity
  (no collider).
- **Morph camera, GPU side.** A browser check confirmed the specs above: ground where the camera expects it at every
  spot, no seam cracks. It also saw one `GpuReadbackTimeoutError` from the engine's GPU timer while the browser pane was
  in the background. That is a hidden-tab effect, not a timing-run fault; unattended runs use a full-screen window.

### 2026-10-21: surface-coordinate precision (`surfaceCoordErrorM`)

The owner saw the checker edge go speckled at 6,371 km in the ground pose and crisp at 64 km. It is not texture
resolution: the colour comes from the geometry's `uv`, interpolated in float32 across triangles about 78 km wide, and a
float32 step of u near 0.5 is 2^-24 of the circumference, 2.4 m at 6,371 km. With the camera 2 m up, that moves the edge
by many pixels at random.

- The probe now writes u/v to green/blue (alpha is the drawn flag). `referenceFacetUv` rebuilds the lab sphere's own
  triangles in doubles, intersects the pixel's ray with them and interpolates uv exactly, so the metric isolates the
  float32 coordinate from facet shape. Metres of ground: du x circumference at the latitude, dv x half meridian.
- Same suite (`planet-shape-quality` v1): the scenarios are unchanged; this adds a metric.
- Spec floor: just storing the exact uv in float32 costs up to 1.2 m at 6,371 km.

Run 2026-10-21T14:54 (RTX 3080, quick mode, which does not matter for a functional suite), median / p95 / max in metres:

| Pose | 64 km | 600 km | 6,371 km |
|---|---|---|---|
| orbit | 0.35 / 0.98 / 6.2 | 3.3 / 9.0 / 58 | 35 / 97 / 616 |
| low flyover | 0.02 / 0.08 / 0.38 | 0.20 / 0.71 / 3.5 | 2.2 / 7.5 / 37 |
| ground | 0.01 / 0.03 / 0.05 | 0.14 / 0.33 / 0.44 | 1.1 / 2.7 / 4.2 |
| horizon grazing | 0.02 / 0.05 / 1.05 | 0.14 / 0.42 / 9.6 | 1.8 / 4.9 / 105 |

The error grows linearly with the radius, as a float32 coordinate must. At orbit a metre of ground is far under a pixel,
so only the near poses matter: at ground on 6,371 km it is 1-4 m, a whole checker edge's width at 2 m altitude. Any
material or texture keyed by global surface position inherits this; the contenders must key surface lookups
camera- or tile-relative. Fixing it is contender work (Phase 1+), not the plain sphere's.

### 2026-10-21: preflight thresholds from measured readings

Baseline rerun `planet-shape-baseline@v1/2026-10-21T14-56-34-832Z_visible-browser_3d4c9267-9a985aa5.json`, unattended
on the RTX 3080, owner away: auto=pass, perf=pass, **no machine warnings** (the first clean one; the receiver's
compositor fix is live). Frame interval 6.1 ms in every case (165 Hz vsync), empty frame GPU 0.05 ms, plain sphere
0.10 ms at orbit and 0.16 ms on the ground at every size.

Readings across the 11 saved timing runs (baseline, morph, shadows A/B):

| Reading | Value |
|---|---|
| GPU load, nothing open (launcher quiet check) | 0 % |
| GPU load in the preflight, page already rendering | median 13-47 %, p95 up to 48 % (55 % once, with a game client open) |
| GPU load in timed cases | median 43-46 % (the page's empty frame alone: 44 %) |
| GPU temperature, preflight | 38-52 C |
| GPU temperature, timed cases | 43-48 C, clocks 1830 MHz, P0, no throttle bits |

So the page itself loads the GPU about 45 %: compositing a full-screen 2560 x 1440 frame at 165 Hz, not the scene.
A load threshold can never tell the page from other work, which is why `gpu-busy-before-start` keys on a non-browser
GPU process first.

- `gpuBusyPct` 20 -> **60**: the fallback when `nvidia-smi` lists no processes. Above anything the page alone reads.
- `gpuHotC` 80 -> **85** (owner: the laptop holds its temperature in Turbo mode, and a run must never wait to cool).
  Warning only: the launcher never waits on temperature, and real slowdown shows as throttle bits.
- `throttleMask` unchanged: no throttle bit seen.
- The receiver loads these when it starts: restart `daxur app serve` for them to apply.
- Game-load scenario (a synthetic "rest of the game" load, proposed during Phase 0, never in the plan): dropped by the
  owner. GPU and CPU costs of independent work add; contention effects are second order and hit every contender alike,
  so they do not change the ranking. The one real risk, main-thread CPU work (LOD, streaming) competing with game
  logic, is checked on the winning contender in a real game, not on a synthetic load.

### 2026-10-21: fixed costs for the frame budget table

Phase 0 asks for the costs that sit beside terrain in every frame. Atmosphere and clouds are measured in their own labs
(both are WebGPU/TSL already), not wired into the planet-shape lab: each is a screen-space pass whose cost does not
depend on what terrain is drawn, and wiring them in is Plan 049's and 051's job.

- **Atmosphere:** `bent-atmosphere-cost@v2` (`/atmosphere-lab`), rerun full screen:
  `2026-10-21T15-11-02-138Z_visible-browser_3d4c9267-c0e46c6e.json`. Each view has a `plain` case (no atmosphere) and the
  atmosphere on its default `auto` path at morph 0 / 0.5 / 1. The run is marked `gpu-throttled`: its `march` cases hold
  the GPU at 7 ms a frame. The `auto` cases agree with the 2026-10-20 run within 0.03 ms.
- **Clouds:** new `cloud-cost-ab@v1` (`/cloud-volumes-lab`): clouds off (A) and on (B) in alternating rounds, 12 volumes,
  proxies, atmosphere lighting and haze on, still camera at three spots:
  `2026-10-21T15-13-06-124Z_visible-browser_3d4c9267-c0e46c6e.json`. No machine warnings. The lab now records the GPU
  adapter and drawing buffer (it recorded neither before). Its timer is whole-render (it includes the cloud bakes).

GPU ms, median, RTX 3080, 2538 × 1440 (the same buffer as the planet-shape baseline):

| Cost | Case | Off | On | Added |
|---|---|---|---|---|
| Empty frame | `planet-shape-baseline` | | 0.05 | 0.05 |
| Atmosphere `auto`, morph 0 / 0.5 / 1 | space | 0.11 | 0.26 / 0.34 / 0.42 | 0.15 / 0.23 / 0.31 |
| | low orbit | 0.14 | 0.48 / 0.48 / 0.51 | 0.34 / 0.34 / 0.37 |
| | high in the air | 0.20 | 0.26 / 0.33 / 0.30 | 0.06 / 0.13 / 0.10 |
| | ground | 0.17 | 0.20 / 0.20 / 0.16 | 0.03 / 0.03 / -0.01 |
| Atmosphere `march` (not a default) | all views | | 0.66–7.34 | 0.5–7.1 |
| Clouds, 12 volumes, haze | outside | 0.18 | 0.27 | 0.10 |
| | inside | 0.14 | 0.51 | 0.37 |
| | horizon | 0.16 | 0.33 | 0.17 |

Round-to-round noise in the clouds A/B is 0.001 ms. **Result:** the fixed costs together are at most about 0.8 ms
(0.05 + 0.37 + 0.37), well under the ~2.3–3.5 ms the frame budget table set aside for them, so terrain's 2.0 ms (D8)
is not squeezed. The Runbook 049 figures in the table (0.79–1.97 ms) predate the `auto` path. Caveats: clouds were
measured with 12 volumes, the lab's largest preset, and a still sun; a moving sun or a fast spin rebakes and costs more
(Plan 051's flyby cases). Neither lab draws terrain, so overdraw between terrain and these passes is not in the
numbers.

### 2026-10-21: phases reordered; first raymarched terrain (Phase 1)

The owner closed Phase 0, parked the platform microbenchmarks and Phase 0b, and moved the first raymarched terrain
ahead of the shape-op machinery (plan, Phases). Built in the lab (`planet-shape-raymarch.ts`, the lab's **Surface:
raymarched terrain** button and a steps row):

- A back-faced shell at `R + H` (128 x 64, camera-relative, radius pushed out so its chords still enclose the sphere).
  Each of its pixels starts where the ray enters the shell (or at the camera inside it), sphere-traces one fixed height
  field and writes its own depth. `H = min(0.01 R, 8 km)`.
- Height: fractal Perlin noise (`mx_noise_float`) over the body-frame direction, `R / 4` base hills, a flat pad under
  the poses so no pose starts inside a hill. Octaves are added only while their wavelength is over four pixel
  footprints (up to 14, the last one fading in). In the march, octaves stop as soon as the most the rest could add
  leaves the ground below the ray, and above `H` no noise is evaluated at all.
- Altitude along the ray uses `|o|^2 - R^2` from doubles on the CPU, so 6,371 km keeps the ground to millimetres near
  the camera.
- A ray that runs out of steps within 8 pixels of the ground keeps its last point (otherwise the horizon is speckled).
- The pipeline is compiled before the runner is ready; its first use otherwise stalled the GPU past the 500 ms
  timestamp readback limit (the first run failed on case 1 that way).
- No morph, no shadows, no quality probe yet (the quality suite still measures the plain sphere).

First timing run, `planet-shape-raymarch@v1` (RTX 3080, 2538 x 1440, unattended standard run;
`2026-10-21T17-11-41-211Z_visible-browser_556840cd-0c1fc7b9.json`), scene pass = terrain, median GPU ms:

| Pose | 64 km | 600 km | 6,371 km |
|---|---|---|---|
| Orbit | 4.5 | 4.7 | 1.1 |
| Low flyover | 40.9 | 41.7 | 29.3 |
| Ground | 44.2 | 43.4 | 36.1 |
| Horizon grazing | 47.5 | 48.2 | 42.0 |

Steps at 600 km: orbit 2.6 / 4.7 / 4.9 ms and ground 11.9 / 43.4 / 60.9 ms at 32 / 128 / 256 steps. The run is marked
`gpu-throttled` (the page itself held the GPU at 100 %) and the 256-step ground case `INVALID` (61 ms cadence).

**Reading:** the low poses are 15-25x over the 2.0 ms terrain budget, and their cost is linear in the step count, so
most pixels use every step: the sky and grazing rays cross up to `sqrt(2RH)` (85 km at 600 km) of shell before they
leave it, in steps of 0.6 x the gap to the ground below. This is contender C's stated main risk (per-pixel cost at
1440p). The design in the plan answers it with a tight raster mesh that bounds the surface from outside, so the march
covers only the last stretch and sky pixels are never marched; this first version uses the loosest bound there is
(the `R + H` sphere). Also open: half-resolution marching, and a cone/relaxed step.


### 2026-10-21: terrain v2, the Shadertoy recipe (`planet-shape-raymarch-lit.ts`)

The first terrain looked flat and fell apart (a pit at the pad, mid-air speckle, horizontal stripes of holes). The owner
asked for something in the style of the Shadertoy terrains; v2 takes their ideas (no code copied: Shadertoy shaders
are CC BY-NC-SA by default) and sits next to v1 under Surface, "terrain v2".

- Value noise from one 256 x 256 RG texture, the four texel reads blended in the shader. A single octave of value
  noise reads as blocky; colour noise thresholded by `smoothstep` made it worse, so the grass tint now follows height.
- The march sees up to 9 octaves; the normal 13, plus camera-relative bump and colour noise (camera position modulo
  the noise period in doubles, so it holds at 6,371 km).
- Rays step by `max(0.5 gap, 1.2 % of t)`, refined by one secant step, and the `R + H` sphere is the analytic bound
  (rays that miss it never march). No more stripes; rays that run out stop where they are.
- Heights from below the sphere to `H = min(0.03 R, 9 km)`, so the pad is at mean level (no pit).
- A sky inside a `0.04 R` air band; black space above it. Sun, sky and bounce light, optional soft shadow (the
  `shadows` feature), a `1 - exp(-x)` tone curve. Fog was tried and dropped (owner).

Seen only in the browser pane (integrated GPU), not timed yet. With the paused sun at noon over the poses the ground is
flat-lit; the horizon at 600 km from 12 km is still smooth (the hills there are low, the mountain mask mostly off).

#### Same day: v2 rebuilt as a density field (canyons, ledges, overhangs)

The owner found the height-map v2 looked like "worms under the skin" (ridged octaves plus noise bump) and pointed out
that the reference shader makes canyons with overhangs, which a height map cannot. Right: the reference is a 3D field,
`altitude + canyons + noise(p * (1, 4, 1))`, stepped at a quarter of its value. v2 now follows that:

- Field = `altitude + pad * U * (7 * canyon + 3 * (rock - 0.44))`, `U = relief / 10`, `relief = min(0.03 R, 9 km)`.
  `rock` is three octaves of 3D value noise with the vertical stretched 4x (strata, ledges, overhangs); `canyon` is a
  two-octave mask, winding channels where it crosses its middle plus basins where it is high.
- Every noise is a camera-relative frame: `origin + matrix * x`, the matrix (scale, octave rotation) and the origin
  (camera times matrix, modulo the 256 period) worked out in doubles on the CPU. Octaves finer than a pixel fade to
  their mean.
- The march runs between the plateau-top sphere and a solid-floor sphere (reaching it is ground), twice the chosen
  steps, `max(field / 4, k t)` with `k` growing from 0.8 % to 6 % over the second half, so rays skimming the flat pad
  still reach the horizon. The march uses one hardware-filtered fetch per noise; normals use the four-tap noise
  (8-bit filter weights step visibly in finite differences).
- Close range: six camera-relative detail levels (2.5 U down by 5x each) for bump and colour, each faded by footprint.
- Shading after the reference: rock banded by altitude, grass on up-facing ground, some pale dust on flat tops,
  Oren-Nayar sun / five-direction sky / bounce, occlusion low in canyons, `1.4 x / (1 + x)`, a muted grade in display
  space. The reference's sun strength (7, orange) assumes a low sun; at a high sun it is 2.2 and white, or noon blows out.

Seen in the browser pane only (integrated GPU, about 1 FPS there at DPR 1.5 with the pane hidden, so no timing
claim). Horizon grazing at 600 km and 64 km shows layered canyon walls; the ground pose stands on the flat pad, so it
shows a plain with canyons on the horizon.

## 2026-10-21: the v2 terrain field as modules with a CPU twin

The v2 density field is now one definition in three files beside the lab page (the raymarcher still holds its own copy
until it is switched to import them):

- `planet-shape-noise.ts`: `generateNoiseBytes()` (the exact bytes the lab texture uses, RGBA8 256 x 256),
  `createNoiseTexture()`, `NOISE_PERIOD`.
- `planet-shape-field.ts`: the constants, `NoiseFrame` plus the CPU frame helpers (`fieldFrameMatrices`, `noiseOrigin`),
  and the exported TSL functions `valueNoise`, `sampleFrame`, `padAt`, `canyonAt`, `rockAt`, `densityAt`. They take the
  texture, frames, camera and relief unit as arguments; the doubles-on-CPU, camera-relative design is unchanged.
- `planet-shape-field-cpu.ts`: `createTerrainFieldCpu(radiusM)` with `canyon`, `rock`, `density`, `isSolid` and
  `groundHeightAt(direction)` (altitude of the outermost surface, found by marching down from the plateau-top sphere in
  0.05-unit steps, then bisection), all in doubles on body-relative positions, reading the same bytes through the smooth
  four-tap path.

`planet-shape-field.spec.ts` compares them through `evaluateOnGpu` (smooth path on the GPU; the hardware-filtered path
has 8-bit filter weights, so it is deliberately not the parity target) at 40 points per body on 20 km, 1737 km and
6371 km bodies, cameras at the surface with camera-relative offsets. Worst differences found: value noise 7e-6, canyon
6e-5, rock 4e-6, density 0.36 m at 6371 km (0.04 % of the 900 m unit; 5 mm at 20 km). Specs assert 2e-3, 5e-3, 3e-3 and
1 % of a unit. CPU-only specs cover determinism, 256 periodicity, range, and `groundHeightAt` landing at density ~0 with
solid below and open above. Run:
`npx ng test demo-app --watch=false --browsers=ChromeHeadless --include='**/planet-shape-field.spec.ts'`.

Surprises: the density error grows with body radius (float32 `up` and altitude at 6.4e6 m), not the noise, so the CPU
twin is the more accurate of the two on large bodies; the pad edge is the most sensitive place (`1 - up.z` cancels in
float32). The spec points keep clear of the sharpest pad transition on purpose only by sampling; none is exactly on it.

#### Same day: Phase 1 finish line set; v1 timed; v2 pre-pass; suite v2

- **v1 timed** (`planet-shape-raymarch@1`, visible quick run on the 3080, 2538 × 1308, GPU warm and throttled at 78 °C,
  so somewhat high): orbit 0.7–4.4 ms; near the ground 27–45 ms scene pass; at 600 km ground 12.7 / 41.6 / 58 ms for
  32 / 128 / 256 steps. The cost follows the step count: the march dominates, not shading. Close poses did not settle
  in their 5 s windows (too few, too slow frames) and the 256-step ground case was invalid (58 ms cadence); the medians
  still stand.
- **Finish line** written into the plan (Phase 1 finish line): fast enough to build on (16 ms milestone; D8 stays 2 ms),
  one field definition with a CPU twin and parity spec, edits (flatten / smooth / carve replacing the pad), two
  blended biomes, and tests for each.
- **Pre-pass** (v2): the shell is drawn first into a float target at 1/2, 1/4 or 1/8 of the drawing buffer with a
  coarse march that writes the last distance still in the air. The full march starts at the nearest of the 3 × 3
  coarse pixels around it, less a margin of four coarse footprints; if none reached the ground the pixel is sky and
  is not marched. It is its own scene pass (`Raymarch pre-pass`), so `gpuScenePass` includes it. In the lab it looked
  the same as no pre-pass at 1/4 and 1/8 (horizon and low flyover, 600 km); features thinner than a coarse pixel
  standing alone against the sky could be lost.
- **Suite `planet-shape-raymarch` v2:** v2 at every pose and size with the pre-pass off and at 1/4, 1/2 and 1/8 at the
  600 km ground, one case with the soft shadow, and v1 at 600 km as the reference. Run 2026-10-22 (below).

#### 2026-10-22: v2 timed (finish line 1 met); edits replace the pad (finish line 3)

- **Suite `planet-shape-raymarch` v2, unattended on the 3080** (`npm run test:run`, standard, 2538 × 1440, GPU at
  100 % and throttled at about 76 °C, so a little high). Scene pass medians (ms), pre-pass off → 1/4:
  ground 15.5 → 4.9 (64 km), 17.0 → 5.4 (600 km), 19.1 → 8.4 (6371 km); horizon grazing 6.1 → 2.9, 4.3 → 2.9,
  2.6 → 2.3; low flyover 3.1 → 2.4, 3.5 → 2.8, 2.2 → 2.6; orbit 1.2–1.7 either way. At the 600 km ground, 1/2 is
  7.8 and 1/8 is 6.1 (1/4 is the sweet spot), the soft shadow adds 0.8 (6.2). v1 at 600 km in the same run: 42–50
  near the ground. So the 16 ms milestone holds at every pose with the 1/4 pre-pass; D8's 2 ms is still 3–4× away
  near the ground. Of the 5.4 ms, the pre-pass at 1/2 was 4.6 ms in the pass labels, so the coarse march is now the
  bigger half.
- **Runner fix:** the first attempt stopped at the 26th scenario with "Run timed out": the whole-run budget was a flat
  180 s unless the mode was soak. `TestSession` now adds every scenario's warm-up and window (times the repetitions)
  to the 180 s in every mode (`testing/test-session.ts`, CHANGELOG, `docs/testing.md`).
- **Edits** (`planet-shape-field.ts`): `TerrainEdit` = `flatten` (a disc levelled at `heightM`, soft edge `edgeM`),
  `soften` (the disc keeps `strength` of the relief), `carve` (a sphere removed, smooth-max rim). Applied after the
  noise, in list order, up to 8. The shader gets two vec4 arrays: the centre minus the camera, worked out in doubles
  every frame like the noise origins (so a metre-scale disc holds on an Earth-size body), and the kind code; and
  radius, edge, height, strength. The pad is now `padEdit(radius)`, the default list; `padAt` is gone. The CPU twin
  applies the same edits (`applyEditCpu`, `createTerrainFieldCpu(radius, bytes, edits)`, `setEdits`).
- **Per-ray edit mask:** looping over every edit at every march step cost too much (first edits run: ground pad
  6.5 ms against 5.4 with the old inline pad; the pad plus three sites 9.2). Each edit now has a bound radius
  (`editBoundM`: a disc's cylinder through the air band with 5 % margin, a carve's sphere plus rim) outside which it
  cannot change solidity; each ray works out once which bounds its segment passes (`rayEditMask`, an int bitmask)
  and the march skips the others. Normals and shadows still read all edits. Timed again (`planet-shape-edits` v1,
  600 km, 1/4 pre-pass, ms, none / pad / pad + three sites): low flyover 3.0 / 3.2 / 3.7 (4.2 before the mask),
  horizon grazing 3.1 / 3.3 / 3.8 (4.2), ground 2.7 / 6.6 / 9.1 (9.2). At the ground the camera stands in the pad
  and looks straight at the sites, so nearly every ray really does meet them; and a disc's bound sphere spans the
  whole air band (about 17 km at 600 km for a 2.7 km disc). Levers for the race: a capsule bound along the edit's
  vertical instead of a sphere, and a cheaper inline path when one edit is in play. ("None" at the ground is cheap
  only because the 2 m camera is then inside rock.)
- **Lab:** an "edits" row (pad, none, pad + base sites: a raised flat base, a bowl carved into the pad rim and a
  softened stretch, east of the poses where the low and grazing views look); setting `rayEdits` in the tests;
  suite `planet-shape-edits` v1 (none / pad / sites at the low, ground and grazing poses, 600 km, pre-pass 1/4).
- **Specs** (55 lab specs green): edit parity GPU against CPU at 20 km and 6371 km (worst 3 mm and 0.66 m against
  units of 60 m and 900 m; about 150 points per body actually changed by the edits, so the check is not vacuous);
  flatten levels the ground at its height and leaves it alone outside; soften keeps its share of the relief; carve
  opens a hole; points just outside each bound keep their solidity; the GPU mask selects the edit a ray passes and
  not one beside it.

#### Same day: two blended biomes (finish line 4); review suite (finish line 5)

- **Biomes** (`planet-shape-field.ts`): `BiomeParams` = canyon depth, rock amplitude, vertical stretch, per-octave
  contrast (an octave keeps its mean, so the band does not move). `CANYON_BIOME` is the old field (7, 3, 4,
  [1, 1, 1]); `HILLS_BIOME` is rolling hills (0, 3, 1, [1, 0.5, 0.2]): no canyons, round, smoother. A biome mask
  (value noise on its own camera-relative frame, lattice 40 units, edge 0.42–0.58) blends the parameters, not two
  fields: one extra texture read per step. Every biome has to stay inside the canyon biome's band (a spec checks
  it), since the march spheres come from it. The offset was picked (by a CPU search) so that at 600 km the poses stand
  in hills and canyons start about 10 km east: the grazing view shows rolling green hills in front and canyon country
  behind. Shading: the hills are greener (grass on gentler slopes and more of it) and less dusty. A first try with
  amplitude 2.5 and contrast [1, 0.35, 0.12] read as nearly flat from 12 km up.
- `FieldNodes.biome` = frame and an override node (0 or more replaces the mask); `fieldBiomeAt`, `biomeAt`,
  `biomeParams`; `rockAt` takes the blend. CPU twin: `biome(p)`, `biomeOverride`, fourth argument of
  `createTerrainFieldCpu`. Lab: a "biome" row (blend, canyons, hills); setting `rayBiome`.
- **Specs** (58 green): field parity now includes the biome frame (rock and density compared under the blend; worst
  density 0.16 m at 6371 km, 5 mm at 20 km); the biome band check; the mask gives both biomes over a sphere of
  directions (over 80 of 400 each) and the override makes one everywhere; the hills biome has no canyon term.
- **Suites:** `planet-shape-biomes` v1 (timing: canyons, hills, blend at the low, ground and grazing poses, 600 km,
  1/4 pre-pass) and `planet-shape-terrain-views` v1 (functional, `requiresVisualReview`: each biome and the blend at
  those poses and the base-site edits at the low and grazing poses, spin paused at a fixed sun). The views wait for the
  owner's review on the results page.
- **Timed** (`planet-shape-biomes` v1, 600 km, 1/4 pre-pass, pad; ms, canyons / hills / blend): low flyover
  3.1 / 3.2 / 3.7, horizon grazing 3.2 / 3.7 / 4.4, ground 7.0 / 8.1 / 9.1. The blend costs more than either biome
  alone (the mask read, and the border is where these views look). All under the 16 ms milestone. The views run
  (`planet-shape-terrain-views` v1, 11 cases) is saved with thumbnails and `visual=pending` for the owner.
- **Finish line status:** 1 (16 ms) met; 2 (one definition, CPU twin, parity) met; 3 (edits) met; 4 (two blended
  biomes) met; 5 (tests) in place: timing per biome, edit set and pose, parity specs, review views pending.
- **Owner review (same day):** the owner checked the blend and the flatten edits in the lab and found them working,
  which closes item 5; Phase 1 is done. The owner noticed floating rock (unsupported 3D-noise blobs) in places.
  Causes, fixes and the cell-planet, collider, scatter and race notes from that conversation are in the plan's
  "Design notes (2026-10-22)".
- **CPU twin cost (Node 22, reference laptop, one thread):** about 12 µs per `density` sample, 390 ms for a 32³
  block at 600 km. Input to the D2 spike: collider blocks are a strong case for GPU sampling with a readback.

## 2026-10-22: grounded rock for terrain v2 (floating-rock fix 1)

- **Built.** `BiomeParams.grounded` (0..1, blended by the biome mask): 0 is the wild 3D density as before, 1 the
  grounded one. Canyons stay wild (the owner likes the floaters there, and strata need the vertical stretch a height
  surface cannot have); hills are grounded. Densities are blended by the share; only the modes in use are evaluated
  (`If` per share), so hills cost about what they did (biome read, two warp reads that the canyon term would share,
  three rock octaves; the canyon term is skipped where the biome's canyon depth is 0). Lab: "rock: biome / wild /
  grounded" row (`setRock?` on the raymarch terrain, settings key `rayRock`, a mismatch key in the adapter, defaults
  `biome`). Timing suite `planet-shape-rock` v1 (wild vs grounded at low, ground and grazing, 600 km, `rayPrepass: 4`)
  is defined, not run.
- **Field.** `density_grounded(p) = altitude(q) + relief(direction(q))`, `q = p + w(p)`. The relief is the wild field's
  expression (canyon term plus rock octaves) read at the point of the sphere under `q`, with no vertical stretch, so it
  depends on the direction of `q` only. `w` is tangential: the two canyon-mask noises (lattices 30 and 14.9 units)
  move the point along two fixed axes by up to ±`WARP_FACTOR` × lattice (±2.4 and ±1.2 units), projected onto the
  tangent plane. `altitude(q)` is computed as `altitude(p) + |w|²/(|p| + |q|)` (exact for a tangential `w`, no
  cancellation on a big body). CPU twin: `warp`, `groundedOverride`, `grounded`.
- **Bound.** Value noise has `|grad n| <= 1.5 √3 = 2.6` per lattice cell (smoothstep' <= 1.5, lattice differences
  <= 1). With `A_i = 0.08 L_i`, `||Dw|| <= 2 · 2.6 · √2 · 0.08 = 0.59`, plus 0.017 for the projection varying over the
  body radius (a unit is at most 0.3 % of it): `warpLipschitzBound()` = 0.604, so `p -> q` is a bijection with margin
  0.4. The solid set is then a deformed height-surface solid: connected, no floaters. In the blend zone (share between
  0 and 1) the density is a mix, so the guarantee holds where the share is 1, which covers the hills; the border is as
  narrow as the biome edge.
- **Specs** (`planet-shape-field.spec.ts`, headless): GPU/CPU parity with grounded 1 and 0.5 on 20 km, 1737 km and
  6371 km bodies (worst 1e-3 m at 20 km, 0.4 m at the big bodies against a 9 m tolerance, the same level as the wild
  parity); measured largest `||Dw||` 0.21–0.23 by finite differences (bound 0.604) and measured noise gradient 1.41
  (bound 2.6); no-floaters flood fill (48×48×96 voxels, 6 units wide, the whole band tall, 12 spots × canyons and
  hills): grounded 0 unreached solid voxels in all 24 blocks, wild 18 unreached voxels in one canyon block and none
  elsewhere (floaters are rare and small in the grid: the check has teeth, but thinly). The existing hills spec now
  pins `groundedOverride 0`. The lead's in-progress `shape-ops` spec did not compile during my runs, so I ran with a
  temporary tsconfig that left it out (field and lab specs: 64 of 65 on the first run, the one failure being my own
  threshold, then 25 of 25 in the field spec).
- **Look** (lab, low flyover, 600 km, 1/4 pre-pass, spin paused). Canyons wild: stepped ledges, fragmented strata and
  ragged overhangs. Canyons grounded: one smooth sheet, canyon walls lean a little, no ledges (no vertical stretch).
  Hills wild vs grounded: both rolling; grounded is slightly bumpier (isotropic octaves, no stretch to flatten them).
  The tell is the canyons: use wild there for the floating-rock look, grounded for solid ground.
- **Constants:** `WARP_FACTOR` 0.08, `NOISE_GRADIENT_MAX` 2.6, `UNIT_RADIUS_RATIO` 0.003, `WARP_AMPLITUDE` [2.4, 1.19]
  units, `CANYON_BIOME.grounded` 0, `HILLS_BIOME.grounded` 1.

## 2026-10-22: Phase 1b starts: shape ops, op log, op index (CPU)

New folder `projects/demo-app/src/app/pages/planet-shape-lab/shape-ops/` (CPU reference; the TSL twin and the field
integration come next, after the grounded-rock work on the field files lands).

- **`shape-op.ts`.**
  - Height ops: `disc`, `cone`, `crater`, `path` (flat or round profile, a height per point). Blends: `add`, `set`, `raise`, `lower`, `scale`.
  - Volume ops: `sphere`, `tube`, with `union` or `subtract`.
  - Each op has an id, a fidelity class and a minimum visible size. `contact` and `topology` ops are never skipped; `relaxed` and `silhouette` ops are skipped when the sample footprint is larger than their size.
  - Horizontal distances are arcs on the body sphere. The Phase 1 edits used the distance from the vertical axis, which grows with depth.
  - `shapeOpFromTerrainEdit` maps flatten → disc + set, soften → disc + scale, and carve → sphere + subtract.
  - `validateShapeOp` gives readable errors for ops from save files.
- **Bounds contract.**
  - Outside an op's caps the op is the identity, bit for bit.
  - Inside the caps but outside its altitude range, the op never changes solidity.
  - Two changes were needed to make the first rule exact:
    - Volume ops fade out between k and 2k from the shape. A plain smooth union lowers positive values far away, and a later `set`/`scale` could then flip solidity when an index skips the union.
    - Height blends return the input untouched at weight 0, because `scale` re-adding the altitude was off by one ulp.
  - `shapeOpsBounds` widens each op's input band by the earlier ops whose caps meet it.
- **`op-log.ts`.**
  - Entry types are `add`, `replace` (keeps the op's position) and `remove`.
  - `replayOpLog` is deterministic and throws on entries that don't fit.
  - `hashShapeOps` is a 64-bit hash of canonical JSON (sorted keys), so key order doesn't matter.
  - `createOpLog` provides append (atomic: a refused entry leaves the log as it was), undo and `toJSON`. `parseOpLog` checks the version and replays.
- **`op-index.ts`.**
  - Cube-face gnomonic tiles; each op is listed in every tile its caps meet, in apply order. A cap's tile box comes from its sampled rim, grown so the gaps between samples are covered.
  - `bandAt` gives the per-tile altitude band: the march bound per region.
  - Applying a tile's ops gives exactly the value of applying them all. A march still must not step past a tile's edge on that value.
- **Specs** (`shape-ops.spec.ts`, 12/12, headless):
  - Ground under the `sites` preset, edits vs ops: worst difference 2.7e-4 units (103 of 160 grounds moved).
  - Each shape gives the profile it describes.
  - Volume ops add and remove rock.
  - Validation errors.
  - The bounds contract on the real CPU field: 2238 points outside bounds kept solidity; 40 inside changed it, so the check has teeth.
  - After 40 random ops, the ground stays inside the index's per-tile band.
  - Minimum visible size by fidelity class.
  - Op log: replay through a JSON save, undo restoring every earlier hash, refused entries.
  - Index: no op missed at cap rims across face edges and corners; ascending order.
  - Indexed evaluation equals full evaluation exactly.
- **CPU cost per sample against op count** (ops packed into about 40 units, so tiles are crowded; 512 tiles per face):

  | ops | all ops | indexed | max ops per tile |
  |---|---|---|---|
  | 10 | 2.7 µs | 1.3 µs | 2 |
  | 100 | 28 µs | 1.7 µs | 14 |
  | 1000 | 160 µs | 11 µs | 158 |

  This is the first point of the op-count cost curve.

## 2026-10-22: data-flow core (`triangular-engine/gpu-data-flow`)

Built in a parallel session from the plan's "Data-flow core" rules. It's a library secondary entry, with a doc in
`projects/triangular-engine/docs/gpu-data-flow.md` and a CHANGELOG entry.

- **Design.** All logic is plain TypeScript behind a small `FlowDevice` interface (`createBuffer`, `writeBuffer`,
  `copyBuffer`, `mapRead`, `limits`, and an injectable clock), so the specs use a fake device.
  - The caller passes the frame in; the module doesn't own it.
  - Readback slots are fixed in size. When all are busy, a request drops (and is counted) instead of queueing.
  - Latency is recorded in milliseconds from the clock and in frames.
  - Default limits are the WebGPU defaults (128 MiB storage binding).
- **Parts:**
  - `UploadRing`: a per-frame byte budget; large writes split on 4-byte boundaries; queue depth and bytes as metrics.
  - `ReadbackRing`: `request` returns at once; `poll(frame)` yields results with `frame`, `tag`, `latencyMs` and `latencyFrames`.
  - `LatencyWindow`: p50/p95 over a rolling window.
  - `DoubleBuffer`: `swap` and `grow`; growth is guarded and keeps the read contents.
  - `CapacityGuard`: throws `GpuCapacityError` before creation, with headroom and a total budget.
  - `JobScheduler`: GPU and worker lanes with per-frame cost budgets, an in-flight cap, priorities and error isolation.
  - `telemetry()` on every part returns plain data.
  - WebGPU binding: `createWebGpuFlowDevice`, `webGpuDeviceOf(renderer)` and `adoptGpuBuffer`.
- **Specs:** 27, headless, in `gpu-data-flow.spec.ts`; `npm run test:triangular-engine:gpu-data-flow`. The library
  build passes.
- **Not yet:**
  - The binding has not run on real WebGPU hardware. Its first real use is the D2 collider-block spike.
  - Each copy submits its own command buffer; batching comes later.
- **Spec run time:** the grounded-rock floater spec (24 voxel blocks of the CPU field) blocked the headless browser past
  Karma's ping timeout in a full lab run. It now yields every 4 layers, and the full lab run is 77/77.

## 2026-10-22: cell-planet bake and shape programs

Phase 1b: the cell planet as the source of terrain v2's large scale. New folder
`projects/demo-app/src/app/pages/planet-shape-lab/cell-bake/` (no other lab file touched). Not wired in yet.

- **`cell-bake.ts`**
  - `cellData(world, params?)` returns per-cell `baseHeightM`, `biome` (0 = canyons, 1 = hills, as `CANYON_BIOME` /
    `HILLS_BIOME`), `maxHeightM` and `isMountain`. Heights come from `tectonics.elevation` above sea level, scaled so the
    highest land is `landMaxM` (3000); sea floor is clamped to `-oceanDepthM` (600). `maxHeightM` is the base plus
    `mountainReliefM` (1800) in a mountain cell, `otherReliefM` (300) on other land, 0 at sea. Dry biomes
    (canyon, rift canyon, desert, martian lowlands/highlands, volcanic plains, cinder plateau) are 0; all else is 1.
  - `bakeCellPlanet(world, { resolution = 128, blendFraction = 0.5, ... })` returns a `CellBake`:
    `{ resolution, size = resolution + 2, data: Float32Array, blendRadians, cellCount }`. `data` is an RGBA float32
    atlas, `size` wide and `6 * size` tall, faces stacked; texel = `[baseHeightM, biome, maxHeightM, 1]`.
    Face = axis * 2 + (negative ? 1 : 0), u and v are the next two axes over the major component (as `op-index.ts`).
    Each face has a one-texel gutter baked from the true directions beyond its edge, so bilinear lookups cross face
    edges without a seam.
  - Blending: a cell's weight is a smoothstep from 1 at the nearest cell's angle to 0 at that angle plus `blendRadians`
    (`blendFraction` of the mean cell spacing), then normalised. Equal on a border, so continuous; no polygon steps.
  - `sampleCellBake(bake, direction)` returns `{ baseHeightM, biome, maxHeightM }` with bilinear filtering (any
    non-zero direction).
  - `createCellBakeTexture(bake)` returns a `DataTexture` (float32, nearest filter). `cellBakeNode(texture,
    bake.resolution, directionNode)` is the TSL twin and returns a vec3 node `(baseHeightM, biome, maxHeightM)`. It does
    the CPU steps with four `textureLoad`s, so it needs no float32-filterable feature. Bind the texture once; the
    direction is the unit body-relative direction of the sample point.
  - Also exported: `isMountainCell(world, id)`, `cellBakeDirection(face, u, v)`.
  - Cost: O(texels x cells), about 0.2 s at 48 texels and 600 cells in the spec; roughly a second or two at 128 and 2,000
    cells. Bake once per world, off the frame path.
- **`shape-programs.ts`**: `type ShapeProgram = (world, seed, { radiusM, mountainHeightM? }) => ShapeOp[]`. Pure and
  deterministic; every op is checked with `validateShapeOp` before it is returned. Positions are `direction * radiusM`.
  - `singleCellMountains`: one `cone` (blend `add`, fidelity `silhouette`) per mountain cell; radius is 0.85 of the
    cell's farthest-corner angle; height 70 to 100 % of `mountainHeightM` (1500).
  - `multiCellRidges`: shared edges between neighbouring mountain cells are chained into polylines; each chain of at
    least two edges is a rounded `path` (`add`) with seeded heights. A chain of five or more points gets a summit
    `crater`; each end gets a `disc` with `scale` 0.5 to calm the foot.
- **Integration notes**
  - Large scale: `altitude = baseHeightM(bake) + ops + detail`, with the biome weight feeding `biomeParams(m)` /
    `biomeAt`, and `maxHeightM` bounding the per-direction march band (the op index band is still the base band widened
    by the ops).
  - Biome borders are blended but not noise-warped here; warp the lookup direction in the field if borders look smooth.
  - The TSL node has no GPU parity run yet (the spec builds the node graph only); compare it with `sampleCellBake`
    in the lab on real hardware.
- **Specs** (`cell-bake.spec.ts`, 11, headless): layout and finite values, texel-centre reproduction, a mixed-biome
  blend, no steps across cell borders and face edges (bounded slope), seam continuity at face edges, TSL node and texture
  construction, mountain cells exist, valid cone per mountain cell and deterministic output, valid ridge paths with
  craters and discs, and `compileShapeOps` plus `buildShapeOpIndex` stats (indexed evaluation equals full).
  Run: `npx ng test demo-app --watch=false --browsers=ChromeHeadless --include='**/cell-bake/*.spec.ts'`.

## 2026-10-22: D2 collider blocks (GPU density vs workers)

Question: can collider data for terrain with overhangs be made fast enough. New folder
`projects/demo-app/src/app/pages/planet-shape-lab/collider-blocks/`; nothing else in `planet-shape-lab/` was edited.

- **Built.**
  - `block-grid.ts`: a block is 33³ corner samples (32³ cells), 143,748 bytes as float32, origin body-relative in doubles.
  - `gpu-density-block.ts`: a TSL compute pass (`densityAt`, the raymarcher's graph, workgroup 64) writing a storage buffer, read back through `gpu-data-flow`'s `ReadbackRing` (`adoptGpuBuffer` on the buffer behind the TSL storage node). Per block only uniforms change (origin, noise-frame origins, edits, overrides), so one compiled pipeline serves every block. This is the first real use of the data-flow binding, and it worked unchanged.
  - `surface-nets.ts`: naive surface nets (mean of edge crossings, quads split on the shorter diagonal, wound toward positive density). Open at the block boundary, so a collider needs one block of padding or neighbour skirts.
  - `cpu-density-block.ts` (the CPU twin per corner), `block-worker-pool.ts` and `collider-block.worker.ts` (a pool; jobs: sample, mesh, sample+mesh; grids and meshes transferred, not copied).
- **Specs** (`collider-blocks.spec.ts`, 8, headless):
  - Surface nets on an analytic sphere and a torus: every edge used exactly twice, once per direction, Euler characteristic 2 and 0, vertices within 0.1 voxel of the sphere, outward winding, volume within 5 %. An open surface stays open; an all-outside grid gives no mesh.
  - Worker blocks equal main-thread blocks bit for bit; worker meshes equal main-thread meshes.
  - GPU against CPU on 20 km blocks (2 m voxels, wild canyons, four directions, one with a carve edit): worst 9.1e-3 m against the 0.6 m field tolerance (a hundredth of the unit), 2 sign flips in 35,937 on the edit block, none elsewhere.
  - Timing logs. The GPU specs skip cleanly with "WebGPU is not available" in plain `ChromeHeadless`.
- **How to run.** `--include='**/collider-blocks/*.spec.ts'` matched; the `src/app/...` pattern in the brief matched nothing. Plain `ChromeHeadless` has no WebGPU adapter (5 run, 3 skipped). WebGPU needs `--karma-config=karma.gpu.conf.cjs --browsers=ChromeHeadlessGpu` (8 of 8).
- **Timings.** Headless and **the adapter is SwiftShader (`google / swiftshader`, a CPU-emulated GPU)**, so the GPU rows are not hardware numbers; two attempts at other flags still got SwiftShader. The CPU rows are real V8 in Chrome workers on the owner laptop CPU, with 4 workers, 20 km body, 2 m voxels. Ms per 33³ block:

  | path | one block, latency | pipelined, throughput |
  |---|---|---|
  | GPU compute + readback, wild canyons | 6.2 (CPU submit 0.15) | 4.3–4.7 per block, about 220 blocks/s |
  | GPU, grounded hills | 5.9 | 4.5–4.7 |
  | GPU, biome-mask blend | 6.2–7.1 | 4.6–5.2 |
  | CPU twin in a worker, wild | 62–65 (1.7–1.8 µs per sample) | 16 per block, 4 workers, 62 blocks/s |
  | CPU twin, grounded hills | 63–77 (1.7–2.1 µs) | 16 |
  | CPU twin, mask blend | 73–74 (2.0–2.1 µs) | 19, 54 blocks/s |
  | surface nets, main thread (4,300 triangles) | 1.1–1.3 | |
  | surface nets, in a worker | 1.5–2.0 median, round trip 2.4 (first runs cold, up to 13) | |

  Pipelined GPU ring latency is 25–35 ms because eight requests queue behind each other; that is queueing, not per-block cost.
- **Findings.**
  - The "12 µs per sample, 390 ms per block" figure does not hold in the browser: V8 in a worker does 1.7–2.1 µs per `density` call, 6× better, 62–77 ms per block. The earlier number was Node, unwarmed, with the pad edit. The CPU path is therefore a real option, not only a fallback: one block meets the 100 ms edit-to-collider target on a single worker.
  - Even on a software GPU the compute path is 3.5–4× faster in throughput than 4 workers and 10× faster per block, and the CPU cost on the main thread is 0.15 ms. A fill of a ring of 75 blocks (5×5×3) takes about 0.35 s on SwiftShader against about 1.2–1.4 s on 4 workers.
  - Meshing is cheap (about 1.2 ms): do it on the main thread for a block or two per frame, or in the worker that already has the grid; a separate mesh worker only costs a transfer.
  - GPU precision: the field's camera is a float32 uniform, so the block origin is rounded (about 0.25 m at Earth radius). Fine at the 20 km check body; Earth-size bodies need the origin split in two floats, or blocks built camera-relative to a nearer origin.
  - Readback is 140 KiB per block; packing to f16 or i16 distances halves it if needed.
- **Recommendation.** GPU density with the readback ring, then meshing and the Jolt shape on the CPU side (main thread or a worker), with the CPU-worker path kept as the fallback and reference (it is 60–75 ms per block, fast enough for edits and for the first fill on machines without WebGPU). Before D2 is closed, repeat the GPU rows on a real adapter (RTX 3080 Laptop); that needs a browser run with a lab hook or a test-run suite, which `collider-blocks/` does not provide. If the hardware GPU is not at least as fast as SwiftShader here, the workers alone are enough.
- **Needed from the field files.** Nothing was missing: `densityAt`, `fieldFrameMatrices`, `noiseOrigin`, `terrainEditUniforms`, `createTerrainFieldCpu` (`edits`, `biomeOverride`, `groundedOverride`) were enough. If `densityAt`'s signature changes, `gpu-density-block.ts` is the only consumer here.

## 2026-10-22: shape ops on the GPU (TSL twin), replacing the edit list

`shape-ops/shape-ops-gpu.ts`, `createShapeOpTextures()`: `setOps(ops, radiusM, base)`, `setCamera(camera)`,
`apply(value, x, up, altitude, footprint)` (TSL), `band`, `index`. Terrain v2 (`planet-shape-raymarch-lit.ts`) now
takes shape ops through `FieldNodes.shapeOps` (`densityAt` applies them after the old edits, which the lit terrain no
longer sets); `setEdits` converts edits with `shapeOpFromTerrainEdit`. The CPU twin got `setShapeOps`, and
`groundHeightAt` searches the band widened by the ops.

**Packing.** Four RGBA32F textures, 128 wide, allocated once: ops (4 texels each: centre and shape code; size, edge,
height and blend code; shape extras, blend parameter, minimum visible size; first segment and count), path and tube
segments (4 texels: ends with heights, great-circle normal and angle, unit start and its length), one texel per op-index
tile (first entry, count, band) and an R32F list of op positions. Capacities 4096 ops, 4096 segments, 65,536 index
entries, 6 x 32² tiles; `setOps` throws past them.

**Precision.** Positions are packed relative to an origin near the camera and repacked when the camera has moved more
than max(1 km, a tenth of its altitude); the shader adds the small camera-to-origin shift. Arcs come from
camera-relative differences: the angle between P and P + D is `atan(|up x D|, |P| + up . D)`, so two nearly equal unit
vectors are never subtracted. On a path the signed angle along the segment uses the same trick around the circle's
normal. The op index grows each tile by 1e-6 rad (about 6 m on Earth) so a float32 lookup a hair across a tile border
still finds every op.

**A GPU `asin` trap.** The first parity run was off by up to 0.1 units on paths only. The cause: the evaluation
backend's `asin(0.002)` returned 0.00206 (3 % high). The perpendicular arc is now `atan(s, sqrt(1 - s²))`, exact
there. Worth remembering for any small-angle maths in shaders.

**Specs** (`shape-ops-gpu.spec.ts`, 6, all pass with the 13 CPU ones): ten ops of every shape and blend against
`compileShapeOps` at 20 km, 600 km, Earth and a cube-face corner, worst 0.043 m (unit 60 m) and 0.69 m (unit 900 m)
with 40 to 50 % of values changed; footprint skips relaxed ops and keeps contact ones; the band grows by the ops; the
whole terrain v2 density with the landforms against the CPU twin at 600 km, worst 6.3 m (the field's own tolerance is
9 m there), 107 of 160 points changed by the ops. Full lab specs: 99 pass (with the two side sessions' new specs).

**Landforms preset** (`shapeOpPreset('landforms')`, the lab's "pad + landforms" button), in relief units east of the
poses: a cone mountain (5 units, raised, not added: added onto the 7-unit-deep canyon it first landed in, it barely
reached the plain), a crater, a round ridge path, a flat road (`set`, a causeway through the canyons), a sphere ledge on
the mountain's flank (a column under it reads air, rock, air, rock: a real overhang), a bent tube arch and a tunnel
through the mountain's foot. Seen in the lab from the grazing pose; the arch's underside shows ribbed banding, most
likely march steps across the union's fade, to look at with the step and normal settings.

**Not done yet.** The march still runs the global band (`band`, the widest over all tiles); per-tile bands are packed
(tile texel z, w) but unused. Timing: suite `planet-shape-ops` v1 (pad against landforms, three poses) and the review
suite `planet-shape-landforms-views` v1, not run (they need the laptop free). Re-running `planet-shape-edits` v1 gives
the old 8-edit list's numbers against the shape-op path on the same views. The old edit uniforms (`terrainEditUniforms`,
`rayEditMask`) stay for the field spec's edit tests and can go once those move to shape ops.

## 2026-10-22: arch gaps and the share-0 shading fix

- **Arch legs in slices over canyons.** A volume op leaves the field untouched beyond 2k from its shape (so the op
  index can skip it), so near a thin union shape the field is the plain terrain's value. Over a deep canyon that is
  hundreds of metres, and a march step jumped through the leg. Which slices survived depended on the step pattern,
  so changing biome or the rock share moved them. Fix: `ShapeOpNodes.reach(x, footprint)` is the exact distance to the
  nearest union shape (a global list after the tile entries, not per tile, since a step can start outside the
  listing tiles). The march and the shadow march never step past it. The cost is one SDF per union op per step;
  per-tile lists with a margin of one step would be needed with many unions.
- **Wild (share exactly 0) shaded wrong.** The lit normals passed expressions into `densityAt`. TSL emits a shared
  expression where it is first built, which was inside the grounded `If` block, so at share 0 the normals read an
  unset value (dark faces, black crater, shading that looked like different shapes). `densityAt` now takes its inputs
  as variables first. The density itself was right: GPU against CPU at shares 0, 0.05 and 1, one-tap and smooth noise,
  with and without ops, all within 0.005 units.
- **Ring bands ("portal" look) on the road walls over canyons.** A `set` path over a canyon blends the road surface
  and the canyon floor across a 0.6-unit edge, so up to 7 units of depth become a cliff whose field grows many times
  faster than distance. A march step over the edge ended deep inside the road column, and the single secant step
  between the last two samples interpolated across that jump, landing off the surface in bands. Fix: the full march
  bisects the hit bracket (up to `REFINE_STEPS` = 8, stopping once it is narrower than the pixel) before the secant.
  Dividing the field by a local steepness bound was tried and dropped: it only helps inside the edge band (a ray
  still steps into the band from outside), and scaling the value changes how later ops (`scale`, smooth `raise`)
  read it. The GPU also now packs the minimum edge for height shapes without an `edgeM` key, as the CPU does.
- **Arch floating over canyons.** Its legs ended 0.6 units below the plain, above the canyon floors (up to
  `CANYON_DEPTH` = 7 units down). They now run on straight down to 8 units below.

## 2026-10-22: graded road, a march-step spec and the terrain quality suite

The bisection above made the road bands rarer, not gone (owner, same day, through the arch). The cause was the field,
not the refinement: across a canyon the `set` road's 0.6-unit edge is a cliff about 12 times steeper than distance, and
the march, which trusts the field up to 4 (`MARCH_STEP_SCALE` = 0.25), stepped clean through thin parts of it. No
refinement helps a step that never lands in rock. So the fix moved to the op, and two checks now measure this class of
fault instead of a screenshot.

- **`grade` blend** (`shape-op.ts`, shader twin code 7). The profile inside the shape, and outside it banks that rise
  and fall from the profile's height by `slope` (rise over run, default 1) until they meet the ground: a cutting where
  the ground is higher, a fill where it is lower. It is a clamp, `max(min(value, level + slope * d), level - slope * d)`
  with `d` the metres beyond the shape's core, so where the ground already lies between the banks the value passes
  through bit for bit. Its caps reach as far as the band under it needs (`(band height) / slope`, 1% margin), which
  keeps the "identity outside the caps" contract. The landforms road is now graded at slope 1. Limit: the caps follow
  the band, and overlapping `scale` ops with factors over 1 stretch the band without limit (the 1,000-op cost
  benchmark of random ops reached whole-body caps and hung the browser), so that benchmark leaves graded ops out. A log
  of real edits does not stack exaggerating scales; if one ever does, `grade` needs a cap on its bank reach.
- **March-step spec** (`shape-ops/march-steps.spec.ts`). From random air points in each op's bounds it takes the
  march's own step (field x `MARCH_STEP_SCALE`, capped at the nearest union shape) in a random direction and measures
  the rock the step crosses, with the ops and without. Raw slope was measured first and dropped: union shapes are steep
  in their fade band by design, and the march's `reach` cap already covers them. Numbers (600 km body, 1,500 points per
  op): with the graded road the most rock any step crosses is 0.23 units, at the ridge, where the field alone also
  crosses 0.10 (its stretched noise is a little steeper than 4 in places; those steps land in the rock with one
  crossing, which the bisection resolves). With the road `set`, 0.84 units at the road and 0.95 near the arch. The line
  is 0.3 units, and the spec checks that the set road fails it. The tunnel's steps cross up to 0.15 units: noise inside
  the rock it opens, not the tube.
- **CPU reach twin.** `CompiledShapeOps.reach(p)` and `TerrainFieldCpu.reach(p)` give the shader's `reach` on the CPU
  (the shader spec checks the two agree), and `TerrainFieldCpu.band` the altitudes the ground lies between.
- **Terrain quality suite** (`planet-shape-terrain-quality` v1, functional, `planet-shape-terrain-quality.ts`). Terrain
  v2 gets two depth probes: the march as drawn (without the pre-pass) and a slow reference march that trusts the field
  only up to a slope of 64, never steps under a pixel, hits only on a crossing and bisects to a twentieth of a pixel.
  Each writes per pixel the distance, a ran-out flag and the field at the drawn point in footprints. A pixel is wrong
  when its fast point is off the surface (field over 4 footprints from zero), behind the reference by over 4 footprints
  along the ray (through a wall), or drawn by one march only more than 3 pixels from the reference's outline (a hole or
  sliver). The reference is checked on a grid of 40 pixels against the same march on the CPU twin in doubles. Scenarios:
  landforms in canyons and in the blend, from the low flyover and the grazing pose and three close-ups set by a new
  optional `view` setting (through the arch to the road, along the road, the tunnel and the mountain). Scenario
  settings may now carry a free-camera `view`; the page applies it after the pose.
  - **Measured on the iGPU** (direct probe calls in the browser pane, the same classification): the ten views 0.00-0.12%
    wrong, every wrong pixel the far horizon drawn a few pixels fat. No fast point off the surface or behind it. The
    fast march's drawn points sit a median 1.1-1.6 footprints from the surface by the field, at most 2 (its half-pixel
    hit cone, as designed). The same arch view with the road `set` again: 1.66% wrong, 1,313 pixels behind the surface,
    all on the road wall seen through the arch, which is where the owner saw the bands. The line is 0.5%. GPU reference
    against the CPU march, first run: median 0.04 footprints, at most 0.28.
  - **How the measure got there.** Distance along the ray was tried first and flagged 8% of the low flyover: a cone stop
    at a grazing angle is many footprints short along the ray but the same place on screen. Distance along a normal
    estimated from the reference's depths was second, still 2.8%: the estimate is poor on distant grazing ground. The
    field at the drawn point is what the march itself promises, so it needs no geometry guesses.
  - **Gotchas.** A probe material whose `outputNode` used `.toVar()` outside an `Fn` drew nothing, with no shader or GPU
    error; wrapped in an `Fn` it works. A new probe material's pipeline compiles in the background and its first draws
    are skipped, so the page redraws until the target holds anything (60 s limit). The reference holds the iGPU for
    over half a second, which trips the engine's GPU-timer readback timeout; the adapter treats that error during the
    probe as expected and still fails on any other.
  - **First run on the reference machine (RTX 3080).** It stopped at road-along on the guard that the reference's own
    point has |field| at most 4 footprints: 4.0009. The four views that ran were 0.00% wrong, with no pixels off the
    surface or behind it. The reference stops on a crossing to a twentieth of a pixel, so its |field| is the field's
    steepness there (iGPU 2.2 in the same view, 1.2-3.0 in the others), not a miss, and the CPU check agreed (max 2.05
    footprints). The guard is now 8 (`REFERENCE_FIELD_FOOTPRINTS`), there to catch a failed refinement or a field that
    jumps. The fast march's off-surface line stays 4; its points reached 3.6 at grazing views, which is close.
  - **Passed on the reference machine** (2026-10-22T18:09, RTX 3080): all ten cases 0.00% wrong (most wrong pixels in a
    case: 78 drawn by one march only, in a 480x270 probe), no fast ray ran out, no flicker. The reference agreed with
    the CPU march to a median of at most 0.11 footprints; blend arch-road had grid pixels up to 2.6 off, within the two
    allowed. The fast points' field reached 3.6 footprints in the canyons' grazing views; the line is 4.
  - **Not done.** The fast probe leaves the pre-pass out (its target has another size). Shading is not compared, only where the
    surface is drawn. The horizon fattening (the cone stop) could be tightened by shrinking the hit cone with distance.
