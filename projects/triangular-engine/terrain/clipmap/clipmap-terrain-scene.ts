import {
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  Texture,
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
} from './clipmap-constants';
import { buildSharedGridBuffers } from './clipmap-grid-geometry';
import { createClipmapTerrainMaterial } from './clipmap-terrain-material';

export interface IClipmapTerrainDiagnostics {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly instanceCountsByLevel: readonly number[];
  readonly frozen: boolean;
}

/**
 * Overrides for the module-level defaults in `clipmap-constants.ts`. Every
 * field is optional and defaults to that constant, so existing callers (e.g.
 * gpu-morph-lod-spike) are unaffected. Added so a consumer can push the same
 * mechanism to more/larger LOD rings (e.g. horizon-scale far coverage)
 * without forking the scene-builder or touching the constants the default
 * callers rely on.
 */
export interface IClipmapTerrainSceneOptions {
  readonly levelCount?: number;
  readonly baseTileSizeM?: number;
  readonly blockRadiusTiles?: number;
  readonly gridResolution?: number;
  readonly finestSwitchDistanceM?: number;
  readonly heightScaleM?: number;
  /** Optional bounded texture-backed source. Omit to retain the analytic fixture terrain. */
  readonly heightSource?: IClipmapTerrainHeightSource;
  /** Ground point around which rings are selected; useful for an oblique camera. */
  readonly lodFocus?: { readonly x: number; readonly z: number };
}

export interface IClipmapTerrainHeightSource {
  readonly texture: Texture;
  readonly colorTexture?: Texture;
  readonly minHeightM: number;
  readonly maxHeightM: number;
  readonly bounds: {
    readonly minX: number;
    readonly minZ: number;
    readonly maxX: number;
    readonly maxZ: number;
  };
}

export interface IClipmapTerrainSceneHandle {
  /** Replace the bounded texture-backed source without rebuilding clipmap meshes. */
  setHeightSource(source: IClipmapTerrainHeightSource): void;
  setWireframe(enabled: boolean): void;
  setShowLevelTint(enabled: boolean): void;
  setMorphEnabled(enabled: boolean): void;
  setFrozen(enabled: boolean): void;
  setTerrainKind(kind: 'wave' | 'noise'): void;
  /**
   * Synchronous, unthrottled read of the same counters `onDiagnostics`
   * reports every 500ms — for automated capture that needs a fresh sample
   * immediately after moving the camera, not whatever the throttled UI
   * display last saw.
   */
  getDiagnosticsSnapshot(): IClipmapTerrainDiagnostics;
  dispose(): void;
}

/**
 * Builds the shared-buffer + per-level InstancedMesh set and drives it off
 * an existing `<scene>`'s render loop via `EngineService`. The LOD/morph
 * mechanism itself owns no renderer/camera/rAF loop of its own — that is
 * `<scene>`'s job, which also gets its `showFPS` overlay and draw-call/
 * triangle counters for free instead of hand-rolled ones.
 *
 * Promoted from demo-app's gpu-morph-lod-spike (passed the near-boundary
 * crack-free/bounded-draw-call case — see
 * docs/runbook/028_planet_terrain_attempt_history.md) into
 * `triangular-engine/terrain` so both that spike and any consuming
 * app/POC share this one implementation.
 */
