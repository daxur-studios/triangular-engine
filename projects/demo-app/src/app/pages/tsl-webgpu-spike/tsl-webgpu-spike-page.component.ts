import {
  Component,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  Group,
  HalfFloatType,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Mesh,
  RenderTarget,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  Vector2,
  type IUniform,
  FrontSide,
} from 'three';
import {
  DirectRenderPipeline,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type Material,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  attribute,
  float,
  mix,
  normalize,
  positionGeometry,
  positionLocal,
  transformNormalToView,
  uniform,
  vec3,
} from 'three/tsl';
import {
  EngineModule,
  EngineService,
  RaycastOrbitControlsComponent,
} from 'triangular-engine';
import type {
  ILatLonTerrainPatchAddress,
  ITerrainPatchMesh,
  ITerrainSurfaceGenerationRequest,
  ITerrainSurfaceLodStats,
} from 'triangular-engine/terrain';
import {
  CellPlanetMorphStreamingViewComponent,
  WORLD_SIZE_TIER_RADIUS_M,
  enablePlanetMorphProjection,
  type IDynamicProjectionUniforms,
} from 'triangular-engine/worldgen/render';
import { CELL_PLANET_U0_FIXTURE } from '../cell-planet-u0-fixture';
import { getTerrainHeightScaleM } from '../cell-planet-25d-map/cell-planet-terrain-scale';
import type { CellPlanetMorphWorkerRequest } from '../cell-planet-morph-streaming/cell-planet-morph-streaming.worker';

/**
 * PLAN 050 PHASE 0 - THROWAWAY SPIKE. Not a product page; delete when Phase 1's `cell-planet-tsl` lands.
 *
 * `?backend=` selects the renderer (a renderer cannot be swapped live, so the buttons reload):
 *   - `classic`  : WebGLRenderer + the stock GLSL material (the baseline for frame-time comparisons)
 *   - `classic-nodeuniform`: WebGLRenderer + `enablePlanetMorphProjection` fed with TSL `UniformNode`s
 *                  (runtime check that a UniformNode works as an `IUniform`)
 *   - `webgpu`   : WebGPURenderer on the native WebGPU backend
 *   - `webgl2`   : WebGPURenderer with `forceWebGL: true`
 * Material on the WebGPU backends: MeshStandardNodeMaterial + vertexColors + a TSL positionNode.
 */
type Backend = 'classic' | 'classic-nodeuniform' | 'webgpu' | 'webgl2';

function readBackend(): Backend {
  const value = new URLSearchParams(globalThis.location?.search ?? '').get(
    'backend',
  );
  return value === 'classic' ||
    value === 'classic-nodeuniform' ||
    value === 'webgl2'
    ? value
    : 'webgpu';
}
const BACKEND = readBackend();
const AA =
  new URLSearchParams(globalThis.location?.search ?? '').get('aa') !== '0';
const BASIC =
  new URLSearchParams(globalThis.location?.search ?? '').get('mat') === 'basic';
const LOG_DEPTH =
  new URLSearchParams(globalThis.location?.search ?? '').get('log') !== '0';
/**
 * Diagnostics for the "why is WebGPURenderer slower" question (Runbook 050):
 *   - `out=ubyte`: WebGPURenderer with an 8-bit output buffer instead of the default half float.
 *   - `rt=1` (classic only): scene into a half-float target (MSAA when aa=1) + a full-screen tone-map pass,
 *     which is the pipeline WebGPURenderer always runs (like-for-like).
 *   - `mat=basic` on classic: unlit baseline, to compare with the unlit WebGPU control.
 */
const OUT_UBYTE =
  new URLSearchParams(globalThis.location?.search ?? '').get('out') === 'ubyte';
const RT =
  new URLSearchParams(globalThis.location?.search ?? '').get('rt') === '1';
/**
 * `pipeline=direct` (webgpu / webgl2 only): render through three r186's `DirectRenderPipeline`, which applies
 * tone mapping / output colour space inside the material shaders and skips the intermediate framebuffer +
 * output pass of the default pipeline. Caveats: blending happens after tone mapping, and materials that
 * sample the framebuffer (transmission / refraction) are not supported. `pipeline=default` (or omitted) keeps
 * the renderer's own pipeline.
 */
const PIPELINE_DIRECT =
  new URLSearchParams(globalThis.location?.search ?? '').get('pipeline') ===
    'direct' &&
  (BACKEND === 'webgpu' || BACKEND === 'webgl2');

