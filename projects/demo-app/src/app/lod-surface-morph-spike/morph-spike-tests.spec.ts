import { buildTestLaunchUrl, type TestContext } from 'triangular-engine/testing';
import { poleCauseOf, type CrackRow, type FanProbeRow, type FanRebuildRow, type MorphSpikeState, type ProbeResult } from './core';
import { createMorphSpikeTestAdapter, thumbnailScore, type MorphSpikeTestHost } from './morph-spike-test-adapter';
import {
  FAN_PRECISION_LIMIT_PX, MORPH_SPIKE_SUITE_ID, MORPH_SPIKE_TEST_HISTORY, TRIANGLES_PER_INSTANCE, crackObservation, crackRowText, expectedCrackCases, expectedFanProbeCases,
  expectedFanRebuildCases, expectedSilent, fanPrecisionObservation, fanProbeRowText, fanRebuildObservation, precisionObservation,
  type MorphSpikeTestSettings,
} from './morph-spike-tests';

const suite = MORPH_SPIKE_TEST_HISTORY[MORPH_SPIKE_TEST_HISTORY.length - 1];
const scenario = (id: string) => suite.scenarios.find((s) => s.id === id)!;
const v4Scenario = (id: string) => MORPH_SPIKE_TEST_HISTORY[3].scenarios.find((s) => s.id === id)!;
const BASELINE_IDS = [
  'crack-pole-200m', 'crack-tilted', 'crack-pole-200m-stretch', 'crack-tilted-stretch', 'crack-pole-200m-stretch-cap16k',
  'crack-tilted-stretch-cap16k', 'crack-pole-200m-fan-256', 'crack-tilted-fan-256',
];

function row(change: Partial<CrackRow> = {}): CrackRow {
  return {
    radiusM: 6_371_000, morph: 0.5, view: 'pole-200m', cut: 0, pole: 0, elsewhere: 0, holes: 0, masked: 3, drawnPx: 1000, coveredPx: 1000, leakPx: 0,
    agreement: 1, flipY: false, holesInterior: 0, holesRim: 0, rimOffsetMaxPx: 0, rimOffsetP95Px: 0, rimColumns: 1024, leaves: 4000, instances: 4100, duplicates: 100, poleLeaves: 8, torn: 0, dropped: 0, widthPx: 1024, heightPx: 576, ms: 1,
    ...change,
  } as CrackRow;
}

