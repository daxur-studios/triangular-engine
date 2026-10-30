import type { FanMode } from './morph-fan';
import { poseOf, type MorphPose } from './morph-frame';

/**
 * Plan 059 morph spike, iteration 5: the fan rebuild counter. A scripted run draws frames through the page's own upload path (selection,
 * pack, fan) with the fan on and counts how often the fan was built, and what the builds cost on the CPU, while the camera moves and
 * while the morph changes. The CPU fan (iteration 4) is built for the camera and the morph, so it rebuilds as they move. The vertex-stage fan
 * (iteration 5) is built from the pole leaf set, the edge masks, the rays, the radius and the projection centre only: it must not rebuild
 * for a camera or a morph change. A projection-centre change is the third phase and is reported, not judged: it rebuilds both (the polar
 * longitudes and colatitudes are measured in the projection basis).
 *
 * The run is fair to a rebuild that a changed leaf set justifies: each frame the host reports the pole leaf set's signature, and the row
 * counts how often it changed. The script holds the leaf set (a camera moving round the pole at the same distance, a morph change under the
 * sphere metric, whose selection does not read the morph), and a row whose leaf set changed in the camera or morph phase says so.
 */

/** What a frame of the script sets. */
export interface FanRebuildStep {
  readonly radiusM: number;
  readonly morph: number;
  readonly centreLonDeg: number;
  readonly centreLatDeg: number;
  readonly pose: MorphPose;
}

/** What the host reports after drawing a frame. */
export interface FanRebuildFrame {
  /** Builds of the fan and their CPU milliseconds since the run began. */
  readonly rebuilds: number;
  readonly buildMsTotal: number;
  /** The pole leaf set of the frame (`fanLeafSignature`). */
  readonly signature: string;
  readonly vertices: number;
  readonly triangles: number;
}

/** The page's side of the run. */
export interface FanRebuildHost {
  /** Starts a run: the fan on in `mode` with `rays`, a fresh selector, the fan counters at zero. */
  begin(mode: FanMode, rays: number): void;
  /** Draws one frame (applies the step, selects, uploads) and reports the fan. */
  frame(step: FanRebuildStep): FanRebuildFrame;
  /** Puts the page back as it was. */
  end(): void;
}

/** One phase of the run: frames drawn, builds and CPU milliseconds in it, and how often the pole leaf set changed. */
export interface FanRebuildPhase {
  readonly frames: number;
  readonly rebuilds: number;
  readonly buildMs: number;
  readonly leafSetChanges: number;
}

/** One row: a fan mode at one radius and projection centre. */
export interface FanRebuildRow {
  readonly mode: FanMode;
  readonly radiusM: number;
  readonly centreLonDeg: number;
  readonly centreLatDeg: number;
  readonly rays: number;
  readonly vertices: number;
  readonly triangles: number;
  /** The first frame (the build the fan cannot avoid). */
  readonly initial: FanRebuildPhase;
  /** The camera moving round the pole, then the morph changing from 0.5 to 1 and back to 0.25. */
  readonly camera: FanRebuildPhase;
  readonly morph: FanRebuildPhase;
  /** The projection centre moved by 5 degrees of longitude: reported, not judged. */
  readonly centre: FanRebuildPhase;
  /** Builds and CPU milliseconds of the camera and morph phases together, and per build. */
  readonly moveRebuilds: number;
  readonly moveBuildMs: number;
  readonly moveBuildMsPerRebuild: number;
  /** The pole leaf set changed in the camera or morph phase (the script is then not holding what it should). */
  readonly moveLeafSetChanges: number;
}

/** Options of {@link runFanRebuildProbe}. */
export interface FanRebuildOptions {
  readonly radii?: readonly number[];
  readonly centres?: readonly { readonly lonDeg: number; readonly latDeg: number }[];
  readonly modes?: readonly FanMode[];
  readonly rays?: number;
  /** Frames of each moving phase. */
  readonly frames?: number;
  readonly onProgress?: (done: number, total: number, row: FanRebuildRow) => void;
}

/** The run's defaults: both modes, the centred and the tilted centre, 6,371 km, 1,024 rays, 60 frames per phase. */
export const FAN_REBUILD_DEFAULTS = {
  radii: [6_371_000] as readonly number[],
  centres: [{ lonDeg: 0, latDeg: 0 }, { lonDeg: 20, latDeg: 35 }] as readonly { lonDeg: number; latDeg: number }[],
  modes: ['vertex', 'cpu'] as readonly FanMode[],
  rays: 1024,
  frames: 60,
};

/** Frames the pole leaf set must hold unchanged before the camera phase starts, and the most frames waited for that. */
export const FAN_SETTLE_FRAMES = 6;
export const FAN_SETTLE_LIMIT = 80;

