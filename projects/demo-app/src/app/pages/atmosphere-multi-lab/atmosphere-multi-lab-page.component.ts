import { Component, DestroyRef, computed, inject, isDevMode, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BufferAttribute, Mesh, PerspectiveCamera, SphereGeometry, Vector3 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { EngineModule, EngineService } from 'triangular-engine';
import { PlanetAtmosphere } from 'triangular-engine/atmosphere';
import { PlanetSurfaceMaterial } from 'triangular-engine/planet-material';
import {
  TestRunnerComponent,
  type TestContext,
  type TestMetric,
  type TestObservation,
  type TestProgress,
  type TestRunAdapter,
  type TestScenario,
  type TestSetting,
} from 'triangular-engine/testing';
import { adapterLabel, describeGpuAdapter, type GpuAdapterRendererLike } from '../planet-shape-lab/gpu-adapter-info';
import {
  EARTH_RADIUS_M,
  MOON_CENTRE,
  MOON_RADIUS_M,
  MOON_RADIUS_UNITS,
  MULTI_ATMOSPHERE_TEST_HISTORY,
  SUN_DIRECTION,
  VIEW_POSES,
  type MultiAtmosphereSettings,
} from './atmosphere-multi-lab-tests';

/** Plan 078 spike-measure: two `PlanetAtmosphere` instances in one scene (planet A, moon B), for the lab suite. */
const RADIUS_A_UNITS = 1;
const FOV_DEG = 50;
const DEFAULT_SETTINGS: MultiAtmosphereSettings = { view: 'spaceBoth', arm: 'both', fullMarch: false };
/** Frames of samples below which a case is not evidence. */
const MIN_FRAMES = 30;
const THUMBNAIL_WIDTH = 320;

interface Disc {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** A sphere with the attributes the planet material reads (the flat map equals the sphere), with a latitude colour. */
function buildGlobe(radius: number, tint: readonly [number, number, number]): SphereGeometry {
  const geometry = new SphereGeometry(radius, 128, 64);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  geometry.setAttribute('aFlatPos', new BufferAttribute(new Float32Array(position.array), 3));
  geometry.setAttribute('aFlatNorm', new BufferAttribute(new Float32Array(normal.array), 3));
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const lat = Math.abs(position.getY(i)) / radius;
    colors[i * 3] = tint[0] * (0.7 + 0.3 * (1 - lat));
    colors[i * 3 + 1] = tint[1] * (0.7 + 0.3 * (1 - lat));
    colors[i * 3 + 2] = tint[2] * (0.7 + 0.3 * (1 - lat));
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

/** Where a body's disc falls on the canvas, from the camera's projection (small-angle perspective for the radius). */
function screenDisc(camera: PerspectiveCamera, centre: Vector3, radiusUnits: number, width: number, height: number): Disc {
  const ndc = centre.clone().project(camera);
  const distance = centre.distanceTo(camera.position);
  const focal = height / 2 / Math.tan((camera.fov * Math.PI) / 360);
  const angular = Math.asin(Math.min(0.999, radiusUnits / distance));
  return { cx: ((ndc.x + 1) / 2) * width, cy: ((1 - ndc.y) / 2) * height, r: focal * Math.tan(angular) };
}

/** Radians to degrees for a detail field; null when unknown (JSON has no NaN). */
function finiteDegrees(radians: number): number | null {
  return Number.isFinite(radians) ? Math.round(((radians * 180) / Math.PI) * 1000) / 1000 : null;
}

function luma(data: Uint8ClampedArray, i: number): number {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

/** Luma of the pixels in the ring [lo, hi] disc radii around `disc`; NaN elsewhere. */
function ringLuma(data: Uint8ClampedArray, width: number, height: number, disc: Disc, lo: number, hi: number): Float32Array {
  const out = new Float32Array(width * height).fill(NaN);
  const outer = disc.r * hi;
  const x0 = Math.max(0, Math.floor(disc.cx - outer));
  const x1 = Math.min(width - 1, Math.ceil(disc.cx + outer));
  const y0 = Math.max(0, Math.floor(disc.cy - outer));
  const y1 = Math.min(height - 1, Math.ceil(disc.cy + outer));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - disc.cx, y + 0.5 - disc.cy);
      if (d < disc.r * lo || d > outer) continue;
      const i = y * width + x;
      out[i] = luma(data, i * 4);
    }
  }
  return out;
}

function meanOf(values: Float32Array): number {
  let sum = 0;
  let count = 0;
  for (const v of values) if (!Number.isNaN(v)) { sum += v; count++; }
  return count ? sum / count : NaN;
}

/** Share of pixels in the top third of the frame that are black (luma below 4): the sky a black wipe would blank. */
function upperBlackFraction(data: Uint8ClampedArray, width: number, height: number): number {
  const rows = Math.floor(height / 3);
  let black = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) if (luma(data, (y * width + x) * 4) < 4) black++;
  }
  return rows > 0 ? black / (rows * width) : NaN;
}

