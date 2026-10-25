import { TestBed } from '@angular/core/testing';
import { digestTestRun, TestRunnerComponent, testRunAgentText } from './test-runner.component';
import type { TestRunAdapter, TestRunResult, TestSuite } from './test-contracts';

interface Settings { value: number }
const history: readonly TestSuite<Settings>[] = [1, 2].map((version) => ({
  id: 'ui-test', version, title: `Version ${version}`, purpose: 'functional', requiresVisualReview: true,
  scenarios: [{ id: 'check', label: 'Applied value', settings: { value: version }, durationMs: 1 }],
}));

describe('TestRunnerComponent', () => {
  it('keeps all A/B rounds together when Run all is clicked and clears an older batch result', async () => {
    await TestBed.configureTestingModule({ imports: [TestRunnerComponent] }).compileComponents();
    const fixture = TestBed.createComponent<TestRunnerComponent<Settings, number>>(TestRunnerComponent);
    const suite: TestSuite<Settings> = {
      id: 'paired', version: 1, title: 'Paired comparison', purpose: 'performance', requiresVisualReview: false,
      ablation: { feature: 'extra work', metrics: ['cost'] },
      scenarios: ['A', 'B', 'A', 'B'].map((arm, index) => ({
        id: `round-${index}`, label: `Round ${index}`, durationMs: 1, warmupMs: 0,
        settings: { value: arm === 'A' ? 1 : 2 }, ablation: { group: 'workload', arm: arm as 'A' | 'B' },
      })),
    };
    let applied = 0;
    const measured: string[] = [];
    const adapter: TestRunAdapter<Settings, number> = {
      capture: () => applied, apply: (scenario) => { applied = scenario.settings.value; }, ready: async () => {},
      measure: async (scenario) => {
        measured.push(scenario.id);
        return { metrics: [{ name: 'cost', unit: 'ms', source: 'deterministic test input', samples: [applied, applied] }] };
      },
      restore: (snapshot) => { applied = snapshot; },
    };
    fixture.componentRef.setInput('suites', [suite]);
    fixture.componentRef.setInput('adapter', adapter);
    fixture.componentRef.setInput('resultSink', false);
    fixture.componentRef.setInput('copyOnFinish', false);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.controls.profile.setValue('headless-hardware');
    const completed: TestRunResult<Settings>[] = [];
    component.completed.subscribe((run) => completed.push(run));
    // An earlier independent batch should disappear when the whole suite starts.
    await component.runBatch([{ suiteId: suite.id, suiteVersion: 1, scenarioId: suite.scenarios[0].id }]);
    expect(component.batchEntries().length).toBe(1);
    completed.length = 0;
    measured.length = 0;
    const finished = new Promise<void>((resolve) => {
      component.completed.subscribe(() => resolve());
    });
    const menu = fixture.nativeElement.querySelector('.run-menu') as HTMLDetailsElement;
    menu.open = true;
    (menu.querySelector('button') as HTMLButtonElement).click();
    await finished;
    fixture.detectChanges();
    expect(menu.open).toBeFalse();
    expect(completed.length).toBe(1);
    expect(component.result()?.cases.length).toBe(4);
    expect(measured).toEqual(suite.scenarios.map((scenario) => scenario.id));
    expect(component.result()?.ablations?.[0].result.a.rounds.length).toBe(2);
    expect(component.result()?.ablations?.[0].result.b.rounds.length).toBe(2);
    expect(component.result()?.ablations?.[0].result.verdict).toBe('slower');
    expect(component.batchEntries()).toEqual([]);
    expect(applied).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Run suite');
    fixture.destroy();
  });

  it('uses reactive form selection, runs latest, restores and requires explicit visual review', async () => {
    await TestBed.configureTestingModule({ imports: [TestRunnerComponent] }).compileComponents();
    const fixture = TestBed.createComponent<TestRunnerComponent<Settings, number>>(TestRunnerComponent);
    let applied = 0;
    const adapter: TestRunAdapter<Settings, number> = {
      capture: () => applied, apply: (scenario) => { applied = scenario.settings.value; }, ready: async () => {},
      measure: async () => ({ metrics: [], checks: [{ name: 'latest applied', passed: applied === 2 }] }),
      restore: (snapshot) => { applied = snapshot; },
    };
    fixture.componentRef.setInput('suites', history);
    fixture.componentRef.setInput('adapter', adapter);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.controls.profile.setValue('headless-hardware');
    component.form.controls.suite.setValue('ui-test@1');
    await component.runLatest();
    fixture.detectChanges();
    expect(component.result()?.suite.version).toBe(2);
    expect(component.result()?.visualReview).toBe('pending');
    expect(applied).toBe(0);
    expect(component.form.enabled).toBeTrue();
    expect((fixture.nativeElement.querySelector('.result-json') as HTMLTextAreaElement).value).toContain('"schemaVersion": 1');
    component.reviewNotes.setValue('Observed both checkpoints');
    component.review('accepted');
    expect(component.result()?.visualReview).toBe('accepted');
    expect(component.result()?.reviewNotes).toContain('Observed');
    fixture.destroy();
  });

  it('shows failed checks with their detail, the case error and run-level errors', async () => {
    await TestBed.configureTestingModule({ imports: [TestRunnerComponent] }).compileComponents();
    const fixture = TestBed.createComponent<TestRunnerComponent<Settings, number>>(TestRunnerComponent);
    const adapter: TestRunAdapter<Settings, number> = {
      capture: () => 0, apply: () => {}, ready: async () => {},
      measure: async () => ({ metrics: [], checks: [
        { name: 'Pose reached', passed: true },
        { name: 'Terrain resident', passed: false, detail: 'minimum resident patches 0' },
      ] }),
      restore: () => { throw new Error('restore broke'); },
    };
    fixture.componentRef.setInput('suites', history);
    fixture.componentRef.setInput('adapter', adapter);
    fixture.detectChanges();
    fixture.componentInstance.form.controls.profile.setValue('headless-hardware');
    await fixture.componentInstance.runLatest();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('✓ Pose reached');
    expect(text).toContain('✗ Terrain resident — minimum resident patches 0');
    expect(text).toContain('Restoration failed: restore broke');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.check.failed').length).toBe(1);
    fixture.destroy();
  });
  it('offers quick and soak only to an adapter that times its windows, and defaults to quick there', async () => {
    await TestBed.configureTestingModule({ imports: [TestRunnerComponent] }).compileComponents();
    const base: TestRunAdapter<Settings, number> = {
      capture: () => 0, apply: () => {}, ready: async () => {}, measure: async () => ({ metrics: [] }), restore: () => {},
    };
    const fixed = TestBed.createComponent<TestRunnerComponent<Settings, number>>(TestRunnerComponent);
    fixed.componentRef.setInput('suites', history);
    fixed.componentRef.setInput('adapter', base);
    fixed.detectChanges();
    expect(fixed.componentInstance.modes()).toEqual(['standard']);
    expect(fixed.componentInstance.form.controls.mode.value).toBe('standard');
    const windowed = TestBed.createComponent<TestRunnerComponent<Settings, number>>(TestRunnerComponent);
    windowed.componentRef.setInput('suites', history);
    windowed.componentRef.setInput('adapter', { ...base, windowModes: true });
    windowed.detectChanges();
    expect(windowed.componentInstance.modes()).toEqual(['quick', 'standard', 'soak']);
    expect(windowed.componentInstance.form.controls.mode.value).toBe('quick');
    fixed.destroy();
    windowed.destroy();
  });

  it('digests a run into counts, problems and a short agent hand-off', () => {
    const scenario = history[1].scenarios[0];
    const run: TestRunResult<Settings> = {
      schemaVersion: 1, runId: 'r', suite: history[1], profile: 'visible-browser', mode: 'quick', repetitions: 1,
      startedAt: '2026-10-20T10:00:00.000Z', finishedAt: '2026-10-20T10:00:16.000Z', status: 'failed',
      automatedVerdict: 'fail', performanceVerdict: 'inconclusive', visualReview: 'not-required', environment: {}, errors: ['Checks failed: broken'],
      cases: [
        { scenario, repetition: 1, status: 'completed', metrics: [], checks: [], validityIssues: [], limitations: [],
          window: { mode: 'quick', elapsedMs: 1200, stoppedBy: 'settled' } },
        { scenario: { ...scenario, id: 'slow' }, repetition: 1, status: 'completed', metrics: [], checks: [], validityIssues: ['Page lost focus'],
          limitations: [], retries: 2, window: { mode: 'quick', elapsedMs: 5000, stoppedBy: 'max' } },
        { scenario: { ...scenario, id: 'broken' }, repetition: 1, status: 'failed', metrics: [], validityIssues: [], limitations: [],
          checks: [{ name: 'Planet drawn', passed: false, detail: '0 draw calls' }] },
      ],
    };
    const digest = digestTestRun(run);
    expect([digest.valid, digest.invalid, digest.failed, digest.seconds, digest.warnings]).toEqual([1, 1, 1, 16, 2]);
    expect(digest.problems).toEqual([
      'slow: invalid, Page lost focus', 'slow: redone 2x after the page lost focus', 'slow: did not settle within its window',
      'broken: failed Planet drawn (0 draw calls)',
    ]);
    const text = testRunAgentText(run, 'ui-test@v2/a.json');
    expect(text).toContain('Test run finished: ui-test@2 (quick mode, visible-browser, 1 repetition)');
    expect(text).toContain('Result file: ui-test@v2/a.json');
    expect(text).toContain("npm run test:summary '--' --suite ui-test --last 1");
    expect(text.split('\n').length).toBe(9);
  });

  describe('resultSink', () => {
    const adapter: TestRunAdapter<Settings, number> = {
      capture: () => 0, apply: () => {}, ready: async () => {}, measure: async () => ({ metrics: [] }), restore: () => {},
    };
    async function runWith(sink: boolean | string) {
      await TestBed.configureTestingModule({ imports: [TestRunnerComponent] }).compileComponents();
      const fixture = TestBed.createComponent<TestRunnerComponent<Settings, number>>(TestRunnerComponent);
      fixture.componentRef.setInput('suites', history);
      fixture.componentRef.setInput('adapter', adapter);
      fixture.componentRef.setInput('resultSink', sink);
      fixture.detectChanges();
      fixture.componentInstance.form.controls.profile.setValue('headless-hardware');
      await fixture.componentInstance.runLatest();
      for (let i = 0; i < 50 && !fixture.componentInstance.saveStatus() && sink; i++) await new Promise((r) => setTimeout(r, 5));
      fixture.detectChanges();
      return fixture;
    }

    it('posts the finished run to the default same-origin path and shows the stored file', async () => {
      const spy = spyOn(window, 'fetch').and.resolveTo(new Response(JSON.stringify({ ok: true, file: 'ui-test@v2/a.json' })));
      const fixture = await runWith(true);
      expect(spy.calls.mostRecent().args[0]).toBe('/__triangular-test-sink');
      expect(JSON.parse(spy.calls.mostRecent().args[1]?.body as string).suite.id).toBe('ui-test');
      expect(fixture.componentInstance.saveStatus()).toBe('Result saved: ui-test@v2/a.json');
      fixture.destroy();
    });

    it('says the result was not saved when the receiver is unreachable', async () => {
      spyOn(window, 'fetch').and.rejectWith(new TypeError('Failed to fetch'));
      const fixture = await runWith(true);
      expect(fixture.componentInstance.saveStatus()).toContain('Result not saved');
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('use Download JSON');
      fixture.destroy();
    });

    it('does not count a dev server answering with its app HTML as a save', async () => {
      spyOn(window, 'fetch').and.resolveTo(new Response('<!DOCTYPE html><title>Demo App</title>', { headers: { 'content-type': 'text/html' } }));
      const fixture = await runWith(true);
      expect(fixture.componentInstance.saveStatus()).toContain('Result not saved: /__triangular-test-sink is not the test receiver');
      expect(fixture.componentInstance.savedFile()).toBeUndefined();
      fixture.destroy();
    });

    it('does nothing when opted out', async () => {
      const spy = spyOn(window, 'fetch');
      const fixture = await runWith(false);
      expect(spy).not.toHaveBeenCalled();
      expect(fixture.componentInstance.saveStatus()).toBe('');
      fixture.destroy();
    });

    describe('thumbnails', () => {
      const thumbnail = jasmine.createSpy('thumbnail').and.callFake(async () => [new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })]);
      const withPicture: TestRunAdapter<Settings, number> = { ...adapter, thumbnail };
      beforeEach(() => thumbnail.calls.reset());
      async function runPictures(thumbnails: boolean) {
        await TestBed.configureTestingModule({ imports: [TestRunnerComponent] }).compileComponents();
        const fixture = TestBed.createComponent<TestRunnerComponent<Settings, number>>(TestRunnerComponent);
        fixture.componentRef.setInput('suites', history);
        fixture.componentRef.setInput('adapter', withPicture);
        fixture.detectChanges();
        fixture.componentInstance.form.controls.profile.setValue('headless-hardware');
        fixture.componentInstance.form.controls.thumbnails.setValue(thumbnails);
        await fixture.componentInstance.runLatest();
        for (let i = 0; i < 50 && !fixture.componentInstance.saveStatus(); i++) await new Promise((r) => setTimeout(r, 5));
        return fixture;
      }

      it('posts the pictures with the result, and keeps them out of the copied JSON', async () => {
        const spy = spyOn(window, 'fetch').and.resolveTo(new Response(JSON.stringify({ ok: true, file: 'ui-test@v2/a.json', thumbnails: ['ui-test@v2/a/x-r1-0.webp'], dropped: [] })));
        const fixture = await runPictures(true);
        const body = JSON.parse(spy.calls.mostRecent().args[1]?.body as string);
        expect(body.thumbnailUploads).toEqual([{ case: 'check', repetition: 1, index: 0, type: 'image/webp', data: 'AQID' }]);
        expect(fixture.componentInstance.saveStatus()).toBe('Result saved: ui-test@v2/a.json with 1 thumbnail');
        expect(fixture.componentInstance.resultText()).not.toContain('thumbnailUploads');
        expect(fixture.componentInstance.resultText()).not.toContain('AQID');
        fixture.destroy();
      });

      it('says which pictures the receiver dropped', async () => {
        spyOn(window, 'fetch').and.resolveTo(new Response(JSON.stringify({ ok: true, file: 'f.json', thumbnails: [], dropped: ['check: thumbnail dropped, over 64 KB'] })));
        const fixture = await runPictures(true);
        expect(fixture.componentInstance.saveStatus()).toContain('1 thumbnail dropped (check: thumbnail dropped, over 64 KB)');
        fixture.destroy();
      });

      it('takes none when switched off, and the launch link remembers it', async () => {
        const spy = spyOn(window, 'fetch').and.resolveTo(new Response(JSON.stringify({ ok: true })));
        const fixture = await runPictures(false);
        expect(thumbnail).not.toHaveBeenCalled();
        expect(JSON.parse(spy.calls.mostRecent().args[1]?.body as string).thumbnailUploads).toBeUndefined();
        expect(new URL(fixture.componentInstance.result()?.rerunUrl ?? '').searchParams.get('testThumbnails')).toBe('0');
        fixture.destroy();
      });
    });

    it('saves by default in a dev build', async () => {
      const spy = spyOn(window, 'fetch').and.resolveTo(new Response(JSON.stringify({ ok: true })));
      await TestBed.configureTestingModule({ imports: [TestRunnerComponent] }).compileComponents();
      const fixture = TestBed.createComponent<TestRunnerComponent<Settings, number>>(TestRunnerComponent);
      fixture.componentRef.setInput('suites', history);
      fixture.componentRef.setInput('adapter', adapter);
      fixture.detectChanges();
      fixture.componentInstance.form.controls.profile.setValue('headless-hardware');
      await fixture.componentInstance.runLatest();
      for (let i = 0; i < 50 && !fixture.componentInstance.saveStatus(); i++) await new Promise((r) => setTimeout(r, 5));
      expect(spy.calls.mostRecent().args[0]).toBe('/__triangular-test-sink');
      fixture.destroy();
    });
  });
});

