import { IPlanetGraphCore } from './planet-graph';
import { findCellAt } from './sample-elevation';
import { IPlanetSurfaceSampler } from './planet-surface';
import { IVec3 } from './vec3';

export interface IPlanetSurfaceBakeParams {
  width: number;
  height: number;
  /** Optional conversion from unitless worldgen elevation to the bake's display units. */
  heightScale?: number;
  /**
   * Optional projection adapter. The default is equirectangular. A projection may return null
   * for canvas positions outside its valid footprint; those texels are baked as sea datum with
   * no source cell.
   */
  projection?: IPlanetSurfaceBakeProjection;
}

/** Projection-specific direction lookup used by a planar cache. The canonical sampler still
 * receives a unit-sphere direction, so changing this only changes the displayed map footprint. */
export interface IPlanetSurfaceBakeProjection {
  directionAt(x: number, y: number, width: number, height: number): IVec3 | null;
}

export interface IPlanetSurfaceBake {
  readonly width: number;
  readonly height: number;
  /** Canonical surface elevations, row-major, latitude north to south. */
  readonly elevations: Float32Array;
  /** Base graph elevations before ridge/river shaping. */
  readonly baseElevations: Float32Array;
  /** Stable source cell id per texel. This metadata is never linearly filtered. */
  readonly cellIds: Int32Array;
  /** 1 for land and 0 for water at the source cell. */
  readonly landMask: Uint8Array;
  readonly heightScale: number;
}

function directionAt(x: number, y: number, width: number, height: number): IVec3 {
  const longitude = (x / width - 0.5) * Math.PI * 2;
  const latitude = (0.5 - y / height) * Math.PI;
  const cosLatitude = Math.cos(latitude);
  return {
    x: cosLatitude * Math.cos(longitude),
    y: Math.sin(latitude),
    z: cosLatitude * Math.sin(longitude),
  };
}

/** Bakes a bounded equirectangular cache; the sampler remains authoritative. */
export function buildPlanetSurfaceBake(
  graph: IPlanetGraphCore,
  sampler: IPlanetSurfaceSampler,
  params: IPlanetSurfaceBakeParams,
): IPlanetSurfaceBake {
  const width = Math.max(1, Math.floor(params.width));
  const height = Math.max(1, Math.floor(params.height));
  const heightScale = params.heightScale ?? 1;
  const elevations = new Float32Array(width * height);
  const baseElevations = new Float32Array(width * height);
  const cellIds = new Int32Array(width * height);
  const landMask = new Uint8Array(width * height);

  const projectDirection = params.projection?.directionAt ?? directionAt;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const direction = projectDirection(x + 0.5, y + 0.5, width, height);
      const index = y * width + x;
      if (!direction) {
        cellIds[index] = -1;
        continue;
      }
      const sample = sampler.sample(direction);
      elevations[index] = sample.elevation * heightScale;
      baseElevations[index] = sample.baseElevation * heightScale;
      cellIds[index] = findCellAt(graph, direction).id;
      landMask[index] = sample.isLand ? 1 : 0;
    }
  }

  return { width, height, elevations, baseElevations, cellIds, landMask, heightScale };
}
