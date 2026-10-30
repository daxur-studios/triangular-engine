import { TERRAIN_DEFAULTS } from 'triangular-engine/lod-surface/core';
import type { TestCheck, TestMetric, TestObservation, TestScenario, TestSuite } from 'triangular-engine/testing';
import { CRACK_DEFAULTS, DIAGNOSE_LEAF_CAP, PROBE_DEFAULTS, type CrackRow, type LodMetric, type MorphPoseId, type ProbeResult } from './core';

/**
 * Everything a morph spike case sets. Plain JSON: it is saved with the result and the page runs it through the probes it already
 * has (`runProbe`, `runCrackProbe`); a case never drives the page's own controls.
 */
export interface MorphSpikeTestSettings {
  /** `precision`: the GPU vertex precision probe (`runProbe`); `crack`: the crack probe (`runCrackProbe`). */
  readonly kind: 'precision' | 'crack';
  readonly radii: readonly number[];
  readonly morphs: readonly number[];
  /** The poses: the crack probe's views, or the precision probe's 2 m poses. */
  readonly views: readonly MorphPoseId[];
  /** The projection centre of every case, degrees. */
  readonly centreLonDeg: number;
  readonly centreLatDeg: number;
  /** The LOD metric of every case's selector. */
  readonly lodMetric: LodMetric;
  /** Crack kind: run the plain matrix (radii x views x morphs). */
  readonly matrix: boolean;
  /** Crack kind: also run the known-bad controls on the views they apply to. */
  readonly controls: boolean;
  /** Crack kind: the probe image width, pixels. */
  readonly widthPx: number;
  /** Crack kind: the selector's leaf cap of every case (absent: the library default, 4,096; the spike's mesh holds up to 16,384). */
  readonly leafCap?: number;
  /** Crack kind: draw a case with pole holes again at the largest cap and say whether the budget or the geometry caused them. */
  readonly diagnosePole?: boolean;
  /** Crack kind: a silent control that `expectedSilent` names is reported as a limitation, not failed (v2; v1 failed it). */
  readonly knownSilentControls?: boolean;
  /**
   * Crack kind (v3): a real case passes with no hole inside the ground (`holesInterior` 0, `holes` at the cut 0) and the drawn rim of the
   * world within `RIM_OFFSET_LIMIT_PX` of the exact rim, instead of with no hole pixel at all.
   */
  readonly rimCheck?: boolean;
  /**
   * Crack kind (v4): the pole leaves are drawn as the pole fan (`morph-fan.ts`: a CPU-built polar mesh around the pole, `fanRays` meridians per
   * full turn, default 1,024) instead of instances. Never active at morph 0.
   */
  readonly poleFan?: boolean;
  readonly fanRays?: number;
}

/** Largest rim offset (pixels) a v3 real case may have: the plan's goal is a vertex error under a pixel. */
export const RIM_OFFSET_LIMIT_PX = 1;

/** Radius (m) above which the 'folding-off' control over the 2 m view is expected to stay silent, see {@link expectedSilent}. */
export const SILENT_RADIUS_M = 1_000_000;

/**
 * A control case that is allowed to find nothing: 'folding-off' at planet radius over the 2 m mid view. The relief that opens a
 * T-junction is held to 40 % of the camera's 2 m altitude (the camera must stay above the ground), and at 6,371 km the junction's
 * step is below a pixel then; the control is reported as a limitation there, not failed. Anywhere else a silent control fails.
 */
export function expectedSilent(row: Pick<CrackRow, 'control' | 'view' | 'radiusM'>): boolean {
  return row.control === 'folding-off' && row.view === 'mid-2m' && row.radiusM > SILENT_RADIUS_M;
}

/** Id of the suite. */
export const MORPH_SPIKE_SUITE_ID = 'lod-surface-morph';

/** Triangles one drawn instance holds (the cap segments are not counted, as in the page's readout). */
export const TRIANGLES_PER_INSTANCE = 2 * TERRAIN_DEFAULTS.patchCells ** 2;

const CRACK_BASE: MorphSpikeTestSettings = {
  kind: 'crack', radii: CRACK_DEFAULTS.radii, morphs: CRACK_DEFAULTS.morphs, views: [], centreLonDeg: 0, centreLatDeg: 0, lodMetric: 'sphere',
  matrix: true, controls: false, widthPx: CRACK_DEFAULTS.widthPx,
};

/** The centre the tilted cases use: a pole strictly inside a leaf of the projection, not on a lattice vertex. */
const TILTED_CENTRE = { centreLonDeg: 20, centreLatDeg: 35 } as const;