describe('morph spike test suite', () => {
  it('is a functional suite with unique scenario ids and plain JSON settings', () => {
    expect(suite.id).toBe(MORPH_SPIKE_SUITE_ID);
    expect(suite.version).toBe(6);
    expect(suite.purpose).toBe('functional');
    const ids = suite.scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['precision', 'crack-cut', 'crack-orbit-map', 'crack-mid', 'crack-pole-200m', 'crack-controls', 'crack-tilted']) expect(ids).toContain(id);
    for (const s of suite.scenarios) expect(JSON.parse(JSON.stringify(s.settings))).toEqual(s.settings as unknown as object);
  });

  it('puts the stretch metric next to the sphere metric at the pole edge and at the tilted centre', () => {
    expect(scenario('crack-pole-200m').settings.lodMetric).toBe('sphere');
    expect(scenario('crack-pole-200m-stretch').settings).toEqual({ ...scenario('crack-pole-200m').settings, lodMetric: 'stretch', diagnosePole: true });
    expect(scenario('crack-tilted').settings.centreLonDeg).toBe(20);
    expect(scenario('crack-tilted').settings.centreLatDeg).toBe(35);
    expect(scenario('crack-tilted-stretch').settings).toEqual({ ...scenario('crack-tilted').settings, lodMetric: 'stretch', diagnosePole: true });
  });

  it('judges the crack scenarios of v3 by interior holes and the rim offset, and keeps v1 and v2 as they were', () => {
    const [v1, v2] = MORPH_SPIKE_TEST_HISTORY;
    expect(v2.version).toBe(2);
    expect(v1.scenarios.some((s) => s.settings.rimCheck)).toBeFalse();
    expect(v2.scenarios.some((s) => s.settings.rimCheck)).toBeFalse();
    expect(suite.scenarios.filter((s) => s.settings.kind === 'crack').every((s) => s.settings.rimCheck === true)).toBeTrue();
    expect(MORPH_SPIKE_TEST_HISTORY[2].scenarios.map((s) => s.id)).toEqual(v2.scenarios.map((s) => s.id));
  });

  it('adds the pole fan scenarios in v4 and leaves v1 to v3 without a fan', () => {
    const [v1, v2, v3] = MORPH_SPIKE_TEST_HISTORY;
    expect(MORPH_SPIKE_TEST_HISTORY.map((s) => s.version)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const old of [v1, v2, v3]) expect(old.scenarios.some((s) => s.settings.poleFan)).toBeFalse();
    for (const old of v3.scenarios) expect(suite.scenarios.map((s) => s.id)).toContain(old.id);
    const fan = scenario('crack-pole-200m-fan').settings;
    expect(fan).toEqual({ ...v4Scenario('crack-pole-200m').settings, lodMetric: 'stretch', rimCheck: true, poleFan: true, fanRays: 1024 });
    expect(scenario('crack-tilted-fan').settings).toEqual({
      ...v4Scenario('crack-tilted').settings, lodMetric: 'stretch', rimCheck: true, poleFan: true, fanRays: 1024,
    });
    for (const id of ['crack-orbit-map-fan', 'crack-mid-fan', 'crack-cut-fan']) {
      expect(scenario(id).settings.poleFan).toBeTrue();
      expect(scenario(id).settings.rimCheck).toBeTrue();
      expect(scenario(id).settings.lodMetric).toBe('sphere');
    }
    expect(scenario('crack-pole-200m-fan-256').settings.fanRays).toBe(256);
    expect(scenario('crack-pole-200m-fan-4096').settings.fanRays).toBe(4096);
    expect(scenario('crack-tilted-fan-4096').settings.centreLatDeg).toBe(35);
  });

  it('keeps v1 as it was and adds the larger leaf cap scenarios and the known-silent control to v2 onward', () => {
    const v1 = MORPH_SPIKE_TEST_HISTORY[0];
    expect(v1.version).toBe(1);
    const v1Settings = (id: string) => v1.scenarios.find((s) => s.id === id)!.settings;
    expect(v1.scenarios.map((s) => s.id)).not.toContain('crack-pole-200m-stretch-cap16k');
    expect(v1Settings('crack-pole-200m-stretch').diagnosePole).toBeUndefined();
    expect(v1Settings('crack-controls').knownSilentControls).toBeUndefined();
    expect(scenario('crack-controls').settings.knownSilentControls).toBeTrue();
    expect(scenario('crack-pole-200m-stretch-cap16k').settings).toEqual({ ...scenario('crack-pole-200m').settings, lodMetric: 'stretch', leafCap: 16_384 });
    expect(scenario('crack-tilted-stretch-cap16k').settings).toEqual({ ...scenario('crack-tilted').settings, lodMetric: 'stretch', leafCap: 16_384 });
    for (const old of v1.scenarios) expect(suite.scenarios.map((s) => s.id)).toContain(old.id);
  });

  it('marks the eight comparison baselines in v5 and changes nothing else about v4', () => {
    const v4 = MORPH_SPIKE_TEST_HISTORY[3];
    const v5 = MORPH_SPIKE_TEST_HISTORY[4];
    expect(v5.scenarios.map((s) => s.id)).toEqual(v4.scenarios.map((s) => s.id));
    for (const old of v4.scenarios) {
      const now = v5.scenarios.find((s) => s.id === old.id)!;
      const { baseline, ...measurement } = now.settings;
      expect(measurement).toEqual(old.settings);
      expect(baseline).toBe(BASELINE_IDS.includes(old.id) ? true : undefined);
      expect(now.durationMs).toBe(old.durationMs);
    }
    expect(v5.scenarios.filter((s) => s.settings.baseline).map((s) => s.id).sort()).toEqual([...BASELINE_IDS].sort());
    for (const s of suite.scenarios) expect(s.label.startsWith('Baseline: ')).toBe(BASELINE_IDS.includes(s.id));
    expect(suite.scenarios.filter((s) => s.settings.baseline).map((s) => s.id).sort()).toEqual([...BASELINE_IDS].sort());
    expect(scenario('crack-pole-200m').label).toBe('Baseline: Cracks: pole edge at 200 m, sphere metric');
    expect(MORPH_SPIKE_TEST_HISTORY.slice(0, 4).some((v) => v.scenarios.some((s) => s.settings.baseline))).toBeFalse();
  });

  it('builds an autostart launch link for the exact version', () => {
    const url = new URL(buildTestLaunchUrl('http://triangular-demo.localhost:4200/lod-surface-morph-spike', suite, 'headless-hardware', 1));
    expect(url.searchParams.get('testSuite')).toBe('lod-surface-morph');
    expect(url.searchParams.get('testVersion')).toBe('6');
    expect(url.searchParams.get('testAutoStart')).toBe('1');
  });

  it('counts the cases a scenario asks the probe for', () => {
    expect(expectedCrackCases(scenario('crack-pole-200m').settings)).toBe(2 * 1 * 3);
    expect(expectedCrackCases(scenario('crack-orbit-map').settings)).toBe(2 * 1 * 3);
    // Controls only: gap on orbit-map and mid-200m, folding-off and relief on mid-200m and mid-2m, at both radii.
    expect(expectedCrackCases(scenario('crack-controls').settings)).toBe(2 * (2 + 4));
  });
});

