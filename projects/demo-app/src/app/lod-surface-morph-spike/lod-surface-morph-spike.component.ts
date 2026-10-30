import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { Color } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  MORPH_POSE_IDS,
  createLodSurfaceMorphSpikeScene,
  type ILodSurfaceMorphSpikeDiagnostics,
  type ILodSurfaceMorphSpikeSceneHandle,
  type MorphMethod,
  type MorphPoseId,
  type MorphSpikeState,
  type CrackProbeOptions,
  type CrackRow,
  type ProbeOptions,
  type ProbeResult,
} from './core';

/** The test handle on `window`: run the precision probe and set the spike's state from the console or a test. */
export interface LodMorphSpikeWindowApi {
  runProbe(options?: ProbeOptions): Promise<ProbeResult[]>;
  setState(patch: Partial<MorphSpikeState>): void;
  getState(): MorphSpikeState;
  /** The rows of the last probe run. */
  lastProbe: ProbeResult[];
  /** Runs the crack probe (part 2): holes inside the map's outline per radius, morph and view, plus the known-bad controls. */
  runCrackProbe(options?: CrackProbeOptions): Promise<CrackRow[]>;
  /** The rows of the last crack probe run. */
  lastCrackProbe: CrackRow[];
}

declare global {
  interface Window {
    __lodMorphSpike?: LodMorphSpikeWindowApi;
  }
}

/**
 * Plan 059 morph spike (D11, before G6), part 1: the LOD terrain bent from globe to map with the vertex stage written as
 * differences from a per-frame anchor, so a 2 m view of a 600 km or 6,371 km planet keeps vertex error under a pixel at
 * morph 0.5 and 1. The page draws the bent sphere, steers the camera in the bent frame and runs a GPU precision probe
 * against a double-precision reference (`window.__lodMorphSpike.runProbe()`).
 *
 * What this file is responsible for and nothing more: providing `EngineService` (so `<scene>` in the template owns the
 * renderer, camera, tick loop, resize handling, and the free `showFPS` overlay) and wiring UI controls through to the
 * `core/` factory's handle. The mechanism under test lives in `core/`.
 */
@Component({
  selector: 'app-lod-surface-morph-spike',
  imports: [EngineModule],
  templateUrl: './lod-surface-morph-spike.component.html',
  styleUrl: './lod-surface-morph-spike.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      preferredRenderer: 'webgpu',
      webGpuRendererParameters: { antialias: false, reversedDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class LodSurfaceMorphSpikeComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scene: ILodSurfaceMorphSpikeSceneHandle;

  readonly radii = [{ label: '600 km', value: 600_000 }, { label: '6,371 km', value: 6_371_000 }];
  readonly morphPresets = [0, 1e-4, 0.5, 1];
  readonly poseIds = MORPH_POSE_IDS;
  readonly methods: MorphMethod[] = ['p2', 'naive'];

  readonly state = signal<MorphSpikeState>(undefined as unknown as MorphSpikeState);
  readonly diagnostics = signal<ILodSurfaceMorphSpikeDiagnostics | undefined>(undefined);
  readonly probeRows = signal<ProbeResult[]>([]);
  readonly probeStatus = signal('');
  readonly probeRunning = signal(false);
  readonly crackRows = signal<CrackRow[]>([]);
  readonly crackStatus = signal('');
  readonly crackRunning = signal(false);

  constructor() {
    this.engine.scene.background = new Color('#12181f');
    this.scene = createLodSurfaceMorphSpikeScene(this.engine, (diagnostics) => this.diagnostics.set(diagnostics));
    this.state.set(this.scene.getState());
    const api: LodMorphSpikeWindowApi = {
      lastProbe: [],
      lastCrackProbe: [],
      runProbe: (options) => this.runProbe(options),
      runCrackProbe: (options) => this.runCrackProbe(options),
      setState: (patch) => this.update(patch),
      getState: () => this.scene.getState(),
    };
    window.__lodMorphSpike = api;
    this.destroyRef.onDestroy(() => {
      if (window.__lodMorphSpike === api) delete window.__lodMorphSpike;
      this.scene.dispose();
    });
  }

  update(patch: Partial<MorphSpikeState>): void {
    this.scene.setState(patch);
    this.state.set(this.scene.getState());
  }

  setMorph(value: number): void {
    this.update({ morph: Math.min(1, Math.max(0, value)) });
  }

  setNumber(key: 'centreLonDeg' | 'centreLatDeg' | 'heightM', event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) this.update({ [key]: value });
  }

  setPose(id: MorphPoseId): void {
    this.update({ poseId: id });
  }

  toggleWireframe(): void {
    this.update({ wireframe: !this.state().wireframe });
  }

  async runProbe(options?: ProbeOptions): Promise<ProbeResult[]> {
    if (this.probeRunning()) throw new Error('The probe is already running');
    this.probeRunning.set(true);
    this.probeRows.set([]);
    this.probeStatus.set('running…');
    try {
      const rows: ProbeResult[] = [];
      const results = await this.scene.runProbe({
        ...options,
        onProgress: (done, total, row) => {
          rows.push(row);
          this.probeRows.set([...rows]);
          this.probeStatus.set(`${done} / ${total}`);
          options?.onProgress?.(done, total, row);
        },
      });
      this.probeStatus.set(`done, ${results.length} rows`);
      if (window.__lodMorphSpike) window.__lodMorphSpike.lastProbe = results;
      return results;
    } catch (error) {
      this.probeStatus.set(`failed: ${String(error)}`);
      throw error;
    } finally {
      this.probeRunning.set(false);
    }
  }

  async runCrackProbe(options?: CrackProbeOptions): Promise<CrackRow[]> {
    if (this.crackRunning()) throw new Error('The crack probe is already running');
    this.crackRunning.set(true);
    this.crackRows.set([]);
    this.crackStatus.set('running…');
    try {
      const rows: CrackRow[] = [];
      const results = await this.scene.runCrackProbe({
        ...options,
        onProgress: (done, total, row) => {
          rows.push(row);
          this.crackRows.set([...rows]);
          this.crackStatus.set(`${done} / ${total}`);
          options?.onProgress?.(done, total, row);
        },
      });
      this.crackStatus.set(`done, ${results.length} rows`);
      if (window.__lodMorphSpike) window.__lodMorphSpike.lastCrackProbe = results;
      return results;
    } catch (error) {
      this.crackStatus.set(`failed: ${String(error)}`);
      throw error;
    } finally {
      this.crackRunning.set(false);
    }
  }

  /** The pole bands of a row as a tooltip: vertices, max px, p99 px, worst distance. */
  bandsText(row: ProbeResult): string {
    return row.poleBands
      .map((b) => `q ${b.label}: n ${b.vertices}, max ${this.fmt(b.maxErrPx)} px, p99 ${this.fmt(b.p99ErrPx)} px, worst at ${this.fmt(b.worstDistM)} m`)
      .join('\n');
  }

  /** Metres and pixels with three significant figures. */
  fmt(value: number): string {
    if (value === 0) return '0';
    const abs = Math.abs(value);
    return abs >= 1000 || abs < 0.001 ? value.toExponential(2) : value.toPrecision(3);
  }
}
