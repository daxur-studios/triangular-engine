/**
 * Plan 050 Phase 5: runs the planet benchmark across several pages and renderer backends from one click.
 *
 * The TSL backend is chosen by a `?backend=` query parameter, so switching it needs a page load. The suite
 * therefore keeps its queue and the finished reports in `sessionStorage`; every page checks it on load, runs its
 * own benchmark when it is the next entry, stores the report and navigates to the following entry. The combined
 * report is copied by a button on the last page (the clipboard needs a click, which a navigation chain has lost).
 */
const STATE_KEY = 'planetBenchmarkSuite';
const RESULT_KEY = 'planetBenchmarkSuiteResult';

interface ISuiteEntry {
  readonly label: string;
  /** Path (relative to the document base) plus query. */
  readonly target: string;
}

interface ISuiteState {
  readonly queue: readonly ISuiteEntry[];
  readonly done: readonly { readonly label: string; readonly report: string }[];
  readonly total: number;
}

function read(): ISuiteState | undefined {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as ISuiteState) : undefined;
  } catch {
    return undefined;
  }
}

function write(state: ISuiteState | undefined): void {
  try {
    if (state) sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(STATE_KEY);
  } catch {
    // Storage blocked: the suite cannot run; callers see `suiteSupported()` false.
  }
}

function urlOf(target: string): URL {
  return new URL(target, document.baseURI);
}

export function suiteSupported(): boolean {
  try {
    sessionStorage.setItem('planetBenchmarkProbe', '1');
    sessionStorage.removeItem('planetBenchmarkProbe');
    return true;
  } catch {
    return false;
  }
}

/** Alternating rounds (TSL WebGL2, TSL WebGPU, GLSL) so slow machine drift hits every page alike. */
export function startBenchmarkSuite(rounds = 3): void {
  const queue: ISuiteEntry[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    queue.push(
      { label: `TSL webgl2, round ${round}`, target: 'cell-planet-tsl?backend=webgl2' },
      { label: `TSL webgpu, round ${round}`, target: 'cell-planet-tsl?backend=webgpu' },
      { label: `GLSL, round ${round}`, target: 'cell-planet-morph-streaming' },
    );
  }
  try {
    sessionStorage.removeItem(RESULT_KEY);
  } catch {
    // ignore
  }
  write({ queue, done: [], total: queue.length });
  location.href = urlOf(queue[0].target).href;
}

/** The suite entry this page should run now, or undefined when no suite is active or this is not its page. */
export function currentSuiteEntry(): { label: string; index: number; total: number } | undefined {
  const state = read();
  const next = state?.queue[0];
  if (!state || !next) return undefined;
  const want = urlOf(next.target);
  if (want.pathname !== location.pathname || want.search !== location.search) {
    write(undefined); // the user went elsewhere: drop the suite
    return undefined;
  }
  return { label: next.label, index: state.done.length + 1, total: state.total };
}

export function cancelBenchmarkSuite(): void {
  write(undefined);
}

/** Stores this page's report and navigates to the next entry; on the last one, stores the combined report. */
export function completeSuiteEntry(report: string): 'navigating' | 'finished' {
  const state = read();
  if (!state || state.queue.length === 0) return 'finished';
  const done = [...state.done, { label: state.queue[0].label, report }];
  const queue = state.queue.slice(1);
  if (queue.length > 0) {
    write({ queue, done, total: state.total });
    location.href = urlOf(queue[0].target).href;
    return 'navigating';
  }
  write(undefined);
  const combined = [
    '## Planet benchmark suite',
    '',
    ...done.flatMap((d) => [`#### ${d.label}`, d.report, '']),
  ].join('\n');
  try {
    sessionStorage.setItem(RESULT_KEY, combined);
  } catch {
    // ignore
  }
  console.info(combined);
  return 'finished';
}

export function suiteResult(): string {
  try {
    return sessionStorage.getItem(RESULT_KEY) ?? '';
  } catch {
    return '';
  }
}