/** Finite samples only: a value that is not on screen is an absent optional metric, not an invalid sample. */
function finiteSamples(value: number): number[] {
  return Number.isFinite(value) ? [value] : [];
}

@Component({
  standalone: true,
  selector: 'app-atmosphere-multi-lab-page',
  imports: [EngineModule, RouterLink, TestRunnerComponent],
  providers: EngineService.provide({
    showFPS: true,
    gpuTiming: true,
    preferredRenderer: 'webgpu',
    webGpuRendererParameters: { antialias: false, trackTimestamp: true },
  }),
  host: { class: 'flex-page' },
  template: `
    <scene [logarithmicDepthBuffer]="true">
      <ng-template portalTarget="overlay" lane="topStart">
        <a class="back-link" routerLink="/">← Examples</a>
        <section class="scope" aria-label="Two atmospheres">
          <h2>Two atmospheres · Plan 078 spike</h2>
          <p class="note">
            Planet A (Earth air) at the origin, moon B (1737 km, Earth-like air) six planet radii away.
            The nearer atmosphere owns the sky; the other draws only its bounded air.
            Showing: {{ shown() }}
          </p>
          <tri-test-runner
            [suites]="testHistory"
            [adapter]="testAdapter"
            [available]="testAvailable()"
            [allowAutoStart]="allowTestAutoStart"
            [resultSink]="true"
            (progressChange)="onTestProgress($event)"
          />
        </section>
      </ng-template>
    </scene>
  `,
  styles: `
    .back-link {
      color: #7cc4ff;
      font: 14px/1.35 Inter, system-ui, sans-serif;
    }
    .scope {
      width: min(30rem, calc(100vw - 2rem));
      padding: 0.75rem 1rem;
      border: 1px solid #294253;
      border-radius: 0.75rem;
      background: rgba(5, 13, 21, 0.92);
      color: #e6edf3;
      font: 14px/1.35 Inter, system-ui, sans-serif;
    }
    .scope h2 {
      margin: 0.25rem 0 0.5rem;
      font-size: 1.1rem;
    }
    .note {
      margin: 0.4rem 0;
      opacity: 0.75;
    }
  `,
})
export class AtmosphereMultiLabPageComponent {
  private readonly engine = inject(EngineService);

  readonly testHistory = MULTI_ATMOSPHERE_TEST_HISTORY;
  readonly allowTestAutoStart = isDevMode();
  readonly shown = signal('');
  readonly testBusy = signal(false);
  private readonly firstFrameRendered = signal(false);
  readonly testAvailable = computed(() => this.firstFrameRendered());
  private renderedFrames = 0;
  /** Planet A's rim luma from the half-resolution run, read by the full-resolution run of the same view (Q1). */
  private halfRim?: Float32Array;