function engineProviders() {
  const base = { showFPS: false };
  if (BACKEND === 'classic' || BACKEND === 'classic-nodeuniform') {
    return EngineService.provide({
      ...base,
      preferredRenderer: 'webgl',
      webGLRendererParameters: {
        logarithmicDepthBuffer: LOG_DEPTH,
        antialias: AA,
      },
    });
  }
  return EngineService.provide({
    ...base,
    preferredRenderer: 'webgpu',
    webGpuRendererParameters: {
      logarithmicDepthBuffer: LOG_DEPTH,
      forceWebGL: BACKEND === 'webgl2',
      antialias: AA,
      trackTimestamp: BACKEND === 'webgpu',
      ...(OUT_UBYTE ? { outputBufferType: UnsignedByteType } : {}),
    },
  });
}

@Component({
  standalone: true,
  selector: 'app-tsl-webgpu-spike-page',
  imports: [
    EngineModule,
    RouterLink,
    RaycastOrbitControlsComponent,
    CellPlanetMorphStreamingViewComponent,
  ],
  providers: engineProviders(),
  host: { class: 'flex-page' },
  template: `
    <scene [showFps]="true">
      <raycastOrbitControls
        [cameraPosition]="camPos()"
        [target]="camTarget()"
        [near]="0.5"
        [far]="10000000"
        [raycastFocusResolver]="planetView.raycastFocusResolver"
      />
      <ambientLight [intensity]="0.4" />
      <directionalLight
        [position]="[50000, 70000, 60000]"
        [intensity]="2.2"
        [castShadow]="shadows()"
        [shadowFollow]="focus"
        [shadow]="{
          cameraHalfExtent: 60000,
          cameraNear: 1,
          cameraFar: 400000,
          mapSize: [2048, 2048],
          bias: -0.0005,
          normalBias: 0.5,
        }"
      />
      <cellPlanetMorphStreamingView
        #planetView
        [radiusM]="radius"
        [meshGenerator]="meshGenerator"
        [morphProgress]="morphProgress()"
        [maxLod]="6"
        [resolution]="32"
        [createMaterial]="createMaterial"
        [castShadow]="shadows()"
        [receiveShadow]="shadows()"
        (lodChange)="onLodChange($event)"
      />
    </scene>

    <aside class="panel">
      <a routerLink="/">← Examples</a>
      <h2>Plan 050 · Phase 0 spike</h2>
      <p>
        Backend: <b>{{ backend }}</b>
      </p>
      <p class="row">
        @for (b of backends; track b) {
          <button (click)="switchBackend(b)" [disabled]="b === backend">
            {{ b }}
          </button>
        }
      </p>
      <label
        >morph
        <input
          type="range"
          min="0"
          max="1"
          step="0.005"
          [value]="morphProgress()"
          (input)="setMorph($event)"
      /></label>
      <p class="row">
        <button (click)="viewOrbit()">orbit view</button>
        <button (click)="viewSurface()">surface view</button>
        <button (click)="shadows.set(!shadows())">
          shadows: {{ shadows() }}
        </button>
      </p>
      <p>
        Resident {{ stats().resident }} · tris {{ stats().triangles }} · LOD
        draw {{ stats().drawCalls }}
      </p>
      <p class="row">
        <button (click)="runAll()" [disabled]="running">
          {{ running ? 'running...' : 'run all benchmarks' }}
        </button>
      </p>
      <p>{{ status() }}</p>
      @if (report()) {
        <textarea
          readonly
          rows="6"
          [value]="report()"
          (focus)="$any($event.target).select()"
        ></textarea>
        <button (click)="copyReport()">copy JSON</button>
      }
      <pre>{{ perf() }}</pre>
    </aside>
  `,
  styles: `
    :host {
      position: relative;
    }
    .panel {
      position: absolute;
      top: 1rem;
      left: 1rem;
      background: rgba(10, 14, 20, 0.85);
      color: #eee;
      padding: 1rem;
      border-radius: 8px;
      max-width: 360px;
      font: 13px/1.4 system-ui;
      z-index: 20;
    }
    .panel input[type='range'] {
      width: 100%;
    }
    .row {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    textarea {
      width: 100%;
      font: 11px monospace;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      font-size: 11px;
    }
  `,
})
export class TslWebgpuSpikePageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly engine = inject(EngineService);
  readonly planetView = viewChild.required(
    CellPlanetMorphStreamingViewComponent,
  );

  readonly backend = BACKEND;
  readonly backends: Backend[] = [
    'classic',
    'classic-nodeuniform',
    'webgpu',
    'webgl2',
  ];
  readonly radius = WORLD_SIZE_TIER_RADIUS_M.medium;
  readonly morphProgress = signal(0);
  private readonly query = new URLSearchParams(
    globalThis.location?.search ?? '',
  );
  /** `?alt=` metres above the +Z surface point, `?back=` metres further out along +Y; `?shadows=1`. */
  readonly shadows = signal(this.query.get('shadows') === '1');
  readonly camPos = signal<[number, number, number]>(
    this.query.has('alt')
      ? [
          0,
          Number(this.query.get('back') ?? 0),
          this.radius + Number(this.query.get('alt')),
        ]
      : [0, 0, this.radius * 2.6],
  );
  readonly camTarget = signal<[number, number, number]>(
    this.query.has('alt') ? [0, 0, this.radius] : [0, 0, 0],
  );
  readonly focus = new Group();
  readonly perf = signal('');
  readonly status = signal('');
  readonly report = signal('');
  running = false;
  readonly stats = signal<ITerrainSurfaceLodStats>({
    desired: 0,
    resident: 0,
    queued: 0,
    drawCalls: 0,
    triangles: 0,
    geometryBytes: 0,
    levels: {},
  });

  /**
   * UniformNodes used where the GLSL path uses `{ value }` holders. Typing this as
   * `IDynamicProjectionUniforms` IS the compile-time `UniformNode` satisfies `IUniform<T>` check.
   */
  private readonly morphNode = uniform(0);
  readonly nodeUniforms: IDynamicProjectionUniforms = {
    uMorph: this.morphNode,
    uProjForward: uniform(new Vector3(0, 0, 1)),
    uProjUp: uniform(new Vector3(0, 1, 0)),
    uProjRight: uniform(new Vector3(1, 0, 0)),
    uProjMode: uniform(0),
    uMapWidth: uniform(1),
    uMapHeight: uniform(1),
    uRadius: uniform(1),
    uProjectionType: uniform(1),
  };

  readonly createMaterial = (): Material => {
    if (BACKEND === 'classic') {
      const material = BASIC
        ? new MeshBasicMaterial({ side: FrontSide, vertexColors: true })
        : new MeshStandardMaterial({
            roughness: 0.92,
            metalness: 0.05,
            side: FrontSide,
            vertexColors: true,
          });
      enablePlanetMorphProjection(material, this.glslUniforms);
      return material as unknown as Material;
    }
    if (BACKEND === 'classic-nodeuniform') {
      const material = new MeshStandardMaterial({
        roughness: 0.92,
        metalness: 0.05,
        side: FrontSide,
        vertexColors: true,
      });
      enablePlanetMorphProjection(material, this.nodeUniforms);
      return material as unknown as Material;
    }
    if (BASIC) {
      // Control: no lighting, to separate PBR cost from position/batch/MSAA cost.
      const basic = new MeshBasicNodeMaterial({
        side: FrontSide,
        vertexColors: true,
      });
      const sp = attribute('aSpherePos', 'vec3' as const);
      const fp = attribute('aFlatPos', 'vec3' as const);
      basic.positionNode = mix(sp, fp, this.morphNode).add(
        positionLocal.sub(positionGeometry),
      );
      return basic;
    }
    const material = new MeshStandardNodeMaterial({
      roughness: 0.92,
      metalness: 0.05,
      side: FrontSide,
      vertexColors: true,
    });
    const aSpherePos = attribute('aSpherePos', 'vec3' as const);
    const aFlatPos = attribute('aFlatPos', 'vec3' as const);
    const aSphereNorm = attribute('aSphereNorm', 'vec3' as const);
    const aFlatNorm = attribute('aFlatNorm', 'vec3' as const);
    const morph = this.morphNode;
    // BatchNode has already written `batchingMatrix * position` into positionLocal, and positionNode
    // replaces positionLocal. The batch matrices are translation-only, so carry the translation over.
    const batchOffset = positionLocal.sub(positionGeometry);
    material.positionNode = mix(aSpherePos, aFlatPos, morph).add(batchOffset);
    material.normalNode = transformNormalToView(
      normalize(mix(aSphereNorm, aFlatNorm, morph)),
    );
    return material;
  };

  /** Plain holders for the `classic` baseline. */
  private readonly glslUniforms: IDynamicProjectionUniforms = {
    uMorph: { value: 0 },
    uProjForward: { value: new Vector3(0, 0, 1) },
    uProjUp: { value: new Vector3(0, 1, 0) },
    uProjRight: { value: new Vector3(1, 0, 0) },
    uProjMode: { value: 0 },
    uMapWidth: { value: 1 },
    uMapHeight: { value: 1 },
    uRadius: { value: 1 },
    uProjectionType: { value: 1 },
  };

  private readonly worker = new Worker(
    new URL(
      '../cell-planet-morph-streaming/cell-planet-morph-streaming.worker',
      import.meta.url,
    ),
    { type: 'module' },
  );
  private nextRequestId = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (patch: ITerrainPatchMesh<ILatLonTerrainPatchAddress>) => void;
      reject: (e: Error) => void;
    }
  >();

  private frameTimes: number[] = [];
  private cpuTimes: number[] = [];
  private lastFrameAt = 0;
  private beforeAt = 0;

  constructor() {
    const holders =
      BACKEND === 'classic' ? this.glslUniforms : this.nodeUniforms;
    this.applyMapUniforms(holders);
    this.worker.onmessage = ({
      data,
    }: MessageEvent<{
      id: number;
      patch?: ITerrainPatchMesh<ILatLonTerrainPatchAddress>;
      error?: string;
    }>) => {
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error));
      else if (data.patch) entry.resolve(data.patch);
    };
    this.destroyRef.onDestroy(() => this.worker.terminate());
    this.focus.position.set(0, 0, this.radius);
    this.engine.scene.add(this.focus);

    this.engine.beforeRender$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.installRtPass();
      this.installDirectPipeline();
      this.beforeAt = performance.now();
    });
    this.engine.renderComplete$.pipe(takeUntilDestroyed()).subscribe(() => {
      const now = performance.now();
      this.cpuTimes.push(now - this.beforeAt);
      if (this.lastFrameAt) this.frameTimes.push(now - this.lastFrameAt);
      this.lastFrameAt = now;
      if (this.frameTimes.length >= 120) this.flushPerf();
    });
    (globalThis as unknown as { __spike: unknown }).__spike = this;
    this.report.set(this.readStore('spikeReport') ?? '');
    if (this.query.get('auto') === '1') {
      this.running = true;
      void this.autoRun();
    }
  }

  private rtRenderer?: WebGLRenderer;
  private directPipeline?: DirectRenderPipeline;

  /** `pipeline=direct`: hand the engine's main render to a `DirectRenderPipeline` (registered once). */
  private installDirectPipeline(): void {
    if (!PIPELINE_DIRECT || this.directPipeline) return;
    const renderer = this.engine.renderer as unknown as WebGPURenderer;
    if (!renderer?.initialized) return;
    const pipeline = new DirectRenderPipeline(renderer);
    this.directPipeline = pipeline;
    const registered = {
      render: () => pipeline.render(this.engine.scene, this.engine.camera),
      setSize: () => undefined,
    };
    this.engine.registerRenderPipeline(registered);
    this.destroyRef.onDestroy(() => {
      this.engine.unregisterRenderPipeline(registered);
      pipeline.dispose();
    });
  }

  /**
   * `rt=1` on classic: wraps `render` so the scene goes to a half-float (MSAA when aa=1) target and a
   * full-screen pass tone-maps it to the screen, the pipeline `WebGPURenderer` always runs.
   */
  private installRtPass(): void {
    const r = this.engine.renderer as unknown as WebGLRenderer;
    if (!RT || BACKEND !== 'classic' || this.rtRenderer === r) return;
    this.rtRenderer = r;
    const original = r.render.bind(r);
    const size = new Vector2();
    let target: WebGLRenderTarget | undefined;
    const quadScene = new Scene();
    const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadMaterial = new ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        #include <tonemapping_pars_fragment>
        #include <colorspace_pars_fragment>
        void main() {
          gl_FragColor = texture2D(tDiffuse, vUv);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), quadMaterial);
    quad.frustumCulled = false;
    quadScene.add(quad);
    r.render = (scene, camera) => {
      r.getDrawingBufferSize(size);
      if (!target || target.width !== size.x || target.height !== size.y) {
        target?.dispose();
        target = new WebGLRenderTarget(size.x, size.y, {
          type: HalfFloatType,
          samples: AA ? 4 : 0,
        });
      }
      const previous = r.getRenderTarget();
      r.setRenderTarget(target);
      original(scene, camera);
      r.setRenderTarget(previous);
      quadMaterial.uniforms['tDiffuse'].value = target.texture;
      original(quadScene, quadCamera);
    };
  }

  // ---- run-all orchestration: a renderer cannot be swapped live, so each config is a page load ----
  private static readonly CONFIGS = [
    'backend=classic&aa=1',
    'backend=classic&aa=0',
    'backend=webgpu&aa=1',
    'backend=webgpu&aa=0',
    'backend=webgl2&aa=1',
    'backend=webgl2&aa=0',
    'backend=webgpu&aa=0&mat=basic',
    'backend=webgpu&aa=1&mat=basic',
    // diagnostics (Runbook 050): output buffer type, classic unlit, classic with the same pass structure
    'backend=webgpu&aa=0&out=ubyte',
    'backend=webgpu&aa=1&out=ubyte',
    'backend=webgl2&aa=1&out=ubyte',
    'backend=classic&aa=0&mat=basic',
    'backend=classic&aa=1&mat=basic',
    'backend=classic&aa=0&rt=1',
    'backend=classic&aa=1&rt=1',
    // r186 DirectRenderPipeline (Runbook 050): the same WebGPURenderer, output processing inside the materials
    'backend=webgpu&aa=1&pipeline=direct',
    'backend=webgpu&aa=0&pipeline=direct',
    'backend=webgl2&aa=1&pipeline=direct',
    'backend=webgl2&aa=0&pipeline=direct',
  ];

  private readStore(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }
  private writeStore(key: string, value: string): void {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* storage blocked: results are lost */
    }
  }

  runAll(): void {
    this.writeStore('spikeResults', '[]');
    this.writeStore('spikeReport', '');
    location.assign(
      `${location.pathname}?${TslWebgpuSpikePageComponent.CONFIGS[0]}&auto=1`,
    );
  }

  copyReport(): void {
    void navigator.clipboard?.writeText(this.report());
  }

  private async waitStable(maxMs = 45000): Promise<number> {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let last = -1;
    let same = 0;
    for (let t = 0; t < maxMs; t += 500) {
      await sleep(500);
      const n = this.stats().resident;
      same = n > 0 && n === last ? same + 1 : 0;
      last = n;
      if (same >= 6) break;
    }
    return last;
  }

  private async autoRun(): Promise<void> {
    const median = async (): Promise<{ ms: number; draws: number }> => {
      const xs: number[] = [];
      let draws = 0;
      for (let i = 0; i < 5; i++) {
        const r = await this.bench(150);
        xs.push(r['totalMsPerFrame'] as number);
        draws = r['drawCalls'] as number;
      }
      xs.sort((a, b) => a - b);
      return { ms: xs[2], draws };
    };
    try {
      this.status.set('waiting for terrain...');
      await this.waitStable();
      const renderer = this.engine.renderer;
      renderer.setPixelRatio(1);
      renderer.setSize(1280, 720, false);
      const orbit = await median();
      this.status.set('surface view...');
      this.viewSurface();
      await this.waitStable();
      const surface = await median();
      this.status.set('flat map...');
      this.setMorphValue(1);
      await this.waitStable();
      const flat = await median();
      const results: unknown[] = JSON.parse(
        this.readStore('spikeResults') ?? '[]',
      );
      results.push({
        b: BACKEND,
        aa: AA ? 1 : 0,
        mat: BASIC ? 'basic' : 'std',
        out: OUT_UBYTE ? 'ubyte' : 'half',
        rt: RT ? 1 : 0,
        pipeline: PIPELINE_DIRECT ? 'direct' : 'default',
        ms: [orbit.ms, surface.ms, flat.ms],
        draws: [orbit.draws, surface.draws, flat.draws],
      });
      this.writeStore('spikeResults', JSON.stringify(results));
      const idx = TslWebgpuSpikePageComponent.CONFIGS.findIndex((c) => {
        const q = new URLSearchParams(c);
        return (
          q.get('backend') === BACKEND &&
          (q.get('aa') === '0') === !AA &&
          (q.get('mat') === 'basic') === BASIC &&
          (q.get('out') === 'ubyte') === OUT_UBYTE &&
          (q.get('rt') === '1') === RT &&
          (q.get('pipeline') === 'direct') === PIPELINE_DIRECT
        );
      });
      const next = TslWebgpuSpikePageComponent.CONFIGS[idx + 1];
      if (next) {
        location.assign(`${location.pathname}?${next}&auto=1`);
        return;
      }
      let gpu = 'unknown';
      try {
        const info = (
          await (
            navigator as unknown as {
              gpu?: {
                requestAdapter(): Promise<{
                  info?: { vendor?: string; description?: string };
                } | null>;
              };
            }
          ).gpu?.requestAdapter()
        )?.info;
        gpu =
          `${info?.vendor ?? ''} ${info?.description ?? ''}`.trim() ||
          'unknown';
      } catch {
        /* no adapter info */
      }
      const round = (xs: number[]) => xs.map((x) => +Number(x).toFixed(2));
      const json = JSON.stringify({
        gpu,
        res: '1280x720@1x',
        units: 'ms/frame [orbit,surface,flat], GPU-synced median of 5x150',
        runs: (
          results as {
            b: string;
            aa: number;
            mat: string;
            out: string;
            rt: number;
            pipeline: string;
            ms: number[];
            draws: number[];
          }[]
        ).map((r) => ({ ...r, ms: round(r.ms) })),
      });
      this.writeStore('spikeReport', json);
      this.report.set(json);
      this.status.set('done - copy the JSON below');
    } catch (error) {
      this.status.set(`failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** Last measurement window, readable from `javascript_tool` as `__spike.lastPerf`. */
  lastPerf: Record<string, number | string> = {};

  private flushPerf(): void {
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const info = this.engine.renderer.info as unknown as {
      render: {
        drawCalls?: number;
        calls?: number;
        triangles: number;
        timestamp?: number;
      };
    };
    this.lastPerf = {
      backend: BACKEND,
      frameMsAvg: +avg(this.frameTimes).toFixed(2),
      frameMsP95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
      cpuRenderMsAvg: +avg(this.cpuTimes).toFixed(3),
      drawCalls: info.render.drawCalls ?? info.render.calls ?? -1,
      triangles: info.render.triangles,
      gpuMs: info.render.timestamp ?? -1,
    };
    this.perf.set(JSON.stringify(this.lastPerf, null, 1));
    this.frameTimes = [];
    this.cpuTimes = [];
    const renderer = this.engine.renderer as unknown as {
      resolveTimestampsAsync?: (t: string) => Promise<unknown>;
    };
    void renderer.resolveTimestampsAsync?.('render');
  }

  /**
   * Throughput benchmark that does not depend on rAF pacing (a hidden browser pane throttles rAF):
   * renders `n` frames back to back, then waits for the GPU to finish. Returns ms per frame.
   */
  async bench(n = 120): Promise<Record<string, number | string>> {
    const r = this.engine.renderer as unknown as {
      getContext?: () => WebGL2RenderingContext;
      backend?: { device?: GPUDevice };
      render: (s: unknown, c: unknown) => void;
      info: {
        reset(): void;
        render: { drawCalls?: number; calls?: number; triangles: number };
      };
    };
    const sync = async () => {
      const device = r.backend?.device;
      if (device) await device.queue.onSubmittedWorkDone();
      else {
        // `finish()` is a no-op under ANGLE; reading a pixel back forces the GPU to drain.
        const gl = r.getContext?.();
        gl?.readPixels(
          0,
          0,
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array(4),
        );
      }
    };
    for (let i = 0; i < 10; i++) this.engine.render(performance.now(), true);
    await sync();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.engine.render(performance.now(), true);
    const tSubmit = performance.now() - t0;
    await sync();
    const total = performance.now() - t0;
    // GPU timestamp total of the last frame's render passes (native WebGPU only; -1 elsewhere).
    // It covers the scene pass and the output pass together, so compare it across `out=` configs.
    const rr = r as unknown as {
      resolveTimestampsAsync?: (t: string) => Promise<unknown>;
      info: { render: { timestamp?: number } };
    };
    await rr.resolveTimestampsAsync?.('render');
    return {
      gpuMsLastFrame: +(rr.info.render.timestamp ?? -1).toFixed?.(3),
      backend: BACKEND,
      frames: n,
      cpuSubmitMsPerFrame: +(tSubmit / n).toFixed(3),
      totalMsPerFrame: +(total / n).toFixed(3),
      drawCalls: r.info.render.drawCalls ?? r.info.render.calls ?? -1,
      triangles: r.info.render.triangles,
    };
  }

  /**
   * Draws one frame to a render target and shows it as a DOM overlay. A hidden browser pane never
   * presents canvas frames (rAF is stopped), so a screenshot of the canvas is stale; a DOM overlay is
   * composited normally. Shown linear -> sRGB with a plain gamma, so it is for eyeballing only.
   */
  async snap(width = 960, height = 540): Promise<number> {
    const r = this.engine.renderer as unknown as {
      setRenderTarget(t: RenderTarget | null): void;
      render(s: unknown, c: unknown): void;
      readRenderTargetPixelsAsync(
        t: RenderTarget,
        x: number,
        y: number,
        w: number,
        h: number,
      ): Promise<Uint16Array | Float32Array>;
    };
    const target = new RenderTarget(width, height, {
      type: HalfFloatType,
      depthBuffer: true,
    });
    this.engine.tick(performance.now());
    r.setRenderTarget(target);
    r.render(this.engine.scene, this.engine.camera);
    r.setRenderTarget(null);
    const data = await r.readRenderTargetPixelsAsync(
      target,
      0,
      0,
      width,
      height,
    );
    const half = (h: number): number => {
      const e = (h >> 10) & 31,
        m = h & 1023,
        sgn = h & 0x8000 ? -1 : 1;
      return e === 0
        ? sgn * 2 ** -14 * (m / 1024)
        : sgn * 2 ** (e - 15) * (1 + m / 1024);
    };
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const src = ((height - 1 - y) * width + x) * 4;
        const dst = (y * width + x) * 4;
        for (let k = 0; k < 3; k++) {
          const v =
            data instanceof Uint16Array ? half(data[src + k]) : data[src + k];
          image.data[dst + k] =
            255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2);
        }
        image.data[dst + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    let img = document.getElementById('snapimg') as HTMLImageElement | null;
    if (!img) {
      img = document.createElement('img');
      img.id = 'snapimg';
      img.style.cssText =
        'position:fixed;left:0;top:0;width:960px;height:540px;z-index:9999;pointer-events:none';
      document.body.appendChild(img);
    }
    img.src = canvas.toDataURL('image/png');
    target.dispose();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return 1;
  }

  private applyMapUniforms(h: IDynamicProjectionUniforms): void {
    h.uRadius.value = this.radius;
    h.uMapWidth.value = 2 * Math.PI * this.radius;
    h.uMapHeight.value = Math.PI * this.radius;
  }

  readonly meshGenerator = (
    request: ITerrainSurfaceGenerationRequest<ILatLonTerrainPatchAddress>,
  ): Promise<ITerrainPatchMesh<ILatLonTerrainPatchAddress>> => {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const workerRequest: CellPlanetMorphWorkerRequest = {
        id,
        address: request.address,
        radius: this.radius,
        baseResolution: request.baseResolution ?? request.resolution,
        resolution: request.resolution,
        edgeRefinementMask: request.edgeRefinementMask,
        edgeRefinementLevel: request.edgeRefinementLevel,
        edgeRefinementLevels: request.edgeRefinementLevels,
        edgeRefinementSegments: request.edgeRefinementSegments,
        reduction: 0.35,
        targetError: 0.08,
        projectionKind: 'equalEarth',
        colorMode: 'material',
        heightScale: getTerrainHeightScaleM(this.radius, 4),
        worldProfile: CELL_PLANET_U0_FIXTURE.worldProfile,
        seed: CELL_PLANET_U0_FIXTURE.seed,
      };
      this.worker.postMessage(workerRequest);
    });
  };

  setMorph(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    this.setMorphValue(value);
  }

  setMorphValue(value: number): void {
    const v = Math.max(0, Math.min(1, value));
    this.morphProgress.set(v);
    (BACKEND === 'classic'
      ? this.glslUniforms
      : this.nodeUniforms
    ).uMorph.value = v;
  }

  viewOrbit(): void {
    this.camPos.set([0, 0, this.radius * 2.6]);
    this.camTarget.set([0, 0, 0]);
  }

  viewSurface(): void {
    this.camPos.set([0, 300, this.radius + 700]);
    this.camTarget.set([0, 0, this.radius]);
  }

  switchBackend(backend: Backend): void {
    location.assign(`${location.pathname}?backend=${backend}`);
  }

  onLodChange(stats: ITerrainSurfaceLodStats): void {
    this.stats.set(stats);
  }
}
