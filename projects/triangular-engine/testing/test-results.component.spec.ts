import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TEST_RESULTS_FETCH, TestResultsComponent } from './test-results.component';
import type { TestRunIndexCase, TestRunIndexEntry } from './test-results';

const metric = (med: number, p95 = med * 1.1) => ({ n: 100, min: med * 0.9, med, p95, max: p95 * 1.2 });
const scenario = (med: number, extra: Partial<TestRunIndexCase> = {}): TestRunIndexCase =>
  ({ metrics: { 'frameInterval (ms)': metric(med), 'renderSubmitCpu (ms)': metric(0.4), 'gpuScenePass (ms)': metric(0.05), 'gpuOutputPass (ms)': metric(0.04), 'draws (count)': metric(4, 4) }, failed: [], invalid: [], ...extra });

function run(name: string, startedAt: string, extra: Partial<TestRunIndexEntry> = {}): TestRunIndexEntry {
  return {
    savedAt: startedAt, startedAt, suite: 'lab', version: 1, profile: 'visible-browser', mode: 'quick', runId: name, fingerprint: 'abc-123', head: 'abc',
    status: 'completed', automatedVerdict: 'pass', performanceVerdict: 'unassessed', visualReview: 'not-required', file: `lab@v1/${name}.json`, errors: [],
    gpu: 'nvidia', gpuBackend: 'webgpu', cases: { orbit: scenario(6), ground: scenario(8) }, ...extra,
  };
}

const first = run('first', '2026-10-18T10:00:00Z', { cases: { orbit: scenario(6, { thumbnails: ['lab@v1/first/orbit-r1-0.webp'] }), ground: scenario(8) } });
const second = run('second', '2026-10-19T10:00:00Z', {
  gpu: 'amd', cases: { orbit: scenario(6.6, { thumbnails: ['lab@v1/second/orbit-r1-0.webp', 'lab@v1/second/orbit-r1-1.webp', 'lab@v1/second/orbit-r2-0.webp'], window: { stoppedBy: 'settled', s: 1.4 }, retries: 1 }),
    ground: scenario(7.6, { failed: ['Planet drawn'], invalid: ['Page lost focus'] }) },
});
const other = run('other', '2026-10-20T10:00:00Z', { suite: 'water', mode: undefined, gpu: undefined, gpuBackend: undefined, status: 'failed', automatedVerdict: 'fail', file: 'water@v1/other.json', cases: { wave: scenario(2) } });
const result = {
  suite: { id: 'lab', version: 1, scenarios: [{ id: 'orbit', label: 'Orbit view' }, { id: 'ground', label: 'Ground view' }] },
  repetitions: 1, startedAt: '2026-10-19T10:00:00Z', finishedAt: '2026-10-19T10:00:30Z', mode: 'quick', profile: 'visible-browser', status: 'completed',
  cases: [{ scenario: { id: 'ground' }, repetition: 1, status: 'failed', checks: [{ name: 'Planet drawn', passed: false, detail: '0 draw calls' }], validityIssues: ['Page lost focus'], limitations: [], metrics: [] }],
  errors: [], ablations: [],
};

