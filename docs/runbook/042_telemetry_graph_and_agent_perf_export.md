# 042 — Telemetry Graph, Camera Activity Tracking, and Token-Efficient Agent Export

Status: proposed design and implementation plan, 2026-10-12.

## Purpose

Provide real-time graphical performance insight and a 1-click token-efficient telemetry exporter for Triangular Engine. This bridges the diagnostic gap between visual frame drops observed during interaction (such as rotating or zooming the camera) and actionable, token-dense debugging data needed by AI coding agents and human developers.

The solution consists of three core components:
1. **Interactive Camera & Performance Telemetry**: Tracking 1-second rolling history alongside classified camera actions (`idle`, `rot`, `zoom`, `move`) and automatic drop-event capture.
2. **Standalone `<telemetry-sparkline>` Component**: A reusable, lightweight Angular component rendering an SVG mini-histogram with threshold coloring and camera activity markers, usable inside `<engine-stats>` or standalone debug UIs.
3. **Token-Efficient Agent Telemetry Exporter**: A 1-click clipboard action producing a compact, structured Markdown/YAML report (~50–80 tokens) that explains what caused an FPS drop without log bloat.

---

## Background & Problem Statement

### 1. The Disconnect in 3D Performance Debugging
In 3D WebGL and WebGPU applications, average framerate numbers (e.g. "58 FPS") frequently hide jarring micro-stutters and drops. When developers or testers report an issue, descriptions are often vague (e.g. *"it lags when I look around"* or *"zooming in causes a freeze"*).
When collaborating with AI coding agents:
- Raw console dumps and object inspection logs consume hundreds to thousands of LLM context tokens.
- Screenshots convey visual appearance but cannot indicate whether the bottleneck is GPU rasterization, draw-call submission overhead, frustum culling spikes, or garbage-collection freezes.

### 2. Camera Motion as the Dominant Drop Driver
Most runtime performance cliffs in Triangular Engine are interaction-driven:
- **Camera Rotation (`rot`)**: Swings dense geometry or unculled meshes into the view frustum; triggers shadow map cascade updates.
- **Camera Zoom (`zoom`)**: Alters distance and field-of-view; triggers terrain quadtree LOD transitions (e.g. CDLOD/Clipmap subdivision) or extreme screen-space overdraw.
- **Camera Translation (`move`)**: Crosses streaming boundaries, instigating chunk allocation or collider generation.

Correlating framerate fluctuations with camera actions within the same timeline enables immediate root-cause diagnosis.

### 3. Existing Foundation
- [`FPSController`](../../projects/triangular-engine/src/lib/engine/models/fps.controller.ts) currently records a 60-element sliding array (`graph: number[]`), but no UI renders it.
- [`EngineStatsComponent`](../../projects/triangular-engine/src/lib/engine/components/engine-ui/engine-stats/engine-stats.component.ts) renders numerical values only.
- Runbooks `037` and `038` cover headless Playwright automated testing, but explicitly leave interactive HUD visualizers and agent diagnostic exports to runtime engine tools.

---

## Architectural Design

### 1. Camera Activity Tracking & Telemetry Model

Camera movement is categorized each frame into non-exclusive motion flags:

```typescript
export enum CameraAction {
  None = 0,
  Rotate = 1 << 0, // Yaw, pitch, roll, or orbit angle change
  Zoom   = 1 << 1, // FOV change, ortho zoom, or distance to orbit target
  Move   = 1 << 2, // Positional translation in 3D space
  Orbit  = 1 << 3, // Position AND orientation changed in the same frame (OrbitControls-style)
}

export type CameraActionTag =
  | 'idle' | 'rot' | 'zoom' | 'move' | 'orbit'
  | 'rot+zoom' | 'move+rot' | 'move+zoom' | 'orbit+zoom' | 'multi';

export interface ITelemetrySample {
  readonly timestamp: number;
  readonly fps: number;
  readonly frameTimeMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly cameraAction: CameraActionTag;
}

export interface IPerformanceDropEvent {
  readonly timestamp: number;
  readonly baselineFps: number;
  readonly dropFps: number;
  readonly worstFrameMs: number; // longest frame-to-frame gap in the drop second
  readonly cameraAction: CameraActionTag;
  readonly cameraPosition: [number, number, number];
  readonly drawCallsDelta: number;
  readonly trianglesDelta: number;
}
```