/** The camera pose of frame `i` of `n` of the camera phase: round the pole, 15 degrees of longitude, the altitude from 200 m to 170 m, the heading turning 30 degrees. */
export function cameraStepPose(base: MorphPose, i: number, n: number): MorphPose {
  const t = n <= 1 ? 0 : i / (n - 1);
  return { ...base, lonDeg: base.lonDeg + 15 * t, altitudeM: base.altitudeM - 30 * t, headingDeg: base.headingDeg + 30 * t };
}

/** The morph of frame `i` of `n` of the morph phase: 0.5 to 1 in the first half, back to 0.25 in the second. */
export function morphStepValue(i: number, n: number): number {
  const t = n <= 1 ? 0 : i / (n - 1);
  return t <= 0.5 ? 0.5 + t : 1 - (t - 0.5) * 1.5;
}

/** Runs the scripted camera move and morph change for every mode, radius and centre. */
export async function runFanRebuildProbe(host: FanRebuildHost, options: FanRebuildOptions = {}): Promise<FanRebuildRow[]> {
  const radii = options.radii ?? FAN_REBUILD_DEFAULTS.radii;
  const centres = options.centres ?? FAN_REBUILD_DEFAULTS.centres;
  const modes = options.modes ?? FAN_REBUILD_DEFAULTS.modes;
  const rays = options.rays ?? FAN_REBUILD_DEFAULTS.rays;
  const frames = options.frames ?? FAN_REBUILD_DEFAULTS.frames;
  const total = radii.length * centres.length * modes.length;
  const rows: FanRebuildRow[] = [];
  for (const radiusM of radii) {
    for (const centre of centres) {
      for (const mode of modes) {
        host.begin(mode, rays);
        try {
          const base = poseOf('pole-200m', radiusM, 0.5);
          const state: { last?: FanRebuildFrame; signature?: string } = {};
          const run = (step: FanRebuildStep, count: number, pose: (i: number) => MorphPose, morph: (i: number) => number, centreOf: (i: number) => number): FanRebuildPhase => {
            const startRebuilds = state.last?.rebuilds ?? 0;
            const startMs = state.last?.buildMsTotal ?? 0;
            let changes = 0;
            for (let i = 0; i < count; i++) {
              const frame = host.frame({ ...step, pose: pose(i), morph: morph(i), centreLonDeg: step.centreLonDeg + centreOf(i) });
              if (state.signature !== undefined && frame.signature !== state.signature) changes++;
              state.signature = frame.signature;
              state.last = frame;
            }
            return { frames: count, rebuilds: (state.last?.rebuilds ?? 0) - startRebuilds, buildMs: (state.last?.buildMsTotal ?? 0) - startMs, leafSetChanges: changes };
          };
          const step: FanRebuildStep = { radiusM, morph: 0.5, centreLonDeg: centre.lonDeg, centreLatDeg: centre.latDeg, pose: base };
          const initial = run(step, 1, () => base, () => 0.5, () => 0);
          // The selector refines over the first frames; the camera phase starts once the pole leaf set has held for a few frames.
          for (let settled = 0, guard = 0; settled < FAN_SETTLE_FRAMES && guard < FAN_SETTLE_LIMIT; guard++) {
            const before = state.signature;
            run(step, 1, () => base, () => 0.5, () => 0);
            settled = state.signature === before ? settled + 1 : 0;
          }
          const camera = run(step, frames, (i) => cameraStepPose(base, i, frames), () => 0.5, () => 0);
          const morph = run(step, frames, () => base, (i) => morphStepValue(i, frames), () => 0);
          const centrePhase = run(step, 3, () => base, () => 0.5, (i) => 5 * (i > 0 ? 1 : 0));
          const moveRebuilds = camera.rebuilds + morph.rebuilds;
          const moveBuildMs = camera.buildMs + morph.buildMs;
          const row: FanRebuildRow = {
            mode, radiusM, centreLonDeg: centre.lonDeg, centreLatDeg: centre.latDeg, rays, vertices: state.last?.vertices ?? 0, triangles: state.last?.triangles ?? 0,
            initial, camera, morph, centre: centrePhase, moveRebuilds, moveBuildMs, moveBuildMsPerRebuild: moveRebuilds ? moveBuildMs / moveRebuilds : 0,
            moveLeafSetChanges: camera.leafSetChanges + morph.leafSetChanges,
          };
          rows.push(row);
          options.onProgress?.(rows.length, total, row);
        } finally {
          host.end();
        }
        await new Promise<void>((resolve) => setTimeout(resolve));
      }
    }
  }
  return rows;
}
