// Fits the Capsule Doodle face model to a measured spec: for each concept subject it finds one
// shared set of face parameters and, for each view, a camera (yaw, pitch, field of view, scale and
// image offset), by robust least squares over eye circles, pupil centres, head side edges and
// mouth corners. Views that cannot be explained are flagged instead of forced.
//
//   node tools/concept-fitting/fit.mjs --spec <measured-spec.json> [--crops <dir>] [--out <dir>]
//
// All residuals are in head widths: pixels divided by the fitted pixel size of one head width.
// The thresholds here are provisional; the calibration phase sets the final ones.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore } from './load-core.mjs';

/** Radius of the model head in metres. It is fixed: every length is read in head widths. */
export const BODY_RADIUS = 0.36;
/** Residual scale of the robust loss, in head widths. Larger residuals count less than squared. */
export const ROBUST_DELTA = 0.03;
/** Provisional: a view whose RMS residual exceeds this many head widths is flagged. */
export const FLAG_RMS_LIMIT = 0.06;
/** Provisional: a view is also flagged when its RMS exceeds this multiple of the median of the others. */
export const FLAG_MEDIAN_FACTOR = 3;
/** Floor for the median rule, so a set of excellent views does not flag a merely good one. */
export const FLAG_MEDIAN_FLOOR = 0.01;
/** A view with fewer measured numbers than its camera parameters plus this many is reported as weakly constrained. */
export const WEAK_FREEDOM = 4;

const DEG = Math.PI / 180;
const round = (v, n = 4) => Math.round(v * 10 ** n) / 10 ** n;

/** Shared face parameters, with the DNA range each one is limited to. */
export const SHARED_PARAMETERS = [
  { key: 'eyeSpacing', lo: 0.27, hi: 0.55, start: 0.34 },
  { key: 'eyeScale', lo: 0.7, hi: 1.35, start: 1 },
  { key: 'eyeSizeAsymmetry', lo: -0.35, hi: 0.35, start: 0 },
  { key: 'eyeHeightAsymmetry', lo: -0.08, hi: 0.08, start: 0 },
  { key: 'bodyHeight', lo: 0.55, hi: 1.4, start: 0.85 },
  { key: 'mouthWidth', lo: 0.22, hi: 1.15, start: 0.62 },
  { key: 'gazeYawLeft', lo: -0.8, hi: 0.8, start: 0 },
  { key: 'gazePitchLeft', lo: -0.8, hi: 0.8, start: 0 },
  { key: 'gazeYawRight', lo: -0.8, hi: 0.8, start: 0 },
  { key: 'gazePitchRight', lo: -0.8, hi: 0.8, start: 0 },
];

/** Per-view camera parameter names; `logPpm` is the natural log of pixels per metre at the head centre. */
export const VIEW_KEYS = ['yaw', 'pitch', 'fov', 'logPpm', 'ox', 'oy'];

/** Pupil radius relative to the eye radius. The measurement records pupil centres, not sizes, so it is not fitted. */
export const PUPIL_SCALE = 0.28;

export const startShared = () => Object.fromEntries(SHARED_PARAMETERS.map((p) => [p.key, p.start]));

// ---------------------------------------------------------------------------------------------
// Model

/** The DNA the shared parameters describe. */
export function dnaFrom(core, s) {
  return {
    ...core.DEFAULT_CAPSULE_DNA,
    bodyRadius: BODY_RADIUS,
    bodyHeight: s.bodyHeight,
    suitSplitY: 0,
    eyeSpacing: s.eyeSpacing,
    eyeScale: s.eyeScale,
    pupilScale: PUPIL_SCALE,
    eyeSizeAsymmetry: s.eyeSizeAsymmetry,
    eyeHeightAsymmetry: s.eyeHeightAsymmetry,
  };
}