describe('crack observation', () => {
  const settings: MorphSpikeTestSettings = { ...v4Scenario('crack-pole-200m').settings, rimCheck: false, radii: [6_371_000], morphs: [0.5] };

  it('passes a clean run and reports counts', () => {
    const o = crackObservation([row()], settings);
    expect(o.checks!.every((c) => c.passed)).toBeTrue();
    const named = (name: string) => o.metrics.find((m) => m.name === name)!.samples;
    expect(named('holes')).toEqual([0]);
    expect(named('leaves')).toEqual([4000]);
    expect(named('instances')).toEqual([4100]);
    expect(named('surfaceTriangles')).toEqual([4100 * TRIANGLES_PER_INSTANCE]);
    expect(named('duplicates')).toEqual([100]);
  });

  it('fails a real case with holes and says where they are', () => {
    const o = crackObservation([row({ holes: 10, pole: 4, elsewhere: 6 })], settings);
    const check = o.checks!.find((c) => c.name.startsWith('No holes'))!;
    expect(check.passed).toBeFalse();
    expect(check.detail).toContain('pole 4');
    expect(o.metrics.find((m) => m.name === 'holesPole')!.samples).toEqual([4]);
    expect(o.metrics.find((m) => m.name === 'holesElsewhere')!.samples).toEqual([6]);
  });

  it('fails when the probe returns fewer rows than asked, a case drew nothing or an instance was dropped', () => {
    expect(crackObservation([], settings).checks![0].passed).toBeFalse();
    expect(crackObservation([row({ coveredPx: 0 })], settings).checks!.find((c) => c.name === 'Every case drew the surface')!.passed).toBeFalse();
    expect(crackObservation([row({ dropped: 2 })], settings).checks!.find((c) => c.name === 'No instance dropped for capacity')!.passed).toBeFalse();
  });

  it('requires the holes controls to find holes and the relief twin to be clean', () => {
    const controls: MorphSpikeTestSettings = { ...scenario('crack-controls').settings, radii: [6_371_000], views: ['mid-200m'] };
    const good = crackObservation([row({ control: 'gap', holes: 50 }), row({ control: 'folding-off', holes: 7 }), row({ control: 'relief', holes: 0 })], controls);
    expect(good.checks!.filter((c) => c.name.startsWith('Control')).every((c) => c.passed)).toBeTrue();
    expect(good.metrics.find((m) => m.name === 'controlHoles')!.samples).toEqual([50, 7]);
    const silent = crackObservation([row({ control: 'gap', holes: 0 }), row({ control: 'folding-off', holes: 7 }), row({ control: 'relief', holes: 2 })], controls);
    expect(silent.checks!.find((c) => c.name.startsWith('Controls:'))!.passed).toBeFalse();
    expect(silent.checks!.find((c) => c.name.startsWith('Control twin'))!.passed).toBeFalse();
  });

  it('reports a silent folding-off control at 6,371 km over the 2 m view as a limitation (v2) and fails a silent one anywhere else', () => {
    const controls: MorphSpikeTestSettings = { ...scenario('crack-controls').settings, radii: [6_371_000], views: ['mid-2m'] };
    const known = row({ control: 'folding-off', view: 'mid-2m', holes: 0 });
    expect(expectedSilent(known)).toBeTrue();
    expect(expectedSilent({ ...known, view: 'mid-200m' })).toBeFalse();
    expect(expectedSilent({ ...known, radiusM: 600_000 })).toBeFalse();
    expect(expectedSilent({ ...known, control: 'gap' })).toBeFalse();
    const tolerated = crackObservation([known], controls);
    expect(tolerated.checks!.find((c) => c.name.startsWith('Controls:'))!.passed).toBeTrue();
    expect(tolerated.details!['expectedSilentControls']).toContain('folding-off');
    const strict = crackObservation([known], { ...controls, knownSilentControls: false });
    expect(strict.checks!.find((c) => c.name.startsWith('Controls:'))!.passed).toBeFalse();
    const shouldShow = crackObservation([{ ...known, view: 'mid-200m' }], controls);
    expect(shouldShow.checks!.find((c) => c.name.startsWith('Controls:'))!.passed).toBeFalse();
    const small = crackObservation([{ ...known, radiusM: 600_000 }], controls);
    expect(small.checks!.find((c) => c.name.startsWith('Controls:'))!.passed).toBeFalse();
  });

  it('shows the fan cost in the row text and the metrics', () => {
    const fanRow = row({ poleFan: true, fanRays: 1024, fanLeaves: 4, fanVertices: 120_000, fanTriangles: 240_000, fanBuildMs: 31.2 });
    expect(crackRowText(fanRow)).toContain('fan 1024 rays 4 leaves 120000 vertices 240000 triangles 31.2 ms');
    const o = crackObservation([fanRow], { ...settings, rimCheck: true, poleFan: true });
    expect(o.metrics?.find((m) => m.name === 'fanVertices')?.samples).toEqual([120_000]);
    expect(o.metrics?.find((m) => m.name === 'fanBuildMs')?.samples).toEqual([31.2]);
    expect(crackObservation([row({})], { ...settings, rimCheck: true }).metrics?.find((m) => m.name === 'fanVertices')?.samples).toEqual([]);
  });

  it('v3 passes rim holes within a pixel and fails interior holes, cut holes and a rim offset over a pixel', () => {
    const v3: MorphSpikeTestSettings = { ...settings, rimCheck: true };
    const name = (o: ReturnType<typeof crackObservation>) => o.checks!.find((c) => c.name.startsWith('No hole inside the ground'))!;
    expect(name(crackObservation([row({ holes: 1024, pole: 1024, holesRim: 1024, rimOffsetMaxPx: 1 })], v3)).passed).toBeTrue();
    expect(name(crackObservation([row({ holes: 1024, pole: 1024, holesRim: 1024, rimOffsetMaxPx: 2, rimOffsetP95Px: 2 })], v3)).passed).toBeFalse();
    expect(name(crackObservation([row({ holes: 5, elsewhere: 5, holesInterior: 5 })], v3)).passed).toBeFalse();
    expect(name(crackObservation([row({ holes: 5, cut: 5, holesRim: 5 })], v3)).passed).toBeFalse();
    // Without the flag (v1, v2) any hole pixel fails.
    expect(crackObservation([row({ holes: 3, holesRim: 3, pole: 3 })], settings).checks!.find((c) => c.name.startsWith('No holes inside'))!.passed).toBeFalse();
    const o = crackObservation([row({ holes: 3, holesRim: 3, pole: 3, rimOffsetMaxPx: 2, rimOffsetP95Px: 2 })], v3);
    expect(o.metrics.find((m) => m.name === 'rimOffsetMaxPx')!.samples).toEqual([2]);
    expect(o.details!['worstRimOffsetPx']).toBe(2);
  });

  it('judges a baseline by no interior hole and a rim error still shown, not by the rim check', () => {
    const baseline: MorphSpikeTestSettings = { ...settings, rimCheck: true, baseline: true };
    const interior = (o: ReturnType<typeof crackObservation>) => o.checks!.find((c) => c.name.startsWith('No hole inside the ground'))!;
    const shown = (o: ReturnType<typeof crackObservation>) => o.checks!.find((c) => c.name.startsWith('Baseline: the rim error'))!;
    const bad = crackObservation([row({ holes: 1024, pole: 1024, holesRim: 1024, rimOffsetMaxPx: 4, rimOffsetP95Px: 4 })], baseline);
    expect(bad.checks!.every((c) => c.passed)).toBeTrue();
    expect(shown(bad).detail).toContain('Comparison baseline');
    expect(bad.details!['baseline']).toBeTrue();
    // The cut corner: rim pixels at the cut with no interior hole do not fail a baseline.
    expect(interior(crackObservation([row({ holes: 6, cut: 6, holesRim: 6, rimOffsetMaxPx: 3 })], baseline)).passed).toBeTrue();
    const gone = crackObservation([row({ rimOffsetMaxPx: 1 }), row({ rimOffsetMaxPx: 0 })], baseline);
    expect(shown(gone).passed).toBeFalse();
    expect(shown(gone).detail).toContain('no longer shows the defect');
    expect(interior(gone).passed).toBeTrue();
    const hole = crackObservation([row({ holes: 5, elsewhere: 5, holesInterior: 5, rimOffsetMaxPx: 4 })], baseline);
    expect(interior(hole).passed).toBeFalse();
    expect(shown(hole).passed).toBeTrue();
    expect(crackObservation([row()], { ...settings, rimCheck: true }).details!['baseline']).toBeFalse();
  });

  it('judges a scenario without the baseline flag as before', () => {
    const real: MorphSpikeTestSettings = { ...settings, rimCheck: true };
    const rim = (o: ReturnType<typeof crackObservation>) => o.checks!.find((c) => c.name.startsWith('No hole inside the ground'))!;
    expect(crackObservation([row({ rimOffsetMaxPx: 4 })], real).checks!.some((c) => c.name.startsWith('Baseline:'))).toBeFalse();
    expect(rim(crackObservation([row({ rimOffsetMaxPx: 4 })], real)).passed).toBeFalse();
    expect(rim(crackObservation([row({ rimOffsetMaxPx: 1 })], real)).passed).toBeTrue();
    expect(rim(crackObservation([row({ holes: 6, cut: 6, holesRim: 6 })], real)).passed).toBeFalse();
    expect(crackObservation([row({ rimOffsetMaxPx: 0 })], real).checks!.every((c) => c.passed)).toBeTrue();
  });

  it('names the cause of pole holes and carries it into the row text', () => {
    expect(poleCauseOf(0, 0)).toBe('none');
    expect(poleCauseOf(2446, 0)).toBe('budget');
    expect(poleCauseOf(1024, 1024)).toBe('geometry');
    expect(poleCauseOf(2446, 633)).toBe('both');
    const o = crackObservation([row({ pole: 5, holes: 5, poleCause: 'geometry', poleHolesAtBigCap: 5 })], settings);
    expect(o.details!['poleCauses']).toBe('geometry');
    expect(String(o.details!['rows'])).toContain('pole cause geometry');
  });
});

