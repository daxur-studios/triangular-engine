// Preset regression (plan 088): prints the face probe ratios of every character preset and fails
// when one has drifted from the accepted table, so a shared change cannot alter a face unseen.
//
//   node tools/concept-fitting/preset-ratios.mjs [--accept] [--spec <measured-spec.json>]
//
// All ratios are in head widths (twice the body radius), read from the model's own probes at a
// neutral pose with the DNA's gaze asymmetry applied. `--accept` rewrites the baseline after a
// reviewed change. `--spec` also gates the concept-fit presets against the measurements.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore } from './load-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BASELINE_FILE = path.join(here, 'preset-ratios.baseline.json');
/** A ratio may move this far (in head widths, or in ratio units) before it counts as drift. */
export const DRIFT_TOLERANCE = 0.002;

const len = (v) => Math.hypot(v.x, v.y, v.z);
const round = (v, n = 4) => Math.round(v * 10 ** n) / 10 ** n;

/** Face probe ratios of one DNA, in head widths. */
export function ratiosOf(core, dna) {
  const asymYaw = (dna.gazeAsymmetryYaw ?? 0) * 0.5;
  const asymPitch = (dna.gazeAsymmetryPitch ?? 0) * 0.5;
  const rest = { yaw: dna.gazeRestYaw ?? 0, pitch: dna.gazeRestPitch ?? 0 };
  const p = core.computeCapsuleFaceProbes(dna, {
    leftEye: { gazeYaw: rest.yaw - asymYaw, gazePitch: rest.pitch - asymPitch, pupilScale: dna.pupilScale },
    rightEye: { gazeYaw: rest.yaw + asymYaw, gazePitch: rest.pitch + asymPitch, pupilScale: dna.pupilScale },
  });
  const w = 2 * dna.bodyRadius;
  const radius = (e) => len(e.sclera.axes[0]);
  const off = (e, axis) => (e.pupilCenter[axis] - e.sclera.center[axis]) / radius(e);
  const mid = (a, b) => (a + b) / 2;
  const capsuleHeight = Math.abs(p.head.capsule.end.y - p.head.capsule.start.y) + 2 * dna.bodyRadius;
  return {
    eyeSeparation: round(Math.abs(p.leftEye.sclera.center.x - p.rightEye.sclera.center.x) / w),
    eyeHeightAboveTop: round((p.head.topY - mid(p.leftEye.sclera.center.y, p.rightEye.sclera.center.y)) / w),
    eyeRadius: round(mid(radius(p.leftEye), radius(p.rightEye)) / w),
    eyeRadiusLeftOverRight: round(radius(p.leftEye) / radius(p.rightEye)),
    eyeHeightDifference: round((p.leftEye.sclera.center.y - p.rightEye.sclera.center.y) / w),
    // Right minus left, so opposite gaze on the two eyes adds up instead of cancelling.
    pupilSpreadYaw: round(off(p.rightEye, 'x') - off(p.leftEye, 'x')),
    pupilSpreadPitch: round(off(p.rightEye, 'y') - off(p.leftEye, 'y')),
    mouthWidth: round(Math.abs(p.mouth.right.x - p.mouth.left.x) / w),
    mouthHeightBelowEyes: round((mid(p.leftEye.sclera.center.y, p.rightEye.sclera.center.y) - p.mouth.center.y) / w),
    bodyAspect: round(capsuleHeight / w),
  };
}

/** Ratios for every preset, keyed by preset id. */
export function ratioTable(core) {
  return Object.fromEntries(core.ALL_CAPSULE_CHARACTER_PRESETS.map((dna) => [dna.id, ratiosOf(core, dna)]));
}