  private readonly materialA = new PlanetSurfaceMaterial();
  private readonly materialB = new PlanetSurfaceMaterial();
  private readonly bodyA = new Mesh(buildGlobe(RADIUS_A_UNITS, [0.35, 0.5, 0.7]), this.materialA);
  private readonly bodyB = new Mesh(buildGlobe(MOON_RADIUS_UNITS, [0.55, 0.55, 0.52]), this.materialB);
  private readonly atmosphereA: PlanetAtmosphere;
  private readonly atmosphereB: PlanetAtmosphere;

  constructor() {
    this.bodyB.position.set(...MOON_CENTRE);
    this.atmosphereA = new PlanetAtmosphere({ preset: 'earth', radiusM: EARTH_RADIUS_M, radiusUnits: RADIUS_A_UNITS, planet: this.bodyA });
    this.atmosphereB = new PlanetAtmosphere({ preset: 'earth', radiusM: MOON_RADIUS_M, radiusUnits: MOON_RADIUS_UNITS, planet: this.bodyB });
    for (const [atmosphere, material] of [[this.atmosphereA, this.materialA], [this.atmosphereB, this.materialB]] as const) {
      atmosphere.withAtmosphere(material);
      atmosphere.sunDirection.set(...SUN_DIRECTION);
      this.engine.scene.add(atmosphere.object);
    }
    this.engine.scene.add(this.bodyA, this.bodyB);
    this.applySettings(DEFAULT_SETTINGS);

    const tick = this.engine.beforeRender$.subscribe(() => {
      this.assignSkyOwner();
      const renderer = this.engine.renderer as unknown as WebGPURenderer;
      this.atmosphereA.update(renderer, this.engine.camera);
      this.atmosphereB.update(renderer, this.engine.camera);
    });
    const frames = this.engine.renderComplete$.subscribe(() => {
      this.renderedFrames++;
      if (this.renderedFrames >= 3) this.firstFrameRendered.set(true);
    });
    inject(DestroyRef).onDestroy(() => {
      tick.unsubscribe();
      frames.unsubscribe();
      this.atmosphereA.dispose();
      this.atmosphereB.dispose();
      this.engine.scene.remove(this.bodyA, this.bodyB);
      this.materialA.dispose();
      this.materialB.dispose();
      this.bodyA.geometry.dispose();
      this.bodyB.geometry.dispose();
    });
  }

  /**
   * Plan 078: the enabled atmosphere nearest the camera (surface distance) owns the full sky; the other draws only its own
   * bounded air from space. A consumer would decide this its own way (gravity primary, influence sphere).
   */
  private assignSkyOwner(): void {
    const position = this.engine.camera.position;
    const gapA = position.distanceTo(this.bodyA.position) - RADIUS_A_UNITS;
    const gapB = position.distanceTo(this.bodyB.position) - MOON_RADIUS_UNITS;
    const aOwns = this.atmosphereA.enabled && (!this.atmosphereB.enabled || gapA <= gapB);
    this.atmosphereA.backdrop.ownsSky = aOwns;
    this.atmosphereB.backdrop.ownsSky = !aOwns;
  }

  onTestProgress(progress: TestProgress | null): void {
    this.testBusy.set(progress !== null);
  }

  /** Camera pose, which atmospheres are on, and the full-resolution march switch. Synchronous; the next frame shows it. */
  private applySettings(settings: MultiAtmosphereSettings): void {
    const pose = VIEW_POSES[settings.view];
    const camera = this.engine.camera as PerspectiveCamera;
    camera.fov = FOV_DEG;
    camera.near = 0.00001;
    camera.far = 100;
    camera.up.set(0, 1, 0);
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    this.atmosphereA.enabled = settings.arm === 'both' || settings.arm === 'a';
    this.atmosphereB.enabled = settings.arm === 'both' || settings.arm === 'b';
    const lowRes = settings.fullMarch ? 0 : 1;
    this.atmosphereA.backdrop.spaceLowResEnabled.value = lowRes;
    this.atmosphereB.backdrop.spaceLowResEnabled.value = lowRes;
    this.shown.set(`${settings.view} · ${settings.arm}${settings.fullMarch ? ' · full-resolution march' : ''}`);
  }

