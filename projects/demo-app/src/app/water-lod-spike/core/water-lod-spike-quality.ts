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

/**
 * The sphere page's tiers: the same table with ultra at 2048 leaves. The horizon suite (ER 080) measured 6.1 ms at 2 m for
 * 4096 leaves and 3.7 ms for 1024, so the cap is the lever; 2048 is the first step down. The plane spike keeps
 * {@link WATER_LOD_SPIKE_QUALITIES} as measured.
 */
export const WATER_LOD_SPIKE_SPHERE_QUALITIES: readonly IWaterLodSpikeQuality[] = WATER_LOD_SPIKE_QUALITIES.map((tier) =>
  tier.id === 'ultra' ? { ...tier, leafCap: 2048 } : tier,
);

/** The sphere page's tier with this id; throws for an id the table does not have. */
export function waterLodSpikeSphereQuality(id: WaterLodSpikeQualityId): IWaterLodSpikeQuality {
  const quality = WATER_LOD_SPIKE_SPHERE_QUALITIES.find((entry) => entry.id === id);
  if (!quality) throw new Error(`Unknown water quality: ${id}`);
  return quality;
}

/** The tier with this id; throws for an id the table does not have. */
export function waterLodSpikeQuality(id: WaterLodSpikeQualityId): IWaterLodSpikeQuality {
  const quality = WATER_LOD_SPIKE_QUALITIES.find((entry) => entry.id === id);
  if (!quality) throw new Error(`Unknown water quality: ${id}`);
  return quality;
}
