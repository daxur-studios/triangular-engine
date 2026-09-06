import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { Color, Vector3 } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  createGpuMorphLodScene,
  LEVEL_COUNT,
  type IGpuMorphLodSceneHandle,
} from './core';

/**
 * Camera distances (metres from the origin) probed by
 * `runDiagnosticsCapture()`'s draw-call sweep. Chosen to straddle the
 * clipmap's level rings (see constants.ts's `FINEST_SWITCH_DISTANCE_M` doc
 * comment: level radii are 64/128/256/512m) from well inside level 0 to
 * past the coarsest level.
 */
const DIAGNOSTICS_SWEEP_DISTANCES_M = [30, 150, 600, 3000] as const;

/** ~2s of samples at 60fps, used by the frozen-camera stability check. */
const DIAGNOSTICS_STABILITY_FRAME_COUNT = 120;

/**
 * Attempt #5, Spike 1: shared-vertex-buffer + GPU vertex-shader height/morph
 * LOD (see docs/runbook/028_planet_terrain_attempt_history.md). Uses
 * triangular-engine's `<scene>` only for renderer/camera/tick-loop plumbing
 * and its `showFPS` overlay — the LOD/morph mechanism itself (./core/*.ts)
 * is plain Three.js with no engine coupling, to keep it isolated from any
 * production terrain code.
 */
