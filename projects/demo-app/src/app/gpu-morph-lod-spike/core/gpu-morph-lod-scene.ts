import {
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
} from 'three';
import { EngineService } from 'triangular-engine';
import { buildClipmapTiles, groupTilesByLevel } from './clipmap-layout';
import {
  BASE_TILE_SIZE_M,
  BLOCK_RADIUS_TILES,
  FINEST_SWITCH_DISTANCE_M,
  GRID_RESOLUTION,
  LEVEL_COUNT,
  MAX_INSTANCES_PER_LEVEL,
  TERRAIN_HEIGHT_SCALE_M,
} from './constants';
import { buildSharedGridBuffers } from './shared-grid-geometry';
import { createGpuMorphLodMaterial } from './shader';

export interface IGpuMorphLodDiagnostics {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly instanceCountsByLevel: readonly number[];
  readonly frozen: boolean;
}

export interface IGpuMorphLodSceneHandle {
  setWireframe(enabled: boolean): void;
  setShowLevelTint(enabled: boolean): void;
  setMorphEnabled(enabled: boolean): void;
  setFrozen(enabled: boolean): void;
  setTerrainKind(kind: 'wave' | 'noise'): void;
  /**
   * Synchronous, unthrottled read of the same counters `onDiagnostics`
   * reports every 500ms — for an automated capture script that needs a
   * fresh sample immediately after moving the camera, not whatever the
   * throttled UI display last saw.
   */
  getDiagnosticsSnapshot(): IGpuMorphLodDiagnostics;
  dispose(): void;
}

/**
 * Builds the shared-buffer + per-level InstancedMesh set and drives it off
 * an existing `<scene>`'s render loop via `EngineService`. The LOD/morph
 * mechanism under test owns no renderer/camera/rAF loop of its own — those
 * are now `<scene>`'s job, which also gets us its `showFPS` overlay and
 * draw-call/triangle counters for free instead of hand-rolled ones.
 */
export function createGpuMorphLodScene(
  engine: EngineService,
  onDiagnostics: (diagnostics: IGpuMorphLodDiagnostics) => void,
): IGpuMorphLodSceneHandle {
  engine.scene.add(new HemisphereLight('#cfe8ff', '#2b2318', 1.1));

  const { levelGeometries } = buildSharedGridBuffers(
    GRID_RESOLUTION,
    LEVEL_COUNT,
  );
  const material = createGpuMorphLodMaterial();
  material.uniforms['uBaseTileSizeM']!.value = BASE_TILE_SIZE_M;
  material.uniforms['uGridResolution']!.value = GRID_RESOLUTION;
  material.uniforms['uMaxLevel']!.value = LEVEL_COUNT - 1;
  material.uniforms['uFinestSwitchDistanceM']!.value = FINEST_SWITCH_DISTANCE_M;
  material.uniforms['uHeightScale']!.value = TERRAIN_HEIGHT_SCALE_M;

  const levelMeshes: InstancedMesh[] = [];
  const levelOffsetAttributes: InstancedBufferAttribute[] = [];
  const levelScaleAttributes: InstancedBufferAttribute[] = [];

  for (let level = 0; level < LEVEL_COUNT; level++) {
    const geometry = levelGeometries[level]!;
    const offsetArray = new Float32Array(MAX_INSTANCES_PER_LEVEL * 3);
    const scaleArray = new Float32Array(MAX_INSTANCES_PER_LEVEL);
    const offsetAttribute = new InstancedBufferAttribute(offsetArray, 3);
    const scaleAttribute = new InstancedBufferAttribute(scaleArray, 1);
    geometry.setAttribute('instanceOffset', offsetAttribute);
    geometry.setAttribute('instanceScale', scaleAttribute);

    const mesh = new InstancedMesh(geometry, material, MAX_INSTANCES_PER_LEVEL);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = `gpu-morph-lod-level-${level}`;
    engine.scene.add(mesh);

    levelMeshes.push(mesh);
    levelOffsetAttributes.push(offsetAttribute);
    levelScaleAttributes.push(scaleAttribute);
  }

  let frozen = false;

  function updateClipmap(): void {
    if (frozen) return;
    const camera = engine.camera$.value;
    if (!camera) return;
    material.uniforms['uCameraWorldPos']!.value.copy(camera.position);

    const tiles = buildClipmapTiles(
      camera.position.x,
      camera.position.z,
      BASE_TILE_SIZE_M,
      LEVEL_COUNT,
      BLOCK_RADIUS_TILES,
    );
    const groups = groupTilesByLevel(tiles, LEVEL_COUNT);

    for (let level = 0; level < LEVEL_COUNT; level++) {
      const group = groups[level]!;
      const mesh = levelMeshes[level]!;
      const offsets = levelOffsetAttributes[level]!;
      const scales = levelScaleAttributes[level]!;
      const count = Math.min(group.length, MAX_INSTANCES_PER_LEVEL);

      for (let i = 0; i < count; i++) {
        const tile = group[i]!;
        offsets.setXYZ(i, tile.centerXM, 0, tile.centerZM);
        scales.setX(i, tile.sizeM);
      }
      mesh.count = count;
      offsets.needsUpdate = true;
      scales.needsUpdate = true;
    }
  }

  let lastSampleMs = 0;
  const tickSubscription = engine.tick$.subscribe(() => {
    updateClipmap();

    const nowMs = performance.now();
    if (nowMs - lastSampleMs >= 500) {
      lastSampleMs = nowMs;
      onDiagnostics({
        drawCalls: engine.renderer.info.render.calls,
        triangles: engine.renderer.info.render.triangles,
        instanceCountsByLevel: levelMeshes.map((mesh) => mesh.count),
        frozen,
      });
    }
  });

  return {
    setWireframe(enabled: boolean): void {
      material.wireframe = enabled;
    },
    setShowLevelTint(enabled: boolean): void {
      material.uniforms['uShowLevelTint']!.value = enabled;
    },
    setMorphEnabled(enabled: boolean): void {
      material.uniforms['uMorphEnabled']!.value = enabled;
    },
    setFrozen(enabled: boolean): void {
      frozen = enabled;
    },
    setTerrainKind(kind: 'wave' | 'noise'): void {
      material.uniforms['uTerrainKind']!.value = kind === 'noise' ? 1 : 0;
    },
    getDiagnosticsSnapshot(): IGpuMorphLodDiagnostics {
      return {
        drawCalls: engine.renderer.info.render.calls,
        triangles: engine.renderer.info.render.triangles,
        instanceCountsByLevel: levelMeshes.map((mesh) => mesh.count),
        frozen,
      };
    },
    dispose(): void {
      tickSubscription.unsubscribe();
      for (const mesh of levelMeshes) engine.scene.remove(mesh);
      for (const geometry of levelGeometries) geometry.dispose();
      material.dispose();
    },
  };
}
