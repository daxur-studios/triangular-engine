import { signal } from '@angular/core';
import { Camera, OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { IEngine } from './engine.model';
import { TelemetrySections } from './telemetry-sections.model';
import { FrameSampler, IGpuPassBatchRecord } from './frame-sampler';

export enum CameraAction {
  None = 0,
  Rotate = 1 << 0,
  Zoom = 1 << 1,
  Move = 1 << 2,
  /** Position and orientation changed in the same frame (orbit-style camera motion). */
  Orbit = 1 << 3,
}

export type CameraActionTag =
  | 'idle'
  | 'rot'
  | 'zoom'
  | 'move'
  | 'rot+zoom'
  | 'move+rot'
  | 'move+zoom'
  | 'orbit'
  | 'orbit+zoom'
  | 'multi';

export interface IPerformanceDropEvent {
  readonly timestamp: number;
  readonly baselineFps: number;
  readonly dropFps: number;
  /** Longest gap between two consecutive frames during the drop second (includes GPU/vsync stalls). */
  readonly worstFrameMs: number;
  readonly cameraAction: CameraActionTag;
  readonly cameraPosition: [number, number, number];
  readonly drawCallsDelta: number;
  readonly trianglesDelta: number;
  /** Page telemetry sections as they read when the drop was detected; see `FPSController.telemetry`. */
  readonly pageSections?: string;
}

/**
 * Controller for tracking and evaluating engine performance telemetry.
 *
 * Keeps track of frames per second, average frame duration (CPU/GPU main thread execution time),
 * draw calls, triangle count, resource memory usage, shader compiles, and camera activity.
 * Evaluates status (good, warning, critical) based on customizable performance thresholds.
 */
export class FPSController {
  lastRenderTime = -1;
  fpsLimitInterval = 0;
  /** Page-supplied sections appended to `formatTelemetryForAgent`. */
  readonly telemetry = new TelemetrySections();
  /** Per-frame timing inside an explicit window (Plan 052). Idle, and free, until `start()`. */
  readonly frameSampler = new FrameSampler();

  previousSecond = performance.now();

  /** The number of frames in the current second */
  frameCount = 0;
  private accumulatedFrameTime = 0;
  private lastFrameStamp = -1;
  private currentSecondPeakInterval = 0;
  private readonly intervalPeaks: number[] = [];

  /** Throttled performance indicators updated once per second */
  readonly displayCount = signal(this.frameCount);
  readonly frameTime = signal<number>(0);
  /**
   * Frame rate the engine could sustain without the display's vsync cap: 1000 / the slower of
   * average tick + render (CPU) time and average GPU time. GPU time is only included when
   * `gpuTiming` is enabled; 0 until the first second.
   */
  readonly uncappedFps = signal<number>(0);
  private gpuSampleSum = 0;
  private gpuSampleCount = 0;
  readonly drawCalls = signal<number>(0);
  readonly triangles = signal<number>(0);
  readonly geometries = signal<number>(0);
  readonly textures = signal<number>(0);
  readonly programs = signal<number>(0);
  readonly materials = signal<number>(0);
  readonly geometryBytes = signal<number>(0);
  readonly textureBytes = signal<number>(0);
  readonly cpuFrameTime = signal<number>(0);
  readonly gpuFrameTime = signal<number | null>(null);
  readonly physicsTime = signal<number>(0);
  readonly assetLoadingTime = signal<number>(0);
  readonly status = signal<'good' | 'warning' | 'critical'>('good');
  /** Which budget(s) put `status` at its current level; empty when good. */
  readonly statusReason = signal<string>('');

  /** Sliding 60-second telemetry history */
  graph: number[] = [];
  readonly fpsHistory = signal<readonly number[]>([]);
  readonly cameraHistory = signal<readonly CameraActionTag[]>([]);
  readonly minFps = signal<number>(60);
  readonly maxSpikeMs = signal<number>(0);
  readonly recentDropEvent = signal<IPerformanceDropEvent | null>(null);

  private readonly prevCamPos = new Vector3();
  private readonly prevCamQuat = new Quaternion();
  private prevCamZoomOrFov = 0;
  private hasCamBaseline = false;
  private currentSecondCamActions = CameraAction.None;
  private readonly motionHistoryList: CameraActionTag[] = [];
  private prevDrawCalls = 0;
  private prevTriangles = 0;

  /**
   * Records one GPU frame duration from a resolved timestamp query. Averaged into
   * `gpuFrameTime` once per second, alongside the CPU figures.
   */
  recordGpuFrameTime(milliseconds: number): void {
    this.gpuSampleSum += milliseconds;
    this.gpuSampleCount++;
    this.frameSampler.recordGpu(milliseconds);
  }

  /** Records one resolved timestamp batch split by render pass; only an open `frameSampler` window keeps it. */
  recordGpuPasses(record: IGpuPassBatchRecord): void {
    this.frameSampler.recordGpuPasses(record);
  }

  recordPhysicsTime(milliseconds: number): void {
    this.physicsTime.set(milliseconds);
  }

  recordAssetLoadingTime(milliseconds: number): void {
    this.assetLoadingTime.set(milliseconds);
  }

  constructor(public readonly engineService: IEngine) {}

  /**
   * Records a frame duration and updates telemetry metrics on second boundaries.
   * Called automatically by the animation loop.
   *
   * @param frameTimeMs Duration of the frame tick & render in milliseconds.
   */
  recordFrame(frameTimeMs: number) {
    this.frameCount++;
    this.accumulatedFrameTime += frameTimeMs;
    this.cpuFrameTime.set(frameTimeMs);

    // Real frame-to-frame interval: unlike frameTimeMs (CPU time in the tick) this also
    // captures GPU back-pressure, vsync waits, GC pauses and main-thread stalls.
    const stamp = performance.now();
    let interval = -1;
    if (this.lastFrameStamp >= 0) {
      interval = stamp - this.lastFrameStamp;
      // Ignore tab-suspend gaps; they are not rendering hitches.
      if (interval < 2000 && interval > this.currentSecondPeakInterval) {
        this.currentSecondPeakInterval = interval;
      }
    }
    this.lastFrameStamp = stamp;
    this.frameSampler.recordFrame(frameTimeMs, interval < 2000 ? interval : -1);

    // Track camera movement for this frame
    const camera = this.engineService.camera;
    if (camera) {
      const isPerspective =
        (camera as any).isPerspectiveCamera ?? (camera instanceof PerspectiveCamera);
      const currentZoomOrFov = isPerspective
        ? ((camera as PerspectiveCamera).fov ?? 50) * ((camera as PerspectiveCamera).zoom ?? 1)
        : ((camera as OrthographicCamera).zoom ?? 1);

      if (this.hasCamBaseline) {
        const posDelta = camera.position.distanceTo(this.prevCamPos);
        const rotDelta = camera.quaternion.angleTo(this.prevCamQuat);
        const zoomDelta = Math.abs(currentZoomOrFov - this.prevCamZoomOrFov);

        const moved = posDelta > 0.05;
        const rotated = rotDelta > 0.005;
        if (moved && rotated) {
          this.currentSecondCamActions |= CameraAction.Orbit;
        } else if (moved) {
          this.currentSecondCamActions |= CameraAction.Move;
        } else if (rotated) {
          this.currentSecondCamActions |= CameraAction.Rotate;
        }
        if (zoomDelta > 0.02) {
          this.currentSecondCamActions |= CameraAction.Zoom;
        }
      } else {
        this.hasCamBaseline = true;
      }

      this.prevCamPos.copy(camera.position);
      this.prevCamQuat.copy(camera.quaternion);
      this.prevCamZoomOrFov = currentZoomOrFov;
    }

    const now = performance.now();
    const ONE_SECOND = 1000;

    if (now - this.previousSecond >= ONE_SECOND) {
      const actualFrames = this.frameCount;
      this.displayCount.set(actualFrames);

      const avgFrameTime = actualFrames > 0 ? this.accumulatedFrameTime / actualFrames : 0;
      this.frameTime.set(avgFrameTime);
      const avgGpuTime = this.gpuSampleCount > 0 ? this.gpuSampleSum / this.gpuSampleCount : null;
      this.gpuFrameTime.set(avgGpuTime === null ? null : Number(avgGpuTime.toFixed(1)));
      this.gpuSampleSum = 0;
      this.gpuSampleCount = 0;
      // The slower of CPU and GPU work sets the ceiling; GPU is absent unless `gpuTiming` is on.
      const ceilingMs = Math.max(avgFrameTime, avgGpuTime ?? 0);
      this.uncappedFps.set(ceilingMs > 0 ? Math.round(1000 / ceilingMs) : 0);

      this.graph.push(actualFrames);
      if (this.graph.length > 60) {
        this.graph.shift();
      }

      const tag = this.classifyCameraActions(this.currentSecondCamActions);
      this.currentSecondCamActions = CameraAction.None;

      this.motionHistoryList.push(tag);
      if (this.motionHistoryList.length > 60) {
        this.motionHistoryList.shift();
      }
      this.cameraHistory.set([...this.motionHistoryList]);
      this.fpsHistory.set([...this.graph]);

      if (this.graph.length > 0) {
        this.minFps.set(Math.min(...this.graph));
      }
      this.intervalPeaks.push(this.currentSecondPeakInterval);
      if (this.intervalPeaks.length > 60) {
        this.intervalPeaks.shift();
      }
      this.maxSpikeMs.set(Math.max(...this.intervalPeaks));

      const renderer = this.engineService.renderer;
      if (renderer) {
        const info = renderer.info as any;
        const drawCallsVal = info?.render?.drawCalls ?? info?.render?.calls ?? 0;
        const trianglesVal = info?.render?.triangles ?? 0;
        const geometriesVal = info?.memory?.geometries ?? 0;
        const texturesVal = info?.memory?.textures ?? 0;
        const programsVal = info?.programs?.length ?? 0;
        // Walking the whole scene costs render-thread time, so it is skipped inside a frame window
        // (`frameSampler`). The memory figures keep their last values until the window ends.
        const walkScene = !this.frameSampler.isActive;
        const materials = new Set<string>();
        let geometryBytes = this.geometryBytes();
        let textureBytes = this.textureBytes();
        let materialCount = this.materials();
        if (walkScene) {
          this.engineService.scene.traverse((object: any) => {
            if (object.material) {
              const list = Array.isArray(object.material) ? object.material : [object.material];
              for (const material of list) materials.add(material.uuid);
            }
            const geometry = object.geometry;
            if (geometry?.attributes) for (const attribute of Object.values(geometry.attributes) as any[]) geometryBytes += attribute.array?.byteLength ?? 0;
            if (geometry?.index?.array) geometryBytes += geometry.index.array.byteLength;
            const materialList = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
            for (const material of materialList) for (const value of Object.values(material)) {
              if ((value as any)?.isTexture && (value as any).image) textureBytes += ((value as any).image.width ?? 0) * ((value as any).image.height ?? 0) * 4;
            }
          });
          materialCount = materials.size;
        }

        this.drawCalls.set(drawCallsVal);
        this.triangles.set(trianglesVal);
        this.geometries.set(geometriesVal);
        this.textures.set(texturesVal);
        this.programs.set(programsVal);
        this.materials.set(materialCount);
        this.geometryBytes.set(geometryBytes);
        this.textureBytes.set(textureBytes);

        // Detect frame drops: >=20% below the mean of the previous (up to) 5 seconds,
        // so gradual declines are caught as well as sudden ones.
        const baselineFps = this.rollingBaselineFps();
        if (
          (actualFrames <= baselineFps * 0.8 && baselineFps >= 20) ||
          (avgFrameTime >= 33.3 && baselineFps > 35)
        ) {
          const camPos: [number, number, number] = camera
            ? [
                Number(camera.position.x.toFixed(1)),
                Number(camera.position.y.toFixed(1)),
                Number(camera.position.z.toFixed(1)),
              ]
            : [0, 0, 0];

          // Captured now, so the report can show page state from the drop, not from copy time.
          const pageSections = this.telemetry.format();
          this.recentDropEvent.set({
            timestamp: now,
            baselineFps,
            dropFps: actualFrames,
            worstFrameMs: Number(this.currentSecondPeakInterval.toFixed(1)),
            cameraAction: tag,
            cameraPosition: camPos,
            drawCallsDelta: drawCallsVal - this.prevDrawCalls,
            trianglesDelta: trianglesVal - this.prevTriangles,
            pageSections,
          });
        }

        this.prevDrawCalls = drawCallsVal;
        this.prevTriangles = trianglesVal;

        this.updateStatus(avgFrameTime, drawCallsVal, trianglesVal);
      } else {
        this.updateStatus(avgFrameTime, 0, 0);
      }

      this.currentSecondPeakInterval = 0;
      this.frameCount = 0;
      this.accumulatedFrameTime = 0;
      this.previousSecond = now;
    }
  }

  /**
   * Evaluates performance numbers against warning and critical thresholds.
   */
  private updateStatus(frameTimeMs: number, drawCalls: number, triangles: number) {
    const options = this.engineService.options;
    const thresholds = options?.performanceThresholds || {};

    const maxFrameTimeWarn = thresholds.maxFrameTimeWarning ?? 16.6; // ~60 FPS
    const maxFrameTimeCrit = thresholds.maxFrameTimeCritical ?? 33.3; // ~30 FPS

    const maxDrawCallsWarn = thresholds.maxDrawCallsWarning ?? 150;
    const maxDrawCallsCrit = thresholds.maxDrawCallsCritical ?? 300;

    const maxTrianglesWarn = thresholds.maxTrianglesWarning ?? 1000000;
    const maxTrianglesCrit = thresholds.maxTrianglesCritical ?? 2000000;

    const critical: string[] = [];
    const warning: string[] = [];
    const check = (value: number, warn: number, crit: number, label: string, fmt: (n: number) => string) => {
      if (value >= crit) {
        critical.push(`${label}>=${fmt(crit)}`);
      } else if (value >= warn) {
        warning.push(`${label}>=${fmt(warn)}`);
      }
    };
    check(frameTimeMs, maxFrameTimeWarn, maxFrameTimeCrit, 'cpu', (n) => `${n}ms`);
    check(drawCalls, maxDrawCallsWarn, maxDrawCallsCrit, 'calls', (n) => `${n}`);
    check(triangles, maxTrianglesWarn, maxTrianglesCrit, 'tris', (n) => this.formatMetric(n));

    if (critical.length > 0) {
      this.status.set('critical');
      this.statusReason.set(critical.join(','));
    } else if (warning.length > 0) {
      this.status.set('warning');
      this.statusReason.set(warning.join(','));
    } else {
      this.status.set('good');
      this.statusReason.set('');
    }
  }

  /** Mean FPS of up to 5 seconds preceding the current sample (60 when no history exists). */
  private rollingBaselineFps(): number {
    const prior = this.graph.slice(-6, -1);
    if (prior.length === 0) {
      return 60;
    }
    return Math.round(prior.reduce((a, b) => a + b, 0) / prior.length);
  }

  private classifyCameraActions(mask: number): CameraActionTag {
    const orbit = (mask & CameraAction.Orbit) !== 0;
    // Orbit implies position + orientation change, so it subsumes move/rotate.
    const move = !orbit && (mask & CameraAction.Move) !== 0;
    const rot = !orbit && (mask & CameraAction.Rotate) !== 0;
    const zoom = (mask & CameraAction.Zoom) !== 0;
    const count = +orbit + +move + +rot + +zoom;

    if (count === 0) return 'idle';
    if (count > 2) return 'multi';
    if (orbit) return zoom ? 'orbit+zoom' : 'orbit';
    if (move && rot) return 'move+rot';
    if (move && zoom) return 'move+zoom';
    if (rot && zoom) return 'rot+zoom';
    return move ? 'move' : rot ? 'rot' : 'zoom';
  }

  /**
   * Formats the current performance state, recent history, and drop cause
   * into a compact token-efficient markdown snippet (~50-80 tokens) for AI agents.
   */
  formatTelemetryForAgent(): string {
    const fps = this.displayCount();
    const avgFps =
      this.graph.length > 0
        ? Math.round(this.graph.reduce((a, b) => a + b, 0) / this.graph.length)
        : fps;
    const minFps = this.minFps();
    const maxSpike = this.maxSpikeMs().toFixed(1);
    const status = this.statusReason() ? `${this.status()} (${this.statusReason()})` : this.status();

    const renderer = this.engineService.renderer;
    const rendererType = (renderer as any)?.isWebGPURenderer ? 'WebGPU' : 'WebGL2';
    const width = Math.round(this.engineService.width ?? 0);
    const height = Math.round(this.engineService.height ?? 0);
    const pixelRatio = (renderer as any)?.getPixelRatio ? (renderer as any).getPixelRatio() : 1;

    const calls = this.drawCalls();
    const tris = this.triangles();
    const shaders = this.programs();
    const mats = this.materials();
    const geoMB = (this.geometryBytes() / (1024 * 1024)).toFixed(1);
    const texMB = (this.textureBytes() / (1024 * 1024)).toFixed(1);

    const cpuMs = this.cpuFrameTime().toFixed(1);
    const gpu = this.gpuFrameTime();
    // Omit timings that are unavailable or zero to keep the report compact.
    const timing = [
      `cpu ${cpuMs}ms`,
      gpu !== null ? `gpu ${gpu.toFixed(1)}ms` : '',
      this.physicsTime() > 0 ? `physics ${this.physicsTime().toFixed(1)}ms` : '',
      this.assetLoadingTime() > 0 ? `assetLoad ${this.assetLoadingTime().toFixed(1)}ms` : '',
    ]
      .filter(Boolean)
      .join(', ');

    const camera = this.engineService.camera;
    let camStr = 'none';
    if (camera) {
      const px = camera.position.x.toFixed(1);
      const py = camera.position.y.toFixed(1);
      const pz = camera.position.z.toFixed(1);
      const rx = camera.rotation.x.toFixed(2);
      const ry = camera.rotation.y.toFixed(2);
      camStr = `pos(${px}, ${py}, ${pz}) rot(${rx}, ${ry})`;
    }

    const drop = this.recentDropEvent();
    const dropAgeS = drop ? Math.round((performance.now() - drop.timestamp) / 1000) : 0;
    let dropStr = '';
    // Only report drops still inside the 60s history window; older ones are stale.
    if (drop && dropAgeS <= 60) {
      const sign = (n: number): string => (n >= 0 ? `+${this.formatMetric(n)}` : this.formatMetric(n));
      const atDrop = drop.pageSections
        ? `\n  at drop:\n${drop.pageSections
            .split('\n')
            .map((line) => `    ${line}`)
            .join('\n')}`
        : '';
      dropStr = `
drop_event (${dropAgeS}s ago): ${drop.baselineFps}fps -> ${drop.dropFps}fps on ${drop.cameraAction.toUpperCase()} (worstFrame: ${drop.worstFrameMs}ms, calls: ${sign(drop.drawCallsDelta)}, tris: ${sign(drop.trianglesDelta)})${atDrop}`;
    }

    const recentCount = Math.min(10, this.graph.length);
    const recentFps = this.graph.slice(-recentCount);
    const recentCam = this.cameraHistory().slice(-recentCount).map((c) => (c === 'idle' ? '-' : c));

    const timelineStr =
      recentCount > 0
        ? `\ntimeline (last ${recentCount}s):\n  fps: [${recentFps.join(', ')}]\n  cam: [${recentCam.join(', ')}]`
        : '';

    const pageSections = this.telemetry.format();
    const pageStr = pageSections ? `\n${pageSections}` : '';

    return `\`\`\`triangular-telemetry
status: ${status} | fps: ${fps} (uncapped ~${this.uncappedFps()}, avg: ${avgFps}, min: ${minFps}) | worstFrame60s: ${maxSpike}ms
viewport: ${width}x${height}@${pixelRatio} | renderer: ${rendererType}
calls: ${calls} | tris: ${this.formatMetric(tris)} | shaders: ${shaders} | mats: ${mats}
mem: geo ${geoMB}MB, tex ${texMB}MB | timing: ${timing}
camera: ${camStr}${dropStr}${timelineStr}${pageStr}
\`\`\``;
  }

  private formatMetric(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) {
      return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (abs >= 1_000) {
      return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return value.toString();
  }
}