/** Orbit camera for a view: aimed at the capsule centre, offset on the image afterwards by (ox, oy). */
export function cameraFor(view, size) {
  const f = size.height / 2 / Math.tan((view.fov * DEG) / 2);
  const distance = f / Math.exp(view.logPpm);
  const cp = Math.cos(view.pitch);
  return {
    position: { x: distance * Math.sin(view.yaw) * cp, y: distance * Math.sin(view.pitch), z: distance * Math.cos(view.yaw) * cp },
    target: { x: 0, y: 0, z: 0 },
    fovYDegrees: view.fov,
    width: size.width,
    height: size.height,
  };
}

/**
 * Soft limits on the camera for a view label, as hinge residuals in head widths. They stop a view
 * with few measured landmarks from taking any camera that happens to fit: a profile must look
 * from the side, a front view from the front.
 */
export function labelPriors(label, view) {
  const hinge = (violation) => Math.max(0, violation) * 0.3;
  const yaw = Math.abs(view.yaw), pitch = Math.abs(view.pitch);
  switch (label) {
    case 'front': return [hinge(yaw - 25 * DEG), hinge(pitch - 30 * DEG)];
    case 'three-quarter': return [hinge(15 * DEG - yaw), hinge(yaw - 80 * DEG), hinge(pitch - 35 * DEG)];
    case 'profile': return [hinge(65 * DEG - yaw), hinge(pitch - 35 * DEG)];
    case 'up':
    case 'down': return [hinge(15 * DEG - pitch), hinge(yaw - 35 * DEG)];
    default: return [];
  }
}

/** Pixels in one head width at the head centre. */
export const headWidthPx = (view) => Math.exp(view.logPpm) * 2 * BODY_RADIUS;

const norm3 = (x, y, z) => {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
};
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Facing of a surface point towards the camera: 1 straight on, below 0 hidden behind the head. */
function facing(point, camPos) {
  const n = norm3(point.x, 0, point.z);
  return dot3(n, norm3(camPos.x - point.x, camPos.y - point.y, camPos.z - point.z));
}

/** Where the model's landmarks fall on the image of one view, in crop pixels. */
export function predict(core, shared, view, size) {
  const probes = core.computeCapsuleFaceProbes(dnaFrom(core, shared), {
    mouth: { ...core.CAPSULE_NEUTRAL_MOUTH, mouthWidth: shared.mouthWidth },
    leftEye: { gazeYaw: shared.gazeYawLeft, gazePitch: shared.gazePitchLeft, pupilScale: PUPIL_SCALE },
    rightEye: { gazeYaw: shared.gazeYawRight, gazePitch: shared.gazePitchRight, pupilScale: PUPIL_SCALE },
  });
  const camera = cameraFor(view, size);
  const shift = (p) => (p ? { x: p.x + view.ox, y: p.y + view.oy } : null);
  const project = (p) => shift(core.projectCharacterPoint(camera, p));
  const eyes = [probes.leftEye, probes.rightEye].map((e) => {
    const ellipse = core.projectCharacterEllipsoid(camera, e.sclera);
    const centre = ellipse ? shift(ellipse.center) : project(e.placement.position);
    return {
      side: e.placement.side,
      centre,
      ellipse: ellipse && { ...ellipse, center: centre },
      radius: ellipse ? (ellipse.semiMajor + ellipse.semiMinor) / 2 : 0,
      pupil: project(e.pupilCenter),
      facing: facing(e.placement.position, camera.position),
    };
  });
  const corner = (p) => ({ ...project(p), facing: facing(p, camera.position) });
  const mouth = { left: corner(probes.mouth.left), right: corner(probes.mouth.right) };
  const lines = core
    .characterCapsuleSideContour(probes.head.capsule, camera.position, 12)
    .map((line) => line.map(project).filter(Boolean))
    .filter((line) => line.length > 1)
    .sort((a, b) => mean(a.map((p) => p.x)) - mean(b.map((p) => p.x)));
  return { eyes, mouth, head: lines, camera };
}

const mean = (values) => values.reduce((s, v) => s + v, 0) / (values.length || 1);

