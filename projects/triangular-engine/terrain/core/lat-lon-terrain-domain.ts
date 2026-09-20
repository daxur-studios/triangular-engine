import type { TerrainVector3 } from './terrain-math';
import type {
  ITerrainPatchBounds,
  IHierarchicalTerrainSurfaceDomain,
} from './terrain-surface-domain';

export interface ILatLonTerrainPatchAddress {
  /** Quadtree level: 0 is the coarsest global root cut. */
  readonly level: number;
  /** Longitude tile index: 0 .. (rootTilesX * 2^level - 1), East from -PI. */
  readonly x: number;
  /** Latitude tile index: 0 .. (rootTilesY * 2^level - 1), North from -PI/2. */
  readonly y: number;
}

export type LatLonTerrainPatchEdge = 'left' | 'right' | 'bottom' | 'top';

/**
 * Hierarchical Longitude-Latitude terrain domain for spherical planets and 2.5D map projections.
 *
 * Parameterized by:
 * - U: Longitude $\lambda \in [-\pi, \pi]$ (radians)
 * - V: Latitude $\phi \in [-\pi/2, \pi/2]$ (radians)
 *
 * East-West wrapping across the antimeridian ($\lambda = \pm \pi$) is seamless by construction.
 */
export class LatLonTerrainDomain
  implements IHierarchicalTerrainSurfaceDomain<ILatLonTerrainPatchAddress>
{
  readonly kind = 'lat-lon';

  /** Number of root tiles across longitude at level 0 (default 4 -> 90 deg each). */
  readonly rootTilesX: number;
  /** Number of root tiles across latitude at level 0 (default 2 -> 90 deg each). */
  readonly rootTilesY: number;

  constructor(
    readonly radiusM: number,
    rootTilesX = 4,
    rootTilesY = 2,
  ) {
    if (!Number.isFinite(radiusM) || radiusM <= 0) {
      throw new RangeError(
        'LatLonTerrainDomain radius must be positive and finite.',
      );
    }
    if (!Number.isInteger(rootTilesX) || rootTilesX < 1) {
      throw new RangeError('rootTilesX must be a positive integer.');
    }
    if (!Number.isInteger(rootTilesY) || rootTilesY < 1) {
      throw new RangeError('rootTilesY must be a positive integer.');
    }
    this.rootTilesX = rootTilesX;
    this.rootTilesY = rootTilesY;
  }

  getTilesCountX(level: number): number {
    return this.rootTilesX * 2 ** level;
  }

  getTilesCountY(level: number): number {
    return this.rootTilesY * 2 ** level;
  }

  createLevelZeroRoots(): readonly ILatLonTerrainPatchAddress[] {
    const roots: ILatLonTerrainPatchAddress[] = [];
    for (let y = 0; y < this.rootTilesY; y += 1) {
      for (let x = 0; x < this.rootTilesX; x += 1) {
        roots.push({ level: 0, x, y });
      }
    }
    return roots;
  }

  getPatchBounds(address: ILatLonTerrainPatchAddress): ITerrainPatchBounds {
    this.validateAddress(address);
    const tilesX = this.getTilesCountX(address.level);
    const tilesY = this.getTilesCountY(address.level);
    const spanLon = (2 * Math.PI) / tilesX;
    const spanLat = Math.PI / tilesY;

    const minLon = -Math.PI + address.x * spanLon;
    const maxLon = -Math.PI + (address.x + 1) * spanLon;
    const minLat = -Math.PI / 2 + address.y * spanLat;
    const maxLat = -Math.PI / 2 + (address.y + 1) * spanLat;

    return {
      minU: minLon,
      maxU: maxLon,
      minV: minLat,
      maxV: maxLat,
    };
  }

  /** Converts patch domain coordinates (lon, lat) into unit sphere direction vector. */
  getFieldPosition(
    _address: ILatLonTerrainPatchAddress,
    u: number,
    v: number,
  ): TerrainVector3 {
    const lon = u;
    const lat = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, v));
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);

    // Coordinate system: lon=0 faces +Z, lon=+PI/2 faces +X (East), lat=+PI/2 faces +Y (North)
    const x = cosLat * sinLon;
    const y = sinLat;
    const z = cosLat * cosLon;
    return [x, y, z];
  }

  /** Converts patch domain coordinates and elevation into 3D world space. */
  getSurfacePosition(
    address: ILatLonTerrainPatchAddress,
    u: number,
    v: number,
    elevationM: number,
  ): TerrainVector3 {
    const [dx, dy, dz] = this.getFieldPosition(address, u, v);
    const r = this.radiusM + elevationM;
    return [dx * r, dy * r, dz * r];
  }

  /** Finds adjacent same-level neighbor, wrapping East-West across antimeridian. */
  getPatchNeighbor(
    address: ILatLonTerrainPatchAddress,
    edge: LatLonTerrainPatchEdge,
  ): ILatLonTerrainPatchAddress {
    this.validateAddress(address);
    const tilesX = this.getTilesCountX(address.level);
    const tilesY = this.getTilesCountY(address.level);

    switch (edge) {
      case 'left': // West
        return {
          level: address.level,
          x: (address.x - 1 + tilesX) % tilesX,
          y: address.y,
        };
      case 'right': // East
        return {
          level: address.level,
          x: (address.x + 1) % tilesX,
          y: address.y,
        };
      case 'bottom': // South
        return {
          level: address.level,
          x: address.x,
          y: Math.max(0, address.y - 1),
        };
      case 'top': // North
        return {
          level: address.level,
          x: address.x,
          y: Math.min(tilesY - 1, address.y + 1),
        };
    }
  }

  getChildren(
    address: ILatLonTerrainPatchAddress,
  ): readonly ILatLonTerrainPatchAddress[] {
    this.validateAddress(address);
    const nextLevel = address.level + 1;
    const nextX = address.x * 2;
    const nextY = address.y * 2;
    return [
      { level: nextLevel, x: nextX, y: nextY },
      { level: nextLevel, x: nextX + 1, y: nextY },
      { level: nextLevel, x: nextX, y: nextY + 1 },
      { level: nextLevel, x: nextX + 1, y: nextY + 1 },
    ];
  }

  getGeometricErrorM(
    address: ILatLonTerrainPatchAddress,
    resolution: number,
    minElevationM: number,
    maxElevationM: number,
  ): number {
    const tilesY = this.getTilesCountY(address.level);
    const spanLat = Math.PI / tilesY;
    const stepAngle = spanLat / resolution;

    // Chord sagitta over one quad: s = R * (1 - cos(theta / 2))
    const sagittaM = this.radiusM * (1 - Math.cos(stepAngle * 0.5));
    const elevationSpanM = (maxElevationM - minElevationM) / resolution;
    return sagittaM + elevationSpanM;
  }

  private validateAddress(address: ILatLonTerrainPatchAddress): void {
    if (
      !Number.isInteger(address.level) ||
      address.level < 0 ||
      !Number.isInteger(address.x) ||
      !Number.isInteger(address.y)
    ) {
      throw new RangeError(
        'LatLonTerrainDomain address must contain non-negative integer level, x, and y.',
      );
    }
    const tilesX = this.getTilesCountX(address.level);
    const tilesY = this.getTilesCountY(address.level);
    if (address.x < 0 || address.x >= tilesX) {
      throw new RangeError(
        `Address x (${address.x}) out of range [0, ${tilesX - 1}] at level ${address.level}.`,
      );
    }
    if (address.y < 0 || address.y >= tilesY) {
      throw new RangeError(
        `Address y (${address.y}) out of range [0, ${tilesY - 1}] at level ${address.level}.`,
      );
    }
  }
}
