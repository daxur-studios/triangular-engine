/**
 * Both functions below measure distance from the camera as Chebyshev
 * (L-infinity: max(|dx|, |dz|)), not Euclidean. The ring holes and
 * footprints in `computeWaterLodLevels` are axis-aligned squares
 * (independent `|dx|`/`|dz|` checks), not circles — along a diagonal, a
 * square boundary sits up to sqrt(2)x farther out than along an axis, so
 * Euclidean `distance()` makes morph/cull thresholds diverge from the
 * actual square shape at the four ring corners: cull would discard the
 * finer level there before the coarser ring's square hole actually has
 * geometry, opening a gap. Chebyshev distance matches the square shape
 * exactly in every direction, so a single threshold is correct everywhere,
 * corners included.
 */

/**
 * CDLOD-style vertex morph: snaps a vertex's world XZ toward the next
 * coarser grid (2x cell size) as it nears the outer edge of its LOD range.
 * Vertices already sitting on the coarser grid are snap-invariant (rounding
 * a value that is already a multiple of the target step returns itself), so
 * the morph both removes LOD pop and keeps ring boundaries crack-free without
 * a separate per-vertex parity attribute. See
 * docs/runbook/002_water_sublibrary.md, Phase 1a.
 */
export const WATER_LOD_MORPH_GLSL = `
  vec2 waterLodMorph(vec2 worldXZ, vec2 cameraXZ, float cellSize, float morphStart, float morphEnd) {
    vec2 snapped = round(worldXZ / (2.0 * cellSize)) * (2.0 * cellSize);
    vec2 delta = abs(worldXZ - cameraXZ);
    float dist = max(delta.x, delta.y);
    float t = clamp((dist - morphStart) / max(morphEnd - morphStart, 0.0001), 0.0, 1.0);
    return mix(worldXZ, snapped, t);
  }
`;

/**
 * Discards fragments a level must not draw, so adjacent LOD levels never
 * both shade the same world point: inside innerCullRadius the next-finer
 * level already covers it solidly (0 for the innermost level, which has no
 * finer neighbour); at or beyond outerCullRadius the next-coarser level
 * takes over (a very large sentinel for the outermost level, which has no
 * coarser neighbour). Radii come from `computeWaterLodBoundaryRadius` and
 * are measured in the same Chebyshev (not Euclidean) distance as the
 * placement/hole geometry — see the note above `WATER_LOD_MORPH_GLSL`. See
 * docs/runbook/002_water_sublibrary.md, Phase 1a.
 */
export const WATER_LOD_CULL_GLSL = `
  void waterLodCull(vec2 worldXZ, vec2 cameraXZ, float innerCullRadius, float outerCullRadius) {
    vec2 delta = abs(worldXZ - cameraXZ);
    float dist = max(delta.x, delta.y);
    if (dist < innerCullRadius || dist >= outerCullRadius) {
      discard;
    }
  }
`;