function distanceToPolyline(p, line) {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/**
 * Residual slots of one crop under a model and a camera: one slot per measured number, in head
 * widths. A measured landmark is matched to whichever model landmark explains it best, because
 * which eye is which depends on the view.
 */
export function evaluate(core, shared, view, crop) {
  const size = { width: crop.rect.w, height: crop.rect.h };
  const model = predict(core, shared, view, size);
  const unit = headWidthPx(view);
  const slots = [];
  const push = (kind, label, px, weight = 1) => slots.push({ kind, label, value: px / unit, weight });
  const lm = crop.landmarks;

  const eyes = lm.eyes ?? [];
  if (eyes.length) {
    const options = eyes.length === 1 ? [[0], [1]] : [[0, 1], [1, 0]];
    const cost = (pick) => pick.reduce((s, m, j) => s + (model.eyes[m].centre.x - eyes[j].cx) ** 2 + (model.eyes[m].centre.y - eyes[j].cy) ** 2, 0);
    const pick = options.reduce((best, o) => (cost(o) < cost(best) ? o : best));
    eyes.forEach((e, j) => {
      const m = model.eyes[pick[j]];
      push('eye-centre', `eye ${j} x`, m.centre.x - e.cx);
      push('eye-centre', `eye ${j} y`, m.centre.y - e.cy);
      push('eye-radius', `eye ${j} radius`, m.radius - e.r, 0.5);
      if (e.pupil && m.pupil) {
        push('pupil', `pupil ${j} x`, m.pupil.x - e.pupil.cx);
        push('pupil', `pupil ${j} y`, m.pupil.y - e.pupil.cy);
      }
      push('hidden', `eye ${j} hidden`, Math.max(0, -m.facing - 0.05) * unit * 0.5);
    });
    // An eye the model shows but the measurement did not find: soft, because detection can miss an eye.
    model.eyes.forEach((m, k) => {
      if (!pick.includes(k)) push('unmatched', `model eye ${k} unmeasured`, Math.max(0, m.facing - 0.2) * unit * 0.15, 0.5);
    });
  }

  const mouth = lm.mouth;
  if (mouth) {
    const weight = mouth.kind === 'full' ? 1 : 0.5;
    const measured = [mouth.left, mouth.right];
    const options = [[model.mouth.left, model.mouth.right], [model.mouth.right, model.mouth.left]];
    const cost = (o) => o.reduce((s, p, j) => s + (p.x - measured[j].x) ** 2 + (p.y - measured[j].y) ** 2, 0);
    const pick = options.reduce((best, o) => (cost(o) < cost(best) ? o : best));
    measured.forEach((m, j) => {
      push('mouth-corner', `mouth corner ${j} x`, pick[j].x - m.x, weight);
      push('mouth-corner', `mouth corner ${j} y`, pick[j].y - m.y, weight);
      push('hidden', `mouth corner ${j} hidden`, Math.max(0, -pick[j].facing - 0.05) * unit * 0.5);
    });
  }

  const head = lm.head;
  if (head && model.head.length === 2) {
    const weight = head.rows >= 30 ? 1 : 0.3;
    [['left', 0], ['right', 1]].forEach(([side, k]) => {
      const e = head[side];
      push('head-edge', `head ${side} edge top`, distanceToPolyline({ x: e.x0, y: e.y0 }, model.head[k]), weight);
      push('head-edge', `head ${side} edge bottom`, distanceToPolyline({ x: e.x1, y: e.y1 }, model.head[k]), weight);
    });
  }
  // Keeps the field of view from wandering when the perspective cues are weak.
  slots.push({ kind: 'prior', label: 'field of view', value: ((view.fov - 25) / 25) * 0.02, weight: 1 });
  labelPriors(crop.view, view).forEach((value, i) => slots.push({ kind: 'prior', label: `view label ${i}`, value, weight: 1 }));
  return slots;
}

// ---------------------------------------------------------------------------------------------
// Least squares

const robust = (r) => {
  const s = r / ROBUST_DELTA;
  return Math.sign(r) * ROBUST_DELTA * Math.sqrt(2 * (Math.sqrt(1 + s * s) - 1));
};

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-18) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Levenberg–Marquardt over parameters scaled to [0, 1], with a numerical Jacobian. */
export function levenbergMarquardt(fn, u0, { maxIterations = 80 } = {}) {
  const n = u0.length;
  let u = u0.slice();
  let r = fn(u);
  let cost = r.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-2;
  const h = 1e-4;
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const columns = [];
    for (let k = 0; k < n; k++) {
      const up = u.slice(), um = u.slice();
      up[k] = Math.min(1, u[k] + h);
      um[k] = Math.max(0, u[k] - h);
      const rp = fn(up), rm = fn(um);
      const span = up[k] - um[k] || 1;
      columns.push(rp.map((v, i) => (v - rm[i]) / span));
    }
    const JTJ = columns.map((a) => columns.map((b) => a.reduce((s, v, i) => s + v * b[i], 0)));
    const g = columns.map((a) => a.reduce((s, v, i) => s + v * r[i], 0));
    let improved = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const A = JTJ.map((row, i) => row.map((v, j) => (i === j ? v + lambda * Math.max(v, 1e-9) : v)));
      const dx = solveLinear(A, g.map((v) => -v));
      if (dx) {
        const un = u.map((v, i) => Math.max(0, Math.min(1, v + dx[i])));
        const rn = fn(un);
        const cn = rn.reduce((s, v) => s + v * v, 0);
        if (cn < cost) {
          const gain = (cost - cn) / (cost || 1);
          u = un; r = rn; cost = cn;
          lambda = Math.max(lambda / 3, 1e-9);
          improved = gain > 1e-9;
          break;
        }
      }
      lambda *= 4;
    }
    if (!improved) break;
  }
  return { u, cost };
}