function crack(id: string, label: string, change: Partial<MorphSpikeTestSettings>): TestScenario<MorphSpikeTestSettings> {
  return { id, label, settings: { ...CRACK_BASE, ...change }, durationMs: 1000 };
}

const SCENARIOS_V1: readonly TestScenario<MorphSpikeTestSettings>[] = [
  {
    id: 'precision', label: 'Vertex precision: P2 under a pixel at 2 m, naive float for comparison',
    settings: {
      ...CRACK_BASE, kind: 'precision', radii: PROBE_DEFAULTS.radii, morphs: PROBE_DEFAULTS.morphs, views: PROBE_DEFAULTS.poses, matrix: false,
    },
    durationMs: 1000,
  },
  crack('crack-cut', 'Cracks: the cut, 2 m on each side', { views: ['cut-east-2m', 'cut-west-2m'] }),
  crack('crack-orbit-map', 'Cracks: orbit over the map', { views: ['orbit-map'] }),
  crack('crack-mid', 'Cracks: mid-height views, levels meeting in the picture', { views: ['mid-200m', 'mid-2m'] }),
  crack('crack-pole-200m', 'Cracks: pole edge at 200 m, sphere metric (known open: holes at morph 0.5)', { views: ['pole-200m'] }),
  crack('crack-controls', 'Controls: the probe finds the gap and the folding-off cracks, and the relief twin is clean', {
    views: ['orbit-map', 'mid-200m', 'mid-2m'], matrix: false, controls: true, morphs: [0.5],
  }),
  crack('crack-tilted', 'Cracks: tilted centre (lon 20, lat 35), orbit and pole edge, sphere metric', { ...TILTED_CENTRE, views: ['orbit-map', 'pole-200m'] }),
  crack('crack-pole-200m-stretch', 'Cracks: pole edge at 200 m, stretch metric', { views: ['pole-200m'], lodMetric: 'stretch' }),
  crack('crack-tilted-stretch', 'Cracks: tilted centre, orbit and pole edge, stretch metric', {
    ...TILTED_CENTRE, views: ['orbit-map', 'pole-200m'], lodMetric: 'stretch',
  }),
];

/** v1: the precision probe and one crack case group per scenario, with the stretch metric beside the sphere one at the pole. */
const MORPH_SPIKE_V1: TestSuite<MorphSpikeTestSettings> = {
  id: MORPH_SPIKE_SUITE_ID,
  version: 1,
  title: 'LOD surface globe-to-map morph: vertex precision and cracks (Plan 059 spike)',
  purpose: 'functional',
  requiresVisualReview: false,
  scenarios: SCENARIOS_V1,
};

/** The v1 scenarios with the pole diagnosis on the stretch ones, plus the stretch pole cases again at the largest leaf cap. */
const SCENARIOS_V2: readonly TestScenario<MorphSpikeTestSettings>[] = [
  ...SCENARIOS_V1.map((scenario) => {
    if (scenario.id === 'crack-pole-200m-stretch' || scenario.id === 'crack-tilted-stretch') return { ...scenario, settings: { ...scenario.settings, diagnosePole: true } };
    if (scenario.id === 'crack-controls') return { ...scenario, settings: { ...scenario.settings, knownSilentControls: true } };
    return scenario;
  }),
  crack('crack-pole-200m-stretch-cap16k', 'Cracks: pole edge at 200 m, stretch metric, 16,384 leaf cap', { views: ['pole-200m'], lodMetric: 'stretch', leafCap: 16_384 }),
  crack('crack-tilted-stretch-cap16k', 'Cracks: tilted centre, orbit and pole edge, stretch metric, 16,384 leaf cap', {
    ...TILTED_CENTRE, views: ['orbit-map', 'pole-200m'], lodMetric: 'stretch', leafCap: 16_384,
  }),
];

/**
 * v2: the same measurements as v1, but a silent 'folding-off' control at 6,371 km over the 2 m mid view is reported as a known
 * limitation instead of failing the controls check, the stretch pole scenarios say whether their holes are the leaf budget or the
 * pole edge's geometry, and two scenarios give the stretch pole cases the largest leaf cap.
 */
const MORPH_SPIKE_V2: TestSuite<MorphSpikeTestSettings> = {
  ...MORPH_SPIKE_V1,
  version: 2,
  scenarios: SCENARIOS_V2,
};

