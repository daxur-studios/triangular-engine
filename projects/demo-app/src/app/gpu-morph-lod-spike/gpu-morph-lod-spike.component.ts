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
  createGpuMorphLodScene,
  type IGpuMorphLodSceneHandle,
} from './core';

/**
 * Attempt #5, Spike 1: shared-vertex-buffer + GPU vertex-shader height/morph
 * LOD (see docs/runbook/028_planet_terrain_attempt_history.md and the
 * Unreal Landscape source map). Uses triangular-engine's `<scene>` only for
 * renderer/camera/tick-loop plumbing and its `showFPS` overlay — the LOD/
 * morph mechanism itself (./core/*.ts) is plain Three.js with no engine
 * coupling, to keep it isolated from any production terrain code.
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
}