// ---------------------------------------------------------------------------------------------
// Fitting

function viewBounds(crop) {
  const initial = initialLogPpm(crop);
  return {
    yaw: [-120 * DEG, 120 * DEG],
    pitch: [-70 * DEG, 70 * DEG],
    fov: [10, 45],
    logPpm: [initial - 0.6, initial + 0.6],
    ox: [-crop.rect.w, crop.rect.w],
    oy: [-crop.rect.h, crop.rect.h],
  };
}

function initialLogPpm(crop) {
  const widthPx = crop.landmarks.head?.widthPx ?? crop.rect.h * 0.45;
  return Math.log(widthPx / (2 * BODY_RADIUS));
}

/** Starting cameras tried for a view label. Both signs of yaw and pitch are tried: the label does not say which way. */
export function startPoses(label) {
  const pose = (yaw, pitch) => ({ yaw: yaw * DEG, pitch: pitch * DEG });
  switch (label) {
    case 'front': return [pose(0, 0), pose(12, 0), pose(-12, 0)];
    case 'three-quarter': return [30, 45, 60].flatMap((y) => [pose(y, 0), pose(-y, 0)]);
    case 'profile': return [80, 90].flatMap((y) => [pose(y, 0), pose(-y, 0)]);
    case 'up': return [25, 45].flatMap((p) => [pose(0, -p), pose(0, p)]);
    case 'down': return [25, 45].flatMap((p) => [pose(0, p), pose(0, -p)]);
    default: return [pose(0, 0)];
  }
}

function initialView(core, shared, crop, pose) {
  const view = { yaw: pose.yaw, pitch: pose.pitch, fov: 25, logPpm: initialLogPpm(crop), ox: 0, oy: 0 };
  const size = { width: crop.rect.w, height: crop.rect.h };
  const measured = crop.landmarks.eyes ?? [];
  if (measured.length) {
    const model = predict(core, shared, view, size).eyes;
    const visible = model.filter((e) => e.facing > 0);
    const use = visible.length ? visible : model;
    view.ox = mean(measured.map((e) => e.cx)) - mean(use.map((e) => e.centre.x));
    view.oy = mean(measured.map((e) => e.cy)) - mean(use.map((e) => e.centre.y));
  } else {
    view.ox = crop.rect.w / 2;
    view.oy = crop.rect.h / 2;
  }
  return view;
}