describe('TestResultsComponent', () => {
  let fixture: ComponentFixture<TestResultsComponent>;
  let calls: string[];
  let fetcher: jasmine.Spy;

  async function create(options: { runs?: TestRunIndexEntry[]; result?: unknown | null; receiver?: string } = {}) {
    calls = [];
    fetcher = jasmine.createSpy('fetch').and.callFake(async (url: string) => {
      calls.push(url);
      if (url.includes('/runs')) return new Response(JSON.stringify({ runs: options.runs ?? [first, second, other] }));
      if (url.includes('/run?') && options.result !== null) return new Response(JSON.stringify(options.result ?? result));
      return new Response('{}', { status: 404 });
    });
    await TestBed.configureTestingModule({ imports: [TestResultsComponent], providers: [{ provide: TEST_RESULTS_FETCH, useValue: fetcher }] }).compileComponents();
    fixture = TestBed.createComponent(TestResultsComponent);
    fixture.componentRef.setInput('receiver', options.receiver ?? '/sink');
    await settle();
  }
  /** Response bodies resolve outside Angular's zone tracking, so wait for the component's own loading flags. */
  async function settle() {
    const component = fixture.componentInstance;
    for (let i = 0; i < 100; i++) {
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (!component.loading() && !(component.view() === 'run' && component.detail().state === 'loading')) break;
    }
    fixture.detectChanges();
  }
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const click = (selector: string, index = 0) => { (el().querySelectorAll(selector)[index] as HTMLElement).click(); };

  it('lists the saved runs newest first with mode, GPU, commit, verdicts and counts', async () => {
    await create();
    expect(calls[0]).toBe('/sink/runs?limit=300');
    const rows = Array.from(el().querySelectorAll('.run')).map((row) => row.textContent?.replace(/\s+/g, ' ') ?? '');
    expect(rows.length).toBe(3);
    expect(rows[0]).toContain('water@1');
    expect(rows[0]).toContain('standard');
    expect(rows[0]).toContain('not recorded');
    expect(rows[0]).toContain('auto fail');
    expect(rows[1]).toContain('lab@1');
    expect(rows[1]).toContain('quick');
    expect(rows[1]).toContain('amd webgpu');
    expect(rows[1]).toContain('abc');
    expect(rows[1]).toContain('1 valid');
    expect(rows[1]).toContain('0 invalid');
    expect(rows[1]).toContain('1 failed');
    expect(rows[2]).toContain('2 valid');
  });

  it('filters by suite, mode and GPU', async () => {
    await create();
    const selects = el().querySelectorAll<HTMLSelectElement>('.filters select');
    selects[0].value = 'lab';
    selects[0].dispatchEvent(new Event('change'));
    await settle();
    expect(el().querySelectorAll('.run').length).toBe(2);
    selects[2].value = 'amd webgpu';
    selects[2].dispatchEvent(new Event('change'));
    await settle();
    expect(el().querySelectorAll('.run').length).toBe(1);
    expect(text()).toContain('1 of 3 runs');
    fixture.componentInstance.setFilter('mode', 'standard');
    await settle();
    expect(el().querySelectorAll('.run').length).toBe(0);
  });

  it('says how to start the receiver when it cannot be read, and reloads from an edited URL', async () => {
    await create();
    fetcher.and.rejectWith(new TypeError('Failed to fetch'));
    fixture.componentInstance.setSource('http://127.0.0.1:4723/__triangular-test-sink');
    await settle();
    expect(el().querySelector('[role=alert]')?.textContent).toContain('npm run test:receiver');
    expect(fetcher.calls.mostRecent().args[0]).toBe('http://127.0.0.1:4723/__triangular-test-sink/runs?limit=300');
    fetcher.and.callFake(async (url: string) => { calls.push(url); return new Response(JSON.stringify({ runs: [first] })); });
    const input = el().querySelector<HTMLInputElement>('.source input')!;
    input.value = 'http://127.0.0.1:4723/__triangular-test-sink/';
    (el().querySelector('.source') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(fetcher.calls.mostRecent().args[0]).toBe('http://127.0.0.1:4723/__triangular-test-sink/runs?limit=300');
    expect(el().querySelectorAll('.run').length).toBe(1);
  });

  describe('a run', () => {
    beforeEach(async () => {
      await create();
      click('.run-open', 1);
      await settle();
    });

    it('loads its result, shows a row per case with a thumbnail, the window and the redos', async () => {
      expect(calls).toContain('/sink/run?file=lab%40v1%2Fsecond.json');
      const cases = Array.from(el().querySelectorAll('.case'));
      expect(cases.length).toBe(2);
      expect(cases[0].textContent).toContain('Orbit view');
      expect(cases[0].textContent).toContain('settled · 1.4 s');
      expect(cases[0].textContent).toContain('redone 1x');
      expect(cases[1].textContent).toContain('FAIL Planet drawn');
      expect(cases[1].textContent).toContain('INVALID Page lost focus');
      // The first repetition's two frames loop; the second repetition's picture is not a third frame.
      const frames = cases[0].querySelectorAll('tri-test-thumbnail button img');
      expect(frames.length).toBe(1);
      expect(frames[0].getAttribute('src')).toBe('/sink/image?file=lab%40v1%2Fsecond%2Forbit-r1-0.webp');
      expect(cases[0].querySelectorAll('.dots i').length).toBe(2);
      expect(cases[1].querySelector('.thumb.empty')).not.toBeNull();
      // The problem lines come from digestTestRun over the full result.
      expect(el().querySelector('.problems')?.textContent).toContain('ground: failed Planet drawn (0 draw calls)');
    });

    it('shows the change from the previous matching run by default, and none when asked', async () => {
      expect(fixture.componentInstance.baseline()?.file).toBe(first.file);
      const changes = Array.from(el().querySelectorAll('.case')[0].querySelectorAll('.m-change')).map((node) => node.textContent?.trim());
      expect(changes[0]).toBe('+10.0%');
      expect(el().querySelectorAll('.case')[1].querySelector('.m-change')?.textContent?.trim()).toBe('-5.0%');
      expect(el().querySelector('.m-change.worse')).not.toBeNull();
      expect(el().querySelector('.baseline .problem')?.textContent).toContain('Different GPU adapter (nvidia webgpu)');
      fixture.componentInstance.baselineChoice.set('none');
      await settle();
      expect(el().querySelector('.m-change.worse')).toBeNull();
      expect(Array.from(el().querySelectorAll('.m-change')).every((node) => node.textContent?.trim() === '')).toBeTrue();
    });

    it('lets the reader pick another baseline, and offers only runs of the same suite version and mode', () => {
      expect(fixture.componentInstance.baselines().map((item) => item.file)).toEqual([first.file]);
      const options = Array.from(el().querySelectorAll<HTMLOptionElement>('.baseline select option')).map((option) => option.value);
      expect(options).toEqual(['none', first.file]);
      // The select shows the default baseline, not its first option.
      expect(el().querySelector<HTMLSelectElement>('.baseline select')?.value).toBe(first.file);
    });

    it('shows a few metrics until asked for all, and filters them by name', async () => {
      expect(el().querySelectorAll('.case')[0].querySelectorAll('.metric').length).toBe(4);
      expect(text()).toContain('2 more metrics hidden');
      fixture.componentInstance.allMetrics.set(true);
      await settle();
      expect(el().querySelectorAll('.case')[0].querySelectorAll('.metric').length).toBe(5);
      fixture.componentInstance.metricFilter.set('gpu');
      await settle();
      expect(Array.from(el().querySelectorAll('.case')[0].querySelectorAll('.m-name')).map((node) => node.textContent)).toEqual(['gpuScenePass', 'gpuOutputPass']);
    });

    it('draws a target bar only for metrics that have a target', async () => {
      expect(el().querySelector('.m-bar')).toBeNull();
      fixture.componentRef.setInput('targets', { 'frameInterval (ms)': 6 });
      await settle();
      const bars = el().querySelectorAll('.m-bar');
      expect(bars.length).toBe(2);
      expect(bars[0].getAttribute('aria-valuetext')).toBe('target 6.00 ms');
      expect(bars[0].classList.contains('over')).toBeTrue();
      expect(bars[1].classList.contains('over')).toBeTrue();
    });

    it('goes back to the list', async () => {
      click('.actions button');
      await settle();
      expect(el().querySelectorAll('.run').length).toBe(3);
    });
  });

  it('still shows the saved summary when the full result is missing', async () => {
    await create({ result: null });
    click('.run-open', 1);
    await settle();
    expect(text()).toContain('full result could not be read');
    expect(el().querySelectorAll('.case').length).toBe(2);
    expect(el().querySelectorAll('.case')[0].textContent).toContain('orbit');
  });

  it('says so when a run has nothing to compare with', async () => {
    await create();
    click('.run-open', 0);
    await settle();
    expect(text()).toContain('No other run of this suite version in standard mode');
    expect(el().querySelector('.m-change.worse')).toBeNull();
  });

  it('compares two picked runs side by side on a chosen metric', async () => {
    await create();
    expect(el().querySelector<HTMLButtonElement>('.list-bar button')?.disabled).toBeTrue();
    click('.pick input', 1);
    click('.pick input', 2);
    await settle();
    expect(text()).toContain('Compare 2/2 picked');
    click('.list-bar button');
    await settle();
    expect(fixture.componentInstance.view()).toBe('compare');
    expect(text()).toContain('different GPU adapters (nvidia webgpu and amd webgpu)');
    const rows = Array.from(el().querySelectorAll('.compare-row'));
    expect(rows.map((row) => row.querySelector('b')?.textContent)).toEqual(['orbit', 'ground']);
    expect(rows[0].querySelector('.m-change')?.textContent?.trim()).toBe('+10.0%');
    expect(rows[0].querySelectorAll('.side').length).toBe(2);
    expect(rows[0].textContent).toContain('6.60');
    expect(rows[0].textContent).toContain('6.00');
    fixture.componentInstance.compareMetric.set('renderSubmitCpu (ms)');
    await settle();
    expect(el().querySelector('.compare-row .m-change')?.textContent?.trim()).toBe('0.0%');
  });

  it('keeps at most two runs picked', async () => {
    await create();
    for (const index of [0, 1, 2]) click('.pick input', index);
    await settle();
    // The third pick replaces the oldest.
    expect(fixture.componentInstance.picks()).toEqual([second.file, first.file]);
  });
});
