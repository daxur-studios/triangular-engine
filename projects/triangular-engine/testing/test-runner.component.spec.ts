import { TestBed } from '@angular/core/testing';
import { digestTestRun, TestRunnerComponent, testRunAgentText } from './test-runner.component';
import type { TestRunAdapter, TestRunResult, TestSuite } from './test-contracts';

interface Settings { value: number }
const history: readonly TestSuite<Settings>[] = [1, 2].map((version) => ({
  id: 'ui-test', version, title: `Version ${version}`, purpose: 'functional', requiresVisualReview: true,
  scenarios: [{ id: 'check', label: 'Applied value', settings: { value: version }, durationMs: 1 }],
}));

describe('TestRunnerComponent', () => {
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
      automatedVerdict: 'fail', performanceVerdict: 'inconclusive', visualReview: 'not-required', environment: {}, errors: [],
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

    it('does nothing when opted out', async () => {
      const spy = spyOn(window, 'fetch');
      const fixture = await runWith(false);
      expect(spy).not.toHaveBeenCalled();
      expect(fixture.componentInstance.saveStatus()).toBe('');
      fixture.destroy();
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