#### Sampling Strategy:
- **Per-Frame**: Delta tracking against previous camera pose (`position`, `quaternion`, `zoom`/`fov`). Flags are accumulated into a bitmask for the active second.
- **Per-Second (1 Hz Boundary)**:
  - Commit active second's average FPS, draw calls, triangles, and dominant `CameraActionTag` to a rolling 60-sample ring buffer.
  - If $\text{currentFps} \le \text{recentAverage} \times 0.8$ (a $\ge 20\%$ drop) or $\text{frameTime} \ge 33.3\text{ ms}$, generate/update an `IPerformanceDropEvent` record.

---

### 2. Standalone `<telemetry-sparkline>` Component

To avoid coupling visualization strictly to the engine stats overlay, the sparkline is isolated as a standalone, zero-dependency SVG component.

#### Selector & API:
`projects/triangular-engine/src/lib/engine/components/engine-ui/telemetry-sparkline/telemetry-sparkline.component.ts`

```typescript
@Component({
  selector: 'telemetry-sparkline',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './telemetry-sparkline.component.html',
  styleUrl: './telemetry-sparkline.component.scss'
})
export class TelemetrySparklineComponent {
  /** Telemetry historical data points (e.g. last 60 seconds of FPS). */
  readonly values = input.required<readonly number[]>();

  /** Corresponding camera activity tags matching the values timeline. */
  readonly motionTags = input<readonly CameraActionTag[]>([]);

  /** Target performance baseline (default: 60). */
  readonly targetValue = input<number>(60);

  /** Warning threshold floor (default: 55). */
  readonly warningFloor = input<number>(55);

  /** Critical threshold floor (default: 30). */
  readonly criticalFloor = input<number>(30);

  /** Visual height in pixels (default: 36). */
  readonly height = input<number>(36);

  /** Visual width in pixels (default: 140). */
  readonly width = input<number>(140);

  /** Whether to show camera activity markers beneath the graph (default: true). */
  readonly showMotionTrack = input<boolean>(true);
}
```

#### Visual Layout:
```text
┌──────────────────────────────────────────────┐
│ 60 ─  █ █ █ █ █ ▄ ▂ ▂ ▄ █ █ █ █ █  (FPS bars) │
│ 30 ─  █ █ █ █ █ █ █ █ █ █ █ █ █ █            │
│  0 ─ ──────────────────────────────          │
│ CAM:  · · · · · R Z Z R · · · · ·  (Motion)  │
└──────────────────────────────────────────────┘
```
- **SVG Histogram Bars**: Rendered from normalized values. Colored via CSS classes:
  - Green (`--perf-good: #00ff87`): $\ge 55\text{ FPS}$
  - Amber (`--perf-warn: #ff9f00`): $30\text{--}54\text{ FPS}$
  - Red (`--perf-crit: #ff4b4b`): $< 30\text{ FPS}$
- **Motion Indicators**: A synchronized strip beneath the bars. Discrete indicators highlight when the user rotated (`R`), zoomed (`Z`), or moved (`M`).

---

### 3. Token-Efficient Agent Export Specification

A button labeled **"📋 Copy for Agent"** formats current metrics, recent history, and drop causality into a concise YAML/Markdown payload designed to occupy approximately **150–200 LLM tokens** (a 10-sample timeline).

#### Example Copied Output:
```text
```triangular-telemetry
status: warning (calls>=150) | fps: 22 (avg: 58, min: 18) | worstFrame60s: 45.4ms
viewport: 1920x1080@1.0 | renderer: WebGL2
calls: 380 (+335) | tris: 1.8M (+1.68M) | shaders: 16
mem: geo 24.1MB, tex 86.4MB | cpu: 14.2ms, gpu: 28.5ms
camera: pos(14.2, 5.0, -10.0) rot(0.12, -1.84)
drop_event: 60fps -> 18fps on ZOOM (dist: 85 -> 12)
timeline:
  fps: [60, 60, 59, 24, 18, 22, 58, 60]
  cam: [ - , - ,rot,zoom,zoom,rot, - , - ]