  /** Renders the current view now and copies the canvas in the same task (WebGPU canvases read back only then). */
  private renderAndRead(): { data: Uint8ClampedArray; width: number; height: number } {
    const canvas = this.engine.canvas;
    this.engine.render(this.engine.fpsController.lastRenderTime, true);
    const { width, height } = canvas;
    if (!width || !height) throw new Error('The canvas has no size to read');
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('No 2D context to read the canvas with');
    context.drawImage(canvas, 0, 0);
    return { data: context.getImageData(0, 0, width, height).data, width, height };
  }

  private async waitForFrames(count: number, context: TestContext): Promise<void> {
    const start = this.renderedFrames;
    while (this.renderedFrames < start + count) await context.wait(16);
  }

  readonly testAdapter: TestRunAdapter<MultiAtmosphereSettings, undefined> = {
    windowModes: false,
    capture: () => undefined,
    apply: (scenario) => this.applySettings(scenario.settings),
    ready: (context) => this.waitForFrames(3, context),
    measure: (scenario, context) => this.measure(scenario, context),
    restore: () => this.applySettings(DEFAULT_SETTINGS),
    environment: () => this.environment(),
    thumbnail: async (scenario: TestScenario<MultiAtmosphereSettings>, context) => {
      if (context.repetition > 1) return undefined;
      return [await this.captureThumbnail(context.signal)];
    },
  };

  /** Timing over the window, then one probe frame read back after it (outside the window) for the picture checks. */
  private async measure(scenario: TestScenario<MultiAtmosphereSettings>, context: TestContext): Promise<TestObservation> {
    const settings = scenario.settings;
    const sampler = this.engine.fpsController.frameSampler;
    const walls: number[] = [];
    let lastAt: number | undefined;
    const wall = this.engine.renderComplete$.subscribe((event) => {
      if (lastAt !== undefined) walls.push(event.renderedAt - lastAt);
      lastAt = event.renderedAt;
    });
    sampler.start();
    try {
      await context.wait(scenario.durationMs);
    } finally {
      wall.unsubscribe();
    }
    const gpu = [...sampler.gpuSamples];
    sampler.stop();

    const { data, width, height } = this.renderAndRead();
    const camera = this.engine.camera as PerspectiveCamera;
    const discA = screenDisc(camera, this.bodyA.position, RADIUS_A_UNITS, width, height);
    const discB = screenDisc(camera, this.bodyB.position, MOON_RADIUS_UNITS, width, height);
    const haloA = meanOf(ringLuma(data, width, height, discA, 1.02, 1.3));
    const haloB = meanOf(ringLuma(data, width, height, discB, 1.02, 1.3));
    const upperBlack = upperBlackFraction(data, width, height);

    const metrics: TestMetric[] = [
      {
        name: 'gpuFrameMs',
        unit: 'ms',
        source: 'engine gpuTiming: WebGPU timestamps per frame (FrameSampler gpuSamples), whole frame',
        samples: gpu,
        optional: gpu.length === 0,
        unavailableReason: gpu.length === 0 ? 'no timestamp samples on this backend' : undefined,
      },
      { name: 'wallFrameMs', unit: 'ms', source: 'interval between completed renders in the window', samples: walls },
      {
        name: 'haloLumaA',
        unit: 'luma',
        source: 'mean luma (0-255) of the ring 1.02-1.3 planet radii around A, probe frame after the window',
        samples: finiteSamples(haloA),
        optional: true,
        unavailableReason: 'planet A ring not on screen',
      },
      {
        name: 'haloLumaB',
        unit: 'luma',
        source: 'mean luma (0-255) of the ring 1.02-1.3 moon radii around B, probe frame after the window',
        samples: finiteSamples(haloB),
        optional: true,
        unavailableReason: 'moon B ring not on screen',
      },
      { name: 'upperBlackFraction', unit: 'fraction', source: 'share of pixels with luma < 4 in the top third of the probe frame', samples: finiteSamples(upperBlack) },
    ];

    // Q1: the rim of planet A as seen from space, half-resolution pass (stored) against the full-resolution pass.
    if (settings.view === 'nearA' && settings.arm === 'both') {
      const rim = ringLuma(data, width, height, discA, 1.0, 1.06);
      if (!settings.fullMarch) this.halfRim = rim;
      else if (this.halfRim && this.halfRim.length === rim.length) {
        let sum = 0;
        let count = 0;
        for (let i = 0; i < rim.length; i++) {
          if (Number.isNaN(rim[i]) || Number.isNaN(this.halfRim[i])) continue;
          sum += Math.abs(rim[i] - this.halfRim[i]);
          count++;
        }
        metrics.push({
          name: 'rimMeanAbsDiffLuma',
          unit: 'luma',
          source: 'mean |full - half| luma over planet A rim ring 1.00-1.06 radii, same frame pose',
          samples: count ? [sum / count] : [],
          optional: true,
          unavailableReason: 'no rim pixels',
        });
        metrics.push({
          name: 'rimMeanLumaFull',
          unit: 'luma',
          source: 'mean luma of planet A rim ring 1.00-1.06 radii, full-resolution pass',
          samples: finiteSamples(meanOf(rim)),
        });
        metrics.push({
          name: 'rimMeanLumaHalf',
          unit: 'luma',
          source: 'mean luma of planet A rim ring 1.00-1.06 radii, half-resolution pass (earlier run)',
          samples: finiteSamples(meanOf(this.halfRim)),
        });
      }
    }

    return {
      metrics,
      checks: [{ name: 'enough frames', passed: gpu.length >= MIN_FRAMES || walls.length >= MIN_FRAMES, detail: `gpu ${gpu.length}, wall ${walls.length}` }],
      limitations: [
        'Wall time is the interval between completed renders: a vsync-capped run reads about 16.7 ms.',
        'Halo and black-fraction values are one probe frame after the window; no wipe verdict is made here, compare arms of one view.',
      ],
      details: {
        view: settings.view,
        arm: settings.arm,
        fullMarch: settings.fullMarch,
        coverageA: this.atmosphereA.backdrop.coverage,
        coverageB: this.atmosphereB.backdrop.coverage,
        angularRadiusADeg: finiteDegrees(this.atmosphereA.backdrop.apparentAngularRadius),
        angularRadiusBDeg: finiteDegrees(this.atmosphereB.backdrop.apparentAngularRadius),
      },
    };
  }