/** v3: every crack scenario judged by interior holes and the rim offset, not by the pixel count. */
const MORPH_SPIKE_V3: TestSuite<MorphSpikeTestSettings> = {
  ...MORPH_SPIKE_V2,
  version: 3,
  scenarios: SCENARIOS_V2.map((scenario) => (scenario.settings.kind === 'crack' ? { ...scenario, settings: { ...scenario.settings, rimCheck: true } } : scenario)),
};

const SCENARIOS_V3 = MORPH_SPIKE_V3.scenarios;
const fanCrack = (id: string, label: string, change: Partial<MorphSpikeTestSettings>): TestScenario<MorphSpikeTestSettings> =>
  crack(id, label, { rimCheck: true, poleFan: true, fanRays: 1024, ...change });

/**
 * v4: the v3 scenarios plus the pole fan: the corner case (centre 0, 0) and the interior case (tilted centre) at the pole view with
 * the stretch metric and 256, 1,024 and 4,096 rays per turn, and the seam views (the cut, the orbit over the map, the mid views)
 * with the fan on, which must stay at no hole inside the ground. The judge is v3's (no interior hole, none at the cut, rim offset
 * within `RIM_OFFSET_LIMIT_PX`).
 */
const MORPH_SPIKE_V4: TestSuite<MorphSpikeTestSettings> = {
  ...MORPH_SPIKE_V3,
  version: 4,
  scenarios: [
    ...SCENARIOS_V3,
    fanCrack('crack-pole-200m-fan', 'Cracks: pole edge at 200 m, stretch metric, pole fan (1,024 rays)', { views: ['pole-200m'], lodMetric: 'stretch' }),
    fanCrack('crack-tilted-fan', 'Cracks: tilted centre, orbit and pole edge, stretch metric, pole fan (1,024 rays)', {
      ...TILTED_CENTRE, views: ['orbit-map', 'pole-200m'], lodMetric: 'stretch',
    }),
    fanCrack('crack-orbit-map-fan', 'Cracks: orbit over the map with the pole fan (seams must stay closed)', { views: ['orbit-map'] }),
    fanCrack('crack-mid-fan', 'Cracks: mid-height views with the pole fan (seams must stay closed)', { views: ['mid-200m', 'mid-2m'] }),
    fanCrack('crack-cut-fan', 'Cracks: the cut with the pole fan (seams must stay closed)', { views: ['cut-east-2m', 'cut-west-2m'] }),
    fanCrack('crack-pole-200m-fan-256', 'Cracks: pole edge at 200 m, stretch metric, pole fan with 256 rays', { views: ['pole-200m'], lodMetric: 'stretch', fanRays: 256 }),
    fanCrack('crack-pole-200m-fan-4096', 'Cracks: pole edge at 200 m, stretch metric, pole fan with 4,096 rays', { views: ['pole-200m'], lodMetric: 'stretch', fanRays: 4096 }),
    fanCrack('crack-tilted-fan-256', 'Cracks: tilted centre, pole edge, stretch metric, pole fan with 256 rays', {
      ...TILTED_CENTRE, views: ['pole-200m'], lodMetric: 'stretch', fanRays: 256,
    }),
    fanCrack('crack-tilted-fan-4096', 'Cracks: tilted centre, pole edge, stretch metric, pole fan with 4,096 rays', {
      ...TILTED_CENTRE, views: ['pole-200m'], lodMetric: 'stretch', fanRays: 4096,
    }),
  ],
};

/** Every version of the suite, oldest first. */
export const MORPH_SPIKE_TEST_HISTORY: readonly TestSuite<MorphSpikeTestSettings>[] = [MORPH_SPIKE_V1, MORPH_SPIKE_V2, MORPH_SPIKE_V3, MORPH_SPIKE_V4];

/** How many rows a crack scenario's probe run returns (mirrors `runCrackProbe`'s case list). */
export function expectedCrackCases(settings: MorphSpikeTestSettings): number {
  let count = 0;
  if (settings.matrix) count += settings.radii.length * settings.views.length * settings.morphs.length;
  if (settings.controls) {
    for (const view of settings.views) {
      if (CRACK_DEFAULTS.gapViews.includes(view)) count += settings.radii.length;
      if (CRACK_DEFAULTS.reliefViews.includes(view)) count += 2 * settings.radii.length;
    }
  }
  return count;
}

