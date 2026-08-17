import type { IPartSolid } from './parts-solid';

export interface IPartMassProperties {
  readonly volumeM3: number;
  readonly dryMassKg: number;
  readonly centerOfMassM: readonly [number, number, number];
  readonly byLinkId: ReadonlyMap<
    number,
    {
      readonly volumeM3: number;
      readonly dryMassKg: number;
      readonly centerOfMassM: readonly [number, number, number];
    }
  >;
}

export const DEFAULT_AEROSPACE_DENSITY_KG_M3 = 500; // Typical hollow craft / composite density

function calculateSolidVolumeAndCentroid(solid: IPartSolid): {
  volume: number;
  centroid: [number, number, number];
} {
  const [d0, d1, d2] = solid.dimensionsM;
  const [px, py, pz] = solid.positionM;
  let volume = 0;

  switch (solid.shape) {
    case 'box':
      volume = d0 * d1 * d2;
      break;
    case 'cylinder':
      // dimensions: [radius, height]
      volume = Math.PI * d0 * d0 * d1;
      break;
    case 'cone': {
      // dimensions: [radiusBottom, radiusTop, height]
      const r1 = d0;
      const r2 = d1;
      const h = d2;
      volume = (1 / 3) * Math.PI * h * (r1 * r1 + r1 * r2 + r2 * r2);
      break;
    }
    case 'capsule': {
      // dimensions: [radius, totalHeight]
      const r = d0;
      const cylHeight = Math.max(0, d1 - 2 * r);
      volume = Math.PI * r * r * cylHeight + (4 / 3) * Math.PI * r * r * r;
      break;
    }
    case 'sphere':
      // dimensions: [radius]
      volume = (4 / 3) * Math.PI * d0 * d0 * d0;
      break;
  }

  return {
    volume: Math.max(1e-6, volume),
    centroid: [px, py, pz],
  };
}

/**
 * Calculates exact closed-form volume, dry mass, and center-of-mass centroid
 * for a part's primitive solid assembly.
 */
export function derivePartMassProperties(
  solids: readonly IPartSolid[],
  densityKgM3 = DEFAULT_AEROSPACE_DENSITY_KG_M3,
): IPartMassProperties {
  let totalVolume = 0;
  let weightedCenterX = 0;
  let weightedCenterY = 0;
  let weightedCenterZ = 0;

  interface ILinkAccumulator {
    volume: number;
    wx: number;
    wy: number;
    wz: number;
  }
  const linkMap = new Map<number, ILinkAccumulator>();

  for (const solid of solids) {
    const { volume, centroid } = calculateSolidVolumeAndCentroid(solid);

    totalVolume += volume;
    weightedCenterX += volume * centroid[0];
    weightedCenterY += volume * centroid[1];
    weightedCenterZ += volume * centroid[2];

    const linkAcc = linkMap.get(solid.linkId) ?? { volume: 0, wx: 0, wy: 0, wz: 0 };
    linkAcc.volume += volume;
    linkAcc.wx += volume * centroid[0];
    linkAcc.wy += volume * centroid[1];
    linkAcc.wz += volume * centroid[2];
    linkMap.set(solid.linkId, linkAcc);
  }

  const comX = totalVolume > 0 ? weightedCenterX / totalVolume : 0;
  const comY = totalVolume > 0 ? weightedCenterY / totalVolume : 0;
  const comZ = totalVolume > 0 ? weightedCenterZ / totalVolume : 0;

  const byLinkId = new Map<
    number,
    { volumeM3: number; dryMassKg: number; centerOfMassM: readonly [number, number, number] }
  >();

  for (const [linkId, acc] of linkMap.entries()) {
    byLinkId.set(linkId, {
      volumeM3: acc.volume,
      dryMassKg: acc.volume * densityKgM3,
      centerOfMassM: [
        acc.volume > 0 ? acc.wx / acc.volume : 0,
        acc.volume > 0 ? acc.wy / acc.volume : 0,
        acc.volume > 0 ? acc.wz / acc.volume : 0,
      ],
    });
  }

  return {
    volumeM3: totalVolume,
    dryMassKg: totalVolume * densityKgM3,
    centerOfMassM: [comX, comY, comZ],
    byLinkId,
  };
}
