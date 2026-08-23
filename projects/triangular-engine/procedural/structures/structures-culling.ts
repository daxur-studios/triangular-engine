import {
  Box3,
  Camera,
  Frustum,
  Matrix4,
  Sphere,
  Vector3,
} from 'three';
import type { IStructureInstanceTransform } from './structures-batch';

export interface ISpatialCell<T> {
  readonly cellX: number;
  readonly cellZ: number;
  readonly bounds: Box3;
  readonly boundingSphere: Sphere;
  readonly items: T[];
}

export interface IStructureSpatialItem {
  readonly transform: IStructureInstanceTransform;
  readonly radiusM: number;
  readonly boundingSphere: Sphere;
}

/**
 * 2D spatial grid index for fast hierarchical frustum culling of structures across large spaceports.
 */
export class StructureSpatialGrid {
  readonly cellSizeM: number;
  private readonly cells = new Map<string, ISpatialCell<IStructureSpatialItem>>();

  constructor(cellSizeM = 80) {
    this.cellSizeM = cellSizeM;
  }

  private getCellKey(cellX: number, cellZ: number): string {
    return `${cellX},${cellZ}`;
  }

  /**
   * Clears all registered instances from the spatial grid.
   */
  clear(): void {
    this.cells.clear();
  }

  /**
   * Adds an instance with its bounding radius into the appropriate spatial cell.
   */
  insert(transform: IStructureInstanceTransform, radiusM = 15): void {
    const [x, y, z] = transform.position;
    const cellX = Math.floor(x / this.cellSizeM);
    const cellZ = Math.floor(z / this.cellSizeM);
    const key = this.getCellKey(cellX, cellZ);

    let cell = this.cells.get(key);
    if (!cell) {
      const minX = cellX * this.cellSizeM;
      const minZ = cellZ * this.cellSizeM;
      const maxX = minX + this.cellSizeM;
      const maxZ = minZ + this.cellSizeM;
      const bounds = new Box3(
        new Vector3(minX, -20, minZ),
        new Vector3(maxX, 120, maxZ),
      );
      const boundingSphere = new Sphere();
      bounds.getBoundingSphere(boundingSphere);

      cell = {
        cellX,
        cellZ,
        bounds,
        boundingSphere,
        items: [],
      };
      this.cells.set(key, cell);
    }

    const sphere = new Sphere(new Vector3(x, y, z), radiusM);
    cell.items.push({
      transform,
      radiusM,
      boundingSphere: sphere,
    });
  }

  /**
   * Inserts an array of instances.
   */
  insertMany(transforms: readonly IStructureInstanceTransform[], radiusM = 15): void {
    for (const t of transforms) {
      this.insert(t, radiusM);
    }
  }

  /**
   * Hierarchical frustum query:
   * 1. Coarse pass: checks cell bounding sphere against camera frustum.
   * 2. Fine pass: if cell intersects frustum, checks each item's bounding sphere.
   */
  queryFrustum(frustum: Frustum): IStructureInstanceTransform[] {
    const visible: IStructureInstanceTransform[] = [];

    for (const cell of this.cells.values()) {
      // Coarse culling: if whole cell is outside frustum, skip all items in this cell
      if (!frustum.intersectsSphere(cell.boundingSphere)) {
        continue;
      }

      // Fine-grained culling per instance
      for (const item of cell.items) {
        if (frustum.intersectsSphere(item.boundingSphere)) {
          visible.push(item.transform);
        }
      }
    }

    return visible;
  }

  /**
   * Total registered cells in the grid.
   */
  get cellCount(): number {
    return this.cells.size;
  }

  /**
   * Total registered items across all cells.
   */
  get totalItemCount(): number {
    let count = 0;
    for (const cell of this.cells.values()) {
      count += cell.items.length;
    }
    return count;
  }
}

/**
 * Extracts a Three.js Frustum from a camera for geometric testing.
 */
export function extractCameraFrustum(camera: Camera, targetFrustum?: Frustum): Frustum {
  const frustum = targetFrustum ?? new Frustum();
  const projScreenMatrix = new Matrix4();
  projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);
  return frustum;
}
