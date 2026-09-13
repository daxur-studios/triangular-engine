import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { Vector3 } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  createClipmapFarCoverageSpikeScene,
  FAR_COVERAGE_LEVEL_COUNT,
  FAR_COVERAGE_OUTER_RADIUS_M,
  type IClipmapFarCoverageSpikeSceneHandle,
} from './core';

/**
 * Camera distances (metres from the origin) probed by the draw-call sweep —
 * spans from well inside the finest ring out past the outermost one, so the
 * bounded-draw-call claim is checked at horizon scale, not just near field.
 */
const DIAGNOSTICS_SWEEP_DISTANCES_M = [
  30, 500, 4000, 20000, FAR_COVERAGE_OUTER_RADIUS_M * 1.2,
] as const;

/** ~2s of samples at 60fps, used by the frozen-camera stability check. */
const DIAGNOSTICS_STABILITY_FRAME_COUNT = 120;

/**
 * Falsifies: horizon-scale clipmap coverage can add outward LOD rings past
 * the already-passed near-boundary case (gpu-morph-lod-spike) while keeping
 * draw calls bounded to one InstancedMesh per LOD level and visual detail
 * acceptable at long range — the "far coverage" half of runbook 028's
 * Candidate B (Spike 4 territory) that the near-boundary spike never tested.
 *
 * What this file is responsible for and nothing more: providing
 * `EngineService` (so `<scene>` in the template owns the renderer, camera,
 * tick loop, resize handling, and the free `showFPS` overlay) and wiring UI
 * toggles through to the `core/` factory's handle. The actual mechanism
 * under test belongs entirely in `core/`, which is a thin configuration of
 * the already-promoted `triangular-engine/terrain` clipmap scene builder.
 */
