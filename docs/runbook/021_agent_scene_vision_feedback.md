# 021 — Agent scene vision and token-efficient feedback

Status: Ready for implementation handoff (Sol architecture pass, 2026-08-22).

Related work:

- [projects/triangular-engine/docs/ai-agents.md](../../projects/triangular-engine/docs/ai-agents.md) — supported agent-facing engine conventions.
- [projects/triangular-engine/src/lib/engine/components/scene-saver/scene-saver.component.ts](../../projects/triangular-engine/src/lib/engine/components/scene-saver/scene-saver.component.ts) — existing human-triggered canvas export; useful precedent, not the implementation API for this plan.
- Downstream application WebMCP documentation — existing browser-tab-to-MCP relay and tool registration.
- Downstream application telemetry documentation — precedent for compact, deterministic agent summaries.
- Local agent daemon vision documentation — model-selection and vision-capability notes.
- Local agent daemon MCP bridge — persists, compresses, and forwards MCP image blocks to vision models.

## Goal

Let coding agents inspect a live Triangular Engine scene without requiring the
Human to repeatedly describe what is visible. Agents should receive two
complementary forms of evidence:

1. deterministic, token-efficient scene facts from Three.js; and
2. an optional rendered screenshot for visual interpretation by a vision model.

The engine establishes facts such as names, transforms, bounds, visibility,
camera state, and renderer statistics. A vision model evaluates appearance,
composition, lighting, clipping, occlusion, and whether the visual result
matches the requested intent.

```text
live EngineService
  ├─ inspect scene ──> compact SceneSnapshot ─┐
  └─ capture frame ──> image/jpeg artifact ──┼─> downstream WebMCP tools
                                               ├─> external coding agents
                                               └─> local vision-model critique
```

## Why this is split across repositories

### Triangular Engine owns

- transport-neutral scene inspection contracts and pure functions;
- renderer/canvas frame capture;
- deterministic filtering, truncation, rounding, and warning generation;
- tests for Three.js scene traversal and capture state restoration.

Triangular Engine must not import MCP, application-specific code, an agent
daemon, an Ollama client, or model-specific types. The same API should remain
usable from a unit test, browser UI, CLI adapter, or a future Three.js
application.

### The downstream application owns

- selecting the live application viewport/`EngineService` to inspect;
- registering WebMCP tools and shaping MCP content blocks;
- application-specific semantic context such as vessels, launch sites, flight
  modes, and telemetry;
- deciding which route/viewports are safe and useful to expose.

### The local agent daemon owns

- selecting and scheduling the local vision model;
- image resizing/compression at the model boundary;
- prompt templates, model usage accounting, and critique artifacts;
- optional higher-level `render -> critique -> change -> render` loops.

The first implementation does not require a direct engine-to-daemon API. An
existing MCP bridge can consume the WebMCP screenshot image block once the
downstream application returns it.

## Verified starting point

- `EngineService` already exposes `scene`, `camera`, `renderer`, `canvas`,
  `requestSingleRender()`, renderer statistics, and render-pipeline ownership.
- `SceneSaverComponent` proves that the current WebGL canvas can be exported
  with `toBlob()`/`toDataURL()`.
- A downstream application already registers domain tools through
  `WebmcpToolRegistryService` and a local WebMCP relay.
- The downstream application's current `WebmcpToolResult` typing permits text
  blocks only; it must be extended to represent MCP image content before
  screenshot tools land.
- An existing local MCP bridge accepts image content, writes an artifact,
  resizes it, and passes a model-facing data URL into local model chat.
- `EngineService.activeInstance` is a latest-instance convenience and is not a
  stable viewport identity. Agent tooling must not silently use it when more
  than one scene can exist.

## Core decisions

### D1. Hybrid evidence, independently selectable

Scene facts and screenshots are separate operations. A caller can request only
the cheap deterministic summary, only a screenshot, or both through a later
diagnostic composition tool. No routine read should automatically send an
image to a model.

### D2. Pure engine utilities before Angular integration

Implement the first engine slice as public, transport-neutral functions and
data contracts under `src/lib/engine/inspection/`. Functions receive explicit
scene/camera/renderer or `EngineService` arguments. Do not create a root-scoped
inspection service that might resolve a different scene-local `EngineService`.

Suggested public surface:

```ts
export interface SceneInspectionSource {
  scene: Scene;
  camera: Camera;
  renderer?: WebGLRenderer | WebGPURenderer;
}

export function inspectScene(
  source: SceneInspectionSource,
  options?: SceneInspectionOptions,
): SceneSnapshot;

export async function captureSceneFrame(
  engine: EngineService,
  options?: SceneCaptureOptions,
): Promise<SceneCapture>;
```

Add `inspection/index.ts`, export it from `engine/index.ts`, and keep the
symbols in the main `triangular-engine` entry point. This capability depends
only on core Three.js/engine types and does not justify a secondary package.

### D3. Bounded output is part of the contract

Large scenes, generated terrain, particles, helpers, and instanced meshes can
produce unusable dumps. Defaults must be compact and deterministic:

- summary mode returns aggregate counts, camera state, renderer statistics,
  warnings, and a bounded list of relevant named objects;
- object rows use rounded numbers rather than full floating-point values;
- hierarchy depth and object count have explicit limits;
- truncation is reported (`returnedObjectCount`, `totalObjectCount`,
  `truncated`) rather than hidden;
- UUIDs are opt-in or used only as stable lookup keys, not repeated in prose;
- geometry buffers, matrices, material uniforms, and `userData` payloads are
  never serialized wholesale.

### D4. The screenshot is the WebGL/WebGPU canvas, not the whole page

The default capture excludes DOM UI, CSS2D labels, CSS3D content, devtools, and
private text elsewhere on the page. This gives a narrow privacy boundary and a
clean visual signal. A future page screenshot is a separate browser-tool
capability and must not be smuggled into this API.

### D5. Capture must preserve live renderer state

`captureSceneFrame` must restore every temporary change in a `finally` block:

- renderer size;
- pixel ratio;
- active animation/render state if changed;
- any temporary camera aspect/projection changes;
- render target or pipeline state touched by capture.

Do not copy `SceneSaverComponent.saveScene()` literally: it restores the
requested capture dimensions rather than a separately recorded original size.
The new primitive must record and restore the actual original state.

The first slice should prefer current-viewport capture and avoid resizing the
live renderer if the requested output matches the canvas. Off-size capture may
land after current-size capture is proven with both direct rendering and the
registered post-processing pipeline.

### D6. Live viewport selection is explicit in the downstream application

For V1, the downstream application may inject its application-level
`EngineService` only after a manual check confirms that routed application
scenes use that exact instance. If the application can host multiple
independent scene instances, add an app-owned viewport
registry with stable IDs such as `editor`, `flight`, and `structures-lab`.
Do not fall back to `EngineService.activeInstance` without returning the chosen
instance identity to the caller.

## Scene snapshot contract

The exact TypeScript names may change during implementation, but the semantic
contract should remain recognizable:

```ts
export interface SceneSnapshot {
  version: 1;
  capturedAt: string;
  scene: {
    name?: string;
    totalObjectCount: number;
    returnedObjectCount: number;
    visibleObjectCount: number;
    meshCount: number;
    lightCount: number;
    cameraCount: number;
    truncated: boolean;
  };
  camera: SceneCameraSnapshot;
  renderer?: SceneRendererSnapshot;
  objects: SceneObjectSnapshot[];
  warnings: SceneInspectionWarning[];
}
```

Each returned object should contain only useful inspection facts:

- stable lookup identity (`uuid`) and human name/type;
- parent identity or compact path;
- visible/effective-visible state;
- world position and optional world-space bounds;
- child count;
- mesh geometry/material kind where inexpensive;
- render-order, layer, and frustum-culling flags when relevant.

Options should include:

```ts
interface SceneInspectionOptions {
  detail?: 'brief' | 'standard' | 'deep';
  maxObjects?: number;
  maxDepth?: number;
  nameIncludes?: string;
  objectId?: string;
  visibleOnly?: boolean;
  includeBounds?: boolean;
  includeHelpers?: boolean;
}
```

Named objects should be prioritized over unnamed implementation objects when
the output limit is reached. Unnamed objects are valid Three.js metadata and
are not warnings by themselves. `deep` means a higher bounded limit, not an
unbounded scene serialization.

## Initial warnings

Warnings must be deterministic heuristics with stable codes, not model prose.
Start with cheap checks that are unlikely to mislead:

- duplicate non-empty object names;
- visible mesh with missing geometry or material;
- non-finite world transform components;
- zero or near-zero world scale on a visible object;
- active camera with invalid near/far/aspect values;
- WebGL context loss;
- snapshot truncation.

