import type { IPlaneTerrainPatchAddress } from './plane-terrain-domain';
import { PlaneTerrainDomain } from './plane-terrain-domain';

/** A bounded square selection of plane patches around a world-space position. */
export function selectPlaneTerrainPatches(
  domain: PlaneTerrainDomain,
  worldX: number,
  worldZ: number,
  radius: number,
  level = 0,
): readonly IPlaneTerrainPatchAddress[] {
  if (
    !Number.isFinite(worldX) ||
    !Number.isFinite(worldZ) ||
    !Number.isInteger(radius) ||
    radius < 0
  ) {
    throw new RangeError(
      'Plane terrain selection requires finite coordinates and a non-negative integer radius.',
    );
  }

  const patchSizeM = domain.getPatchSizeM({ level, x: 0, z: 0 });
  const centreX = Math.floor(worldX / patchSizeM);
  // Plane-domain V increases opposite Three.js world Z.
  const centreZ = Math.floor(-worldZ / patchSizeM);
  const addresses: IPlaneTerrainPatchAddress[] = [];

  for (let z = centreZ - radius; z <= centreZ + radius; z++) {
    for (let x = centreX - radius; x <= centreX + radius; x++) {
      addresses.push({ level, x, z });
    }
  }
  return addresses;
}

/** Stable identity for resident plane patches. */
export function getPlaneTerrainPatchKey(
  address: IPlaneTerrainPatchAddress,
): string {
  return `${address.level}:${address.x}:${address.z}`;
}