describe('TestRunnerComponent copy for agent when done', () => {
  const KEY = 'triangular-test-copy-when-done';
  const adapter: TestRunAdapter<Settings, number> = {
    capture: () => 0, apply: () => {}, ready: async () => {}, measure: async () => ({ metrics: [] }), restore: () => {},
  };
  let write: jasmine.Spy;
  let focused: boolean;
  const clearStored = () => { try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ } };
  beforeEach(() => {
    clearStored();
    focused = true;
    spyOn(document, 'hasFocus').and.callFake(() => focused);
    write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    spyOn(window, 'fetch').and.resolveTo(new Response(JSON.stringify({ ok: true, file: 'ui-test@v2/a.json' })));
  });
  afterEach(clearStored);

  async function create(copyOnFinish?: boolean) {
    await TestBed.configureTestingModule({ imports: [TestRunnerComponent] }).compileComponents();
    const fixture = TestBed.createComponent<TestRunnerComponent<Settings, number>>(TestRunnerComponent);
    fixture.componentRef.setInput('suites', history);
    fixture.componentRef.setInput('adapter', adapter);
    if (copyOnFinish !== undefined) fixture.componentRef.setInput('copyOnFinish', copyOnFinish);
    fixture.detectChanges();
    fixture.componentInstance.form.controls.profile.setValue('headless-hardware');
    return fixture;
  }
  const settled = async (fixture: { componentInstance: TestRunnerComponent<Settings, number> }) => {
    for (let i = 0; i < 40 && !fixture.componentInstance.message(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    await new Promise((resolve) => setTimeout(resolve, 10));
  };

  it('copies the agent text once the save has settled, so it names the saved file', async () => {
    const fixture = await create();
    await fixture.componentInstance.runLatest();
    await settled(fixture);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.calls.mostRecent().args[0]).toContain('Result file: ui-test@v2/a.json');
    expect(fixture.componentInstance.message()).toBe('Copied for the agent');
    fixture.destroy();
  });

  it('still copies when the save failed, saying the file was not saved', async () => {
    (window.fetch as jasmine.Spy).and.rejectWith(new TypeError('Failed to fetch'));
    const fixture = await create();
    await fixture.componentInstance.runLatest();
    await settled(fixture);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.calls.mostRecent().args[0]).toContain('Result file: not saved');
    fixture.destroy();
  });

  it('copies nothing when the host turns it off', async () => {
    const fixture = await create(false);
    await fixture.componentInstance.runLatest();
    await settled(fixture);
    expect(write).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Copy for agent when done');
    fixture.destroy();
  });

  it('copies nothing when the viewer unticks it, and remembers that', async () => {
    const fixture = await create();
    fixture.componentInstance.copyWhenDone.setValue(false);
    expect(localStorage.getItem(KEY)).toBe('0');
    await fixture.componentInstance.runLatest();
    await settled(fixture);
    expect(write).not.toHaveBeenCalled();
    fixture.destroy();
    TestBed.resetTestingModule();
    const next = await create();
    expect(next.componentInstance.copyWhenDone.value).toBeFalse();
    next.destroy();
  });

  it('copies nothing after a cancelled run', async () => {
    adapter.measure = async (_, context) => { await context.wait(5_000); return { metrics: [] }; };
    try {
      const fixture = await create();
      const running = fixture.componentInstance.runLatest();
      await new Promise((resolve) => setTimeout(resolve, 30));
      fixture.componentInstance.cancel();
      await running;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fixture.componentInstance.result()?.status).toBe('cancelled');
      expect(write).not.toHaveBeenCalled();
      fixture.destroy();
    } finally { adapter.measure = async () => ({ metrics: [] }); }
  });

  it('copies nothing in a tab without focus, and says so', async () => {
    focused = false;
    const fixture = await create();
    await fixture.componentInstance.runLatest();
    await settled(fixture);
    expect(write).not.toHaveBeenCalled();
    expect(fixture.componentInstance.message()).toBe('Not copied (tab not focused); press Copy for agent');
    fixture.destroy();
  });

  it('reports a refused clipboard write instead of throwing', async () => {
    write.and.rejectWith(new DOMException('Document is not focused', 'NotAllowedError'));
    const fixture = await create();
    await fixture.componentInstance.runLatest();
    await settled(fixture);
    expect(fixture.componentInstance.message()).toBe('Not copied (tab not focused); press Copy for agent');
    fixture.destroy();
  });

  it('does not copy again when the visual review is saved', async () => {
    const fixture = await create();
    await fixture.componentInstance.runLatest();
    await settled(fixture);
    fixture.componentInstance.review('accepted');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(write).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('works when storage throws', async () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('blocked');
    spyOn(Storage.prototype, 'setItem').and.throwError('blocked');
    const fixture = await create();
    expect(fixture.componentInstance.copyWhenDone.value).toBeTrue();
    fixture.componentInstance.copyWhenDone.setValue(false);
    await fixture.componentInstance.runLatest();
    await settled(fixture);
    expect(write).not.toHaveBeenCalled();
    fixture.destroy();
  });
});
