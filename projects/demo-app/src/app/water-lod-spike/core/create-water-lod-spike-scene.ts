import { DirectionalLight, PerspectiveCamera } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { EngineService } from 'triangular-engine';
import type { HeightSource } from 'triangular-engine/lod-surface/core';
import { createWaterLodSpikeMaterial } from './water-lod-spike-material';
import { WATER_LOD_SPIKE_UNIFORMS, createWaterLodSpikeWaves } from './water-lod-spike-waves';

export interface IWaterLodSpikeDiagnostics {
  readonly drawCalls: number;
  readonly triangles: number;
}

export interface IWaterLodSpikeSceneHandle {
  /** Height source for `<flatTerrain [heights]>`: the spike's wave spectrum. */
  readonly heights: HeightSource;
  /** Material for `<flatTerrain [material]>`. */
  readonly material: MeshBasicNodeMaterial;
  /** The wave and material uniforms, for diagnostics. */
  readonly uniforms: typeof WATER_LOD_SPIKE_UNIFORMS;
  setWireframe(enabled: boolean): void;
  /** Footprint and mesh-spacing filters on or off (off is the aliasing control). */
  setFilter(enabled: boolean): void;
  /** Roughness transfer on or off (off is the colour-step control). */
  setTransfer(enabled: boolean): void;
  /** Waves move with time while true; false freezes them at the current time. */
  setAnimating(enabled: boolean): void;
  /** Sets the wave time in seconds (tests use a fixed time). */
  setTime(seconds: number): void;
  dispose(): void;
}

/**
 * Factory for the water LOD spike scene (Plan 080, packet W0b). Takes the `EngineService` that the sibling `<scene>`
 * already created and adds a light, a diagnostics tick, and a per-frame update of the wave uniforms (time, and the pixel
 * angle the vertex filter sizes mesh cells by). It does not create its own renderer, camera, controls, or
 * requestAnimationFrame loop.
 *
 * The water body is a `<flatTerrain>` in the component template, fed by `heights` and `material` from this handle.
 * Wireframe flips `material.wireframe` on the spike's own material, never `<scene>`'s `[wireframe]` input.
 */
export function createWaterLodSpikeScene(
  engine: EngineService,
  onDiagnostics: (diagnostics: IWaterLodSpikeDiagnostics) => void,
): IWaterLodSpikeSceneHandle {
  engine.scene.add(new DirectionalLight('#ffffff', 1.2));

  const heights = createWaterLodSpikeWaves();
  const material = createWaterLodSpikeMaterial();
  const uniforms = WATER_LOD_SPIKE_UNIFORMS;
  let animating = true;
  let lastTickMs = 0;

  let lastSampleMs = 0;
  const tickSubscription = engine.tick$.subscribe(() => {
    const nowMs = performance.now();
    if (animating && lastTickMs > 0) uniforms.time.value += Math.min(0.1, (nowMs - lastTickMs) / 1000);
    lastTickMs = nowMs;
    const camera = engine.camera$.value;
    const height = engine.renderer.domElement.height;
    if (camera instanceof PerspectiveCamera && height > 0) {
      uniforms.pixelAngle.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / camera.zoom / height;
    }
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
    uniforms,
    setWireframe(enabled: boolean): void {
      material.wireframe = enabled;
      material.needsUpdate = true;
    },
    setFilter(enabled: boolean): void {
      uniforms.filter.value = enabled ? 1 : 0;
    },
    setTransfer(enabled: boolean): void {
      uniforms.transfer.value = enabled ? 1 : 0;
    },
    setAnimating(enabled: boolean): void {
      animating = enabled;
    },
    setTime(seconds: number): void {
      uniforms.time.value = seconds;
    },
    dispose(): void {
      tickSubscription.unsubscribe();
      material.dispose();
    },
  };
}