describe('precision observation', () => {
  const p2 = (change: Partial<ProbeResult> = {}) => ({ method: 'p2', maxErrPxOutsideCap: 0.2, p99ErrPxOutsideCap: 0.1, underPixelOutsideCap: true, wrapMismatch: 0, leaves: 100, radiusM: 6_371_000, pose: 'mid-2m', morph: 0.5, heightM: 0, ...change }) as ProbeResult;
  const naive = (change: Partial<ProbeResult> = {}) => p2({ method: 'naive', maxErrPxOutsideCap: 40, p99ErrPxOutsideCap: 12, underPixelOutsideCap: false, ...change });

  it('passes under a pixel for P2 whatever the naive rows show, and keeps the naive p99', () => {
    const o = precisionObservation([p2(), p2({ morph: 0, bitEqualToday: true }), naive()]);
    expect(o.checks!.every((c) => c.passed)).toBeTrue();
    expect(o.metrics.find((m) => m.name === 'naiveP99ErrPx')!.samples).toEqual([12]);
    expect(o.metrics.find((m) => m.name === 'maxErrPx')!.samples).toEqual([0.2, 0.2]);
  });

  it('fails when a P2 row is over a pixel or morph 0 is not bit-equal', () => {
    expect(precisionObservation([p2({ maxErrPxOutsideCap: 1.5, underPixelOutsideCap: false })]).checks!.find((c) => c.name.startsWith('P2 own-sheet'))!.passed).toBeFalse();
    expect(precisionObservation([p2({ bitEqualToday: false })]).checks!.find((c) => c.name.startsWith('Morph 0'))!.passed).toBeFalse();
  });
});