```
```

#### Semantics and Known Limitations:
- **`status` reason**: the parenthesised budget(s) (`cpu`, `calls`, `tris`) that set the level. `status` is a budget verdict, not an fps verdict: high fps with `critical (tris>=2M)` means the scene is over its triangle budget, not that it is slow.
- **`worstFrame60s`**: the longest real frame-to-frame interval in the last 60s (includes GPU/vsync stalls, GC and main-thread pauses; gaps >=2s are ignored as tab suspends). The `timing: cpu` figure is only the CPU time spent in the tick. A large `worstFrame` with small `cpu` points away from render-submission cost.
- **`drop_event`** carries its age (`(6s ago)`) and is omitted once older than the 60s history window.
- **Camera tags** are inferred from camera pose deltas only. `orbit` = position and orientation changed in the same frame. A dolly along the view axis reads as `move`, not `zoom` (indistinguishable from forward translation of a fly camera); `zoom` means FOV / `camera.zoom` changed.

#### Token Efficiency Rules:
1. **Numbers Rounded**: Floating points rounded to 1 decimal place (`14.2ms`, not `14.21894012ms`). Large counts use standard metric suffixes (`1.8M`, `380k`).
2. **Tabular Timelines**: Compact parallel array syntax `[60, 60, 24, 18]` rather than verbose JSON object arrays.
3. **Delta Attribution**: The `drop_event` section immediately surfaces the delta between pre-drop steady state and the bottom of the drop, highlighting the offending variable (e.g. triangles or draw calls).

---

## Implementation Plan

### Milestone 1: Telemetry Data Model & Delta Tracking in `FPSController`
- [ ] Add `CameraAction` enum and `CameraActionTag` types.
- [ ] Implement camera delta tracking in `FPSController.recordFrame`:
  - Track previous camera position, quaternion, and zoom/FOV.
  - Classify frame delta against sensitivity thresholds.
- [ ] Maintain synchronized ring buffers (60 samples):
  - `fpsHistory: number[]`
  - `cameraHistory: CameraActionTag[]`
  - `minFps`: rolling minimum.
  - `dropEvent`: current worst drop snapshot within the window.
- [ ] Unit tests for `FPSController` delta classification and drop event capture.

### Milestone 2: Standalone `<telemetry-sparkline>` Component
- [ ] Create `telemetry-sparkline.component.ts`, `.html`, `.scss` in `projects/triangular-engine/src/lib/engine/components/engine-ui/telemetry-sparkline/`.
- [ ] Render lightweight, responsive SVG bars and threshold guidelines.
- [ ] Render camera motion indicator track aligned 1:1 with data bars.
- [ ] Add standalone component unit tests validating bar heights, color class assignments, and empty/partial history states.
- [ ] Export `<telemetry-sparkline>` via the engine public API.

### Milestone 3: Integration into `<engine-stats>` & Agent Exporter
- [ ] Integrate `<telemetry-sparkline>` into `EngineStatsComponent` (both compact preview and expanded detailed view).
- [ ] Add `copyTelemetryForAgent()` method using `navigator.clipboard.writeText`.
- [ ] Add "Copy for Agent" button with temporary visual confirmation (`"Copied!"` for 1.5s).
- [ ] Format telemetry string according to token-efficient rules.

### Milestone 4: Verification & Documentation
- [ ] Test in the demo application (`projects/demo-app`) across orbit, zoom, and free camera scenarios.
- [ ] Update `projects/triangular-engine/docs/entry-points.md` and user-facing selector references.
- [ ] Validate bundle impact (pure SVG, zero external chart library overhead).

---

## Working Constraints

- Follow `AGENTS.md`: Preserve existing worktree modifications; do not create git commits (`git commit`).
- Keep `<telemetry-sparkline>` strictly standalone so it can be embedded in any custom dashboard, inspector, or HUD.
- Keep per-frame calculation lightweight ($O(1)$ vector distance/quaternion angle comparisons) to avoid skewing frame timings.
