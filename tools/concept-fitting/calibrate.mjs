// Calibration of the concept-fit gate (plan 088, phase 4).
//
// Each fitted head is the "good" case. Deliberately wrong variants of it (one parameter moved by a
// stated amount, every other parameter kept) are held fixed while only the per-view cameras are
// refitted, and the residuals against the real measurements are compared. A usable gate needs
// every wrong variant to be worse than every good head.
//
//   node tools/concept-fitting/calibrate.mjs --spec <measured-spec.json> [--out <file>]
import fs from 'node:fs';
import path from 'node:path';
import { loadCore } from './load-core.mjs';
import { BODY_RADIUS, fitCamera, fitSpec, summarise } from './fit.mjs';

const HEAD_WIDTH = 2 * BODY_RADIUS;
const round = (v, n = 4) => Math.round(v * 10 ** n) / 10 ** n;
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/** Lateral eye position (metres) for an eyeSpacing, read from the model's own probes. */
function eyeX(core, shared, dnaFrom) {
  const p = core.computeCapsuleFaceProbes(dnaFrom(core, shared), {
    mouth: { ...core.CAPSULE_NEUTRAL_MOUTH, mouthWidth: shared.mouthWidth },
    leftEye: { gazeYaw: 0, gazePitch: 0, pupilScale: 0.28 },
    rightEye: { gazeYaw: 0, gazePitch: 0, pupilScale: 0.28 },
  });
  return Math.abs(p.leftEye.placement.position.x);
}

export function variantsOf(core, shared, dnaFrom) {
  const out = [];
  // Eye moved sideways by 10% of head width: solve eyeSpacing from the model's own geometry.
  const x0 = eyeX(core, shared, dnaFrom);
  const slope = (eyeX(core, { ...shared, eyeSpacing: shared.eyeSpacing + 0.01 }, dnaFrom) - x0) / 0.01;
  for (const sign of [1, -1]) {
    out.push({ id: `eye-moved-${sign > 0 ? 'out' : 'in'}-10pct`, shared: { ...shared, eyeSpacing: shared.eyeSpacing + (sign * 0.1 * HEAD_WIDTH) / slope } });
  }
  for (const f of [1.15, 0.85]) out.push({ id: `eye-radius-${f > 1 ? 'plus' : 'minus'}-15pct`, shared: { ...shared, eyeScale: shared.eyeScale * f } });
  out.push({ id: 'pupil-offset-yaw-0.3', shared: { ...shared, gazeYawLeft: shared.gazeYawLeft + 0.3, gazeYawRight: shared.gazeYawRight + 0.3 } });
  out.push({ id: 'pupil-offset-pitch-0.3', shared: { ...shared, gazePitchLeft: shared.gazePitchLeft + 0.3, gazePitchRight: shared.gazePitchRight + 0.3 } });
  for (const f of [1.1, 0.9]) out.push({ id: `head-aspect-${f > 1 ? 'taller' : 'shorter'}-10pct`, shared: { ...shared, bodyHeight: shared.bodyHeight * f } });
  return out;
}

/** Landmark kinds the gate judges. Each is compared with the same kind in the head's own fit. */
export const GATE_KINDS = ['eye-centre', 'eye-radius', 'pupil', 'mouth-corner', 'head-edge'];
/** A model fails when any kind's mean RMS exceeds the fitted head's by this factor... */
export const GATE_FACTOR = 1.25;
/** ...and by at least this many head widths, so a near-zero kind cannot trip on rounding. */
export const GATE_MIN_RISE = 0.003;

/** Mean RMS per landmark kind of a shared model against all crops, with the fitted cameras held fixed. */
export function gateResidual(core, shared, crops, views) {
  const per = crops.map((crop) => summarise(core, shared, views[crop.id], crop));
  const kinds = Object.fromEntries(GATE_KINDS.map((k) => [k, round(mean(per.map((p) => p.kinds[k]?.rms ?? 0)))]));
  return { mean: round(mean(per.map((p) => p.rms))), kinds };
}

/** Compares a model's per-kind residuals with the fitted head's; returns the kinds that fail. */
export function gateFailures(good, test) {
  return GATE_KINDS.filter((k) => test.kinds[k] > good.kinds[k] * GATE_FACTOR && test.kinds[k] - good.kinds[k] >= GATE_MIN_RISE);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\//, ''))) {
  const args = process.argv.slice(2);
  const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const core = await loadCore();
  const { dnaFrom } = await import('./fit.mjs');
  const spec = JSON.parse(fs.readFileSync(arg('--spec'), 'utf8'));
  const { results, bySubject } = await fitSpec(spec, core);
  const report = { subjects: {} };
  for (const [subject, crops] of Object.entries(bySubject)) {
    const shared = results[subject].shared;
    const views = results[subject].state.views;
    const good = gateResidual(core, shared, crops, views);
    const variants = variantsOf(core, shared, dnaFrom).map((v) => {
      const r = gateResidual(core, v.shared, crops, views);
      const failed = gateFailures(good, r);
      const ratio = Math.max(...GATE_KINDS.map((k) => (good.kinds[k] ? r.kinds[k] / good.kinds[k] : 1)));
      return { id: v.id, ...r, failedKinds: failed, worstKindRatio: round(ratio, 2) };
    });
    report.subjects[subject] = { good, variants };
    console.log(`${subject}: good ${JSON.stringify(good.kinds)}`);
    for (const v of variants) console.log(`  ${v.id}: ${v.failedKinds.length ? 'FAILS on ' + v.failedKinds.join(', ') : 'PASSES (bad)'}  worst kind x${v.worstKindRatio}`);
  }
  if (arg('--out')) fs.writeFileSync(arg('--out'), `${JSON.stringify(report, null, 2)}\n`);
}