describe('morph spike test adapter', () => {
  const context = { signal: new AbortController().signal, profile: 'visible-browser', mode: 'standard', repetition: 1, wait: () => Promise.resolve(), measureWindow: () => Promise.reject(new Error('no window')) } as unknown as TestContext;
  const state = { radiusM: 6_371_000, morph: 0.5, centreLonDeg: 0, centreLatDeg: 0, poseId: 'mid-2m', poseOverride: {}, method: 'p2', lodMetric: 'sphere', wireframe: false, heightM: 0 } as MorphSpikeState;

  function fakeHost(rows: CrackRow[]): { host: MorphSpikeTestHost; applied: Partial<MorphSpikeState>[]; options: unknown[] } {
    const applied: Partial<MorphSpikeState>[] = [];
    const options: unknown[] = [];
    const host: MorphSpikeTestHost = {
      read: () => ({ ...state }),
      apply: (patch) => { applied.push(patch); },
      ready: () => true,
      backendIsWebGpu: () => true,
      runProbe: async () => [],
      runCrackProbe: async (o) => { options.push(o); return rows; },
      runFanProbe: async (o) => { options.push(o); return []; },
      runFanRebuild: async (o) => { options.push(o); return []; },
      environment: () => ({ backend: 'webgpu' }),
    };
    return { host, applied, options };
  }

  it('passes the scenario settings to the crack probe and restores the page state', async () => {
    const s = scenario('crack-pole-200m-stretch');
    const { host, applied, options } = fakeHost(s.settings.radii.flatMap((radiusM) => s.settings.morphs.map((morph) => row({ radiusM, morph, rimOffsetMaxPx: 4 }))));
    const adapter = createMorphSpikeTestAdapter(host);
    const snapshot = await adapter.capture(context);
    await adapter.apply(s, context);
    await adapter.ready(context, s);
    const observation = await adapter.measure(s, context);
    expect(options[0]).toEqual(jasmine.objectContaining({ lodMetric: 'stretch', views: ['pole-200m'], matrix: true, controls: false, diagnosePole: true }));
    expect(observation.checks!.map((c) => c.name)).toContain('WebGPU backend in use');
    expect(observation.checks!.every((c) => c.passed)).toBeTrue();
    await adapter.restore(snapshot, context);
    expect(applied[0]).toEqual(jasmine.objectContaining({ lodMetric: 'stretch' }));
    expect(applied[applied.length - 1]).toEqual(state);
    expect(adapter.environment!()).toEqual({ backend: 'webgpu' });
  });

  it('passes the leaf cap of a scenario to the crack probe', async () => {
    const s = scenario('crack-pole-200m-stretch-cap16k');
    const { host, options } = fakeHost(s.settings.radii.flatMap((radiusM) => s.settings.morphs.map((morph) => row({ radiusM, morph }))));
    const adapter = createMorphSpikeTestAdapter(host);
    await adapter.apply(s, context);
    await adapter.measure(s, context);
    expect(options[0]).toEqual(jasmine.objectContaining({ leafCap: 16_384, lodMetric: 'stretch' }));
  });

  it('passes the fan type of a vertex-stage crack scenario to the crack probe', async () => {
    const s = scenario('crack-pole-200m-fan-vertex');
    const { host, options } = fakeHost(s.settings.radii.flatMap((radiusM) => s.settings.morphs.map((morph) => row({ radiusM, morph }))));
    const adapter = createMorphSpikeTestAdapter(host);
    await adapter.apply(s, context);
    await adapter.measure(s, context);
    expect(options[0]).toEqual(jasmine.objectContaining({ poleFan: true, fanRays: 1024, fanMode: 'vertex' }));
  });

  it('runs the fan probe and the rebuild run for their kinds and judges them', async () => {
    const precision = scenario('fan-vertex-precision');
    const a = fakeHost([]);
    const adapterA = createMorphSpikeTestAdapter(a.host);
    await adapterA.apply(precision, context);
    const observationA = await adapterA.measure(precision, context);
    expect(a.options[0]).toEqual(jasmine.objectContaining({ radii: [600_000, 6_371_000], morphs: [0.5, 1], rays: 1024 }));
    expect(observationA.checks!.map((c) => c.name)).toContain('WebGPU backend in use');
    expect(observationA.checks!.some((c) => !c.passed)).toBeTrue();
    const rebuild = scenario('fan-vertex-rebuilds');
    const b = fakeHost([]);
    const adapterB = createMorphSpikeTestAdapter(b.host);
    await adapterB.apply(rebuild, context);
    await adapterB.measure(rebuild, context);
    expect(b.options[0]).toEqual(jasmine.objectContaining({ radii: [6_371_000], modes: ['vertex', 'cpu'], rays: 1024, frames: 60 }));
  });

  it('picks the pole edge at morph 0.5 for the thumbnail', () => {
    const base = { radiusM: 6_371_000, view: 'mid-200m' as const };
    expect(thumbnailScore({ ...base, morph: 0.5, view: 'pole-200m' })).toBeGreaterThan(thumbnailScore({ ...base, morph: 0.5 }));
    expect(thumbnailScore({ ...base, morph: 0.5 })).toBeGreaterThan(thumbnailScore({ ...base, morph: 1 }));
    expect(thumbnailScore({ ...base, morph: 0.5, control: 'gap' })).toBe(0);
  });
});

