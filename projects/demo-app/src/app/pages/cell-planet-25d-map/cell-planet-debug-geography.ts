import { BufferAttribute, BufferGeometry } from 'three';
import type { IVec3 } from 'triangular-engine/worldgen';
import type { IMapProjection } from 'triangular-engine/worldgen/render';

export interface IPlanarDebugRibbonOptions {
  readonly paths: readonly (readonly IVec3[])[];
  readonly closed: boolean;
  readonly projection: IMapProjection;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  readonly clearance: number;
  readonly defaultWidth: number;
  readonly pointWidths?: readonly (readonly number[])[];
  readonly heightAt: (direction: IVec3) => number;
}

interface IProjectedPoint {
  readonly lon: number;
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

function normalize(direction: IVec3): IVec3 {
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  return { x: direction.x / length, y: direction.y / length, z: direction.z / length };
}

function projectPoint(direction: IVec3, options: IPlanarDebugRibbonOptions): IProjectedPoint {
  const unit = normalize(direction);
  // Keep this inverse paired with the 2.5D bake's directionAt convention:
  // x = cos(lat) * cos(lon), z = cos(lat) * sin(lon).
  const lon = Math.atan2(unit.z, unit.x);
  const lat = Math.asin(Math.max(-1, Math.min(1, unit.y)));
  const projected = options.projection.project(lon, lat, options.mapWidth, options.mapHeight);
  return {
    lon,
    x: options.minX + (projected.x / options.mapWidth) * (options.maxX - options.minX),
    // The clipmap stores bake row 0 at world-Z min, so preserve its y-down map convention.
    z: options.minZ + (projected.y / options.mapHeight) * (options.maxZ - options.minZ),
    y: options.heightAt(unit) + options.clearance,
  };
}

/**
 * Builds a lightweight planar debug ribbon from high-level geography paths.
 *
 * This is intentionally an overlay primitive. It does not alter terrain samples or water
 * ownership. Antimeridian segments are omitted so a path never becomes a false line across the
 * whole map; the final terrain implementation can later use the same paths for real carving.
 */
export function buildPlanarDebugRibbonGeometry(options: IPlanarDebugRibbonOptions): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;

  const addSegment = (
    start: IProjectedPoint,
    end: IProjectedPoint,
    width: number,
  ): void => {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length <= 1e-6 || Math.abs(end.lon - start.lon) > Math.PI) return;

    const halfWidth = Math.max(0, width) * 0.5;
    const sideX = (-dz / length) * halfWidth;
    const sideZ = (dx / length) * halfWidth;
    const base = vertexCount;
    positions.push(
      start.x - sideX, start.y, start.z - sideZ,
      start.x + sideX, start.y, start.z + sideZ,
      end.x - sideX, end.y, end.z - sideZ,
      end.x + sideX, end.y, end.z + sideZ,
    );
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    vertexCount += 4;
  };

  for (let pathIndex = 0; pathIndex < options.paths.length; pathIndex++) {
    const path = options.paths[pathIndex];
    if (path.length < 2) continue;
    const projected = path.map((point) => projectPoint(point, options));
    const widths = options.pointWidths?.[pathIndex];
    const segmentCount = options.closed ? path.length : path.length - 1;
    for (let index = 0; index < segmentCount; index++) {
      const nextIndex = (index + 1) % path.length;
      const startWidth = widths?.[index] ?? options.defaultWidth;
      const endWidth = widths?.[nextIndex] ?? startWidth;
      addSegment(projected[index], projected[nextIndex], (startWidth + endWidth) * 0.5);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
