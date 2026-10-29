import { DestroyRef, effect, signal, untracked, type Signal } from '@angular/core';
import type { PerspectiveCamera } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { EngineService } from 'triangular-engine';
import { LodTerrainBody, type LodTerrainSettings, type LodView, type Vec3 } from 'triangular-engine/lod-surface/core';

/** What the terrain components read each time an input changes: the body's settings plus its debug and lighting switches. */
export interface LodTerrainInputs {
  readonly settings: LodTerrainSettings;
  readonly sunDirection: Vec3 | readonly [number, number, number];
  readonly view: LodView;
  readonly lighting: boolean;
  readonly bounds: boolean;
  readonly wireframe: boolean;
}

/**
 * Shared wiring of `<planetTerrain>` and `<flatTerrain>`; call it from a field initializer or constructor (it uses
 * `effect`). The body is made on the first run of the effect, when the required inputs are set, and added to the engine
 * scene. Every frame, in `beforeRender$` (after camera controls have settled in `lateUpdate$`), it selects from the
 * active camera. On a renderer that is not `WebGPURenderer` the terrain stays hidden and does nothing.
 */
export function attachLodTerrain(engine: EngineService, destroyRef: DestroyRef, read: () => LodTerrainInputs): Signal<LodTerrainBody | undefined> {
  const terrain = signal<LodTerrainBody | undefined>(undefined);
  let body: LodTerrainBody | undefined;

  effect(() => {
    const inputs = read();
    untracked(() => {
      if (body) body.configure(inputs.settings);
      else {
        body = new LodTerrainBody(inputs.settings);
        body.object.visible = false;
        engine.scene.add(body.object);
        terrain.set(body);
      }
      body.setView(inputs.view);
      body.setLighting(inputs.lighting);
      body.setBounds(inputs.bounds);
      body.setWireframe(inputs.wireframe);
      body.setSun([inputs.sunDirection[0], inputs.sunDirection[1], inputs.sunDirection[2]]);
    });
  });

  const frame = engine.beforeRender$.subscribe(() => {
    if (!body) return;
    const renderer = engine.renderer as unknown as WebGPURenderer | null | undefined;
    const webgpu = renderer?.isWebGPURenderer === true;
    body.object.visible = webgpu;
    const camera = engine.camera as PerspectiveCamera;
    if (!webgpu || !camera.isPerspectiveCamera) return;
    body.update(camera, renderer?.domElement?.height || 1080);
  });

  destroyRef.onDestroy(() => {
    frame.unsubscribe();
    body?.dispose();
    body = undefined;
    terrain.set(undefined);
  });
  return terrain.asReadonly();
}
