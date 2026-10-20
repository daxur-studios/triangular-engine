import {
  collectIllustrativeFrames,
  createIllustrativeAdapter,
  type IllustrativeTestHost,
} from './illustrative-cell-planet-adapter';
import { ILLUSTRATIVE_TEST_HISTORY } from './illustrative-cell-planet-tests';
import type { TestContext } from 'triangular-engine/testing';

describe('illustrative frame adapter', () => {
  function setup() {
    const before = new Set<() => void>(),
      rendered = new Set<(time: number) => void>();
    const controller = new AbortController();
    const context: TestContext = {
      signal: controller.signal,
      profile: 'headless-hardware',
      mode: 'standard',
      repetition: 1,
      wait: async () => {},
      measureWindow: async () => ({ mode: 'standard', elapsedMs: 0, stoppedBy: 'fixed' }),
    };
    const host: IllustrativeTestHost<string> = {
      capture: () => 'original',
      apply: jasmine.createSpy('apply'),
      restore: jasmine.createSpy('restore'),
      onBeforeFrame: (callback) => {
        before.add(callback);
        return () => before.delete(callback);
      },
      onFrame: (callback) => {
        rendered.add(callback);
        return () => rendered.delete(callback);
      },
      move: jasmine.createSpy('move'),
      observe: () => ({ metrics: [] }),
      environment: () => ({}),
    };
    const frame = (time: number) => {
      for (const callback of before) callback();
      for (const callback of rendered) callback(time);
    };
    return { before, rendered, controller, context, host, frame };
  }

  it('counts completed renders and removes both subscriptions after readiness', async () => {
    const s = setup();
    const promise = collectIllustrativeFrames(s.host, s.context, 0);
    s.frame(10);
    s.frame(26);
    s.frame(45);
    expect(await promise).toEqual([16, 19]);
    expect(s.before.size + s.rendered.size).toBe(0);
  });

  it('cleans up when cancelled during motion', async () => {
    const s = setup();
    const promise = collectIllustrativeFrames(
      s.host,
      s.context,
      5000,
      ILLUSTRATIVE_TEST_HISTORY[1].scenarios[0].settings,
    );
    s.frame(10);
    s.controller.abort(new Error('cancelled during sweep'));
    await expectAsync(promise).toBeRejectedWithError('cancelled during sweep');
    expect(s.before.size + s.rendered.size).toBe(0);
  });

  it('renders each flyover keyframe even if the first slow frame reaches the end', async () => {
    const s = setup();
    spyOn(performance, 'now').and.returnValues(0, 10_000, 10_001, 10_002);
    const settings = ILLUSTRATIVE_TEST_HISTORY[1].scenarios[0].settings;
    const promise = collectIllustrativeFrames(
      s.host,
      s.context,
      5000,
      settings,
    );
    s.frame(0);
    s.frame(10_000);
    s.frame(10_001);
    s.frame(10_002);
    await promise;
    expect(
      (s.host.move as jasmine.Spy).calls.allArgs().map((a) => a[1]),
    ).toEqual([0, 1 / 3, 2 / 3, 1]);
  });

  it('restores the captured host state and awaits rendered restoration', async () => {
    const s = setup();
    const adapter = createIllustrativeAdapter(s.host);
    const snapshot = await adapter.capture(s.context);
    const promise = adapter.restore(snapshot, s.context);
    expect(s.host.restore).toHaveBeenCalledWith('original');
    s.frame(0);
    s.frame(16);
    s.frame(32);
    await promise;
    expect(s.before.size + s.rendered.size).toBe(0);
  });
});