Frustum visibility, object overlap, texture load state, clipping, and lighting
quality can be added later. Do not label a legal off-camera object as an error.

## Screenshot contract

```ts
interface SceneCaptureOptions {
  mimeType?: 'image/jpeg' | 'image/png';
  quality?: number;
  width?: number;
  height?: number;
}

interface SceneCapture {
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  bytes: Blob;
  camera: SceneCameraSnapshot;
}
```

Defaults:

- JPEG for model-facing captures, quality around `0.75` after benchmarking;
- current canvas dimensions for V1;
- PNG remains available for lossless human artifacts and test fixtures;
- reject invalid or excessive dimensions using named constants;
- surface canvas security/taint failures as typed errors.

Do not add base64 conversion to the engine contract. The downstream MCP adapter
converts the `Blob` to base64 because base64 is a transport concern.

## Downstream WebMCP tools

### `scene_get_summary`

Read-only, deterministic, and compact by default.

Input:

```json
{
  "detail": "brief | standard | deep",
  "maxObjects": 40,
  "visibleOnly": true,
  "nameIncludes": "optional substring",
  "objectId": "optional exact UUID"
}
```

Result:

- short text summary for any MCP client;
- `structuredContent` containing `SceneSnapshot`;
- no image.

### `scene_capture_view`

Read-only and returns:

- a short text block describing dimensions and camera;
- one MCP image block `{ type: 'image', data, mimeType }`;
- compact structured metadata without duplicating base64.

Extend the downstream application's `WebmcpToolResult.content` union to support
image content. Verify the relay preserves the image block and the local bridge
consumes it.

### Deferred composition tools

- `scene_get_object` can initially be expressed through
  `scene_get_summary({ objectId })`; add a separate tool only if agents benefit
  from clearer discovery.
- `scene_diagnose` should compose summary + screenshot after both primitives
  are stable. The MCP tool itself should not call a model; the local agent
  daemon or consuming agent decides whether to invoke a vision model.

This reduces the first public tool surface from four names to two primitives
without losing capability.

## Token-efficient text form

The MCP text block should be generated from the same snapshot, not via a
second traversal. A brief example:

```text
Scene "launch-pad": 87 objects, 64 visible, 42 meshes, 3 lights.
Camera PerspectiveCamera pos=[12.4,8.1,15.2] near=0.1 far=1000000.
Render: 118 calls, 264k triangles. Returned 12/87 objects.
Warnings: duplicate-name(2).
```

Avoid Markdown tables in routine tool output. Compact lines are easier for
small local models and cheaper for upstream coding agents.

## Milestone roadmap

### M0 — Contracts and pure inspection

Triangular Engine:

1. Add `src/lib/engine/inspection/` contracts, traversal, formatting, and
   public exports.
2. Implement brief/standard limits, deterministic ordering, numeric rounding,
   aggregate counts, camera snapshot, and initial warnings.
3. Add colocated unit tests using small in-memory Three.js scenes.

Acceptance:

- output is deterministic for an unchanged scene;
- limits and truncation metadata are tested;
- no geometry arrays, arbitrary `userData`, or circular objects leak;
- library build passes.

### M1 — Current-viewport capture

Triangular Engine:

1. Add `captureSceneFrame(engine, options)` for current canvas dimensions.
2. Force one render through `EngineService.requestSingleRender()` so the
   registered render pipeline remains authoritative.
3. Export JPEG/PNG `Blob` and typed metadata.
4. Test invalid options and state restoration. Use a browser test for real
   canvas export; mock-only tests are insufficient for the final acceptance.

Acceptance:

- capture contains a non-empty image;
- live renderer dimensions and pixel ratio are unchanged afterward;
- direct and post-processed scenes still render after capture;
- failures leave the scene operational.

### M2 — Downstream read tools

Downstream application:

1. Confirm how the active routed viewport's `EngineService` is resolved.
2. Extend WebMCP content typing for image blocks.
3. Register `scene_get_summary` and `scene_capture_view`.
4. Keep application-specific adapters outside Triangular Engine.
5. Update `docs/webmcp-poc.md` tool inventory and live verification steps.

Acceptance through the local relay:

```text
open downstream scene
  -> scene_get_summary
  -> scene_capture_view
  -> MCP client receives text + decodable image
```

### M3 — Local vision-daemon smoke test

Local agent daemon:

1. Connect its existing MCP bridge to the downstream application's relay.
2. Select the configured local vision model through the daemon's model
   configuration; do not hardcode a model tag in the application or Triangular
   Engine.
3. Ask one bounded critique prompt using summary + screenshot.
4. Store the screenshot and critique using the daemon's existing artifact and
   usage-accounting path.

Acceptance:

- model receives both the image and compact scene facts;
- critique distinguishes observed visual judgments from engine-reported facts;
- no direct unaccounted Ollama request is introduced.

### M4 — Diagnostic composition

Add `scene_diagnose` only after observing real agent sessions. Its default
response combines brief summary, warning codes, and one screenshot. Candidate
focus modes are `camera-framing`, `selected-object`, `lighting`, and
`before-after`.

### M5 — Regression harness

Add named diagnostic cameras, fixed scene setup, screenshot artifacts, and
deterministic assertions. Pixel-perfect snapshots should not be the primary
test because GPU/backend differences make them brittle. Prefer structural
assertions plus perceptual/image checks with explicit tolerances.

## Verification commands

Triangular Engine, from `D:\code\triangular-workspace`:

```powershell
npm test -- --watch=false --browsers=ChromeHeadless
npm run build:triangular-engine
```

Downstream application, after rebuilding the local package:

```powershell
npm run update:engine
npm run build
npm run dev:webmcp
```

The local package resolves through `dist`; after rebuilding/updating it, restart
the running downstream application's development server before live relay
verification.

## Manual evaluation prompts

Use the same scene for each candidate workflow:

1. `Summarize the visible scene and identify the active camera.`
2. `Capture the current view. What appears clipped, occluded, floating, or badly framed?`
3. `Compare your visual claims with the engine facts. Mark each claim as observed or reported.`
4. Make one scene change, then repeat with a fresh summary and screenshot.

Record latency, screenshot bytes, prompt tokens, completion tokens, useful
findings, false positives, and how often the Human still had to explain the
scene. This evidence decides whether continuous observation, multiple camera
views, or a dedicated `scene_diagnose` tool earns its complexity.

## Explicit non-goals for the first slice

- continuous frame streaming or periodic screenshots;
- video input;
- whole-page or desktop capture;
- autonomous scene mutation based only on vision-model prose;
- unbounded scene serialization;
- physics state dumps (the downstream application's telemetry remains the
  authority);
- accessibility-tree/DOM inspection;
- choosing one permanent vision model before comparative evaluation;
- putting Ollama or MCP dependencies in Triangular Engine.

## Risks and mitigations

- **Wrong scene instance:** the downstream application explicitly resolves and
  reports viewport identity; no silent latest-instance fallback.
- **Context explosion:** bounded presets, deterministic relevance ordering,
  truncation metadata, and image opt-in.
- **Blank/stale capture:** force a render through the active engine pipeline
  immediately before `toBlob`, then verify against real WebGL and
  post-processing scenes.
- **Renderer disruption:** capture restores actual original state in `finally`.
- **Tainted canvas:** return a typed capture error with likely cross-origin
  asset guidance.
- **Vision hallucination:** prompts separate `reported` engine facts from
  `observed` image judgments.
- **Multiple agents in dirty trees:** do not stage, commit, restore, or modify
  unrelated procedural-structures work currently in progress.

## Luna handoff checklist

Start with M0 only unless the Human explicitly asks for a wider slice.

1. Re-read repository `AGENTS.md`,
   `projects/triangular-engine/docs/ai-agents.md`, and this runbook.
2. Inspect current `git status --short`; procedural-structures files are
   unrelated in-flight work and must be preserved.
3. Implement contracts and pure inspection under
   `projects/triangular-engine/src/lib/engine/inspection/`.
4. Add intentional exports from `inspection/index.ts` and `engine/index.ts`.
5. Add narrow unit tests before touching the downstream application.
6. Report any contract adjustment in this runbook's deviations section rather
   than silently changing the cross-repository boundary.

## Deviations log

- 2026-08-22, Sol architecture pass: reduced the initial WebMCP surface from
  four tools to two primitives (`scene_get_summary`, `scene_capture_view`).
  Object lookup remains an option on the summary tool; model-backed diagnosis
  is deferred until real summary/capture sessions provide evidence.
- 2026-08-22, Sol architecture pass: selected pure engine utilities over a
  root-scoped Angular inspection service to avoid resolving the wrong
  scene-local `EngineService` and to keep the API transport-neutral.
