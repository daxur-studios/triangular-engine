import { Component, DestroyRef, computed, inject, isDevMode, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BufferAttribute, Mesh, SphereGeometry, Vector3 } from 'three';
import { EngineModule, EngineService, RaycastOrbitControlsComponent } from 'triangular-engine';
import { TestRunnerComponent, type TestProgress, type TestRunResult } from 'triangular-engine/testing';
import {
  createExtensionsTestAdapter,
  type ExtensionsPageSnapshot,
  type ExtensionsTestHost,
} from './planet-material-extensions-test-adapter';
import {
  EXTENSIONS_TEST_HISTORY,
  type ExtensionsTestSettings,
  type ExtensionsVec3,
} from './planet-material-extensions-tests';
import {
  createPlanetDayNightUniforms,
  moonEclipseOcclusion,
  nightLightsEmissive,
  PlanetSurfaceMaterial,
  roadLayer,
  simpleDayNightLighting,
  SURFACE_LAYER_ORDER,
} from 'triangular-engine/planet-material';

/**
 * Plan 050 Phase 4: the reference demo for `PlanetSurfaceMaterial`'s extension slots, on a plain sphere.
 *
 * - a game surface layer: a road along a great circle (`roadLayer`, order `SURFACE_LAYER_ORDER.game`);
 * - a sun occluder: a moon eclipse (`moonEclipseOcclusion`), whose shadow follows the moon slider;
 * - the emissive stack: city lights on the night side (`nightLightsEmissive`);
 * - the replaceable lighting stage: `simpleDayNightLighting`, fed the occluder product.
 *
 * Each toggle adds or removes a slot entry, which recompiles (the stack key changes); the sliders only write
 * uniforms. `?backend=webgl2` runs the same renderer on its WebGL2 fallback.
 *
 * Repeatable tests (`triangular-engine/testing`): the panel's runner drives the controls above through the same
 * actions; suites are in `planet-material-extensions-tests.ts`, the page-specific adapter in
 * `planet-material-extensions-test-adapter.ts`.
 */
const query = new URLSearchParams(globalThis.location?.search ?? '');
const BACKEND: 'webgpu' | 'webgl2' = query.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu';
/** A launch link was followed: show the runner (and its result) without a click. */
const TEST_LAUNCHED = query.has('testSuite');
const RADIUS = 1;
const MOON_DISTANCE = 3;

