/**
 * Approximates contact momentum (kg·m/s) for scatter impact-threshold
 * checks. Jolt's OnContactAdded fires before the constraint solver runs, so
 * no solved impulse is available yet — this is deliberately an
 * approximation (mass * approach speed along the contact normal), not a
 * measured impulse. Good enough to gate "did something hit this hard
 * enough to break," not for anything requiring exact physical accuracy.
 */
export function estimateScatterImpactMomentumNs(options: {
  readonly otherBodyMassKg: number;
  readonly otherBodyVelocityMps: readonly [number, number, number];
  readonly contactNormal: readonly [number, number, number];
}): number {
  const [vx, vy, vz] = options.otherBodyVelocityMps;
  const [nx, ny, nz] = options.contactNormal;
  const approachSpeedMps = Math.abs(vx * nx + vy * ny + vz * nz);
  return options.otherBodyMassKg * approachSpeedMps;
}