/** One row as a short text: radius, view, morph, metric, the holes by region and what was drawn. */
export function crackRowText(row: CrackRow): string {
  const km = row.radiusM / 1000;
  return `${km} km ${row.view} m${row.morph}${row.control ? ` ${row.control}` : ''} ${row.lodMetric ?? 'sphere'}: holes ${row.holes} `
    + `(cut ${row.cut}, pole ${row.pole}, else ${row.elsewhere}; interior ${row.holesInterior ?? '?'}, rim ${row.holesRim ?? '?'}, rim offset max ${row.rimOffsetMaxPx ?? '?'} p95 ${row.rimOffsetP95Px ?? '?'} px), leaves ${row.leaves}, instances ${row.instances}`
    + (row.leafCap ? `, cap ${row.leafCap}` : '')
    + (row.fanVertices !== undefined ? `, fan ${row.fanRays ?? '?'} rays ${row.fanLeaves ?? '?'} leaves ${row.fanVertices} vertices ${row.fanTriangles} triangles ${row.fanBuildMs?.toFixed(1)} ms` : '')
    + (row.poleCause && row.poleCause !== 'none' ? `, pole cause ${row.poleCause} (${row.poleHolesAtBigCap} pole holes at ${DIAGNOSE_LEAF_CAP} leaves)` : '');
}

const MAX_LISTED = 6;
const list = (rows: readonly CrackRow[]): string => rows.slice(0, MAX_LISTED).map(crackRowText).join(' | ') + (rows.length > MAX_LISTED ? ` | +${rows.length - MAX_LISTED} more` : '');
const maxOf = (values: readonly number[]): number => values.reduce((a, b) => Math.max(a, b), 0);

const isHoleControl = (row: CrackRow): boolean => row.control === 'gap' || row.control === 'folding-off';