@Component({
  standalone: true,
  selector: 'app-planet-material-extensions-page',
  imports: [EngineModule, RouterLink, RaycastOrbitControlsComponent, TestRunnerComponent],
  providers: EngineService.provide({
    showFPS: true,
    preferredRenderer: 'webgpu',
    webGpuRendererParameters: { forceWebGL: BACKEND === 'webgl2', antialias: true },
  }),
  host: { class: 'flex-page' },
  template: `
    <scene>
      <raycastOrbitControls
        [cameraPosition]="[0, 0.6, 3.2]"
        [target]="[0, 0, 0]"
        [near]="0.01"
        [far]="100"
        [zoomToCursor]="!testBusy()"
      />
      <ambientLight [intensity]="0.4" />
    </scene>
    <aside class="panel">
      <a routerLink="/">← Examples</a>
      <h2>Planet material extensions</h2>
      <details class="tests" [attr.open]="testLaunched ? '' : null">
        <summary>Tests</summary>
        <tri-test-runner
          [suites]="testHistory"
          [adapter]="testAdapter"
          [available]="testAvailable()"
          [allowAutoStart]="allowTestAutoStart"
          (progressChange)="onTestProgress($event)"
          (completed)="retainTestResult($event)"
        />
        @if (testBusy()) {
          <p class="note" role="status">Test {{ testStatus() }}. Controls are locked until it finishes or is cancelled.</p>
          <p class="note">Active: {{ testActiveSummary() }}</p>
        }
        <p class="note">
          Diagnostic only: frame intervals are not GPU time, and software rendering is not hardware acceptance.
          Appearance needs human review.
        </p>
      </details>
      <fieldset class="test-lock" [disabled]="testBusy()">
        <p class="row">
          <button (click)="switchBackend('webgpu')" [disabled]="backend === 'webgpu'">WebGPU</button>
          <button (click)="switchBackend('webgl2')" [disabled]="backend === 'webgl2'">forceWebGL</button>
        </p>
        <p class="row">
          <label><input type="checkbox" [checked]="roadOn()" (change)="setRoad($event)" /> road layer</label>
          <label><input type="checkbox" [checked]="eclipseOn()" (change)="setEclipse($event)" /> moon eclipse</label>
          <label><input type="checkbox" [checked]="lightsOn()" (change)="setLights($event)" /> city lights</label>
        </p>
        <p class="row">
          <label>
            sun {{ sunDegrees() }}°
            <input type="range" min="0" max="360" step="1" [value]="sunDegrees()" (input)="setSun($event)" />
          </label>
        </p>
        <p class="row">
          <label>
            moon {{ moonDegrees() }}°
            <input type="range" min="-60" max="60" step="0.5" [value]="moonDegrees()" (input)="setMoon($event)" />
          </label>
        </p>
      </fieldset>
      <p class="row">stack: {{ stackKey() }}</p>
    </aside>
  `,
  styles: `
    .panel {
      position: absolute;
      left: 1rem;
      bottom: 1rem;
      width: min(26rem, calc(100vw - 2rem));
      max-height: calc(100vh - 2rem);
      overflow-y: auto;
      padding: 0.75rem 1rem;
      border: 1px solid #294253;
      border-radius: 0.75rem;
      background: rgba(5, 13, 21, 0.92);
      color: #e6edf3;
      font: 14px/1.35 Inter, system-ui, sans-serif;
      box-shadow: 0 1rem 3rem #0008;
    }
    .panel a {
      color: #7cc4ff;
    }
    .panel h2 {
      margin: 0.25rem 0 0.5rem;
      font-size: 1.1rem;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1rem;
      margin: 0.4rem 0;
    }
    .row {
      overflow-wrap: anywhere;
    }
    .row label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    button {
      padding: 0.25rem 0.75rem;
      border: 1px solid #3b5a70;
      border-radius: 0.4rem;
      background: #17303f;
      color: #e6edf3;
      cursor: pointer;
    }
    button:disabled {
      background: #2b7fb8;
      border-color: #2b7fb8;
      cursor: default;
    }
    .test-lock {
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .tests {
      margin: 0.25rem 0 0.5rem;
    }
    .tests summary {
      cursor: pointer;
    }
    .note {
      margin: 0.4rem 0;
      color: #9fb3c2;
      font-size: 12px;
    }
  `,
})
export class PlanetMaterialExtensionsPageComponent {
  private readonly engine = inject(EngineService);

  readonly backend = BACKEND;
  readonly roadOn = signal(true);
  readonly eclipseOn = signal(true);
  readonly lightsOn = signal(true);
  /** Sun longitude, degrees round +Y (0 = +Z, the camera side). */
  readonly sunDegrees = signal(0);
  /** The moon's offset from the sun axis, degrees round +Y: 0 puts it right between the sun and the planet's +Z side. */
  readonly moonDegrees = signal(0);
  readonly stackKey = signal('');

  private readonly dayNight = createPlanetDayNightUniforms();
  private readonly road = roadLayer({ axis: new Vector3(0, 1, 0), halfWidth: 0.02, color: '#f2c14e' });
  private readonly eclipse = moonEclipseOcclusion({ planetRadius: RADIUS, moonRadius: 0.27 });
  private readonly lights = nightLightsEmissive({ strength: 0.8 });
  private readonly material = new PlanetSurfaceMaterial({
    lighting: { id: 'dayNight', stage: simpleDayNightLighting(this.dayNight) },
  });
  private readonly moon = new Mesh(new SphereGeometry(0.27, 32, 16), new PlanetSurfaceMaterial());

