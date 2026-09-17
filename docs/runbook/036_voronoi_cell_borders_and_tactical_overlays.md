# Runbook 036: Voronoi Cell Borders & Tactical Overlays in 3D

## Context & Problem Statement

Voronoi cell planets (`triangular-engine/worldgen`) provide the core spatial partitioning for planetary worldgen, tectonic plates, rivers, and gameplay grids.
For tactical strategy gameplay, two distinct visual requirements emerged:
1. **Cell Border Outlines**:
   - Extracting and rendering clean Voronoi boundary edges in 3D without clipping beneath terrain or z-fighting.
   - Requirement: **Floating straight-line border approach**: Instead of subdividing lines to match every micro-curve of noisy terrain, each edge is rendered as a clean straight 3D line segment (or ribbon) floating just slightly above the surface, preserving simplicity, geometric clarity, and extreme rendering performance.
2. **Tactical & Strategy Overlays**:
   - Highlighting cell areas (e.g. unit movement range / reachable cells, selection halos, faction territory fills).
   - National/faction territory borders (thicker / distinct coloring for exterior borders vs internal cell borders).
   - Dynamic toggling and mask updates at 60+ FPS without expensive CPU geometry re-baking.
3. **Seamless Morph Compatibility**:
   - Must synchronize with `<cellPlanetMorphView>`'s GPU unrolling and folding pipeline between a 3D sphere and a 2.5D flat map.

---

## 1. Floating Straight-Line Mathematical Formulation

On a curved sphere of radius $R$, a straight 3D chord connecting two points $A$ and $B$ separated by angular distance $\theta$ sags beneath the spherical surface. The maximum sagitta dip $s$ occurs at the chord midpoint:

$$s = R \left(1 - \cos\frac{\theta}{2}\right) = R \left(1 - \sqrt{\frac{1 + \hat{A} \cdot \hat{B}}{2}}\right)$$

If we elevate the chord endpoints $A$ and $B$ along their radial directions by an offset:

$$\Delta h = \text{minClearance} + s$$

then at the endpoints, the chord is elevated by $\Delta h$. At the midpoint, the chord has dipped by $s$, leaving:

$$h_{\text{midpoint}} \ge \text{minClearance}$$

Thus, **no part of the straight line dips beneath the convex surface**, completely preventing z-fighting or clipping under terrain while keeping the line intimately close to the planet surface (`minClearance \approx 0.003 \cdot R`).

---

## 2. Architecture & Components

```
+-------------------------------------------------------------+
|              triangular-engine/worldgen/core                |
|  - extractCellBorders(graph): ICellBorderEdge[]             |
|  - classifyCellBorders(edges, factions): partition          |
|  - computeEdgeSagitta(a, b, radius): number                 |
|  - computeFloatingEdgeEndpoints(...): IFloatingEndpoints    |
|  - findReachableCells(graph, start, hops, filter): number[] |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|             triangular-engine/worldgen/render               |
|  - buildCellBorderLineGeometry(): LineSegments (morphed)    |
|  - buildTerritoryRibbonGeometry(): Ribbon Quads (morphed)   |
|  - buildCellOverlayGeometry(): Cell Fans (morphed)          |
|  - CellTacticalOverlay: DataTexture GPU mask manager        |
|  - createPlanetBorderMorphMaterial()                        |
|  - createPlanetCellOverlayMaterial()                        |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                       Components                            |
|  - <cellPlanetMorphView> (supports borders & overlay masks) |
|  - <planetView> (supports borders & territory lines)        |
+-------------------------------------------------------------+
```

### 2.1 Graph Layer (`worldgen/core/cell-borders.ts`)
- **Euler Edge Extraction**:
  On a spherical Voronoi diagram where each corner has degree 3, Euler's formula guarantees $E = 3N - 6$.
  For $N = 1500$ cells, $E \approx 4494$ edges.
  Iterating all cells and recording edges where `neighborCellId > cell.id` extracts every edge in $O(N)$ time with zero duplication.
- **Classification**:
  Partitions edges into internal cell boundaries ($f_A = f_B$) and exterior territory boundaries ($f_A \neq f_B$).
- **Reachability Search**:
  Breadth-first search over graph neighbor topology (`findReachableCells`) to compute tactical movement range up to $k$ hops, with optional terrain filter (e.g. land-only, water-only).

### 2.2 Ribbon Extrusion for Thick Territory Borders
Standard WebGL `gl.lineWidth` is clamped to `1.0` on Windows (DirectX ANGLE backend). To provide thick national/faction borders, `buildTerritoryRibbonGeometry` expands each edge $A \to B$ into a ribbon quad tangent to the surface:
- Tangent vector: $\vec{T} = \text{normalize}(B - A)$
- Surface normal: $\vec{N} = \text{normalize}(A + B)$
- Lateral vector: $\vec{W} = \text{normalize}(\vec{T} \times \vec{N}) \cdot \frac{w}{2}$
- Four quad vertices: $A \pm \vec{W}$ and $B \pm \vec{W}$.

### 2.3 Dynamic GPU Tactical Masking (`CellTacticalOverlay`)
Rather than regenerating geometry when selecting a unit or viewing a 30-cell movement range:
- A $W \times H$ `DataTexture` (RGBA) stores cell colors and opacities.
- Updating reachable ranges or selections writes directly into a CPU `Uint8Array` in $< 0.02\text{ ms}$ and flags `texture.needsUpdate = true`.
- The fragment shader fetches `texelFetch(uCellOverlayTex, ivec2(cellId % W, cellId / W), 0)`.
- If $\alpha \le 0.001$, the pixel is discarded (`discard;`).
- If $\alpha > 0$, it applies color with smooth inner-edge glow derived from the center distance attribute `aDist`.

### 2.4 Antimeridian Seam Splitting in Morph Pipeline
When an edge crosses the antimeridian ($\text{lon} \approx \pm\pi$), `buildCellBorderLineGeometry` splits it into two segments meeting at $\pm\pi$ at the same latitude. In 3D sphere space, the split point is mathematically identical, preserving a continuous unbroken line, while in the 2.5D flat map unrolling, each segment cleanly touches the left/right map margin without stretching across the entire width.

---

## 3. Verification & Metrics

- **Total worldgen tests**: 200 passing specs.
- **Edge extraction**: $O(N)$ run time, verified $E = 3N - 6$ for closed spherical Voronoi graphs.
- **Dynamic updates**: $< 0.02\text{ ms}$ per tactical mask update; zero geometry allocations during interactive unit selection or cell hover.
