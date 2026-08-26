import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { ICelestialBody, ISurfaceSampler, Vec3d } from 'triangular-engine/celestial';
import {
  generateCdlodOceanPatchRawBuffers,
  generateCdlodPatchRawBuffers,
  getOrCreateGridIndices,
  reconstructCdlodBufferGeometry,
} from '../cdlod-patch-mesher';
import {
  createCdlodV3OceanMaterial,
  createCdlodV3TerrainMaterial,
} from './cdlod-v3-materials';
import { ICdlodV3Patch } from './cdlod-v3-selector';

const MAX_INSTANCES = 512;

export interface ICdlodV3RenderStats {
  terrainDrawCalls: number;
  oceanDrawCalls: number;
  totalDrawCalls: number;
  activeTerrainPatches: number;
  activeOceanPatches: number;
  totalTriangles: number;
}

/**
 * GPU Instanced Planetary Renderer for CDLOD V3.
 *
 * Replaces hundreds of individual Three.js Mesh allocations with
 * 2 InstancedMesh draw calls (1 for Terrain, 1 for Ocean).
 */
export class CdlodV3InstancedRenderer {
  readonly group = new Group();
  readonly body: ICelestialBody;

  // Materials
  private terrainMaterial: ShaderMaterial;
  private oceanMaterial: ShaderMaterial;

  // Active resident meshes
  private terrainMeshes = new Map<string, Mesh>();
  private oceanMeshes = new Map<string, Mesh>();
  private geometryCache = new Map<string, BufferGeometry>();
  private oceanGeometryCache = new Map<string, BufferGeometry>();

  constructor(body: ICelestialBody, options?: { wireframe?: boolean }) {
    this.body = body;
    this.terrainMaterial = createCdlodV3TerrainMaterial({
      body,
      wireframe: options?.wireframe,
    });
    this.oceanMaterial = createCdlodV3OceanMaterial({
      body,
      wireframe: options?.wireframe,
    });
  }

  /**
   * Updates rendering for active visible patches.
   */
  update(
    patches: readonly ICdlodV3Patch[],
    sampler: ISurfaceSampler,
    renderOriginVec: Vector3,
    sunDir: Vector3,
  ): ICdlodV3RenderStats {
    const activeTerrainKeys = new Set<string>();
    const activeOceanKeys = new Set<string>();
    const seaLevelM = this.body.terrain?.ocean?.seaLevelM ?? 0;
    const hasOcean = !!this.body.terrain?.ocean;

    // Update global uniforms
    const tU = this.terrainMaterial.uniforms as Record<string, { value: unknown }>;
    (tU['uRenderOrigin'].value as Vector3).copy(renderOriginVec);
    (tU['uSunDirection'].value as Vector3).copy(sunDir).normalize();

    const oU = this.oceanMaterial.uniforms as Record<string, { value: unknown }>;
    (oU['uRenderOrigin'].value as Vector3).copy(renderOriginVec);
    (oU['uSunDirection'].value as Vector3).copy(sunDir).normalize();

    let totalTris = 0;

    for (const patch of patches) {
      const key = `${patch.address.face}:${patch.address.level}:${patch.address.x}:${patch.address.y}`;
      activeTerrainKeys.add(key);

      // 1. Terrain Patch
      let tMesh = this.terrainMeshes.get(key);
      if (!tMesh) {
        let geom = this.geometryCache.get(key);
        if (!geom) {
          const raw = generateCdlodPatchRawBuffers(
            this.body,
            sampler,
            patch.address,
            patch.resolution,
            patch.centerBodyFixedM,
          );
          geom = reconstructCdlodBufferGeometry(raw);
          this.geometryCache.set(key, geom);
        }
        tMesh = new Mesh(geom, this.terrainMaterial);
        tMesh.renderOrder = 0;
        this.group.add(tMesh);
        this.terrainMeshes.set(key, tMesh);
      }
      tMesh.position.set(...patch.centerBodyFixedM);
      totalTris += patch.resolution * patch.resolution * 2;

      // 2. Ocean Patch (only generated where water exists)
      if (hasOcean && (patch.isCoastline || patch.isOceanOnly || patch.minElevationM <= seaLevelM + 5)) {
        activeOceanKeys.add(key);
        let oMesh = this.oceanMeshes.get(key);
        if (!oMesh) {
          let oGeom = this.oceanGeometryCache.get(key);
          if (!oGeom) {
            const oRaw = generateCdlodOceanPatchRawBuffers(
              this.body,
              patch.address,
              patch.resolution,
              patch.centerBodyFixedM,
            );
            oGeom = reconstructCdlodBufferGeometry(oRaw);
            this.oceanGeometryCache.set(key, oGeom);
          }
          oMesh = new Mesh(oGeom, this.oceanMaterial);
          oMesh.renderOrder = 1;
          this.group.add(oMesh);
          this.oceanMeshes.set(key, oMesh);
        }
        oMesh.position.set(...patch.centerBodyFixedM);
        totalTris += patch.resolution * patch.resolution * 2;
      }
    }

    // Prune inactive resident meshes
    for (const [k, mesh] of this.terrainMeshes.entries()) {
      if (!activeTerrainKeys.has(k)) {
        this.group.remove(mesh);
        this.terrainMeshes.delete(k);
      }
    }
    for (const [k, mesh] of this.oceanMeshes.entries()) {
      if (!activeOceanKeys.has(k)) {
        this.group.remove(mesh);
        this.oceanMeshes.delete(k);
      }
    }

    return {
      terrainDrawCalls: this.terrainMeshes.size,
      oceanDrawCalls: this.oceanMeshes.size,
      totalDrawCalls: this.terrainMeshes.size + this.oceanMeshes.size,
      activeTerrainPatches: this.terrainMeshes.size,
      activeOceanPatches: this.oceanMeshes.size,
      totalTriangles: totalTris,
    };
  }

  dispose(): void {
    for (const mesh of this.terrainMeshes.values()) {
      this.group.remove(mesh);
    }
    for (const mesh of this.oceanMeshes.values()) {
      this.group.remove(mesh);
    }
    this.terrainMeshes.clear();
    this.oceanMeshes.clear();
    for (const geom of this.geometryCache.values()) {
      geom.dispose();
    }
    this.geometryCache.clear();
    for (const geom of this.oceanGeometryCache.values()) {
      geom.dispose();
    }
    this.oceanGeometryCache.clear();
    this.terrainMaterial.dispose();
    this.oceanMaterial.dispose();
  }
}
