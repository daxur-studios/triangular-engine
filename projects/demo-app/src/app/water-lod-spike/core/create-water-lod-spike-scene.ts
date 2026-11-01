import { DirectionalLight } from 'three';
import { EngineService } from 'triangular-engine';

export interface IWaterLodSpikeDiagnostics {
  readonly drawCalls: number;
  readonly triangles: number;
}

export interface IWaterLodSpikeSceneHandle {
  setWireframe(enabled: boolean): void;
  dispose(): void;
}

/**
 * Factory for the water LOD spike scene (Plan 080, packet W0b). Takes the
 * `EngineService` that the sibling `<scene>` already created and adds objects
 * to it. It does not create its own renderer, camera, controls, or
 * requestAnimationFrame loop.
 *
 * TODO: build the mechanism under test (plan 080, spike S-W1). Use a flat
 * 100 km plane through lod-surface's public API with a spike-local wave
 * source and material, 16 sines with per-wave fade, sigma-squared transfer to
 * roughness, sky Fresnel, and the wind-driven calm, slick and foam far form.
 * Gates Q1 to Q6 are in plan 080, Spike questions. Use a spike-local wave
 * source and material; do not edit the library. The wireframe toggle must flip
 * `material.wireframe` on the spike's own material, never `<scene>`'s
 * `[wireframe]` input.
 */
export function createWaterLodSpikeScene(
  engine: EngineService,
  onDiagnostics: (diagnostics: IWaterLodSpikeDiagnostics) => void,
): IWaterLodSpikeSceneHandle {
  engine.scene.add(new DirectionalLight('#ffffff', 1.2));

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
    setWireframe(): void {
      // TODO: flip material.wireframe on the water material once it exists.
    },
    dispose(): void {
      tickSubscription.unsubscribe();
    },
  };
}
