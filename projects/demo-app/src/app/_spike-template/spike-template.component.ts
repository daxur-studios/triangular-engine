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
  createSpikeTemplateScene,
  type ISpikeTemplateSceneHandle,
} from './core';

/**
 * TEMPLATE — starting point for a new falsifiable spike (see
 * ../AGENTS.md and `docs/runbook/028_planet_terrain_attempt_history.md`
 * "Falsifiable spike suite"). Don't build a spike from scratch: copy this
 * whole `_spike-template/` folder (see `/new-spike` command) and replace
 * the placeholder mechanism in `core/create-spike-template-scene.ts`.
 *
 * What this file is responsible for and nothing more: providing
 * `EngineService` (so `<scene>` in the template owns the renderer, camera,
 * tick loop, resize handling, and the free `showFPS` overlay) and wiring UI
 * toggles through to the `core/` factory's handle. The actual mechanism
 * under test belongs entirely in `core/`, kept plain-Three.js and
 * engine-agnostic wherever the spike's whole point is isolating that
 * mechanism from production/engine code.
 */
@Component({
  selector: 'app-spike-template',
  imports: [EngineModule],
  templateUrl: './spike-template.component.html',
  styleUrl: './spike-template.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class SpikeTemplateComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scene: ISpikeTemplateSceneHandle;

  readonly wireframe = signal(false);
  readonly drawCalls = signal(0);
  readonly triangles = signal(0);

  constructor() {
    this.engine.scene.background = new Color('#12181f');
    this.scene = createSpikeTemplateScene(this.engine, (diagnostics) => {
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
