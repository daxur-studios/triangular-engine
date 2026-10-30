import { buildTestLaunchUrl, type TestContext } from 'triangular-engine/testing';
import { poleCauseOf, type CrackRow, type MorphSpikeState, type ProbeResult } from './core';
import { createMorphSpikeTestAdapter, thumbnailScore, type MorphSpikeTestHost } from './morph-spike-test-adapter';
import {
  MORPH_SPIKE_SUITE_ID, MORPH_SPIKE_TEST_HISTORY, TRIANGLES_PER_INSTANCE, crackObservation, crackRowText, expectedCrackCases, expectedSilent, precisionObservation,
  type MorphSpikeTestSettings,
} from './morph-spike-tests';

const suite = MORPH_SPIKE_TEST_HISTORY[MORPH_SPIKE_TEST_HISTORY.length - 1];
const scenario = (id: string) => suite.scenarios.find((s) => s.id === id)!;

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
    expect(suite.version).toBe(4);
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
    expect(MORPH_SPIKE_TEST_HISTORY.map((s) => s.version)).toEqual([1, 2, 3, 4]);
    for (const old of [v1, v2, v3]) expect(old.scenarios.some((s) => s.settings.poleFan)).toBeFalse();
    for (const old of v3.scenarios) expect(suite.scenarios.map((s) => s.id)).toContain(old.id);
    const fan = scenario('crack-pole-200m-fan').settings;
    expect(fan).toEqual({ ...scenario('crack-pole-200m').settings, lodMetric: 'stretch', rimCheck: true, poleFan: true, fanRays: 1024 });
    expect(scenario('crack-tilted-fan').settings).toEqual({
      ...scenario('crack-tilted').settings, lodMetric: 'stretch', rimCheck: true, poleFan: true, fanRays: 1024,
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

  it('builds an autostart launch link for the exact version', () => {
    const url = new URL(buildTestLaunchUrl('http://triangular-demo.localhost:4200/lod-surface-morph-spike', suite, 'headless-hardware', 1));
    expect(url.searchParams.get('testSuite')).toBe('lod-surface-morph');
    expect(url.searchParams.get('testVersion')).toBe('4');
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
  const settings: MorphSpikeTestSettings = { ...scenario('crack-pole-200m').settings, rimCheck: false, radii: [6_371_000], morphs: [0.5] };

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
      environment: () => ({ backend: 'webgpu' }),
    };
    return { host, applied, options };
  }

  it('passes the scenario settings to the crack probe and restores the page state', async () => {
    const s = scenario('crack-pole-200m-stretch');
    const { host, applied, options } = fakeHost(s.settings.radii.flatMap((radiusM) => s.settings.morphs.map((morph) => row({ radiusM, morph }))));
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

  it('picks the pole edge at morph 0.5 for the thumbnail', () => {
    const base = { radiusM: 6_371_000, view: 'mid-200m' as const };
    expect(thumbnailScore({ ...base, morph: 0.5, view: 'pole-200m' })).toBeGreaterThan(thumbnailScore({ ...base, morph: 0.5 }));
    expect(thumbnailScore({ ...base, morph: 0.5 })).toBeGreaterThan(thumbnailScore({ ...base, morph: 1 }));
    expect(thumbnailScore({ ...base, morph: 0.5, control: 'gap' })).toBe(0);
  });
});