/** The checks and metrics of a crack scenario from the probe's rows. Pure. */
export function crackObservation(rows: readonly CrackRow[], settings: MorphSpikeTestSettings): TestObservation {
  const real = rows.filter((r) => !r.control);
  const holeControls = rows.filter(isHoleControl);
  const twins = rows.filter((r) => r.control === 'relief');
  const expected = expectedCrackCases(settings);
  const dirty = real.filter((r) => r.holes !== 0);
  const rimDirty = real.filter((r) => (r.holesInterior ?? r.holes) !== 0 || r.cut !== 0 || (r.rimOffsetMaxPx ?? 0) > RIM_OFFSET_LIMIT_PX);
  const dropped = real.filter((r) => r.dropped !== 0);
  const silentRows = holeControls.filter((r) => r.holes <= 0);
  const tolerated = (r: CrackRow): boolean => settings.knownSilentControls === true && expectedSilent(r);
  const silent = silentRows.filter((r) => !tolerated(r));
  const knownSilent = silentRows.filter(tolerated);
  const crackedTwins = twins.filter((r) => r.holes !== 0);

  const checks: TestCheck[] = [
    { name: 'The probe ran every case', passed: rows.length === expected && rows.length > 0, detail: `${rows.length} rows, ${expected} expected` },
    {
      name: 'Every case drew the surface', passed: rows.length > 0 && rows.every((r) => r.coveredPx > 0),
      detail: rows.filter((r) => r.coveredPx <= 0).map(crackRowText).join(' | ') || `${rows.length} cases`,
    },
    ...(real.length ? [
      settings.rimCheck ? {
        name: `No hole inside the ground and the drawn rim within ${RIM_OFFSET_LIMIT_PX} px of the exact rim in the real cases (holesInterior == 0, rimOffsetMaxPx <= ${RIM_OFFSET_LIMIT_PX})`,
        passed: rimDirty.length === 0,
        detail: rimDirty.length ? `${rimDirty.length} of ${real.length} cases: ${list(rimDirty)}` : `${real.length} cases, no interior hole, worst rim offset ${maxOf(real.map((r) => r.rimOffsetMaxPx ?? 0))} px`,
      } : {
        name: 'No holes inside the map outline in the real cases (holes == 0)', passed: dirty.length === 0,
        detail: dirty.length ? `${dirty.length} of ${real.length} cases: ${list(dirty)}` : `${real.length} cases, 0 holes`,
      },
      {
        name: 'No instance dropped for capacity', passed: dropped.length === 0,
        detail: dropped.length ? list(dropped) : `${real.length} cases`,
      },
    ] : []),
    ...(holeControls.length ? [{
      name: 'Controls: the probe finds the holes of the gap and of folding off (holes > 0)', passed: silent.length === 0,
      detail: silent.length ? `silent: ${list(silent)}` : holeControls.map((r) => `${r.control} ${r.view} ${r.radiusM / 1000} km: ${r.holes}${tolerated(r) ? ' (expected silent, reported as a limitation)' : ''}`).join(' | '),
    } satisfies TestCheck] : []),
    ...(twins.length ? [{
      name: 'Control twin: relief with folding on has no holes', passed: crackedTwins.length === 0,
      detail: crackedTwins.length ? list(crackedTwins) : `${twins.length} cases`,
    } satisfies TestCheck] : []),
  ];

  const per = (name: string, unit: string, source: string, pick: (r: CrackRow) => number, set: readonly CrackRow[] = real): TestMetric => ({
    name, unit, source, samples: set.map(pick), unavailableReason: set.length ? undefined : 'No such case in this scenario',
  });
  const metrics: TestMetric[] = [
    per('holes', 'count', 'Per real case: background pixels inside the map outline (the probe image is black where no surface drew), outline-adjacent pixels masked', (r) => r.holes),
    per('holesCut', 'count', 'Per real case: holes within 6 px of the cut (the map\'s left and right edges)', (r) => r.cut),
    per('holesPole', 'count', 'Per real case: holes within 6 px of a pole edge', (r) => r.pole),
    per('holesElsewhere', 'count', 'Per real case: holes farther than 6 px from the outline edges', (r) => r.elsewhere),
    per('holesInterior', 'count', 'Per real case: hole pixels with ground around them (space seen through the ground)', (r) => r.holesInterior ?? r.holes),
    per('holesRim', 'count', 'Per real case: hole pixels in a missing run that reaches the exact outline next to space (the drawn rim lies short of the exact rim)', (r) => r.holesRim ?? 0),
    per('rimOffsetMaxPx', 'px', 'Per real case: largest, over the image columns that have a map edge next to space, of the distance between the exact edge and the first drawn pixel', (r) => r.rimOffsetMaxPx ?? 0),
    per('rimOffsetP95Px', 'px', 'Per real case: the 95th percentile of the same column distances', (r) => r.rimOffsetP95Px ?? 0),
    per('masked', 'count', 'Per real case: pixels masked as outline-adjacent, not counted as holes', (r) => r.masked),
    per('duplicates', 'count', 'Per real case: leaves drawn twice because they reach the cut', (r) => r.duplicates),
    per('leaves', 'count', 'Per real case: leaves the selector drew', (r) => r.leaves),
    per('instances', 'count', 'Per real case: instances drawn (leaves plus duplicates)', (r) => r.instances),
    per('surfaceTriangles', 'count', `Per real case: instances x 2 N^2 (N = ${TERRAIN_DEFAULTS.patchCells}); the pole cap triangles are not counted`, (r) => r.instances * TRIANGLES_PER_INSTANCE),
    { ...per('fanVertices', 'count', 'Per real case with the pole fan on: vertices of the fan (the pole leaves it replaced)', (r) => r.fanVertices ?? 0, real.filter((r) => r.fanVertices !== undefined)), optional: true },
    { ...per('fanTriangles', 'count', 'Per real case with the pole fan on: triangles of the fan', (r) => r.fanTriangles ?? 0, real.filter((r) => r.fanVertices !== undefined)), optional: true },
    { ...per('fanBuildMs', 'ms', 'Per real case with the pole fan on: CPU milliseconds of the fan build (doubles, then Float32), one rebuild', (r) => r.fanBuildMs ?? 0, real.filter((r) => r.fanVertices !== undefined)), optional: true },
    { ...per('controlHoles', 'count', 'Per gap or folding-off control case: holes the probe found (they must be above 0)', (r) => r.holes, holeControls), optional: true },
  ];

  return {
    metrics,
    checks,
    details: {
      cases: rows.length,
      lodMetric: settings.lodMetric,
      centreLonDeg: settings.centreLonDeg,
      centreLatDeg: settings.centreLatDeg,
      mostHoles: maxOf(real.map((r) => r.holes)),
      mostHolesInterior: maxOf(real.map((r) => r.holesInterior ?? r.holes)),
      worstRimOffsetPx: maxOf(real.map((r) => r.rimOffsetMaxPx ?? 0)),
      mostInstances: maxOf(rows.map((r) => r.instances)),
      leafCap: settings.leafCap ?? TERRAIN_DEFAULTS.leafCap,
      poleFan: settings.poleFan === true,
      fanRays: settings.poleFan ? settings.fanRays ?? 1024 : 0,
      poleCauses: [...new Set(real.filter((r) => r.poleCause && r.poleCause !== 'none').map((r) => r.poleCause))].join(',') || 'none',
      expectedSilentControls: knownSilent.length ? knownSilent.map(crackRowText).join(' | ') : 'none',
      rows: rows.map(crackRowText).join(' | '),
    },
    limitations: [
      'A hole is a pixel the probe material left black inside the map outline; the outline model is analytic, so a row near the pole edge depends on the 6 px mask.',
      'The leaf cap (4,096 unless the scenario sets one) binds at the pole views: both metrics report the leaves they could afford, not the leaves they asked for.',
      'A hole run that touches the exact outline is a rim hole: the drawn rim of the world lies short of the exact rim (a silhouette error), not space seen through the ground; the rim offset measures it per image column.',
      'The pole edge of a pole-corner leaf spans a fixed longitude range at every level, so more leaves do not shorten its cells: at 6,371 km the pole holes stay after the leaf cap is raised (see the pole cause of the rows).',
      'The folding-off control is expected to stay silent at 6,371 km over the 2 m mid view (its relief is bounded by the camera\'s 2 m altitude); it is reported, not failed.',
      'The probe pauses the page\'s own frame while it runs and renders into its own target.',
    ],
  };
}

