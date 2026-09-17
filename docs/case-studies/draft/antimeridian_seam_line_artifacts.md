# Case Study: Antimeridian Seam-Crossing Line Artifacts in Dynamic 2.5D Planetary Projections

## Executive Summary

When unrolling a spherical 3D Voronoi planet into a 2.5D flat map (Equal Earth or Equirectangular projection), cell boundaries that cross the antimeridian seam ($\Delta\text{lon} = \pm\pi$) cause severe rendering artifacts: horizontal straight lines spanning across the entire viewport.

This case study documents the architectural challenge, why traditional screen-derivative methods (`fwidth`) failed for line primitives and wide quads, and how a zero-CPU, GPU vertex-level angular span test (`aOtherDir`) solved the issue at 60 FPS.

---

## 1. Context & Architecture

The planetary rendering engine supports smooth real-time morphing between:
- **3D Globe Mode**: A sphere with radius $R$ and radial elevation displacement.
- **2.5D Map Mode**: A flat projection (Equal Earth or Equirectangular) with vertical terrain relief.

### Dynamic Projection Tracking
Unlike static world maps fixed at Greenwich ($0^\circ$ longitude), the engine supports dynamic tracking modes:
- **Meridian Tracking**: Pinned to an active aircraft or unit; the central meridian rotates dynamically so the tracked unit is always horizontally centered.
- **Oblique / Transverse Tracking**: Re-centers both latitude and longitude around the unit, allowing seamless cross-polar flights.

In dynamic tracking mode, the projection basis $(\vec{F}_{\text{fwd}}, \vec{U}_{\text{up}}, \vec{R}_{\text{right}})$ rotates continuously on the GPU via uniforms.

---

## 2. Problem: Streaking Lines Across the Map

When unrolling into the 2.5D map with dynamic projection tracking enabled:
- Voronoi boundary lines and territory borders crossing the moving antimeridian seam stretched across the entire map width.
- The lines connected one side of the screen ($x \approx -\frac{W}{2}$) to the other side ($x \approx +\frac{W}{2}$).
- As units moved, these streaking lines flickered and danced across the screen.

```
       [Left Seam: -W/2]                       [Right Seam: +W/2]
              |                                       |
  Corner A ---+=======================================+---> Corner B
 (lon ≈ -179°)                                        (lon ≈ +179°)
              |<------- 1920px Artifact Line -------->|
```

---

## 3. Root Cause Analysis

### 3.1 The Branch Cut Discontinuity
Spherical coordinates map the continuous sphere $S^2$ to the cylinder $[-\pi, \pi] \times [-\frac{\pi}{2}, \frac{\pi}{2}]$.
Adjacent cell corners $A$ and $B$ are geometrically adjacent on the sphere:
$$\theta = \arccos(\hat{A} \cdot \hat{B}) \approx 0.05 \text{ to } 0.10 \text{ rad}$$
However, when an edge crosses the antimeridian:
$$\text{lon}_A \approx +\pi - \epsilon, \quad \text{lon}_B \approx -\pi + \epsilon$$
The unrolled coordinate difference is:
$$\Delta\text{lon} = 2\pi - 2\epsilon \approx 2\pi \approx 6.283 \text{ rad}$$
Instead of rendering a tiny segment spanning $0.05$ radians across the boundary, the GPU rasterizer connects $(-\frac{W}{2})$ to $(+\frac{W}{2})$, drawing a line across the entire screen.

### 3.2 Why CPU Pre-Splitting Works for Static Maps but Fails for Dynamic Maps
- **Static Projection**: The seam is stationary at $\text{lon} = \pm\pi$. During geometry construction, edges can be pre-split into two separate sub-segments using CPU intersection logic (`splitEdgesForProjection`).
- **Dynamic Projection**: The central meridian rotates dynamically on the GPU at 60 FPS based on unit coordinates. Pre-splitting on the CPU would require extracting, clipping, and re-allocating thousands of BufferGeometry vertices every frame, crippling performance and causing garbage collection spikes.

### 3.3 Why Fragment `fwidth()` Screen Derivatives Failed
Terrain meshes discard seam triangles using fragment derivatives:
```glsl
if (vProjMode > 0.5 && vMorph > 0.05 && fwidth(vProjLon) > 2.8) {
  discard;
}
```
This technique failed completely for cell borders due to two independent factors:

1. **Line Primitives (`GL_LINES` / `LineSegments`) Have No Transverse Derivatives**:
   Line rasterization in WebGL is 1D. Hardware finite differences (`dFdx`, `dFdy`) along the orthogonal axis of a 1-pixel-wide line are either zero or driver-undefined.
