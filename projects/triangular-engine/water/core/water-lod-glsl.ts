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
    float dist = distance(worldXZ, cameraXZ);
    float t = clamp((dist - morphStart) / max(morphEnd - morphStart, 0.0001), 0.0, 1.0);
    return mix(worldXZ, snapped, t);
  }
`;
