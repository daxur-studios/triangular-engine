/**
 * The one test the lab's big button runs. Edit this file to change what gets measured next; the button, its label and
 * the output format stay the same. Every field not set keeps the lab's current value for the whole run, then restores it.
 */
export type NextTestMode = 'mesh' | 'pass' | 'pass-full' | 'proxy';

export interface NextTestScenario {
  readonly label: string;
  /** `flyby`: a scripted pass along the great circle (avg, p95 and worst GPU ms). `static`: a still camera at `preset`. */
  readonly kind: 'flyby' | 'static';
  /** Seconds of fly-by, or of settling for `static`. Default 12 / about 2. */
  readonly seconds?: number;
  readonly volumes?: 1 | 4 | 12;
  readonly mode?: NextTestMode;
  /** Canvas render scale of the screen pass: 1 or 0.5. */
  readonly scale?: number;
  readonly steps?: number;
  /** Camera preset label for `static` (e.g. 'inside', 'horizon'). */
  readonly preset?: string;
  readonly animateSun?: boolean;
  /** Atlas bands rebaked per frame; 0 = all at once. */
  readonly bakeBudget?: number;
  readonly rebakeEveryFrame?: boolean;
}

export interface NextTest {
  readonly title: string;
  readonly scenarios: readonly NextTestScenario[];
}

/** Plan 051 step 5: does a per-frame bake budget flatten the spikes while the sun moves, at 12 volumes? */
export const NEXT_TEST: NextTest = {
  title: 'step 5 bake budget, 12 volumes, sun animating',
  scenarios: [0, 1, 2, 4].flatMap((bakeBudget): NextTestScenario[] => {
    const base = { volumes: 12 as const, mode: 'proxy' as const, scale: 1, steps: 24, animateSun: true, bakeBudget };
    const name = bakeBudget === 0 ? 'all at once' : `${bakeBudget} bands/frame`;
    return [
      { ...base, label: `fly-by, budget ${name}`, kind: 'flyby' },
      { ...base, label: `inside, budget ${name}`, kind: 'static', preset: 'inside' },
    ];
  }),
};