@Component({
  selector: 'app-gpu-morph-lod-spike',
  imports: [EngineModule],
  templateUrl: './gpu-morph-lod-spike.component.html',
  styleUrl: './gpu-morph-lod-spike.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class GpuMorphLodSpikeComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scene: IGpuMorphLodSceneHandle;

  readonly wireframe = signal(false);
  readonly showLevelTint = signal(true);
  readonly morphEnabled = signal(true);
  readonly frozen = signal(false);
  readonly terrainKind = signal<'wave' | 'noise'>('wave');

  readonly drawCalls = signal(0);
  readonly triangles = signal(0);
  readonly instanceCountsByLevel = signal<readonly number[]>([]);

  /** Bound to `<orbitControls [cameraPosition]>`; only mutated by the user's
   * initial camera and by `runDiagnosticsCapture()`'s sweep — never read
   * every change-detection cycle, so it never fights live orbit dragging. */
  readonly cameraPosition = signal<[number, number, number]>([60, 45, 60]);

  readonly isCapturingDiagnostics = signal(false);
  readonly diagnosticsReport = signal<string | null>(null);
  readonly diagnosticsCopied = signal(false);

  constructor() {
    this.engine.scene.background = new Color('#12181f');
    this.scene = createGpuMorphLodScene(this.engine, (diagnostics) => {
      this.drawCalls.set(diagnostics.drawCalls);
      this.triangles.set(diagnostics.triangles);
      this.instanceCountsByLevel.set(diagnostics.instanceCountsByLevel);
    });
    this.destroyRef.onDestroy(() => this.scene.dispose());
  }

  toggleWireframe(): void {
    this.wireframe.update((enabled) => !enabled);
    this.scene.setWireframe(this.wireframe());
  }

  toggleShowLevelTint(): void {
    this.showLevelTint.update((enabled) => !enabled);
    this.scene.setShowLevelTint(this.showLevelTint());
  }

  toggleMorph(): void {
    this.morphEnabled.update((enabled) => !enabled);
    this.scene.setMorphEnabled(this.morphEnabled());
  }

  toggleFrozen(): void {
    this.frozen.update((enabled) => !enabled);
    this.scene.setFrozen(this.frozen());
  }

  setTerrainKind(kind: 'wave' | 'noise'): void {
    this.terrainKind.set(kind);
    this.scene.setTerrainKind(kind);
  }

  instanceCountsLabel(): string {
    return this.instanceCountsByLevel()
      .map((count, level) => `L${level}: ${count}`)
      .join(' · ');
  }

  /**
   * Automated, token-efficient stand-in for eyeballing the diagnostics
   * panel: sweeps the camera through fixed distances to check the draw-call
   * bound holds at every LOD level, then freezes the camera to check for
   * the CS-019-style flicker (any per-frame draw-call/triangle variation
   * with a static view and no edits). Produces a compact plain-text report
   * instead of raw per-frame logs, copied to the clipboard so it can be
   * pasted back for review before marking this spike's status 'passed' in
   * `pages/spikes-index/spikes-index.component.ts`.
   *
   * Does NOT check crack-freeness (a visual property — use the wireframe +
   * morph toggles for that) or terrain-shape quality (out of scope for this
   * spike, see shader.ts's doc comment).
   */
  async runDiagnosticsCapture(): Promise<void> {
    if (this.isCapturingDiagnostics()) return;
    this.isCapturingDiagnostics.set(true);
    this.diagnosticsReport.set(null);

    const wasFrozen = this.frozen();
    const restorePosition = this.cameraPosition();
    const camera = this.engine.camera$.value;
    const direction = camera
      ? camera.position.clone().normalize()
      : new Vector3(1, 1, 1).normalize();

    const sweepLines: string[] = [];
    let maxSweepDrawCalls = 0;

    for (const distanceM of DIAGNOSTICS_SWEEP_DISTANCES_M) {
      this.cameraPosition.set([
        direction.x * distanceM,
        direction.y * distanceM,
        direction.z * distanceM,
      ]);
      await this.waitFrames(30); // let the clipmap settle at the new distance
      const d = this.scene.getDiagnosticsSnapshot();
      maxSweepDrawCalls = Math.max(maxSweepDrawCalls, d.drawCalls);
      sweepLines.push(
        `  ${distanceM}m -> calls=${d.drawCalls} tris=${d.triangles} instances=[${d.instanceCountsByLevel.join(',')}]`,
      );
    }

    this.cameraPosition.set(restorePosition);
    await this.waitFrames(5);
    this.scene.setFrozen(true);

    let minCalls = Infinity;
    let maxCalls = -Infinity;
    let minTris = Infinity;
    let maxTris = -Infinity;
    for (let i = 0; i < DIAGNOSTICS_STABILITY_FRAME_COUNT; i++) {
      await this.waitFrames(1);
      const d = this.scene.getDiagnosticsSnapshot();
      minCalls = Math.min(minCalls, d.drawCalls);
      maxCalls = Math.max(maxCalls, d.drawCalls);
      minTris = Math.min(minTris, d.triangles);
      maxTris = Math.max(maxTris, d.triangles);
    }
    this.scene.setFrozen(wasFrozen);

    const report = [
      `=== gpu-morph-lod-spike diagnostics ===`,
      `Terrain: ${this.terrainKind()} | Morph: ${this.morphEnabled() ? 'ON' : 'OFF'} | LevelTint: ${this.showLevelTint() ? 'ON' : 'OFF'} | Wireframe: ${this.wireframe() ? 'ON' : 'OFF'}`,
      `Draw-call sweep (camera distance from origin):`,
      ...sweepLines,
      `Max draw calls across sweep: ${maxSweepDrawCalls} (bound: <=${LEVEL_COUNT}) -> ${maxSweepDrawCalls <= LEVEL_COUNT ? 'PASS' : 'FAIL'}`,
      `Frozen-camera stability (${DIAGNOSTICS_STABILITY_FRAME_COUNT} frames @ static view):`,
      `  drawCalls min/max: ${minCalls}/${maxCalls} (delta ${maxCalls - minCalls}) -> ${maxCalls === minCalls ? 'STABLE' : 'FLICKER DETECTED'}`,
      `  triangles min/max: ${minTris}/${maxTris} (delta ${maxTris - minTris}) -> ${maxTris === minTris ? 'STABLE' : 'FLICKER DETECTED'}`,
      `(Not checked here — judge visually: crack-freeness with morph on/off, terrain shape/quality)`,
      `========================================`,
    ].join('\n');

    this.diagnosticsReport.set(report);
    this.isCapturingDiagnostics.set(false);

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(report)
        .then(() => {
          this.diagnosticsCopied.set(true);
          setTimeout(() => this.diagnosticsCopied.set(false), 2000);
        })
        .catch(() => undefined);
    }
  }

  private waitFrames(count: number): Promise<void> {
    return new Promise((resolve) => {
      let remaining = count;
      const step = () => {
        remaining--;
        if (remaining <= 0) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
}