/** Joint least squares over the listed crops; `freeShared` also frees the shared face parameters. */
function fit(core, crops, state, { freeShared, ids }) {
  const byId = new Map(crops.map((c) => [c.id, c]));
  const layout = [];
  if (freeShared) for (const p of SHARED_PARAMETERS) layout.push({ get: (s) => s.shared[p.key], set: (s, v) => { s.shared[p.key] = v; }, lo: p.lo, hi: p.hi });
  for (const id of ids) {
    const bounds = viewBounds(byId.get(id));
    for (const key of VIEW_KEYS) layout.push({ get: (s) => s.views[id][key], set: (s, v) => { s.views[id][key] = v; }, lo: bounds[key][0], hi: bounds[key][1] });
  }
  const apply = (u) => {
    const s = structuredClone(state);
    layout.forEach((p, i) => p.set(s, p.lo + u[i] * (p.hi - p.lo)));
    return s;
  };
  const u0 = layout.map((p) => Math.max(0, Math.min(1, (p.get(state) - p.lo) / (p.hi - p.lo))));
  const result = levenbergMarquardt((u) => {
    const s = apply(u);
    return ids.flatMap((id) => evaluate(core, s.shared, s.views[id], byId.get(id)).map((slot) => robust(slot.value * slot.weight)));
  }, u0);
  return { state: apply(result.u), cost: result.cost };
}

export function fitCamera(core, crop, shared) {
  let best = null;
  for (const pose of startPoses(crop.view)) {
    const state = { shared, views: { [crop.id]: initialView(core, shared, crop, pose) } };
    const fitted = fit(core, [crop], state, { freeShared: false, ids: [crop.id] });
    if (!best || fitted.cost < best.cost) best = { view: fitted.state.views[crop.id], cost: fitted.cost };
  }
  return best.view;
}

/** Summarises residuals of one crop: RMS over all slots and per landmark kind, in head widths. */
export function summarise(core, shared, view, crop) {
  const slots = evaluate(core, shared, view, crop).filter((s) => !['prior', 'hidden', 'unmatched'].includes(s.kind));
  const rms = (list) => Math.sqrt(mean(list.map((s) => (s.value * s.weight) ** 2)));
  const kinds = {};
  for (const kind of new Set(slots.map((s) => s.kind))) {
    const list = slots.filter((s) => s.kind === kind);
    kinds[kind] = { rms: round(rms(list)), max: round(Math.max(...list.map((s) => Math.abs(s.value * s.weight)))), count: list.length };
  }
  return { rms: round(rms(slots)), count: slots.length, freedom: slots.length - VIEW_KEYS.length, weak: slots.length - VIEW_KEYS.length < WEAK_FREEDOM, kinds };
}

/**
 * Fits one subject: the crops of its views. Returns the shared face parameters, one camera per
 * view, residuals per view and landmark kind, and the views flagged as inconsistent.
 */