  constructor() {
    this.dayNight.uDayNightEnabled.value = 1;
    this.material.addSurfaceLayer({ id: 'roads', order: SURFACE_LAYER_ORDER.game, layer: this.road.layer });
    this.material.addSunOcclusion({ id: 'moon', occlusion: this.eclipse.occlusion });
    this.material.addEmissive({ id: 'cityLights', emissive: this.lights.emissive });

    this.engine.scene.add(new Mesh(this.buildGlobe(), this.material), this.moon);
    this.applyAngles();
    this.stackKey.set(this.material.stackKey);

    const frames = this.engine.renderComplete$.subscribe(() => {
      this.renderedFrameCount++;
      if (!this.firstFrameRendered()) this.firstFrameRendered.set(true);
    });
    const errors = this.engine.error$.subscribe((event) => {
      if (this.testBusy() && !this.testError) this.testError = `Engine ${event.phase}: ${String(event.error)}`;
    });
    inject(DestroyRef).onDestroy(() => {
      this.pageDisposed = true;
      this.stopErrorWatch?.();
      frames.unsubscribe();
      errors.unsubscribe();
    });
  }

  switchBackend(backend: 'webgpu' | 'webgl2'): void {
    const url = new URL(globalThis.location.href);
    url.searchParams.set('backend', backend);
    globalThis.location.href = url.toString();
  }

  // The DOM handlers only read the control; the actions below are what the test adapter also calls.
  setRoad(event: Event): void {
    this.applyRoad((event.target as HTMLInputElement).checked);
  }

  setEclipse(event: Event): void {
    this.applyEclipse((event.target as HTMLInputElement).checked);
  }

  setLights(event: Event): void {
    this.applyLights((event.target as HTMLInputElement).checked);
  }

  setSun(event: Event): void {
    this.applySunDegrees(Number((event.target as HTMLInputElement).value));
  }

  setMoon(event: Event): void {
    this.applyMoonDegrees(Number((event.target as HTMLInputElement).value));
  }

  applyRoad(on: boolean): void {
    this.toggle(this.roadOn, on, () => this.material.addSurfaceLayer({ id: 'roads', order: SURFACE_LAYER_ORDER.game, layer: this.road.layer }), () =>
      this.material.removeSurfaceLayer('roads'),
    );
  }

  applyEclipse(on: boolean): void {
    this.toggle(this.eclipseOn, on, () => this.material.addSunOcclusion({ id: 'moon', occlusion: this.eclipse.occlusion }), () =>
      this.material.removeSunOcclusion('moon'),
    );
    this.moon.visible = this.eclipseOn();
  }

  applyLights(on: boolean): void {
    this.toggle(this.lightsOn, on, () => this.material.addEmissive({ id: 'cityLights', emissive: this.lights.emissive }), () =>
      this.material.removeEmissive('cityLights'),
    );
  }

  applySunDegrees(degrees: number): void {
    this.sunDegrees.set(degrees);
    this.applyAngles();
  }

  applyMoonDegrees(degrees: number): void {
    this.moonDegrees.set(degrees);
    this.applyAngles();
  }

  private toggle(flag: ReturnType<typeof signal<boolean>>, on: boolean, add: () => void, remove: () => void): void {
    flag.set(on);
    if (on) add();
    else remove();
    this.stackKey.set(this.material.stackKey);
  }

  /** The sun and moon both live in the body frame. The moon sits on the sun side, `moonDegrees` round Y from the sun axis. */
  private applyAngles(): void {
    const sun = (this.sunDegrees() * Math.PI) / 180;
    const sunDirection = new Vector3(Math.sin(sun), 0, Math.cos(sun));
    this.dayNight.uSunDirection.value.copy(sunDirection);
    this.eclipse.sunDirection.value.copy(sunDirection);
    this.lights.sunDirection.value.copy(sunDirection);

    const moon = sun + (this.moonDegrees() * Math.PI) / 180;
    const moonPosition = new Vector3(Math.sin(moon), 0.05, Math.cos(moon)).multiplyScalar(MOON_DISTANCE);
    this.eclipse.moonPosition.value.copy(moonPosition);
    this.moon.position.copy(moonPosition);
  }

