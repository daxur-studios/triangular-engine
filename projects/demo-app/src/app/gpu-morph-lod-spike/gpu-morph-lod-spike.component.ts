import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  createGpuMorphLodScene,
  type IGpuMorphLodSceneHandle,
} from './core';

/**
 * Attempt #5, Spike 1: shared-vertex-buffer + GPU vertex-shader height/morph
 * LOD (see docs/runbook/028_planet_terrain_attempt_history.md and the
 * Unreal Landscape source map). Plain Three.js — no triangular-engine
 * imports — to isolate the mechanism from any production terrain code.
 */
@Component({
  selector: 'app-gpu-morph-lod-spike',
  templateUrl: './gpu-morph-lod-spike.component.html',
  styleUrl: './gpu-morph-lod-spike.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GpuMorphLodSpikeComponent implements AfterViewInit {
  private readonly canvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);
  private scene?: IGpuMorphLodSceneHandle;

  readonly wireframe = signal(false);
  readonly showLevelTint = signal(true);
  readonly morphEnabled = signal(true);
  readonly frozen = signal(false);

  readonly fps = signal(0);
  readonly drawCalls = signal(0);
  readonly triangles = signal(0);
  readonly instanceCountsByLevel = signal<readonly number[]>([]);

  ngAfterViewInit(): void {
    this.scene = createGpuMorphLodScene(
      this.canvas().nativeElement,
      (diagnostics) => {
        this.fps.set(diagnostics.fps);
        this.drawCalls.set(diagnostics.drawCalls);
        this.triangles.set(diagnostics.triangles);
        this.instanceCountsByLevel.set(diagnostics.instanceCountsByLevel);
      },
    );
    this.destroyRef.onDestroy(() => this.scene?.dispose());
  }

  toggleWireframe(): void {
    this.wireframe.update((enabled) => !enabled);
    this.scene?.setWireframe(this.wireframe());
  }

  toggleShowLevelTint(): void {
    this.showLevelTint.update((enabled) => !enabled);
    this.scene?.setShowLevelTint(this.showLevelTint());
  }

  toggleMorph(): void {
    this.morphEnabled.update((enabled) => !enabled);
    this.scene?.setMorphEnabled(this.morphEnabled());
  }

  toggleFrozen(): void {
    this.frozen.update((enabled) => !enabled);
    this.scene?.setFrozen(this.frozen());
  }

  instanceCountsLabel(): string {
    return this.instanceCountsByLevel()
      .map((count, level) => `L${level}: ${count}`)
      .join(' · ');
  }
}