  private async captureThumbnail(signal: AbortSignal): Promise<Blob> {
    const canvas = this.engine.canvas;
    this.engine.render(this.engine.fpsController.lastRenderTime, true);
    const small = document.createElement('canvas');
    small.width = Math.min(THUMBNAIL_WIDTH, canvas.width);
    small.height = Math.max(1, Math.round((canvas.height * small.width) / canvas.width));
    small.getContext('2d')?.drawImage(canvas, 0, 0, small.width, small.height);
    if (signal.aborted) throw signal.reason;
    return new Promise<Blob>((resolve, reject) =>
      small.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the thumbnail'))), 'image/webp', 0.6));
  }

  /** The GPU adapter the run used, read from the renderer (never a second adapter request); unknown values stay labelled. */
  private environment(): Readonly<Record<string, TestSetting>> {
    const renderer = this.engine.renderer as unknown as GpuAdapterRendererLike;
    const info = describeGpuAdapter(renderer, globalThis.devicePixelRatio ?? 1);
    return {
      page: 'atmosphere-multi-lab',
      renderer: (renderer as object | undefined)?.constructor?.name ?? 'unknown',
      ...info,
      gpuRenderer: adapterLabel(info),
      'gpu.powerPreference': 'high-performance (engine default)',
      gpuTimingSource: typeof (this.engine.renderer as any)?.resolveTimestampsAsync === 'function'
        ? 'engine gpuTiming: WebGPU timestamps per frame'
        : 'none: no timestamp query on this backend',
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    };
  }
}