/** The checks and metrics of the precision scenario from the probe's rows. Pure. */
export function precisionObservation(rows: readonly ProbeResult[]): TestObservation {
  const p2 = rows.filter((r) => r.method === 'p2');
  const naive = rows.filter((r) => r.method === 'naive');
  const over = p2.filter((r) => !r.underPixelOutsideCap);
  const bitRows = p2.filter((r) => r.bitEqualToday !== undefined);
  const unequal = bitRows.filter((r) => r.bitEqualToday === false);
  const label = (r: ProbeResult): string => `${r.radiusM / 1000} km ${r.pose} m${r.morph}${r.heightM ? ` +${r.heightM} m` : ''} ${r.method}: max ${r.maxErrPxOutsideCap.toPrecision(3)} px`;
  const checks: TestCheck[] = [
    { name: 'The probe returned P2 rows', passed: p2.length > 0, detail: `${p2.length} P2 rows, ${naive.length} naive rows` },
    {
      name: 'P2 own-sheet error under one pixel outside the pole cap (2 m views)', passed: p2.length > 0 && over.length === 0,
      detail: over.length ? over.slice(0, MAX_LISTED).map(label).join(' | ') : `worst ${maxOf(p2.map((r) => r.maxErrPxOutsideCap)).toPrecision(3)} px over ${p2.length} rows`,
    },
    ...(bitRows.length ? [{
      name: 'Morph 0 draws today\'s positions bit for bit (P2)', passed: unequal.length === 0,
      detail: unequal.length ? unequal.map(label).join(' | ') : `${bitRows.length} rows`,
    } satisfies TestCheck] : []),
  ];
  const metric = (name: string, source: string, set: readonly ProbeResult[], pick: (r: ProbeResult) => number): TestMetric => ({
    name, unit: 'px', source, samples: set.map(pick), unavailableReason: set.length ? undefined : 'No such rows',
  });
  const metrics: TestMetric[] = [
    metric('maxErrPx', 'Per P2 row: largest own-sheet vertex error against the double-precision reference, outside the 1 degree pole cap', p2, (r) => r.maxErrPxOutsideCap),
    metric('p99ErrPx', 'Per P2 row: 99th percentile of the same errors', p2, (r) => r.p99ErrPxOutsideCap),
    metric('naiveP99ErrPx', 'Per naive-float row: 99th percentile of the same errors (what the anchor-relative P2 removes)', naive, (r) => r.p99ErrPxOutsideCap),
    metric('naiveMaxErrPx', 'Per naive-float row: largest of the same errors', naive, (r) => r.maxErrPxOutsideCap),
    { name: 'wrapMismatch', unit: 'count', source: 'Per P2 row: vertices whose unwrap integer disagrees with the reference', samples: p2.map((r) => r.wrapMismatch), unavailableReason: p2.length ? undefined : 'No such rows' },
    { name: 'leaves', unit: 'count', source: 'Per row: leaves the probe selected', samples: rows.map((r) => r.leaves), unavailableReason: rows.length ? undefined : 'No rows' },
  ];
  return {
    metrics,
    checks,
    details: { rows: rows.length, p2Rows: p2.length, naiveRows: naive.length },
    limitations: [
      'The error is vertex position against a double-precision CPU reference read back from the GPU; it is not a rendered-image comparison.',
      'Errors inside the 1 degree pole cap are reported in the page\'s table (all max px) but do not decide the pass.',
    ],
  };
}