export function solveSubject(core, crops) {
  const front = crops.find((c) => c.view === 'front') ?? crops[0];
  let state = { shared: startShared(), views: {} };
  state.views[front.id] = initialView(core, state.shared, front, startPoses(front.view)[0]);
  state = fit(core, crops, state, { freeShared: true, ids: [front.id] }).state;
  for (const crop of crops) if (crop.id !== front.id) state.views[crop.id] = fitCamera(core, crop, state.shared);
  const all = crops.map((c) => c.id);
  state = fit(core, crops, state, { freeShared: true, ids: all }).state;

  // A view is judged by how well the other views predict it: shared parameters fitted without it,
  // then only its camera fitted. An in-sample residual alone would reward a flexible camera.
  const heldOut = {};
  for (const crop of crops) {
    const others = all.filter((id) => id !== crop.id);
    const without = fit(core, crops, { shared: state.shared, views: Object.fromEntries(others.map((id) => [id, state.views[id]])) }, { freeShared: true, ids: others }).state;
    heldOut[crop.id] = summarise(core, without.shared, fitCamera(core, crop, without.shared), crop).rms;
  }
  const flagged = flagViews(crops, heldOut);
  if (flagged.length && flagged.length < crops.length - 1) {
    const kept = all.filter((id) => !flagged.includes(id));
    state = fit(core, crops, state, { freeShared: true, ids: kept }).state;
    for (const id of flagged) state.views[id] = fitCamera(core, crops.find((c) => c.id === id), state.shared);
  }
  const views = {};
  for (const crop of crops) {
    views[crop.id] = {
      camera: Object.fromEntries(VIEW_KEYS.map((k) => [k, round(state.views[crop.id][k], 5)])),
      residual: summarise(core, state.shared, state.views[crop.id], crop),
      heldOutRms: heldOut[crop.id],
      flagged: flagged.includes(crop.id),
    };
  }
  return {
    shared: Object.fromEntries(Object.entries(state.shared).map(([k, v]) => [k, round(v, 5)])),
    atBound: SHARED_PARAMETERS.filter((p) => state.shared[p.key] - p.lo < 1e-3 * (p.hi - p.lo) || p.hi - state.shared[p.key] < 1e-3 * (p.hi - p.lo)).map((p) => p.key),
    views,
    flagged,
    state,
  };
}

/** Ids of the views whose held-out RMS is high in absolute terms or against the other views. */
export function flagViews(crops, rmsById) {
  return crops
    .filter((c) => {
      const others = crops.filter((o) => o.id !== c.id).map((o) => rmsById[o.id]).sort((a, b) => a - b);
      const median = others.length ? others[Math.floor(others.length / 2)] : 0;
      const high = rmsById[c.id] > FLAG_RMS_LIMIT;
      const outlier = rmsById[c.id] > FLAG_MEDIAN_FACTOR * Math.max(median, FLAG_MEDIAN_FLOOR);
      return high || outlier;
    })
    .map((c) => c.id);
}

// ---------------------------------------------------------------------------------------------
// Synthetic measurements

/** Small seeded generator (mulberry32) with Gaussian samples, so synthetic runs repeat exactly. */
export function seededNoise(seed) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform() || 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

/**
 * Builds a measured crop from known parameters, in the shape the measurement script writes, with
 * Gaussian noise of `noisePx` pixels added to every coordinate and radius.
 */
export function synthesizeCrop(core, { id, label, shared, view, size, noisePx = 0, gauss = () => 0 }) {
  const model = predict(core, shared, view, size);
  const n = () => gauss() * noisePx;
  const eyes = model.eyes
    .filter((e) => e.facing > 0.1)
    .sort((a, b) => a.centre.x - b.centre.x)
    .map((e) => ({ cx: e.centre.x + n(), cy: e.centre.y + n(), r: e.radius + n(), pupil: { cx: e.pupil.x + n(), cy: e.pupil.y + n() } }));
  const corners = [model.mouth.left, model.mouth.right].filter((c) => c.facing > 0.2).sort((a, b) => a.x - b.x);
  const mouth = corners.length === 2 ? { left: { x: corners[0].x + n(), y: corners[0].y + n() }, right: { x: corners[1].x + n(), y: corners[1].y + n() }, kind: 'full' } : undefined;
  const at = (line, t) => {
    const k = Math.round(t * (line.length - 1));
    return line[k];
  };
  const edge = (line) => ({ x0: at(line, 0.3).x + n(), y0: at(line, 0.3).y + n(), x1: at(line, 0.7).x + n(), y1: at(line, 0.7).y + n() });
  const head = model.head.length === 2
    ? { left: edge(model.head[0]), right: edge(model.head[1]), widthPx: Math.abs(at(model.head[1], 0.5).x - at(model.head[0], 0.5).x), rows: 60 }
    : undefined;
  return { id, view: label, rect: { x: 0, y: 0, w: size.width, h: size.height }, landmarks: { eyes, head, mouth }, flags: [] };
}