/** Differences between a table and the accepted one: added, removed and moved entries. */
export function drift(table, accepted, tolerance = DRIFT_TOLERANCE) {
  const out = [];
  for (const id of Object.keys(table)) {
    if (!accepted[id]) { out.push(`${id}: not in the accepted table`); continue; }
    for (const [key, value] of Object.entries(table[id])) {
      const was = accepted[id][key];
      if (was === undefined) out.push(`${id}.${key}: not in the accepted table`);
      else if (Math.abs(value - was) > tolerance) out.push(`${id}.${key}: ${was} -> ${value}`);
    }
  }
  for (const id of Object.keys(accepted)) if (!table[id]) out.push(`${id}: in the accepted table but no longer a preset`);
  return out;
}

/** The fit's shared parameters that a DNA can express; mouth width is pose, so the fit's own is kept. */
export function sharedFromDna(dna, fitted) {
  return {
    ...fitted,
    bodyHeight: dna.bodyHeight,
    eyeSpacing: dna.eyeSpacing,
    eyeScale: dna.eyeScale,
    eyeSizeAsymmetry: dna.eyeSizeAsymmetry,
    eyeHeightAsymmetry: dna.eyeHeightAsymmetry,
    gazeYawLeft: dna.gazeRestYaw - dna.gazeAsymmetryYaw / 2,
    gazeYawRight: dna.gazeRestYaw + dna.gazeAsymmetryYaw / 2,
    gazePitchLeft: dna.gazeRestPitch - dna.gazeAsymmetryPitch / 2,
    gazePitchRight: dna.gazeRestPitch + dna.gazeAsymmetryPitch / 2,
  };
}

/**
 * Gates each concept-fit preset against the measurements, with the fitted cameras held fixed, using
 * the calibrated rule.
 */
export async function gateConceptPresets(core, specPath) {
  const { fitSpec, dnaFrom } = await import('./fit.mjs');
  const { gateResidual, gateFailures } = await import('./calibrate.mjs');
  const { results, bySubject } = await fitSpec(JSON.parse(fs.readFileSync(specPath, 'utf8')), core);
  const out = {};
  for (const [subject, crops] of Object.entries(bySubject)) {
    const dna = core.ALL_CAPSULE_CHARACTER_PRESETS.find((p) => p.id === `concept-fit-${subject}`);
    if (!dna) continue;
    const views = results[subject].state.views;
    const good = gateResidual(core, results[subject].shared, crops, views);
    const preset = gateResidual(core, sharedFromDna(dna, results[subject].shared), crops, views);
    out[subject] = { good: good.kinds, preset: preset.kinds, failedKinds: gateFailures(good, preset) };
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const core = await loadCore();
  const table = ratioTable(core);
  const keys = Object.keys(Object.values(table)[0]);
  console.log(['preset'.padEnd(30), ...keys.map((k) => k.slice(0, 11).padStart(11))].join(' '));
  for (const [id, r] of Object.entries(table)) console.log([id.padEnd(30), ...keys.map((k) => String(r[k]).padStart(11))].join(' '));
  if (arg('--spec')) {
    const gates = await gateConceptPresets(core, arg('--spec'));
    console.log('\nconcept-fit presets against the measurements (fitted cameras held; fail = a kind more than the gate factor above its fit):');
    for (const [subject, g] of Object.entries(gates)) {
      console.log(`  ${subject}: ${g.failedKinds.length ? 'FAILS on ' + g.failedKinds.join(', ') : 'passes'}`);
      console.log(`    fit    ${JSON.stringify(g.good)}`);
      console.log(`    preset ${JSON.stringify(g.preset)}`);
    }
  }
  if (args.includes('--accept')) {
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify({ schema: 1, tolerance: DRIFT_TOLERANCE, presets: table }, null, 2)}\n`);
    console.log(`accepted ${Object.keys(table).length} presets -> ${path.relative(process.cwd(), BASELINE_FILE)}`);
  } else {
    const accepted = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).presets;
    const moved = drift(table, accepted);
    if (moved.length) { console.error(`\nDRIFT in ${moved.length} ratios:\n  ${moved.join('\n  ')}`); process.exitCode = 1; }
    else console.log(`\nno drift across ${Object.keys(table).length} presets`);
  }
}
