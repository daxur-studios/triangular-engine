import {
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { IStructureArchetype } from './structures-archetype';
import { defaultStructureGeometryCache, StructureGeometryCache } from './structures-cache';

export interface IStructureInstanceTransform {
  readonly position: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number, number]; // Quaternion [x, y, z, w]
  readonly scale?: readonly [number, number, number];
  readonly colorHex?: string | number;
}

export interface IStructureBatchOptions {
  readonly seed?: number;
  readonly lod?: number;
  readonly material?: Material;
  readonly cache?: StructureGeometryCache;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

export interface IStructureLodThresholds {
  readonly lod1DistanceM?: number;
  readonly lod2DistanceM?: number;
  readonly lod3DistanceM?: number;
}

/**
 * Computes which LOD tier (0, 1, 2, or 3) an instance belongs to based on Euclidean distance to camera/focus point.
 */
export function resolveDistanceLod(
  position: readonly [number, number, number],
  focusPosition: readonly [number, number, number],
  thresholds?: IStructureLodThresholds,
): number {
  const dx = position[0] - focusPosition[0];
  const dy = position[1] - focusPosition[1];
  const dz = position[2] - focusPosition[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  const t1 = thresholds?.lod1DistanceM ?? 90;
  const t2 = thresholds?.lod2DistanceM ?? 220;
  const t3 = thresholds?.lod3DistanceM ?? 420;

  if (dist < t1) return 0;
  if (dist < t2) return 1;
  if (dist < t3) return 2;
  return 3;
}

/**
 * Creates a high-performance Three.js InstancedMesh for a specific structure archetype
 * rendering hundreds or thousands of instances in a single GPU draw call.
 */
export function createStructureInstancedMesh(
  archetype: IStructureArchetype,
  instances: readonly IStructureInstanceTransform[],
  options?: IStructureBatchOptions,
): InstancedMesh {
  const count = instances.length;
  const cache = options?.cache ?? defaultStructureGeometryCache;
  const seed = options?.seed ?? 42;
  const lod = options?.lod ?? 0;
  const geometry = cache.getOrCreate(archetype, seed, lod);

  const material =
    options?.material ??
    new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.65,
      metalness: 0.25,
      side: DoubleSide,
    });

  const instancedMesh = new InstancedMesh(geometry, material, count);
  instancedMesh.name = `instanced-${archetype.id}-lod${lod}-count-${count}`;
  instancedMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  instancedMesh.castShadow = options?.castShadow ?? true;
  instancedMesh.receiveShadow = options?.receiveShadow ?? true;

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const color = new Color();
  let hasPerInstanceColors = false;

  for (let i = 0; i < count; i++) {
    const inst = instances[i];
    position.set(...inst.position);

    if (inst.rotation) {
      quaternion.set(...inst.rotation);
    } else {
      quaternion.set(0, 0, 0, 1);
    }

    if (inst.scale) {
      scale.set(...inst.scale);
    } else {
      scale.set(1, 1, 1);
    }

    matrix.compose(position, quaternion, scale);
    instancedMesh.setMatrixAt(i, matrix);

    if (inst.colorHex !== undefined) {
      color.set(inst.colorHex as unknown as number);
      instancedMesh.setColorAt(i, color);
      hasPerInstanceColors = true;
    }
  }

  instancedMesh.instanceMatrix.needsUpdate = true;
  if (hasPerInstanceColors && instancedMesh.instanceColor) {
    instancedMesh.instanceColor.needsUpdate = true;
  }

  return instancedMesh;
}

/**
 * Manages multi-archetype batching for large planetary bases and spaceports.
 * Groups buildings by archetype and LOD to minimize GPU draw calls.
 */
export class StructureBatchManager {
  private readonly batches = new Map<
    string,
    {
      archetype: IStructureArchetype;
      seed: number;
      lod: number;
      instances: IStructureInstanceTransform[];
      mesh?: InstancedMesh;
    }
  >();

  private readonly rootGroup = new Group();
  private readonly cache: StructureGeometryCache;

  constructor(cache?: StructureGeometryCache) {
    this.cache = cache ?? defaultStructureGeometryCache;
    this.rootGroup.name = 'structure-batch-manager-root';
  }

  /**
   * Registers a single building instance.
   */
  addInstance(
    archetype: IStructureArchetype,
    transform: IStructureInstanceTransform,
    seed = 42,
    lod = 0,
  ): void {
    const key = `${archetype.id}-s${seed}-lod${lod}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { archetype, seed, lod, instances: [] };
      this.batches.set(key, batch);
    }
    batch.instances.push(transform);
  }

  /**
   * Registers an array of building instances.
   */
  addInstances(
    archetype: IStructureArchetype,
    transforms: readonly IStructureInstanceTransform[],
    seed = 42,
    lod = 0,
  ): void {
    const key = `${archetype.id}-s${seed}-lod${lod}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { archetype, seed, lod, instances: [] };
      this.batches.set(key, batch);
    }
    batch.instances.push(...transforms);
  }

  /**
   * Registers an array of building instances partitioned into LOD tiers based on camera distance.
   */
  addInstancesWithDistanceLod(
    archetype: IStructureArchetype,
    transforms: readonly IStructureInstanceTransform[],
    focusPosition: readonly [number, number, number] = [0, 0, 0],
    seed = 42,
    thresholds?: IStructureLodThresholds,
  ): void {
    for (const transform of transforms) {
      const lod = resolveDistanceLod(transform.position, focusPosition, thresholds);
      this.addInstance(archetype, transform, seed, lod);
    }
  }

  /**
   * Rebuilds all InstancedMeshes and returns the root Three.js Group.
   */
  build(options?: { material?: Material; overrideLod?: number }): Group {
    this.rootGroup.clear();

    for (const batch of this.batches.values()) {
      if (batch.instances.length === 0) continue;
      const activeLod = options?.overrideLod !== undefined ? options.overrideLod : batch.lod;
      const mesh = createStructureInstancedMesh(batch.archetype, batch.instances, {
        seed: batch.seed,
        lod: activeLod,
        material: options?.material,
        cache: this.cache,
      });
      batch.mesh = mesh;
      this.rootGroup.add(mesh);
    }

    return this.rootGroup;
  }

  /**
   * Returns instance count breakdown per LOD tier.
   */
  getLodCounts(): Record<number, number> {
    const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const batch of this.batches.values()) {
      counts[batch.lod] = (counts[batch.lod] ?? 0) + batch.instances.length;
    }
    return counts;
  }

  /**
   * Returns the root Three.js Group.
   */
  get group(): Group {
    return this.rootGroup;
  }

  /**
   * Returns the total count of instances across all batches.
   */
  get totalInstanceCount(): number {
    let count = 0;
    for (const batch of this.batches.values()) {
      count += batch.instances.length;
    }
    return count;
  }

  /**
   * Returns the total count of active GPU draw calls.
   */
  get drawCallCount(): number {
    let count = 0;
    for (const batch of this.batches.values()) {
      if (batch.instances.length > 0) count++;
    }
    return count;
  }

  /**
   * Clears all registered instances and removes child meshes from the group.
   */
  clear(): void {
    for (const batch of this.batches.values()) {
      if (batch.mesh) {
        batch.mesh.dispose();
      }
    }
    this.batches.clear();
    this.rootGroup.clear();
  }
}
