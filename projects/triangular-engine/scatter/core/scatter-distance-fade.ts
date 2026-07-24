/**
 * Distance-based density multiplier for species with no far LOD (grass): density
 * fades to zero at a cutoff radius instead of popping or falling back to a billboard.
 * Combine multiplicatively with suitability, same as `evaluateScatterPlacement` does.
 */
export function computeScatterDistanceFade01(
  distanceM: number,
  fadeStartM: number,
  fadeEndM: number,
): number {
  if (fadeEndM <= fadeStartM) {
    return distanceM < fadeEndM ? 1 : 0;
  }
  if (distanceM <= fadeStartM) return 1;
  if (distanceM >= fadeEndM) return 0;
  return 1 - (distanceM - fadeStartM) / (fadeEndM - fadeStartM);
}
