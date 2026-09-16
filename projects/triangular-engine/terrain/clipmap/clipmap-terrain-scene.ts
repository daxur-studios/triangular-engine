import {
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  Texture,
  Vector4,
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
import {
  CLIPMAP_TERRAIN_KIND,
  type ClipmapTerrainKindName,
} from './clipmap-benchmark-fixtures';

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
  /** Show or hide the clipmap meshes while an alternate debug surface is displayed. */
  setVisible(enabled: boolean): void;
  setWireframe(enabled: boolean): void;
  setShowLevelTint(enabled: boolean): void;
  setMorphEnabled(enabled: boolean): void;
  setFrozen(enabled: boolean): void;
  setTerrainKind(kind: ClipmapTerrainKindName): void;
  setDebugFlatTerrain(enabled: boolean): void;
  setDebugViewMode(mode: number): void;
  /** Configure the world-anchored material breakup layer. */
  setMacroVariation(enabled: boolean, strength: number, scaleM: number): void;
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

  const terrainLight = new HemisphereLight('#cfe8ff', '#2b2318', 1.1);
  engine.scene.add(terrainLight);

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
    const image = source.texture.image as { width?: number; height?: number } | undefined;
    const width = Math.max(1, image?.width ?? 1);
    const height = Math.max(1, image?.height ?? 1);
    const mapWidthM = source.bounds.maxX - source.bounds.minX;
    const mapHeightM = source.bounds.maxZ - source.bounds.minZ;
    // Sample across roughly two texels in world space. One texel can still
    // turn the bake's bilinear cell boundaries into visible bands when viewed
    // close to the surface; the wider difference gives the normal a small
    // amount of scale-aware smoothing.
    material.uniforms['uHeightSampleStepM']!.value = Math.max(
      0.5,
      2 * Math.min(mapWidthM / width, mapHeightM / height),
    );
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
    const boundsArray = material.uniforms['uLevelBounds']?.value as Vector4[] | undefined;

    for (let level = 0; level < levelCount; level++) {
      if (boundsArray && boundsArray[level]) {
        const tileSizeM = baseTileSizeM * 2 ** level;
        const centerTileX = Math.floor(lodFocus.x / (2 * tileSizeM)) * 2;
        const centerTileZ = Math.floor(lodFocus.z / (2 * tileSizeM)) * 2;
        boundsArray[level].set(
          (centerTileX - blockRadiusTiles) * tileSizeM,
          (centerTileZ - blockRadiusTiles) * tileSizeM,
          (centerTileX + blockRadiusTiles) * tileSizeM,
          (centerTileZ + blockRadiusTiles) * tileSizeM,
        );
      }
      const group = groups[level]!;
      const mesh = levelMeshes[level]!;
      const offsets = levelOffsetAttributes[level]!;
      const scales = levelScaleAttributes[level]!;
      const count = Math.min(group.length, maxInstancesPerLevel);

      for (let i = 0; i < count; i++) {
        const tile = group[i]!;
        // Store the tile centre in tile units rather than as a large world-space
        // metre value. The shader then reconstructs world X/Z from the shared
        // tile-grid coordinate. This makes a shared edge use the same expression
        // on both neighbouring instances, avoiding real-scale floating-point
        // cracks at planetary dimensions.
        offsets.setXYZ(i, tile.gridX + 0.5, 0, tile.gridZ + 0.5);
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
    setVisible(enabled: boolean): void {
      for (const mesh of levelMeshes) mesh.visible = enabled;
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
    setTerrainKind(kind: ClipmapTerrainKindName): void {
      material.uniforms['uTerrainKind']!.value = CLIPMAP_TERRAIN_KIND[kind];
    },
    setDebugFlatTerrain(enabled: boolean): void {
      material.uniforms['uDebugFlatTerrain']!.value = enabled;
    },
    setDebugViewMode(mode: number): void {
      material.uniforms['uDebugViewMode']!.value = mode;
    },
    setMacroVariation(enabled: boolean, strength: number, scaleM: number): void {
      material.uniforms['uMacroVariationEnabled']!.value = enabled;
      material.uniforms['uMacroVariationStrength']!.value = Math.max(0, Math.min(1, strength));
      material.uniforms['uMacroVariationScaleM']!.value = Math.max(1, scaleM);
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
      engine.scene.remove(terrainLight);
      for (const mesh of levelMeshes) engine.scene.remove(mesh);
      for (const geometry of levelGeometries) geometry.dispose();
      material.dispose();
    },
  };
}