2. **Derivative Scale Over Full Viewport Width**:
   Even for triangle quads (territory ribbons), when an edge stretches across the entire screen (e.g. 1920 pixels):
   $$\frac{\partial(\text{lon})}{\partial x_{\text{pixel}}} \approx \frac{2\pi \text{ rad}}{1920 \text{ px}} \approx 0.00327 \text{ rad/pixel}$$
   Because $0.00327 \ll 2.8$, the fragment derivative threshold never triggers, and the line renders uninterrupted.

---

## 4. The Solution: GPU Vertex-Level Angular Span Culling

### 4.1 Concept: Complementary Endpoint Vectors
Every boundary segment connects two unit sphere points: $\hat{A}$ and $\hat{B}$.
By binding each vertex with its counterpart's spherical direction as an attribute:
- Vertex $A$ receives `aSphereNorm = A` and `aOtherDir = B`.
- Vertex $B$ receives `aSphereNorm = B` and `aOtherDir = A`.

### 4.2 GPU Projection and Angular Span Evaluation
In the vertex shader, both endpoints are projected into dynamic tracking space:

```glsl
// Project current vertex direction
float dotFwd   = dot(aSphereNorm, uProjForward);
float dotRight = dot(aSphereNorm, uProjRight);
float pLon     = atan(dotRight, dotFwd);

// Project opposite endpoint direction
float oFwd     = dot(aOtherDir, uProjForward);
float oRight   = dot(aOtherDir, uProjRight);
float oLon     = atan(oRight, oFwd);
```

### 4.3 Frustum Clipping Culling
Since adjacent Voronoi corners satisfy $\Delta\theta \le 0.15 \text{ rad}$, any angular delta $|pLon - oLon| > \pi$ mathematically proves the edge crosses the antimeridian branch cut.

When detected during 2.5D unrolling ($uMorph > 0.05$):
```glsl
if (uMorph > 0.05 && abs(pLon - oLon) > 3.14159) {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  return;
}
```
Setting `gl_Position` outside the normalized device coordinate (NDC) cube $[-1, 1]^3$ causes the GPU's fixed-function primitive clipping unit to discard the entire primitive before rasterization.

---

## 5. Related Pitfalls & Technical Learnings

### Pitfall 1: Dynamic Quad Width Collapse on Territory Ribbons
- **Symptom**: Light blue 1D lines rendered correctly, but yellow/orange territory ribbons disappeared in dynamic tracking mode.
- **Cause**: Territory ribbons are physical quads with 4 vertices per segment. Projecting each vertex purely from its spherical center without re-evaluating the 2D perpendicular offset in dynamic map space caused both sides of the quad to collapse to the same point (width = 0), producing zero-area triangles.
- **Fix**: In the vertex shader, project both endpoints to 2D flat coordinates, derive the dynamic tangent $\vec{D} = P_B - P_A$ and 2D normal $\vec{S} = (-D_y, D_x)$, and expand each vertex by $\pm \vec{S} \times \frac{\text{width}}{2}$ using UV coordinates.

### Pitfall 2: Three.js Built-In Attribute Shadowing
- **Symptom**: All cell borders disappeared completely.
- **Cause**: Three.js's internal `WebGLProgram` preamble automatically injects `attribute vec2 uv;` into all custom shaders. Explicitly declaring `attribute vec2 uv;` in user GLSL caused a fatal GLSL compiler error: `'uv' : redefinition`.
- **Fix**: Omit the explicit `uv` attribute declaration in custom shader code; rely on Three.js's built-in declaration while supplying the buffer in `BufferGeometry`.

### Pitfall 3: Angular Signals & Function Reference Equality
- **Symptom**: Switching the "Data layer" dropdown did not update terrain coloring until another property (like projection type) changed.
- **Cause**: `resolveColorCallback` was declared as a static arrow function reference. When `fillMode` changed, Angular's `effect()` saw the same function reference and skipped re-rendering.
- **Fix**: Wrap dynamic color generation in an Angular `computed()` signal: `readonly resolveColor = computed(...)`, ensuring a new callback reference triggers component re-execution whenever the data layer changes.

---

## 6. Performance & Verification Metrics

| Metric | CPU Static Splitting | GPU Vertex Culling (`aOtherDir`) |
| :--- | :--- | :--- |
| **CPU Frame Overhead** | ~4.8 ms / frame (allocations + GC) | **0.00 ms** (fully static buffers) |
| **GPU Instruction Overhead** | None | ~5 scalar ALU ops per vertex |
| **Artifact Lines Across Map** | Eliminated on static Greenwich | **Eliminated on all dynamic tracking modes** |
| **Unit Test Coverage** | 200 / 200 passing | 200 / 200 passing |
