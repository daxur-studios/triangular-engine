import { AmbientLight, DirectionalLight, PerspectiveCamera } from 'three';
import type { EngineService } from 'triangular-engine';
import { TerrainPlanetMaterial } from 'triangular-engine/lod-surface';
import { createSphereLandHeights } from './water-lod-spike-sphere-land';
import { SphereWaterMaterial } from './water-lod-spike-sphere-material';
import { createSphereWaterHeights, updateSphereWaterAnchor, type ISphereWaterHeights } from './water-lod-spike-sphere-waves';
import type { IWaterLodSpikeDiagnostics } from './create-water-lod-spike-scene';
import { waterLodSpikeQuality, type IWaterLodSpikeQuality, type WaterLodSpikeQualityId } from './water-lod-spike-quality';
import { WATER_LOD_SPIKE_UNIFORMS } from './water-lod-spike-waves';

export interface IWaterLodSpikeSphereSceneHandle {
  /** Height source for the water `<planetTerrain [heights]>`. */
  readonly heights: ISphereWaterHeights;
  /** Material for the water `<planetTerrain [material]>`. */
  readonly material: SphereWaterMaterial;
  /** Height source for the land `<planetTerrain [heights]>`: the plane spike's islands on the sphere. */
  readonly landHeights: ReturnType<typeof createSphereLandHeights>;
  /** Material for the land `<planetTerrain [material]>`; an atmosphere surface, so the atmosphere lights and hazes it. */
  readonly landMaterial: TerrainPlanetMaterial;
  /** The wave and material uniforms (the plane spike's, shared). */
  readonly uniforms: typeof WATER_LOD_SPIKE_UNIFORMS;
  /** Wireframe on the water and land materials (never `<scene [wireframe]>`). */
  setWireframe(enabled: boolean): void;
  setFilter(enabled: boolean): void;
  setTransfer(enabled: boolean): void;
  /** Applies a quality tier to the filter bias and the vertex filter's cell size, and returns it; the mesh density is `<planetTerrain>` inputs the page sets from it. */
  setQuality(id: WaterLodSpikeQualityId): IWaterLodSpikeQuality;
  /** The shore weight (waves flatten over shallow water), the foam and the depth colour, each on or off. They read the land. */
  setShore(enabled: boolean): void;
  setFoam(enabled: boolean): void;
  setDepthColour(enabled: boolean): void;
  setAnimating(enabled: boolean): void;
  setTime(seconds: number): void;
  dispose(): void;
}

/** Sun light intensity and ambient fill, the planet scene's. */
const SUN_INTENSITY = 3;
const AMBIENT_COLOUR = 0xaabbdd;
const AMBIENT_INTENSITY = 0.5;

/**
 * Factory for the sphere water spike (plan 080, water on a planet, stage A). Takes the `EngineService` the sibling `<scene>`
 * created and adds the sun and ambient light the land's PBR material needs, a tick that advances the wave time and the pixel
 * angle the vertex filter sizes cells by, and a `beforeRender$` step that sets every wave's phase offset for the camera's
 * position (in doubles, the anchor path of Q5).
 *
 * The bodies are two `<planetTerrain>` elements in the template: the land (`landHeights`, `landMaterial`) and the water
 * (`heights`, `material`) over it. Neither is inside a `<planet>`, so each takes its own radius, sun and quality inputs.
 */
export function createWaterLodSpikeSphereScene(
  engine: EngineService,
  sun: readonly [number, number, number],
  onDiagnostics: (diagnostics: IWaterLodSpikeDiagnostics) => void,
): IWaterLodSpikeSphereSceneHandle {
  const sunLight = new DirectionalLight(0xffffff, SUN_INTENSITY);
  sunLight.position.set(sun[0], sun[1], sun[2]);
  const ambient = new AmbientLight(AMBIENT_COLOUR, AMBIENT_INTENSITY);
  engine.scene.add(sunLight, sunLight.target, ambient);

  const heights = createSphereWaterHeights();
  const material = new SphereWaterMaterial(heights);
  const landHeights = createSphereLandHeights();
  const landMaterial = new TerrainPlanetMaterial();
  const uniforms = WATER_LOD_SPIKE_UNIFORMS;
  let animating = true;
  let lastTickMs = 0;
  let lastSampleMs = 0;

  const tick = engine.tick$.subscribe(() => {
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
      const render = engine.renderer.info.render as { calls: number; drawCalls?: number; triangles: number };
      onDiagnostics({ drawCalls: render.drawCalls ?? render.calls, triangles: render.triangles });
    }
  });
  // The camera the frame is drawn with, as the terrain's own update reads it (matrixWorld), so the offsets and the mesh agree.
  const beforeRender = engine.beforeRender$.subscribe(() => {
    const camera = engine.camera;
    camera.updateWorldMatrix(true, false);
    const e = camera.matrixWorld.elements;
    updateSphereWaterAnchor([e[12], e[13], e[14]], uniforms.time.value as number);
  });

  return {
    heights,
    material,
    landHeights,
    landMaterial,
    uniforms,
    setWireframe(enabled: boolean): void {
      material.wireframe = enabled;
      material.needsUpdate = true;
      landMaterial.wireframe = enabled;
      landMaterial.needsUpdate = true;
    },
    setFilter(enabled: boolean): void {
      uniforms.filter.value = enabled ? 1 : 0;
    },
    setTransfer(enabled: boolean): void {
      uniforms.transfer.value = enabled ? 1 : 0;
    },
    setQuality(id: WaterLodSpikeQualityId): IWaterLodSpikeQuality {
      const quality = waterLodSpikeQuality(id);
      uniforms.lodBias.value = quality.lodBias;
      uniforms.cellPixels.value = quality.cellPixels;
      return quality;
    },
    setShore(enabled: boolean): void {
      uniforms.shore.value = enabled ? 1 : 0;
    },
    setFoam(enabled: boolean): void {
      uniforms.foam.value = enabled ? 1 : 0;
    },
    setDepthColour(enabled: boolean): void {
      uniforms.depthColour.value = enabled ? 1 : 0;
    },
    setAnimating(enabled: boolean): void {
      animating = enabled;
    },
    setTime(seconds: number): void {
      uniforms.time.value = seconds;
    },
    dispose(): void {
      tick.unsubscribe();
      beforeRender.unsubscribe();
      engine.scene.remove(sunLight, sunLight.target, ambient);
      material.dispose();
      landMaterial.dispose();
    },
  };
}
