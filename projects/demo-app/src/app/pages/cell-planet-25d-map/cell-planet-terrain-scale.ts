/** Width of the original miniature map, before the metre-based planet adapter. */
const REFERENCE_MAP_WIDTH = 256;

/**
 * Preserve the miniature map's relief-to-width ratio at any planet radius.
 * The existing slider remains a stylized relief control, not physical elevation data.
 */
export function getTerrainHeightScaleM(radiusM: number, verticalScale: number): number {
  return verticalScale * (2 * Math.PI * radiusM / REFERENCE_MAP_WIDTH);
}