  // ---- Repeatable tests (triangular-engine/testing) -------------------------------------------
  // The reusable runner owns lifecycle and results; everything page-specific is in
  // planet-material-extensions-test-adapter.ts behind the host below, and the suites in planet-material-extensions-tests.ts.

  readonly testHistory = EXTENSIONS_TEST_HISTORY;
  readonly testLaunched = TEST_LAUNCHED;
  /** Autostart is an explicit application opt-in: development builds only. */
  readonly allowTestAutoStart = isDevMode();
  readonly testBusy = signal(false);
  readonly testStatus = signal('');
  /** Every finished run (including failed, cancelled and inconclusive ones), newest last, mirrored to localStorage. */
  readonly testResults = signal<readonly TestRunResult<ExtensionsTestSettings>[]>([]);
  private readonly firstFrameRendered = signal(false);
  readonly testAvailable = computed(() => this.firstFrameRendered());
  /** Live effective page state, shown while a run drives the controls. */
  readonly testActiveSummary = computed(() =>
    `road ${this.roadOn()} · eclipse ${this.eclipseOn()} · lights ${this.lightsOn()} · sun ${this.sunDegrees()}° · moon ${this.moonDegrees()}°`);
  private readonly orbitControlsRef = viewChild(RaycastOrbitControlsComponent);
  private pageDisposed = false;
  private renderedFrameCount = 0;
  private testError = '';
  private stopErrorWatch: (() => void) | undefined;

  private readonly testHost: ExtensionsTestHost = {
    read: () => this.readTestSnapshot(),
    applyScene: (settings) => this.applyTestScene(settings),
    setCameraPose: (position, target) => this.setTestPose(position, target),
    restore: (snapshot) => this.restoreTestSnapshot(snapshot),
    stackKey: () => this.material.stackKey,
    rendererReady: () => Boolean((this.engine.renderer as unknown as { initialized?: boolean } | undefined)?.initialized),
    compile: (signal) => this.compileForTest(signal),
    drawStats: () => {
      const render = (this.engine.renderer as unknown as { info?: { render: { triangles: number; drawCalls?: number; calls?: number } } }).info?.render;
      return { triangles: render?.triangles ?? 0, drawCalls: render?.drawCalls ?? render?.calls ?? 0 };
    },
    renderedFrames: () => this.renderedFrameCount,
    errors: () => this.testError,
    resetErrors: () => { this.testError = ''; },
    onBeforeRender: (callback) => {
      const subscription = this.engine.beforeRender$.subscribe(() => callback());
      return () => subscription.unsubscribe();
    },
    onRenderComplete: (callback) => {
      const subscription = this.engine.renderComplete$.subscribe((event) => callback(event.renderedAt));
      return () => subscription.unsubscribe();
    },
    isSampling: () => this.engine.fpsController.frameSampler.isActive,
    startSampling: () => this.engine.fpsController.frameSampler.start(),
    stopSampling: () => this.engine.fpsController.frameSampler.stop(),
    invalidateSampling: (reason) => this.engine.fpsController.frameSampler.invalidate(reason),
    environment: () => this.testEnvironment(),
  };

  readonly testAdapter = createExtensionsTestAdapter(this.testHost);

  onTestProgress(progress: TestProgress | null): void {
    const busy = progress !== null;
    if (busy !== this.testBusy()) {
      this.testBusy.set(busy);
      if (busy) this.watchTestErrors();
      else this.stopErrorWatch?.();
    }
    this.testStatus.set(progress
      ? `${progress.phase} ${progress.completed}/${progress.total} · repetition ${progress.repetition}${progress.label ? ` · ${progress.label}` : ''}`
      : '');
  }

