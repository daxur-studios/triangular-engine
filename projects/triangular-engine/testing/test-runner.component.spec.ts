import { TestBed } from '@angular/core/testing';
import { TestRunnerComponent } from './test-runner.component';
import type { TestRunAdapter, TestSuite } from './test-contracts';

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
});
