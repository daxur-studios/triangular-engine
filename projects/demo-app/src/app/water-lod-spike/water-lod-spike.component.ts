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
  createWaterLodSpikeScene,
  type IWaterLodSpikeSceneHandle,
} from './core';

/**
 * Spike W0b (Plan 080, LOD Water): does analytic wave water on a flat plane
 * keep its near and far forms matched, with no colour step at handover and
 * no shimmer, within the plan 080 gates? Mechanism: `core/create-water-lod-spike-scene.ts`
 * (still a TODO; the scene is an empty shell for now).
 *
 * What this file is responsible for and nothing more: providing
 * `EngineService` (so `<scene>` owns the renderer, camera, tick loop, resize
 * handling, and the free `showFPS` overlay) and wiring UI toggles through to
 * the `core/` factory's handle.
 */
@Component({
  selector: 'app-water-lod-spike',
  imports: [EngineModule],
  templateUrl: './water-lod-spike.component.html',
  styleUrl: './water-lod-spike.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class WaterLodSpikeComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scene: IWaterLodSpikeSceneHandle;

  readonly wireframe = signal(false);
  readonly drawCalls = signal(0);
  readonly triangles = signal(0);

  constructor() {
    this.engine.scene.background = new Color('#12181f');
    this.scene = createWaterLodSpikeScene(this.engine, (diagnostics) => {
      this.drawCalls.set(diagnostics.drawCalls);
      this.triangles.set(diagnostics.triangles);
    });
    this.destroyRef.onDestroy(() => this.scene.dispose());
  }

  toggleWireframe(): void {
    this.wireframe.update((enabled) => !enabled);
    this.scene.setWireframe(this.wireframe());
  }
}