@Component({
  selector: 'app-clipmap-far-coverage-spike',
  imports: [EngineModule, DecimalPipe],
  templateUrl: './clipmap-far-coverage-spike.component.html',
  styleUrl: './clipmap-far-coverage-spike.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class ClipmapFarCoverageSpikeComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scene: IClipmapFarCoverageSpikeSceneHandle;

  readonly levelCount = FAR_COVERAGE_LEVEL_COUNT;
  readonly outerRadiusM = FAR_COVERAGE_OUTER_RADIUS_M;

  readonly wireframe = signal(false);
  readonly showLevelTint = signal(true);
  readonly morphEnabled = signal(true);
  readonly frozen = signal(false);
  // 'wave' (sin/cos) stays visually sane at horizon-scale world coordinates;
  // 'noise' is fbm/hash-based and its fract()-heavy hash loses precision in
  // single-precision GLSL floats well before 100km, degenerating into flat
  // bands/spikes — a known limitation of this analytic stand-in height
  // function (see clipmap-terrain-material.ts's doc header), not of the
  // clipmap ring-extension mechanism itself. Default to 'wave' here so the
  // far-field view is legible; 'noise' is still available to toggle and
  // demonstrates the precision limit directly.
  readonly terrainKind = signal<'wave' | 'noise'>('wave');
  readonly debugFlat = signal(false);
  readonly debugViewMode = signal<number>(0);

  readonly drawCalls = signal(0);
  readonly triangles = signal(0);
  readonly instanceCountsByLevel = signal<readonly number[]>([]);

  /** Bound to `<orbitControls [cameraPosition]>`; only mutated by the user's
   * initial camera and by `flyToDistance()` / the diagnostics sweep — never
   * read every change-detection cycle, so it never fights live orbit
   * dragging. `far` is set to Number.MAX_SAFE_INTEGER by orbitControls by
   * default, so no far-plane clipping at these ranges. */
  readonly cameraPosition = signal<[number, number, number]>([60, 45, 60]);
  readonly cameraDistanceM = signal(0);

  readonly isCapturingDiagnostics = signal(false);
  readonly diagnosticsReport = signal<string | null>(null);
  readonly diagnosticsCopied = signal(false);

  constructor() {
    this.scene = createClipmapFarCoverageSpikeScene(this.engine, (diagnostics) => {
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

  toggleDebugFlat(): void {
    this.debugFlat.update((flat) => !flat);
    this.scene.setDebugFlatTerrain(this.debugFlat());
  }

  setDebugViewMode(mode: number): void {
    this.debugViewMode.set(mode);
    this.scene.setDebugViewMode(mode);
  }

  /** Flies the camera outward along its current direction, for eyeballing
   * outer-ring detail/popping at a chosen distance. */
  flyToDistance(distanceM: number): void {
    const camera = this.engine.camera$.value;
    const direction = camera
      ? camera.position.clone().normalize()
      : new Vector3(1, 0.5, 1).normalize();
    this.cameraPosition.set([
      direction.x * distanceM,
      direction.y * distanceM,
      direction.z * distanceM,
    ]);
    this.cameraDistanceM.set(distanceM);
  }

  instanceCountsLabel(): string {
    return this.instanceCountsByLevel()
      .map((count, level) => `L${level}: ${count}`)
      .join(' · ');
  }

  /**
   * Automated, token-efficient stand-in for eyeballing the diagnostics
   * panel: sweeps the camera through fixed distances (near field out to past
   * the outermost ring) to check the draw-call bound holds at every
   * distance, then freezes the camera to check for per-frame draw-call/
   * triangle flicker. Produces a compact plain-text report instead of raw
   * per-frame logs, copied to the clipboard so it can be pasted back for
   * review before marking this spike's status in
   * `pages/spikes-index/spikes-index.component.ts`.
   *
   * Does NOT check outer-ring visual popping (a visual property — use
   * `flyToDistance()` plus the level-tint/wireframe toggles for that).
   */
  async runDiagnosticsCapture(): Promise<void> {
    if (this.isCapturingDiagnostics()) return;
    this.isCapturingDiagnostics.set(true);
    this.diagnosticsReport.set(null);

    const wasFrozen = this.frozen();
    const restorePosition = this.cameraPosition();

    const sweepLines: string[] = [];
    let maxSweepDrawCalls = 0;

    for (const distanceM of DIAGNOSTICS_SWEEP_DISTANCES_M) {
      this.flyToDistance(distanceM);
      await this.waitFrames(30); // let the clipmap settle at the new distance
      const d = this.scene.getDiagnosticsSnapshot();
      maxSweepDrawCalls = Math.max(maxSweepDrawCalls, d.drawCalls);
      sweepLines.push(
        `  ${Math.round(distanceM)}m -> calls=${d.drawCalls} tris=${d.triangles} instances=[${d.instanceCountsByLevel.join(',')}]`,
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
      `=== clipmap-far-coverage-spike diagnostics ===`,
      `LevelCount: ${this.levelCount} | Outer ring radius: ${Math.round(this.outerRadiusM)}m`,
      `Terrain: ${this.terrainKind()} | Morph: ${this.morphEnabled() ? 'ON' : 'OFF'} | LevelTint: ${this.showLevelTint() ? 'ON' : 'OFF'} | Wireframe: ${this.wireframe() ? 'ON' : 'OFF'}`,
      `Draw-call sweep (camera distance from origin):`,
      ...sweepLines,
      `Max draw calls across sweep: ${maxSweepDrawCalls} (bound: <=${this.levelCount}) -> ${maxSweepDrawCalls <= this.levelCount ? 'PASS' : 'FAIL'}`,
      `Frozen-camera stability (${DIAGNOSTICS_STABILITY_FRAME_COUNT} frames @ static view):`,
      `  drawCalls min/max: ${minCalls}/${maxCalls} (delta ${maxCalls - minCalls}) -> ${maxCalls === minCalls ? 'STABLE' : 'FLICKER DETECTED'}`,
      `  triangles min/max: ${minTris}/${maxTris} (delta ${maxTris - minTris}) -> ${maxTris === minTris ? 'STABLE' : 'FLICKER DETECTED'}`,
      `(Not checked here — judge visually with flyToDistance() + wireframe/level-tint toggles: outer-ring popping/coarseness)`,
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
