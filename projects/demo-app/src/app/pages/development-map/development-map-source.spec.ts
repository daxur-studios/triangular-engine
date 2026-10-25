import type { TestRunIndexEntry } from 'triangular-engine/testing';
import {
  buildDevelopmentMapProject,
  type EngineeringRecordsManifest,
  type MapProjectSource,
} from './development-map-source';

const consumerManifest: EngineeringRecordsManifest = {
  schemaVersion: 1,
  currentFingerprint: 'current-fingerprint',
  documents: [{
    id: 'plan-1',
    number: 1,
    title: 'Tide Pools',
    outcome: 'Stable tidal pools for the coast scene.',
    plan: '/plans/001_tide-pools.md',
    record: '/records/001_tide-pools.md',
    mapped: true,
    review: {
      state: 'reviewed',
      items: [{
        id: 'Q1', kind: 'investigation', state: 'open', appliesTo: ['shore'], blocks: ['shore'],
        body: '- [ ] Should foam use a separate pass?\n  - Why it matters: this changes rendering cost.\n  - Next action: compare two small scenes.',
      }],
    },
    phases: [
      { id: 'shore', title: 'Build shore water', progress: 'done', readiness: { state: 'needs-resolution', open: 1, blockers: 1 } },
      { id: 'foam', title: 'Add foam controls', progress: 'in_progress', readiness: { state: 'ready', open: 0, blockers: 0 } },
    ],
    progress: { done: 1, total: 2, percent: 50 },
    relations: [],
    scopeHistory: {
      baseline: { state: 'confirmed', goals: [{ id: 'shore' }] },
      changes: [{
        id: 'SC-1', date: '2026-10-24', kind: 'addition', origin: 'discovered', disposition: 'accepted',
        scopeIds: ['foam'], summary: 'Add foam controls', reason: 'A scene test needs a tuning control.', impact: 'One added goal.',
      }],
    },
  }],
  diagnostics: [],
};

const consumerProject: MapProjectSource = {
  title: 'Coastal Garden',
  description: 'An independent project using its own paths and result receiver.',
  branches: [{
    id: 'coast', title: 'Coastline', examples: [{
      id: 'tidal-pool', title: 'Tidal Pool', href: '/world/coast/pool', documentIds: ['plan-1'],
      evidence: [{ suite: 'tidal-pool-cost', scenarios: ['shoreline'], metrics: ['frameInterval (ms)'] }],
    }],
  }],
};

const consumerRuns: readonly TestRunIndexEntry[] = [{
  savedAt: '2026-10-24T12:00:00Z', startedAt: '2026-10-24T11:59:00Z', suite: 'tidal-pool-cost', version: 2,
  profile: 'visible-browser', mode: 'standard', repetitions: 1, runId: 'run-1', fingerprint: 'old-fingerprint',
  head: 'old', status: 'completed', automatedVerdict: 'pass', performanceVerdict: 'unassessed', visualReview: 'not-required',
  file: 'run-1.json', errors: [], gpu: 'coastal-gpu', gpuBackend: 'webgpu', machine: { warnings: ['other-app-measuring'] },
  cases: { shoreline: {
    metrics: { 'frameInterval (ms)': { n: 12, min: 5.8, med: 6.2, p95: 8.1, max: 9.4 } },
    failed: [], invalid: [], thumbnails: ['tidal-pool-cost/shoreline.webp'],
  } },
}];

describe('development-map app adapter', () => {
  it('maps an independent project manifest, scope ledger and test-result index', () => {
    const model = buildDevelopmentMapProject(consumerProject, consumerManifest, consumerRuns);
    const example = model.branches[0].examples[0];
    const document = example.documents[0];

    expect(model.title).toBe('Coastal Garden');
    expect(example.href).toBe('/world/coast/pool');
    expect(document.sourceHref).toBe('/development-map#plan-1');
    expect(document.readiness).toBe('needs-resolution');
    expect(document.concerns[0].title).toBe('Should foam use a separate pass?');
    expect(document.concerns[0].sourceHref).toBe('/development-map#plan-1-Q1');
    expect(document.scope?.baseline).toEqual({ done: 1, total: 1, percent: 100 });
    expect(document.scope?.current).toEqual({ done: 1, total: 2, percent: 50 });
    expect(document.scope?.acceptedGrowth).toBe(1);
    expect(example.evidence[0].stale).toBeTrue();
    expect(example.evidence[0].performanceVerdict).toBe('unassessed');
    expect(example.evidence[0].metrics[0]).toEqual({ name: 'shoreline · frameInterval', median: 6.2, p95: 8.1, unit: 'ms', samples: 12 });
    expect(example.evidence[0].thumbnailUrl).toContain('/__triangular-test-sink/image?file=');
    expect(model.timeline.map((event) => event.kind)).toEqual(['scope', 'evidence']);
  });

  it('does not infer growth when a project has not confirmed a baseline', () => {
    const manifest = {
      ...consumerManifest,
      documents: [{
        ...consumerManifest.documents[0],
        scopeHistory: { baseline: { state: 'unconfirmed' as const, goals: [] }, changes: consumerManifest.documents[0].scopeHistory!.changes },
      }],
    };
    const model = buildDevelopmentMapProject(consumerProject, manifest, []);
    expect(model.branches[0].examples[0].documents[0].scope?.baselineState).toBe('unconfirmed');
    expect(model.branches[0].examples[0].documents[0].scope?.baseline).toBeUndefined();
    expect(model.branches[0].examples[0].documents[0].scope?.acceptedGrowth).toBeUndefined();
  });

  it('keeps recent suite evidence only when it includes the configured scenario', () => {
    const unrelatedRun: TestRunIndexEntry = {
      ...consumerRuns[0],
      runId: 'run-other-scenario',
      savedAt: '2026-10-25T12:00:00Z',
      startedAt: '2026-10-25T11:59:00Z',
      cases: { unrelated: consumerRuns[0].cases['shoreline'] },
    };
    const model = buildDevelopmentMapProject(consumerProject, consumerManifest, [
      consumerRuns[0], unrelatedRun,
    ]);

    expect(model.branches[0].examples[0].evidence.map((run) => run.id)).toEqual(['run-1-tidal-pool-cost']);
  });
});