  /** Window errors, unhandled rejections and `console.error` (where three.js logs shader and pipeline failures) while a run is active. */
  private watchTestErrors(): void {
    const note = (message: string) => { if (!this.testError) this.testError = message; };
    const onError = (event: ErrorEvent) => note(event.message || 'window error');
    const onRejection = (event: PromiseRejectionEvent) => note(`Unhandled rejection: ${String(event.reason)}`);
    const original = console.error;
    console.error = (...args: unknown[]) => {
      note(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ').slice(0, 300));
      original.apply(console, args);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    this.stopErrorWatch = () => {
      console.error = original;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      this.stopErrorWatch = undefined;
    };
  }

  /** Keeps the whole result JSON (a review verdict replaces the same run) so a failed run is never lost with the tab. */
  retainTestResult(result: TestRunResult<ExtensionsTestSettings>): void {
    const kept = [...this.testResults().filter((item) => item.runId !== result.runId), result];
    this.testResults.set(kept);
    try {
      globalThis.localStorage?.setItem('planet-material-extensions:test-results', JSON.stringify(kept.slice(-10)));
    } catch { /* storage may be blocked or full; the panel's copy/download still has the JSON */ }
  }

  private readTestSnapshot(): ExtensionsPageSnapshot {
    const controls = this.orbitControlsRef();
    const orbit = controls?.orbitControls();
    const camera = controls?.internalCamera;
    const home = { position: [0, 0.6, 3.2], target: [0, 0, 0], up: [0, 1, 0] } as const;
    return {
      road: this.roadOn(), eclipse: this.eclipseOn(), lights: this.lightsOn(),
      sunDegrees: this.sunDegrees(), moonDegrees: this.moonDegrees(), moonVisible: this.moon.visible,
      position: camera ? [camera.position.x, camera.position.y, camera.position.z] : home.position,
      target: orbit ? [orbit.target.x, orbit.target.y, orbit.target.z] : home.target,
      up: camera ? [camera.up.x, camera.up.y, camera.up.z] : home.up,
      controls: { enabled: orbit?.enabled ?? true, damping: orbit?.enableDamping ?? false },
    };
  }

  /** Uses the page's own actions and only touches what differs, so an unchanged slot never recompiles the program. */
  private applyScene(scene: Pick<ExtensionsPageSnapshot, 'road' | 'eclipse' | 'lights' | 'sunDegrees' | 'moonDegrees'>): void {
    if (this.roadOn() !== scene.road) this.applyRoad(scene.road);
    if (this.eclipseOn() !== scene.eclipse) this.applyEclipse(scene.eclipse);
    if (this.lightsOn() !== scene.lights) this.applyLights(scene.lights);
    if (this.sunDegrees() !== scene.sunDegrees) this.applySunDegrees(scene.sunDegrees);
    if (this.moonDegrees() !== scene.moonDegrees) this.applyMoonDegrees(scene.moonDegrees);
  }

  private applyTestScene(settings: ExtensionsTestSettings): void {
    if (this.pageDisposed) throw new Error('Planet material extensions page disposed');
    this.applyScene(settings);
    this.applyTestControls(settings.controls);
  }

  private applyTestControls(controls: { readonly enabled: boolean; readonly damping: boolean }): void {
    const orbit = this.orbitControlsRef()?.orbitControls();
    if (!orbit) throw new Error('Orbit controls are not ready');
    orbit.enabled = controls.enabled;
    orbit.enableDamping = controls.damping;
  }

  /** Writes the live camera and orbit target, then updates the controls so the frame about to draw looks at the target. */
  private setTestPose(position: ExtensionsVec3, target: ExtensionsVec3): void {
    const controls = this.orbitControlsRef();
    const orbit = controls?.orbitControls();
    if (!controls || !orbit) throw new Error('Orbit controls are not ready');
    controls.internalCamera.position.set(position[0], position[1], position[2]);
    orbit.target.set(target[0], target[1], target[2]);
    orbit.update();
  }

  /** Synchronous and tolerant of a page torn down mid-run: it must complete inside the runner's short restore timeout. */
  private restoreTestSnapshot(snapshot: ExtensionsPageSnapshot): void {
    if (this.pageDisposed) return;
    this.applyScene(snapshot);
    this.moon.visible = snapshot.moonVisible;
    const controls = this.orbitControlsRef();
    if (controls?.orbitControls()) {
      controls.internalCamera.up.set(snapshot.up[0], snapshot.up[1], snapshot.up[2]);
      this.setTestPose(snapshot.position, snapshot.target);
      this.applyTestControls(snapshot.controls);
    }
  }

  /** Waits for the renderer to build the current material variants, so a toggled slot's compile is not measured. */
  private async compileForTest(signal: AbortSignal): Promise<void> {
    const renderer = this.engine.renderer as unknown as { compileAsync?: (scene: unknown, camera: unknown) => Promise<void> } | undefined;
    if (typeof renderer?.compileAsync !== 'function') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Pipeline compilation did not finish in 60 s')), 60_000);
      onAbort = () => reject(signal.reason);
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([renderer.compileAsync(this.engine.scene, this.engine.camera), guard]);
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  /** Backend and device facts for the result; unknown values are labelled, not guessed. */
  private testEnvironment(): Record<string, string | number | boolean | null> {
    const renderer = this.engine.renderer as unknown as {
      domElement: HTMLCanvasElement;
      backend?: { isWebGPUBackend?: boolean; gl?: WebGL2RenderingContext; device?: { adapterInfo?: { vendor?: string; architecture?: string; description?: string } } };
    };
    const backend = renderer.backend;
    let gpu = 'unknown';
    try {
      if (backend?.gl) {
        const info = backend.gl.getExtension('WEBGL_debug_renderer_info');
        if (info) gpu = String(backend.gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
      } else if (backend?.device?.adapterInfo) {
        const { vendor, architecture, description } = backend.device.adapterInfo;
        gpu = [vendor, architecture, description].filter(Boolean).join(' ') || 'unknown';
      }
    } catch { /* leave unknown */ }
    return {
      page: 'planet-material-extensions', buildMode: isDevMode() ? 'development' : 'production',
      backend: backend ? (backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2') : 'unknown',
      requestedBackend: BACKEND === 'webgl2' ? 'WebGL2' : 'WebGPU',
      materials: 'PlanetSurfaceMaterial (TSL node material)', gpuRenderer: gpu,
      softwareRenderer: gpu === 'unknown' ? null : /swiftshader|llvmpipe|software|basic render/i.test(gpu),
      gpuTimingSource: 'none: this page does not enable the engine gpuTiming option',
      canvas: `${renderer.domElement.width}x${renderer.domElement.height}`, devicePixelRatio: globalThis.devicePixelRatio ?? null,
      viewport: `${globalThis.innerWidth}x${globalThis.innerHeight}`, automated: globalThis.navigator?.webdriver ?? null,
      hardwareConcurrency: globalThis.navigator?.hardwareConcurrency ?? null,
      fpsTraversal: 'scene traversal suspended during measurement through the existing FrameSampler',
    };
  }

  /** A sphere with the attributes the material reads: the flat map equals the sphere (the morph stays at 0) and a latitude colour. */
  private buildGlobe(): SphereGeometry {
    const geometry = new SphereGeometry(RADIUS, 128, 64);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    geometry.setAttribute('aFlatPos', new BufferAttribute(new Float32Array(position.array), 3));
    geometry.setAttribute('aFlatNorm', new BufferAttribute(new Float32Array(normal.array), 3));
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const lat = Math.abs(position.getY(i)) / RADIUS;
      // Ice at the poles, green in the temperate band, sand near the equator.
      const ice = Math.max(0, (lat - 0.8) / 0.2);
      colors[i * 3] = 0.25 + 0.5 * ice + 0.25 * (1 - lat);
      colors[i * 3 + 1] = 0.4 + 0.4 * ice;
      colors[i * 3 + 2] = 0.2 + 0.6 * ice;
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    return geometry;
  }
}
