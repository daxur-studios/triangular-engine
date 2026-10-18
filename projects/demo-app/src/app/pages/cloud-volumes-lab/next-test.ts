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
  /** Planet spin time warp: 0 still, 1 = one turn per 6 h, 100000 = the worst case (the light rebakes every frame). */
  readonly spinWarp?: number;
}

export interface NextTest {
  readonly title: string;
  readonly scenarios: readonly NextTestScenario[];
}

/** Plan 051 step 7: still vs a spinning planet at 100 000x, proxies, 1 band/frame, at the camera spots that matter. */
export const NEXT_TEST: NextTest = {
  title: 'step 7 moving lab: still vs spin 100000x, proxies, 1 band/frame',
  scenarios: ([4, 12] as const).flatMap((volumes) =>
    [0, 100000].flatMap((spinWarp): NextTestScenario[] => {
      const base = { volumes, mode: 'proxy' as const, scale: 1, steps: 24, animateSun: false, bakeBudget: 1, spinWarp };
      const name = `${volumes}v ${spinWarp === 0 ? 'still' : 'spin'}`;
      return [
        { ...base, label: `fly-by, ${name}`, kind: 'flyby' },
        { ...base, label: `inside, ${name}`, kind: 'static', preset: 'inside' },
        { ...base, label: `horizon, ${name}`, kind: 'static', preset: 'horizon' },
        { ...base, label: `ground, ${name}`, kind: 'static', preset: 'ground' },
      ];
    }),
  ),
};
