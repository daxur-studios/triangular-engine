import { signal } from '@angular/core';
import { IEngine } from './engine.model';

/**
 * Controller for tracking and evaluating engine performance telemetry.
 *
 * Keeps track of frames per second, average frame duration (CPU/GPU main thread execution time),
 * draw calls, triangle count, resource memory usage, and shader compiles. Evaluates status
 * (good, warning, critical) based on customizable performance thresholds.
 */
export class FPSController {
  lastRenderTime = -1;
  fpsLimitInterval = 0;

  previousSecond = performance.now();

  /** The number of frames in the current second */
  frameCount = 0;
  private accumulatedFrameTime = 0;

  /** Throttled performance indicators updated once per second */
  readonly displayCount = signal(this.frameCount);
  readonly frameTime = signal<number>(0);
  readonly drawCalls = signal<number>(0);
  readonly triangles = signal<number>(0);
  readonly geometries = signal<number>(0);
  readonly textures = signal<number>(0);
  readonly programs = signal<number>(0);
  readonly status = signal<'good' | 'warning' | 'critical'>('good');

  graph: number[] = [];

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

    const now = performance.now();
    const ONE_SECOND = 1000;

    if (now - this.previousSecond >= ONE_SECOND) {
      const actualFrames = this.frameCount;
      this.displayCount.set(actualFrames);

      const avgFrameTime = actualFrames > 0 ? this.accumulatedFrameTime / actualFrames : 0;
      this.frameTime.set(avgFrameTime);

      this.graph.push(actualFrames);
      if (this.graph.length > 60) {
        this.graph.shift();
      }

      const renderer = this.engineService.renderer;
      if (renderer) {
        const info = renderer.info as any;
        const drawCallsVal = info?.render?.calls ?? info?.render?.drawCalls ?? 0;
        const trianglesVal = info?.render?.triangles ?? 0;
        const geometriesVal = info?.memory?.geometries ?? 0;
        const texturesVal = info?.memory?.textures ?? 0;
        const programsVal = info?.programs?.length ?? 0;

        this.drawCalls.set(drawCallsVal);
        this.triangles.set(trianglesVal);
        this.geometries.set(geometriesVal);
        this.textures.set(texturesVal);
        this.programs.set(programsVal);

        this.updateStatus(avgFrameTime, drawCallsVal, trianglesVal);
      } else {
        this.updateStatus(avgFrameTime, 0, 0);
      }

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

    if (
      frameTimeMs >= maxFrameTimeCrit ||
      drawCalls >= maxDrawCallsCrit ||
      triangles >= maxTrianglesCrit
    ) {
      this.status.set('critical');
    } else if (
      frameTimeMs >= maxFrameTimeWarn ||
      drawCalls >= maxDrawCallsWarn ||
      triangles >= maxTrianglesWarn
    ) {
      this.status.set('warning');
    } else {
      this.status.set('good');
    }
  }
}
