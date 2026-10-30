import type { TestContext, TestRunAdapter, TestScenario, TestSetting } from 'triangular-engine/testing';
import type { CrackCase, CrackProbeOptions, CrackRow, FanProbeOptions, FanProbeRow, FanRebuildOptions, FanRebuildRow, MorphSpikeState, ProbeOptions, ProbeResult } from './core';
import {
  crackObservation, fanPrecisionObservation, fanProbeOptionsOf, fanRebuildObservation, precisionObservation, type MorphSpikeTestSettings,
} from './morph-spike-tests';

/** The page as the adapter sees it: the spike's own handles, nothing else. */
export interface MorphSpikeTestHost {
  /** The spike's state (`getState`). */
  read(): MorphSpikeState;
  /** Sets the spike's state (`setState`). */
  apply(patch: Partial<MorphSpikeState>): void;
  /** True once the scene has drawn a frame, so a probe has a renderer, a camera and a compiled pipeline to work with. */
  ready(): boolean;
  backendIsWebGpu(): boolean;
  runProbe(options: ProbeOptions): Promise<ProbeResult[]>;
  runCrackProbe(options: CrackProbeOptions): Promise<CrackRow[]>;
  /** The vertex-stage pole fan's precision probe (v6). */
  runFanProbe(options: FanProbeOptions): Promise<FanProbeRow[]>;
  /** The scripted camera move and morph change that counts the pole fan's rebuilds (v6). */
  runFanRebuild(options: FanRebuildOptions): Promise<FanRebuildRow[]>;
  environment(): Readonly<Record<string, TestSetting>>;
}

const READY_TIMEOUT_MS = 30_000;
const THUMBNAIL_WIDTH_PX = 320;
const THUMBNAIL_QUALITY = 0.6;

/** The probe image a thumbnail is made from: the one case of a scenario that shows the most. */
interface KeptImage {
  readonly score: number;
  readonly c: CrackCase;
  readonly rgba: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** The case a scenario's still is taken of: a real case at morph 0.5, the pole edge first. */
export function thumbnailScore(c: CrackCase): number {
  if (c.control) return 0;
  return 1 + (c.morph === 0.5 ? 2 : 0) + (c.view === 'pole-200m' ? 4 : 0);
}

/** Draws a probe image (row 0 on top unless `flipY`) into a small WebP. Undefined where the browser has no canvas encoder. */
async function imageBlob(image: KeptImage, flipY: boolean): Promise<Blob | undefined> {
  const full = document.createElement('canvas');
  full.width = image.width;
  full.height = image.height;
  const fullContext = full.getContext('2d');
  if (!fullContext) return undefined;
  fullContext.putImageData(new ImageData(image.rgba as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
  const small = document.createElement('canvas');
  small.width = THUMBNAIL_WIDTH_PX;
  small.height = Math.max(1, Math.round((THUMBNAIL_WIDTH_PX * image.height) / image.width));
  const smallContext = small.getContext('2d');
  if (!smallContext) return undefined;
  if (flipY) {
    smallContext.translate(0, small.height);
    smallContext.scale(1, -1);
  }
  smallContext.drawImage(full, 0, 0, small.width, small.height);
  return new Promise<Blob | undefined>((resolve) => small.toBlob((blob) => resolve(blob ?? undefined), 'image/webp', THUMBNAIL_QUALITY));
}

/**
 * The testing adapter of the morph spike. A case runs one of the page's probes with the scenario's settings and turns its rows into
 * checks and count metrics (`morph-spike-tests.ts`). The probes render into their own target and pause the page's frame, so there
 * is no timed window: `windowModes` is off and the case is functional evidence.
 */
export function createMorphSpikeTestAdapter(host: MorphSpikeTestHost): TestRunAdapter<MorphSpikeTestSettings, MorphSpikeState> {
  const keep: { image?: KeptImage } = {};
  let keptRows: readonly CrackRow[] = [];

  return {
    capture: () => host.read(),
    apply: (scenario) => {
      keep.image = undefined;
      keptRows = [];
      // The probes put each case's centre and metric in place themselves; setting them here only shows the page the case that runs.
      if (scenario.settings.kind === 'crack') {
        host.apply({ lodMetric: scenario.settings.lodMetric, centreLonDeg: scenario.settings.centreLonDeg, centreLatDeg: scenario.settings.centreLatDeg });
      }
    },
    ready: async (context: TestContext) => {
      const began = performance.now();
      while (!host.ready()) {
        if (performance.now() - began > READY_TIMEOUT_MS) throw new Error(`The scene drew no frame in ${READY_TIMEOUT_MS / 1000} s`);
        await context.wait(50);
      }
    },
    measure: async (scenario) => {
      const settings = scenario.settings;
      const backend = { name: 'WebGPU backend in use', passed: host.backendIsWebGpu(), detail: String(host.environment()['backend'] ?? 'unknown') };
      if (settings.kind === 'precision') {
        const rows = await host.runProbe({ radii: settings.radii, morphs: settings.morphs, poses: settings.views });
        const observation = precisionObservation(rows);
        return { ...observation, checks: [backend, ...(observation.checks ?? [])] };
      }
      if (settings.kind === 'fan-precision') {
        const rows = await host.runFanProbe(fanProbeOptionsOf(settings));
        const observation = fanPrecisionObservation(rows, settings);
        return { ...observation, checks: [backend, ...(observation.checks ?? [])] };
      }
      if (settings.kind === 'fan-rebuild') {
        const rows = await host.runFanRebuild({
          radii: settings.radii, centres: settings.fanCentres, modes: settings.fanModes, rays: settings.fanRays, frames: settings.rebuildFrames,
        });
        const observation = fanRebuildObservation(rows, settings);
        return { ...observation, checks: [backend, ...(observation.checks ?? [])] };
      }
      keep.image = undefined;
      const rows = await host.runCrackProbe({
        radii: settings.radii, morphs: settings.morphs, views: settings.views, widthPx: settings.widthPx,
        centreLonDeg: settings.centreLonDeg, centreLatDeg: settings.centreLatDeg, lodMetric: settings.lodMetric,
        matrix: settings.matrix, controls: settings.controls, leafCap: settings.leafCap, diagnosePole: settings.diagnosePole,
        poleFan: settings.poleFan, fanRays: settings.fanRays, fanMode: settings.fanMode,
        onImage: (c, rgba, width, height) => {
          const score = thumbnailScore(c);
          if (score > (keep.image?.score ?? 0)) keep.image = { score, c, rgba: Uint8ClampedArray.from(rgba), width, height };
        },
      });
      keptRows = rows;
      const observation = crackObservation(rows, settings);
      return { ...observation, checks: [backend, ...(observation.checks ?? [])] };
    },
    restore: async (snapshot, context) => {
      host.apply(snapshot);
      await context.wait(32);
    },
    environment: () => host.environment(),
    thumbnail: async (_scenario: TestScenario<MorphSpikeTestSettings>, context: TestContext) => {
      const image = keep.image;
      if (!image || context.repetition > 1) return undefined;
      const row = keptRows.find((r) => r.radiusM === image.c.radiusM && r.view === image.c.view && r.morph === image.c.morph && r.control === image.c.control);
      const blob = await imageBlob(image, row?.flipY ?? false);
      return blob ? [blob] : undefined;
    },
  };
}
