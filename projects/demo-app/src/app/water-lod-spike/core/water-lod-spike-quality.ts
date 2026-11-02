/** Quality tier ids, best first. */
export type WaterLodSpikeQualityId = 'ultra' | 'high' | 'medium' | 'low';

/**
 * One quality tier: how early the shading filter lets waves go, and how dense the mesh is. All 64 waves stay in every
 * tier. A tier that dropped the shortest waves outright (48, 40 and 20 waves were measured) put a colour step of 4 to 11/255
 * into the grazing and elevated views, because the dropped variance is only approximated by the quadrature where those
 * waves are still resolved; see ER 080.
 */
export interface IWaterLodSpikeQuality {
  readonly id: WaterLodSpikeQualityId;
  readonly label: string;
  /** Multiplies every wave's pixel footprint, so 2 fades each wave out at twice the wavelength (about 6 pixels per wavelength). */
  readonly lodBias: number;
  /** Target mesh cell size in pixels (`<flatTerrain [cellPixels]>`); larger is fewer triangles where the leaf cap is not reached. */
  readonly cellPixels: number;
  /** Most mesh leaves (`<flatTerrain [leafCap]>`): the 100 km plane reaches the default cap in every test view, so this is what sets the triangle count. */
  readonly leafCap: number;
}

/** The tiers, best first. `ultra` is the water as the aliasing suite v1 measured it. */
export const WATER_LOD_SPIKE_QUALITIES: readonly IWaterLodSpikeQuality[] = [
  { id: 'ultra', label: 'Ultra', lodBias: 1, cellPixels: 4, leafCap: 4096 },
  { id: 'high', label: 'High', lodBias: 2, cellPixels: 6, leafCap: 1024 },
  { id: 'medium', label: 'Medium', lodBias: 3, cellPixels: 8, leafCap: 512 },
  { id: 'low', label: 'Low', lodBias: 4, cellPixels: 10, leafCap: 256 },
];

/** The tier with this id; throws for an id the table does not have. */
export function waterLodSpikeQuality(id: WaterLodSpikeQualityId): IWaterLodSpikeQuality {
  const quality = WATER_LOD_SPIKE_QUALITIES.find((entry) => entry.id === id);
  if (!quality) throw new Error(`Unknown water quality: ${id}`);
  return quality;
}