describe('suite v6: the vertex-stage pole fan', () => {
  const v5 = MORPH_SPIKE_TEST_HISTORY[4];
  const v5Ids = v5.scenarios.map((s) => s.id);

  it('keeps every v5 scenario unchanged and adds the vertex-stage fan scenarios', () => {
    expect(suite.version).toBe(6);
    expect(suite.scenarios.slice(0, v5.scenarios.length)).toEqual(v5.scenarios);
    const added = suite.scenarios.slice(v5.scenarios.length).map((s) => s.id);
    expect(added).toEqual([
      'crack-pole-200m-fan-vertex', 'crack-tilted-fan-vertex', 'crack-orbit-map-fan-vertex', 'crack-mid-fan-vertex', 'crack-cut-fan-vertex',
      'fan-vertex-precision', 'fan-vertex-rebuilds',
    ]);
    for (const id of added) expect(v5Ids).not.toContain(id);
    for (const s of suite.scenarios) expect(JSON.parse(JSON.stringify(s.settings))).toEqual(s.settings as unknown as object);
  });

  it('draws the vertex-stage crack cases like the CPU fan cases, under the same judge, with only the fan type changed', () => {
    const pairs: [string, string][] = [
      ['crack-pole-200m-fan-vertex', 'crack-pole-200m-fan'], ['crack-tilted-fan-vertex', 'crack-tilted-fan'], ['crack-orbit-map-fan-vertex', 'crack-orbit-map-fan'],
      ['crack-mid-fan-vertex', 'crack-mid-fan'], ['crack-cut-fan-vertex', 'crack-cut-fan'],
    ];
    for (const [vertex, cpu] of pairs) {
      expect(scenario(vertex).settings).toEqual({ ...scenario(cpu).settings, fanMode: 'vertex' });
      expect(scenario(vertex).settings.fanRays).toBe(1024);
      expect(scenario(vertex).settings.rimCheck).toBeTrue();
      expect(scenario(cpu).settings.fanMode).toBeUndefined();
    }
  });

  it('sets up the precision scenario over both radii, both morphs, both centres and the three poses, with a limit of one pixel', () => {
    const s = scenario('fan-vertex-precision').settings;
    expect(s.kind).toBe('fan-precision');
    expect(s.radii).toEqual([600_000, 6_371_000]);
    expect(s.morphs).toEqual([0.5, 1]);
    expect(s.precisionLimitPx).toBe(FAN_PRECISION_LIMIT_PX);
    expect(FAN_PRECISION_LIMIT_PX).toBe(1);
    expect(s.fanRays).toBe(1024);
    expect(expectedFanProbeCases(s)).toBe(2 * 2 * 3 * 2);
  });

  it('sets up the rebuild scenario with the vertex-stage fan judged and the CPU fan as the control', () => {
    const s = scenario('fan-vertex-rebuilds').settings;
    expect(s.kind).toBe('fan-rebuild');
    expect(s.fanModes).toEqual(['vertex', 'cpu']);
    expect(expectedFanRebuildCases(s)).toBe(1 * 2 * 2);
  });

  it('leaves the older suites without any v6 field', () => {
    for (const old of MORPH_SPIKE_TEST_HISTORY.slice(0, 5)) {
      expect(old.scenarios.some((s) => s.settings.fanMode !== undefined || s.settings.kind === 'fan-precision' || s.settings.kind === 'fan-rebuild')).toBeFalse();
    }
  });
});

