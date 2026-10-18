---
type: Runbook
title: Stylized Illustrative Planet & Scene Rendering
description: Visual breakdown, shader math, and design decisions for achieving a digital-painting / illustrative aesthetic in triangular-engine.
timestamp: 2026-10-17T00:00:00Z
tags: [stylized, rendering, tsl, webgpu, cell-planet, water, geology, clouds, scatter, lighting]
plans: [/docs/plans/054_stylized_illustrative_rendering.md]
performance: []
---

# Runbook 054: Stylized Illustrative Planet & Scene Rendering

Plan: [Plan 054](/docs/plans/054_stylized_illustrative_rendering.md).

## 2026-10-17 — Initial visual decomposition & shader architecture

Nothing built yet. This entry records the decomposition of the target illustrative aesthetic into concrete shader equations and sublibrary responsibilities.

### 1. Why standard 3D looks "CG" while the target looks like a digital painting

Standard PBR (`MeshStandardMaterial`) produces:
- Dark, desaturated grey/black shadows (`albedo * max(N·L, 0)`).
- Continuous high-frequency noise inside terrain tiles, combined with blurry interpolated boundaries between Voronoi cells.
- Smooth vertex normals on mountains and rocks that shade like airbrushed plastic rather than chiseled rock planes.
- Uniform water colour without coastal bathymetry ramps or crisp shoreline edges.

By contrast, the target **Stylized Illustrative PBR** aesthetic achieves a painted look without sacrificing razor-sharp mechanical or UI readability by applying five rules in TSL:

1. **Chromatic Shadows + Half-Lambert Wrap:**
   Instead of clamping $N \cdot L$ to $[0, 1]$ against black, wrap the terminator and blend between a saturated **cool sky shadow colour** ($C_{\text{shadow}}$, cerulean/slate blue) and **warm key sunlight** ($C_{\text{sun}}$, golden off-white):
   $$t_{\text{wrap}} = \text{smoothstep}(-\omega, 1.0, \mathbf{N} \cdot \mathbf{L})$$
   $$\mathbf{L}_{\text{diffuse}} = \text{mix}(\mathbf{C}_{\text{shadow}}, \mathbf{C}_{\text{sun}}, t_{\text{wrap}})$$
   Paired with a crisp grazing Fresnel rim highlight on vehicles, rocks, and cloud silhouettes:
   $$I_{\text{rim}} = \text{smoothstep}(1.0 - w_{\text{rim}}, 1.0, 1.0 - \max(\mathbf{N} \cdot \mathbf{V}, 0)) \cdot \max(\mathbf{N} \cdot \mathbf{L} + 0.3, 0)$$

2. **Frequency Separation ("Quiet Middles, Crisp Edges"):**
   - **Inside a Voronoi cell:** Suppress high-frequency texture noise. Each cell receives a deterministic base colour picked from a curated biome palette (e.g., olive green, lime meadow, wheat tan, ochre soil) plus a subtle low-frequency gradient across the cell.
   - **At cell boundaries:** Evaluate cell edge distance $d_{\text{edge}}$ and convert to a screen-space anti-aliased bevel/line using `fwidth(d_edge)` so borders remain 1–2 pixels crisp from close range to orbit.
   - **Close-range hillside terracing:** On sloped soil/rock cells, quantize local height or perturb normals along a secondary sub-cell/hex grid to create clean terraced steps.

3. **Bathymetric Water Ramps & Shoreline Foam:**
   Using signed vertical water depth $h_{\text{depth}} = h_{\text{water}} - h_{\text{terrain}}$:
   - $h_{\text{depth}} \in [0, h_{\text{foam}}]$: crisp white/cream shoreline band (`fwidth`-stabilized).
   - $h_{\text{depth}} > h_{\text{foam}}$: 4-stop colour ramp (`sandy beige → bright turquoise shallows → mid azure → deep cobalt channel`).

4. **Chiseled / Faceted Rock Normals vs. Smooth Manufactured Hulls:**
   - Natural rock formations (foreground boulders, mountain peaks, volcano flanks) use screen-space derivative normal blends (`normalize(cross(dFdx(pos), dFdy(pos)))`) or low-frequency Voronoi-facet normal perturbation so adjacent planar faces step cleanly between warm sun and cool cerulean shadow.
   - Altitude and slope angle drive a sharp transition from green foothills $\rightarrow$ slate grey rock facets $\rightarrow$ crisp white snow caps.

5. **Atmospheric Unification & Lit Volumetric Plumes:**
   - [Plan 049](/docs/plans/049_morphing_planet_atmosphere.md)'s aerial perspective shifts distant terrain shadows toward bright lower-atmosphere cyan, unifying the horizon into painted depth planes while rendering daytime sky objects (like a large moon) softly behind atmospheric in-scatter.
   - [Plan 051](/docs/plans/051_cloud_volumes.md)'s stylized cloud volumes (G5) and internal point lights (G8) allow billowing exhaust/volcano smoke to glow warm gold near the core and cool lavender-grey in the outer billows.

## 2026-10-18 — Additional landform option and delivery boundary

The owner clarified that the desired terrain is an additional option, preserving
existing terrain policies/defaults, with broad flat grasslands and localized sharp
mountains/volcanoes. The plan now prioritizes actual silhouettes and a crisp-surface
vertical slice before the wider style phases. Shading/normal faceting is a separate
problem from geometry; texture crispness requires diagnosing the actual data and
filtering/LOD path rather than prescribing a large texture or post-filter.

Observed existing facilities include demo `blended`/`cell-features` policies,
canonical cell composition/detail controls and core geology helpers. Reconcile
older geology runbook status against current code before extracting duplicates.
The new descriptor must reach canonical sampling, workers/cache identity and all
surface consumers; an appearance-only shader offset cannot establish collision or
coastline parity. Preserve graph identity and old serialized behavior.

Use a fixed old/new fixture, real runner history/links, retained screenshots/JSON
and distinct cold/steady-state measurements. Water/scatter depend on the surface
contract; the cloud preset can progress independently. This entry records planning
and source inspection only: no terrain code, benchmark, consumer integration or
human visual acceptance was produced by this documentation migration.
