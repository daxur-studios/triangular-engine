# Game adapter recipe

The interface below is example game integration code, not an engine API. Implement
it with the game's real controls, readiness signals and measurement providers.
This keeps the test runner independent of any particular camera or renderer.

```ts
import type {
  TestContext, TestObservation, TestRunAdapter, TestSuite,
} from 'triangular-engine/testing';

type Position = readonly [number, number, number];
interface Settings {
  seed: number;
  clouds: boolean;
  initialCamera: Position;
  path: readonly Position[];
}
interface Snapshot {
  settings: Settings;
  // Extend with camera orientation, controller state, simulation time and other
  // state changed by this game's implementation. Do not save only the position.
}
interface GameTestDriver {
  snapshot(): Snapshot;
  apply(settings: Settings, signal: AbortSignal): Promise<void>;
  waitForRenderedState(settings: Settings, signal: AbortSignal): Promise<void>;
  // Reset/start providers before moving, collect during motion, and stop/remove
  // listeners in finally. Return real checks and metrics, or explain unavailable
  // readings. Every async method must stop its work when the signal aborts.
  observePath(
    path: readonly Position[], durationMs: number, signal: AbortSignal,
  ): Promise<TestObservation>;
  restore(snapshot: Snapshot, signal: AbortSignal): Promise<void>;
}

export const testHistory: readonly TestSuite<Settings>[] = [{
  id: 'camera-toggle',
  version: 1,
  title: 'Cloud toggle during camera traversal',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [false, true].map((clouds) => ({
    id: clouds ? 'clouds-on' : 'clouds-off',
    label: clouds ? 'Clouds on' : 'Clouds off',
    settings: {
      seed: 42,
      clouds,
      initialCamera: [0, 20, 50] as const,
      path: [[0, 20, 50], [25, 15, 10]] as const,
    },
    warmupMs: 250,
    durationMs: 3000,
  })),
}];

export function createGameTestAdapter(
  game: GameTestDriver,
): TestRunAdapter<Settings, Snapshot> {
  return {
    capture: () => game.snapshot(),
    apply: (scenario, context) => game.apply(scenario.settings, context.signal),
    ready: (context: TestContext, scenario) => game.waitForRenderedState(
      scenario.settings, context.signal,
    ),
    measure: (scenario, context) => game.observePath(
      scenario.settings.path, scenario.durationMs, context.signal,
    ),
    restore: async (snapshot, context) => {
      await game.restore(snapshot, context.signal);
      await game.waitForRenderedState(snapshot.settings, context.signal);
    },
  };
}
```

Bind the adapter and history to `TestRunnerComponent` in the game host. Bind
`available` to the first usable rendered state, and `externalBusy` to competing
work. While progress is non-null, prevent manual controls or other test buttons
from fighting the adapter. On restoration and final null progress, release those
locks. Do not dispose scene resources before cancelling and allowing cleanup.

`ready(context, scenario)` receives the scenario just applied; do not cache it in
the adapter. Readiness should check that scenario's expected rendered state.
Lock pointer/keyboard scene controls as well as forms: a disabled fieldset alone
does not disable canvas controls, links, or programmatic actions.

For performance work, append a version/suite with `purpose: 'performance'` and
appropriate metric providers; do not relabel an already shared functional suite.
Add game-specific checks such as expected camera destination, preserved horizon
target, completed path samples, or settings actually applied. The path example
does not itself verify those conditions: `observePath` must return the checks.
