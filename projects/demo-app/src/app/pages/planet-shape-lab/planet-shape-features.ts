/**
 * The ablation registry (Plan 055 Phase 0): every switchable cost the lab really has, and nothing else. The page renders
 * these as toggles, scenarios carry the full state, and tests read it back through the test host.
 * Later contenders add their entries here; an entry must change what is drawn or computed.
 */
export interface FeatureDefinition<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly description: string;
  readonly defaultOn: boolean;
}

export const FEATURES = [
  {
    id: 'shadows',
    label: 'Shadows',
    description: 'Sun shadow map: the body casts and receives (one extra depth pass over the whole planet).',
    defaultOn: false,
  },
] as const satisfies readonly FeatureDefinition[];

export type FeatureId = (typeof FEATURES)[number]['id'];
/** Plain JSON data, so it can sit inside test settings. */
export type FeatureState = Readonly<Record<FeatureId, boolean>>;

export function defaultFeatureState(): FeatureState {
  return Object.fromEntries(FEATURES.map((feature) => [feature.id, feature.defaultOn])) as FeatureState;
}

export function withFeature(state: FeatureState, id: FeatureId, on: boolean): FeatureState {
  return { ...state, [id]: on };
}

export function featureMismatches(actual: FeatureState, expected: FeatureState): string[] {
  return FEATURES.filter((feature) => actual[feature.id] !== expected[feature.id])
    .map((feature) => `feature ${feature.id}: expected ${expected[feature.id]}, found ${actual[feature.id]}`);
}
