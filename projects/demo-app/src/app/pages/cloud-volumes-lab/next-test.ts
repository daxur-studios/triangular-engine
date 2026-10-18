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
  /** false = clouds off, for the baseline the net numbers are taken against. Default true. */
  readonly clouds?: boolean;
}

export interface NextTest {
  readonly title: string;
  readonly scenarios: readonly NextTestScenario[];
}

/** Plan 051 step 7: still vs a spinning planet at 100 000x, proxies, 1 band/frame, at the camera spots that matter. */
const SPOTS = ['inside', 'horizon', 'ground'];

/** A fly-by and the three static spots, all at 12 volumes, proxies, 24 steps, 1 band/frame. */
function group(name: string, clouds: boolean, spinWarp: number): NextTestScenario[] {
  const base = { volumes: 12 as const, mode: 'proxy' as const, scale: 1, steps: 24, animateSun: false, bakeBudget: 1, spinWarp, clouds };
  return [
    { ...base, label: `fly-by, ${name}`, kind: 'flyby' },
    ...SPOTS.map((preset): NextTestScenario => ({ ...base, label: `${preset}, ${name}`, kind: 'static', preset })),
  ];
}

export const NEXT_TEST: NextTest = {
  title: 'step 7 net numbers: 12 volumes, clouds off vs still vs spin 100000x, proxies, 1 band/frame',
  scenarios: [...group('clouds off', false, 0), ...group('still', true, 0), ...group('spin', true, 100000)],
};
