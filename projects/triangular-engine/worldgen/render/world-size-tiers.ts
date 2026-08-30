/** `worldgen/core` stays dimensionless by design (see runbook 024) — nothing here changes
 * that, this is purely a rendering-layer concern (hence living in `worldgen/render`, not
 * `worldgen/core`). But without *some* real-world radius, every knob a consuming lab exposes
 * (cell count, elevation scale, an edit brush's hop count) is unitless, so there's no way to
 * tell whether a given setting is landing-pad-sized or continent-sized. Reuses BSP's own
 * parked world-size-preset tier table (`docs/v3-planning/plans/world-size-presets.md` in the
 * consuming app, medium = that doc's `HOME_PLANET` 600 km) rather than inventing new numbers,
 * so any lab picker here and that future game-facing picker already speak the same units if/
 * when they meet. Shared by every real-scale lab (`cell-planet-lab`, `planet-physics-lab`) so
 * they can't drift apart on what "medium" means. */
export type WorldSizeTier = 'mini' | 'small' | 'medium' | 'large' | 'extra-large';

export const WORLD_SIZE_TIER_RADIUS_M: Record<WorldSizeTier, number> = {
  mini: 6_400,
  small: 190_000,
  medium: 600_000,
  large: 1_900_000,
  'extra-large': 6_371_000,
};

export function formatDistanceM(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km`;
  return `${meters.toFixed(0)} m`;
}
