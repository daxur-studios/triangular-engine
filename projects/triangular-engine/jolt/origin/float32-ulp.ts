/**
 * Spacing between adjacent float32 values at `valueM` metres (the unit in the last place).
 *
 * Jolt in this package is the single-precision build, so a body position far from the
 * origin can only resolve to this step. For example, the spacing is 1 m at 1e7 m and 0.5 m
 * at Earth radius (6.371e6 m). Use it to judge whether a far-from-origin value is precise
 * enough for the physics you need. Works on the absolute value, so the sign does not matter.
 *
 * @param valueM Position magnitude in metres.
 * @returns The float32 step in metres. Zero returns the smallest subnormal step, `2 ** -149`.
 */
export function float32UlpAt(valueM: number): number {
  const magnitude = Math.abs(valueM);
  if (magnitude === 0) return 2 ** -149;
  return 2 ** (Math.floor(Math.log2(magnitude)) - 23);
}
