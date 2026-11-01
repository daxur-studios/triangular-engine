import { DirectionalLight } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { EngineService } from 'triangular-engine';
import type { HeightSource } from 'triangular-engine/lod-surface/core';
import { createWaterLodSpikeMaterial } from './water-lod-spike-material';
import { createWaterLodSpikeWaves } from './water-lod-spike-waves';

export interface IWaterLodSpikeDiagnostics {
  readonly drawCalls: number;
  readonly triangles: number;
}

export interface IWaterLodSpikeSceneHandle {
  /** Height source for `<flatTerrain [heights]>`: the spike's 16 waves. */
  readonly heights: HeightSource;
  /** Material for `<flatTerrain [material]>`. */
  readonly material: MeshBasicNodeMaterial;
  setWireframe(enabled: boolean): void;
  dispose(): void;
}

/**
 * Factory for the water LOD spike scene (Plan 080, packet W0b). Takes the
 * `EngineService` that the sibling `<scene>` already created and adds a light
 * and a diagnostics tick to it. It does not create its own renderer, camera,
 * controls, or requestAnimationFrame loop.
 *
 * The water body itself is a `<flatTerrain>` in the component template, fed by
 * `heights` and `material` from this handle, so the plane goes through
 * lod-surface's public API. Wireframe flips `material.wireframe` on the spike's
 * own material, never `<scene>`'s `[wireframe]` input.
 *
 * Not built yet (plan 080, spike S-W1 follow-up): per-wave distance fade, the
 * sigma-squared roughness transfer, wind-driven calm, slick and foam, and any
 * animation. The heights are static.
 */
export function createWaterLodSpikeScene(
  engine: EngineService,
  onDiagnostics: (diagnostics: IWaterLodSpikeDiagnostics) => void,
): IWaterLodSpikeSceneHandle {
  engine.scene.add(new DirectionalLight('#ffffff', 1.2));

  const heights = createWaterLodSpikeWaves();
  const material = createWaterLodSpikeMaterial();

  let lastSampleMs = 0;
  const tickSubscription = engine.tick$.subscribe(() => {
    const nowMs = performance.now();
    if (nowMs - lastSampleMs >= 500) {
      lastSampleMs = nowMs;
      onDiagnostics({
        drawCalls: engine.renderer.info.render.calls,
        triangles: engine.renderer.info.render.triangles,
      });
    }
  });

  return {
    heights,
    material,
    setWireframe(enabled: boolean): void {
      material.wireframe = enabled;
      material.needsUpdate = true;
    },
    dispose(): void {
      tickSubscription.unsubscribe();
      material.dispose();
    },
  };
}