// ---------------------------------------------------------------------------------------------
// Report and board

function modelOverlay(model, width, height) {
  const parts = [];
  const orange = '#ff8a00';
  for (const e of model.eyes) {
    if (!e.ellipse || e.facing < 0) continue;
    const { center, semiMajor, semiMinor, angle } = e.ellipse;
    parts.push(`<ellipse cx="${center.x}" cy="${center.y}" rx="${semiMajor}" ry="${semiMinor}" transform="rotate(${(angle * 180) / Math.PI} ${center.x} ${center.y})" fill="none" stroke="${orange}" stroke-width="2.5"/>`);
    if (e.pupil) parts.push(`<path d="M${e.pupil.x - 7} ${e.pupil.y}H${e.pupil.x + 7}M${e.pupil.x} ${e.pupil.y - 7}V${e.pupil.y + 7}" stroke="${orange}" stroke-width="2.5"/>`);
  }
  for (const line of model.head) {
    parts.push(`<polyline points="${line.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${orange}" stroke-width="2.5" stroke-dasharray="6 4"/>`);
  }
  for (const c of [model.mouth.left, model.mouth.right]) {
    if (c.facing > 0) parts.push(`<rect x="${c.x - 4}" y="${c.y - 4}" width="8" height="8" fill="${orange}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`;
}

function measuredOverlay(crop, width, height) {
  const parts = [];
  for (const e of crop.landmarks.eyes ?? []) {
    parts.push(`<circle cx="${e.cx}" cy="${e.cy}" r="${e.r}" fill="none" stroke="#00b7ff" stroke-width="1.5"/>`);
    if (e.pupil) parts.push(`<circle cx="${e.pupil.cx}" cy="${e.pupil.cy}" r="3" fill="#ff2bd6"/>`);
  }
  const head = crop.landmarks.head;
  if (head) for (const s of [head.left, head.right]) parts.push(`<line x1="${s.x0}" y1="${s.y0}" x2="${s.x1}" y2="${s.y1}" stroke="#18c418" stroke-width="3"/>`);
  const mouth = crop.landmarks.mouth;
  if (mouth) for (const p of [mouth.left, mouth.right]) parts.push(`<circle cx="${p.x}" cy="${p.y}" r="3" fill="#ff3b1f"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`;
}

const escapeXml = (text) => String(text).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);

/** Writes a board of each concept crop with the measured landmarks (thin blue, pink, green, red) and the fitted model's landmarks (orange). */
export async function writeBoard({ core, results, cropsByName, cropDir, outFile, sharp }) {
  const cellW = 340, imgH = 440, textH = 64, header = 30;
  const subjects = Object.keys(results);
  const views = ['front', 'three-quarter', 'profile', 'up', 'down'];
  const parts = [];
  for (const [row, subject] of subjects.entries()) {
    for (const crop of cropsByName[subject]) {
      const col = views.indexOf(crop.view);
      const file = path.join(cropDir, `${crop.id}.png`);
      if (col < 0 || !fs.existsSync(file)) continue;
      const result = results[subject];
      const model = predict(core, result.state.shared, result.state.views[crop.id], { width: crop.rect.w, height: crop.rect.h });
      const drawn = await sharp(file)
        .composite([
          { input: Buffer.from(measuredOverlay(crop, crop.rect.w, crop.rect.h)) },
          { input: Buffer.from(modelOverlay(model, crop.rect.w, crop.rect.h)) },
        ])
        .png().toBuffer();
      const scale = Math.min(cellW / crop.rect.w, imgH / crop.rect.h);
      const img = await sharp(drawn).resize(Math.round(crop.rect.w * scale), Math.round(crop.rect.h * scale)).png().toBuffer();
      parts.push({ input: img, left: col * cellW, top: header + row * (imgH + textH) });
      const v = result.views[crop.id];
      const lines = [`${crop.id}${v.flagged ? ' — FLAGGED' : ''}`, `RMS ${v.residual.rms} head widths`, `yaw ${round(v.camera.yaw / DEG, 1)}° pitch ${round(v.camera.pitch / DEG, 1)}° fov ${round(v.camera.fov, 1)}°`];
      const text = lines.map((t, k) => `<text x="6" y="${16 + k * 15}" font-family="Arial" font-size="${k ? 11 : 13}" fill="${v.flagged ? '#b00020' : '#222'}">${escapeXml(t)}</text>`).join('');
      parts.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cellW}" height="${textH}">${text}</svg>`), left: col * cellW, top: header + row * (imgH + textH) + imgH });
    }
  }
  const legend = '<text x="8" y="20" font-family="Arial" font-size="14" fill="#222">orange: fitted model (eye outline, pupil cross, head edges, mouth corners) · blue/pink/green/red: measured concept landmarks</text>';
  parts.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${views.length * cellW}" height="${header}">${legend}</svg>`), left: 0, top: 0 });
  await sharp({ create: { width: views.length * cellW, height: header + subjects.length * (imgH + textH), channels: 3, background: '#ffffff' } })
    .composite(parts).png().toFile(outFile);
}

/** Fits every subject in a measured spec and returns the report (without the internal state). */
export async function fitSpec(spec, core) {
  const bySubject = {};
  for (const crop of spec.crops) (bySubject[crop.subject] ??= []).push(crop);
  const results = {};
  for (const [subject, crops] of Object.entries(bySubject)) results[subject] = solveSubject(core, crops);
  const report = {
    schema: 1,
    sheet: spec.sheet,
    units: 'Residuals in head widths (pixels divided by the fitted pixel size of one head width). Camera yaw and pitch in radians; fov in degrees; logPpm is ln(pixels per metre); ox and oy are image offsets in crop pixels.',
    thresholds: { flagRmsLimit: FLAG_RMS_LIMIT, flagMedianFactor: FLAG_MEDIAN_FACTOR, flagMedianFloor: FLAG_MEDIAN_FLOOR, robustDelta: ROBUST_DELTA, provisional: true },
    subjects: Object.fromEntries(Object.entries(results).map(([subject, r]) => [subject, {
      shared: r.shared,
      atBound: r.atBound,
      flagged: r.flagged,
      consistent: r.flagged.length <= 1,
      views: r.views,
    }])),
  };
  return { report, results, bySubject };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const specPath = arg('--spec');
  if (!specPath) {
    console.error('usage: node tools/concept-fitting/fit.mjs --spec <measured-spec.json> [--crops <dir>] [--out <dir>]');
    process.exit(2);
  }
  const specDir = path.dirname(path.resolve(specPath));
  const outDir = path.resolve(arg('--out') ?? specDir);
  const cropDir = path.resolve(arg('--crops') ?? path.join(specDir, 'crops'));
  const core = await loadCore();
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const { report, results, bySubject } = await fitSpec(spec, core);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'fit-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const { default: sharp } = await import('sharp');
  await writeBoard({ core, results, cropsByName: bySubject, cropDir, outFile: path.join(outDir, 'fit-board.png'), sharp });
  for (const [subject, r] of Object.entries(report.subjects)) {
    console.log(`${subject}: ${r.consistent ? 'consistent' : 'INCONSISTENT'}, flagged ${r.flagged.join(', ') || 'none'}`);
    for (const [id, v] of Object.entries(r.views)) console.log(`  ${id}: rms ${v.residual.rms}${v.flagged ? ' FLAGGED' : ''}`);
  }
}