describe('fan precision observation', () => {
  const settings = scenario('fan-vertex-precision').settings;
  const stats = (maxErrPx: number) => ({ vertices: 10, maxErrPx, p99ErrPx: maxErrPx / 2, maxErrM: maxErrPx });
  const fanRow = (change: Partial<FanProbeRow> = {}): FanProbeRow => ({
    label: 'case', leaves: 4, corner: 4, interior: 0, vertices: 1000, all: stats(0.1), polar: stats(0.1), chord: stats(0.05), own: stats(0.05), judged: stats(0.1), poleZone: stats(0.04), chordBands: [], nonFinite: 0,
    worst: { kind: 'polar', distM: 100, errM: 0.01, errPx: 0.1 }, nearestM: 50, buildMs: 2, ms: 3, ...change,
  }) as FanProbeRow;
  const fullRows = (): FanProbeRow[] => {
    const n = expectedFanProbeCases(settings);
    return Array.from({ length: n }, (_, k) => fanRow(k % 2 ? { corner: 0, interior: 1 } : {}));
  };
  const check = (o: ReturnType<typeof fanPrecisionObservation>, start: string) => o.checks!.find((c) => c.name.startsWith(start))!;

  it('passes a complete run that covers the corner and the interior pole under the limit', () => {
    const o = fanPrecisionObservation(fullRows(), settings);
    expect(o.checks!.every((c) => c.passed)).toBeTrue();
    expect(o.metrics.find((m) => m.name === 'maxErrPx')!.samples.length).toBe(fullRows().length);
    expect(fanProbeRowText(fanRow())).toContain('case');
  });

  it('fails a vertex over the limit, a missing case, a non-finite result and a probe that never saw an interior pole', () => {
    const over = fullRows();
    over[3] = fanRow({ judged: stats(1.5) });
    expect(check(fanPrecisionObservation(over, settings), 'Every polar vertex').passed).toBeFalse();
    const zoneOnly = fullRows();
    zoneOnly[3] = fanRow({ all: stats(900), poleZone: stats(900) });
    const zoneObs = fanPrecisionObservation(zoneOnly, settings);
    expect(check(zoneObs, 'Every polar vertex').passed).toBeTrue();
    expect(zoneObs.metrics.find((m) => m.name === 'poleZoneMaxErrPx')!.samples[3]).toBe(900);
    expect(check(fanPrecisionObservation(fullRows().slice(1), settings), 'The probe ran every case').passed).toBeFalse();
    const bad = fullRows();
    bad[0] = fanRow({ nonFinite: 3 });
    expect(check(fanPrecisionObservation(bad, settings), 'Every case built a fan').passed).toBeFalse();
    const corners = Array.from({ length: expectedFanProbeCases(settings) }, () => fanRow());
    expect(check(fanPrecisionObservation(corners, settings), 'The cases cover').passed).toBeFalse();
    expect(check(fanPrecisionObservation([], settings), 'The probe ran every case').passed).toBeFalse();
  });
});