export function createClipmapTerrainScene(
  engine: EngineService,
  onDiagnostics: (diagnostics: IClipmapTerrainDiagnostics) => void,
  options?: IClipmapTerrainSceneOptions,
): IClipmapTerrainSceneHandle {
  const levelCount = options?.levelCount ?? LEVEL_COUNT;
  const baseTileSizeM = options?.baseTileSizeM ?? BASE_TILE_SIZE_M;
  const blockRadiusTiles = options?.blockRadiusTiles ?? BLOCK_RADIUS_TILES;
  const gridResolution = options?.gridResolution ?? GRID_RESOLUTION;
  const finestSwitchDistanceM =
    options?.finestSwitchDistanceM ?? FINEST_SWITCH_DISTANCE_M;
  const heightScaleM = options?.heightScaleM ?? TERRAIN_HEIGHT_SCALE_M;
  const maxInstancesPerLevel = (2 * blockRadiusTiles) ** 2;

  engine.scene.add(new HemisphereLight('#cfe8ff', '#2b2318', 1.1));

  const { levelGeometries } = buildSharedGridBuffers(gridResolution, levelCount);
  const material = createClipmapTerrainMaterial();
  material.uniforms['uBaseTileSizeM']!.value = baseTileSizeM;
  material.uniforms['uGridResolution']!.value = gridResolution;
  material.uniforms['uMaxLevel']!.value = levelCount - 1;
  material.uniforms['uFinestSwitchDistanceM']!.value = finestSwitchDistanceM;
  material.uniforms['uHeightScale']!.value = heightScaleM;
  material.uniforms['uBlockRadiusTiles']!.value = blockRadiusTiles;
  function applyHeightSource(source: IClipmapTerrainHeightSource | undefined): void {
    if (!source) {
      material.uniforms['uUseHeightMap']!.value = false;
      material.uniforms['uUseColorMap']!.value = false;
      return;
    }
    material.uniforms['uHeightMap']!.value = source.texture;
    material.uniforms['uHeightMapBounds']!.value.set(
      source.bounds.minX,
      source.bounds.minZ,
      source.bounds.maxX,
      source.bounds.maxZ,
    );
    material.uniforms['uHeightMapMinM']!.value = source.minHeightM;
    material.uniforms['uHeightMapRangeM']!.value = Math.max(0.000001, source.maxHeightM - source.minHeightM);
    material.uniforms['uUseHeightMap']!.value = true;
    if (source.colorTexture) {
      material.uniforms['uColorMap']!.value = source.colorTexture;
      material.uniforms['uUseColorMap']!.value = true;
    } else {
      material.uniforms['uUseColorMap']!.value = false;
    }
  }
  applyHeightSource(options?.heightSource);

  const levelMeshes: InstancedMesh[] = [];
  const levelOffsetAttributes: InstancedBufferAttribute[] = [];
  const levelScaleAttributes: InstancedBufferAttribute[] = [];

  for (let level = 0; level < levelCount; level++) {
    const geometry = levelGeometries[level]!;
    const offsetArray = new Float32Array(maxInstancesPerLevel * 3);
    const scaleArray = new Float32Array(maxInstancesPerLevel);
    const offsetAttribute = new InstancedBufferAttribute(offsetArray, 3);
    const scaleAttribute = new InstancedBufferAttribute(scaleArray, 1);
    geometry.setAttribute('instanceOffset', offsetAttribute);
    geometry.setAttribute('instanceScale', scaleAttribute);

    const mesh = new InstancedMesh(geometry, material, maxInstancesPerLevel);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = `clipmap-terrain-level-${level}`;
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
    const lodFocus = options?.lodFocus ?? { x: camera.position.x, z: camera.position.z };
    material.uniforms['uCameraWorldPos']!.value.set(lodFocus.x, camera.position.y, lodFocus.z);

    const tiles = buildClipmapTiles(
      lodFocus.x,
      lodFocus.z,
      baseTileSizeM,
      levelCount,
      blockRadiusTiles,
    );
    const groups = groupTilesByLevel(tiles, levelCount);

    for (let level = 0; level < levelCount; level++) {
      const group = groups[level]!;
      const mesh = levelMeshes[level]!;
      const offsets = levelOffsetAttributes[level]!;
      const scales = levelScaleAttributes[level]!;
      const count = Math.min(group.length, maxInstancesPerLevel);

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
    setHeightSource(source: IClipmapTerrainHeightSource): void {
      applyHeightSource(source);
    },
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
    getDiagnosticsSnapshot(): IClipmapTerrainDiagnostics {
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
