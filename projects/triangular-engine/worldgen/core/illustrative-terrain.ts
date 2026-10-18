/** Serializable opt-in surface policy. Missing configuration preserves existing terrain. */
export interface IIllustrativeTerrainConfig {
  readonly version: 1;
  readonly kind: 'illustrative';
  /** Multiplier for positive base elevation above the sea datum; not applied to peaks. */
  readonly lowlandReliefScale?: number;
  /** Peak height in canonical elevation units. Multiply by the renderer's heightScaleM for metres. */
  readonly mountainRelief?: number;
  /** Peak footprint as a fraction of the owning cell's centre-to-corner angular radius. */
  readonly mountainRadiusFraction?: number;
  /** Volcano rim height in canonical elevation units, independent of lowland relief. */
  readonly volcanoRelief?: number;
  readonly volcanoRadiusFraction?: number;
}

export const ILLUSTRATIVE_TERRAIN_DEFAULTS: Readonly<
  Required<IIllustrativeTerrainConfig>
> = Object.freeze({
  version: 1,
  kind: 'illustrative',
  lowlandReliefScale: 0.12,
  mountainRelief: 0.32,
  mountainRadiusFraction: 0.72,
  volcanoRelief: 0.48,
  volcanoRadiusFraction: 0.78,
});

/** Resolves in stable property order for cache identity; rejects unsupported persisted versions. */
export function resolveIllustrativeTerrain(
  config: IIllustrativeTerrainConfig,
): Required<IIllustrativeTerrainConfig> {
  if (config.version !== 1 || config.kind !== 'illustrative') {
    throw new RangeError('Unsupported illustrative terrain policy.');
  }
  const resolved = { ...ILLUSTRATIVE_TERRAIN_DEFAULTS };
  for (const key of [
    'lowlandReliefScale',
    'mountainRelief',
    'mountainRadiusFraction',
    'volcanoRelief',
    'volcanoRadiusFraction',
  ] as const) {
    const value = config[key] ?? resolved[key];
    const maximum =
      key === 'lowlandReliefScale' || key.endsWith('Fraction') ? 1 : Infinity;
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > maximum ||
      (key.endsWith('Fraction') && value === 0)
    ) {
      throw new RangeError(`Invalid illustrative terrain ${key}.`);
    }
    resolved[key] = value;
  }
  return resolved;
}

/** Empty suffix deliberately preserves legacy cache identity for worlds without this option. */
export function illustrativeTerrainKey(
  config?: IIllustrativeTerrainConfig,
): string {
  return config ? `:${JSON.stringify(resolveIllustrativeTerrain(config))}` : '';
}

/** Piecewise planar six-sided peak; unlike normal faceting this changes the silhouette. */
export function illustrativePeak(
  x: number,
  z: number,
  volcano = false,
): number {
  const r = Math.max(
    Math.abs(x),
    Math.abs(0.5 * x + 0.866025403784 * z),
    Math.abs(0.5 * x - 0.866025403784 * z),
  );
  if (r >= 1) return 0;
  if (!volcano) return 1 - r;
  // A lowered crater floor, raised caldera rim and straight flanks. Continuous at both joins.
  const rimRadius = 0.22;
  return r < rimRadius
    ? 0.55 + (0.45 * r) / rimRadius
    : (1 - r) / (1 - rimRadius);
}
