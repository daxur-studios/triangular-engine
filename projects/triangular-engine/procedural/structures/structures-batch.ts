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
  readonly material?: Material;
  readonly cache?: StructureGeometryCache;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
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
  const geometry = cache.getOrCreate(archetype, seed);

  const material =
    options?.material ??
    new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.65,
      metalness: 0.25,
      side: DoubleSide,
    });

  const instancedMesh = new InstancedMesh(geometry, material, count);
  instancedMesh.name = `instanced-${archetype.id}-count-${count}`;
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
 * Groups buildings by archetype to minimize GPU draw calls to exactly 1 draw call per unique building type.
 */
export class StructureBatchManager {
  private readonly batches = new Map<
    string,
    {
      archetype: IStructureArchetype;
      seed: number;
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
  ): void {
    const key = `${archetype.id}-s${seed}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { archetype, seed, instances: [] };
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
  ): void {
    const key = `${archetype.id}-s${seed}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { archetype, seed, instances: [] };
      this.batches.set(key, batch);
    }
    batch.instances.push(...transforms);
  }

  /**
   * Rebuilds all InstancedMeshes and returns the root Three.js Group.
   */
  build(options?: { material?: Material }): Group {
    this.rootGroup.clear();

    for (const batch of this.batches.values()) {
      if (batch.instances.length === 0) continue;
      const mesh = createStructureInstancedMesh(batch.archetype, batch.instances, {
        seed: batch.seed,
        material: options?.material,
        cache: this.cache,
      });
      batch.mesh = mesh;
      this.rootGroup.add(mesh);
    }

    return this.rootGroup;
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
   * Returns the total count of active GPU draw calls (1 per unique archetype batch).
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