describe('fan rebuild observation', () => {
  const settings = scenario('fan-vertex-rebuilds').settings;
  const phase = (rebuilds: number, leafSetChanges = 0) => ({ frames: 60, rebuilds, buildMs: rebuilds * 5, leafSetChanges });
  const rebuildRow = (mode: 'vertex' | 'cpu', centre: number, change: Partial<FanRebuildRow> = {}): FanRebuildRow => {
    const move = mode === 'cpu' ? 90 : 0;
    return {
      mode, radiusM: 6_371_000, centreLonDeg: centre, centreLatDeg: centre, rays: 1024, vertices: 100_000, triangles: 200_000, initial: phase(1),
      camera: phase(mode === 'cpu' ? 60 : 0), morph: phase(mode === 'cpu' ? 30 : 0), centre: phase(1), moveRebuilds: move, moveBuildMs: move * 5, moveBuildMsPerRebuild: move ? 5 : 0, moveLeafSetChanges: 0,
      ...change,
    } as unknown as FanRebuildRow;
  };
  const rows = (): FanRebuildRow[] => [rebuildRow('vertex', 0), rebuildRow('vertex', 20), rebuildRow('cpu', 0), rebuildRow('cpu', 20)];
  const check = (o: ReturnType<typeof fanRebuildObservation>, start: string) => o.checks!.find((c) => c.name.startsWith(start))!;

  it('passes when the vertex-stage fan builds once, never rebuilds while moving, and the CPU control does', () => {
    const o = fanRebuildObservation(rows(), settings);
    expect(o.checks!.every((c) => c.passed)).toBeTrue();
    expect(o.metrics.find((m) => m.name === 'vertexFanMoveRebuilds')!.samples).toEqual([0, 0]);
    expect(o.metrics.find((m) => m.name === 'cpuFanMoveRebuilds')!.samples).toEqual([90, 90]);
  });

  it('fails a vertex-stage fan that rebuilt, a script that changed the leaf set, a fan never built and a counter that never counts', () => {
    const rebuilt = rows();
    rebuilt[0] = rebuildRow('vertex', 0, { moveRebuilds: 2 });
    expect(check(fanRebuildObservation(rebuilt, settings), 'The vertex-stage fan was not rebuilt').passed).toBeFalse();
    const moved = rows();
    moved[1] = rebuildRow('vertex', 20, { moveLeafSetChanges: 1 });
    expect(check(fanRebuildObservation(moved, settings), 'The scripted camera move').passed).toBeFalse();
    const unbuilt = rows();
    unbuilt[2] = rebuildRow('cpu', 0, { initial: phase(0) });
    expect(check(fanRebuildObservation(unbuilt, settings), 'Every fan was built once').passed).toBeFalse();
    const silent = rows();
    silent[3] = rebuildRow('cpu', 20, { moveRebuilds: 0 });
    expect(check(fanRebuildObservation(silent, settings), 'Control').passed).toBeFalse();
    expect(check(fanRebuildObservation(rows().slice(1), settings), 'The run covered every mode').passed).toBeFalse();
  });
});
