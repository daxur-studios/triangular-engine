import type { BufferGeometry, Object3D } from 'three';
import {
  DEFAULT_CAPSULE_DNA,
  type CapsuleFacialHairId,
} from 'triangular-engine/characters';
import { buildCapsuleHairKit } from './capsule-hair-kit';

interface WindingReport {
  readonly total: number;
  readonly inward: number;
  readonly offenders: readonly string[];
}

/**
 * Counts non-degenerate triangles whose winding produces a face normal pointing
 * against the stored vertex normals. A non-zero count means the surface is wound
 * inside out and disappears with backface culling, which the hair materials use.
 */
function measureWinding(
  geometry: BufferGeometry,
  label: string,
): WindingReport {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  if (!position || !normal || !index)
    return { total: 0, inward: 0, offenders: [] };

  let total = 0;
  let inward = 0;
  const offenders: string[] = [];

  for (let offset = 0; offset + 2 < index.count; offset += 3) {
    const a = index.getX(offset);
    const b = index.getX(offset + 1);
    const c = index.getX(offset + 2);
    const abX = position.getX(b) - position.getX(a);
    const abY = position.getY(b) - position.getY(a);
    const abZ = position.getZ(b) - position.getZ(a);
    const acX = position.getX(c) - position.getX(a);
    const acY = position.getY(c) - position.getY(a);
    const acZ = position.getZ(c) - position.getZ(a);
    const faceX = abY * acZ - abZ * acY;
    const faceY = abZ * acX - abX * acZ;
    const faceZ = abX * acY - abY * acX;
    const faceLength = Math.hypot(faceX, faceY, faceZ);
    if (faceLength < 1e-7) continue; // degenerate triangle
    total++;

    const averageNormalX =
      (normal.getX(a) + normal.getX(b) + normal.getX(c)) / 3;
    const averageNormalY =
      (normal.getY(a) + normal.getY(b) + normal.getY(c)) / 3;
    const averageNormalZ =
      (normal.getZ(a) + normal.getZ(b) + normal.getZ(c)) / 3;
    const outwardDot =
      faceX * averageNormalX + faceY * averageNormalY + faceZ * averageNormalZ;
    if (outwardDot <= 0) {
      inward++;
      if (offenders.length < 8) {
        offenders.push(`${label} triangle ${offset / 3}`);
      }
    }
  }

  return { total, inward, offenders };
}

function measureTree(root: Object3D): WindingReport {
  let total = 0;
  let inward = 0;
  const offenders: string[] = [];
  root.traverse((object) => {
    const mesh = object as Object3D & {
      isMesh?: boolean;
      geometry?: BufferGeometry;
    };
    if (!mesh.isMesh || !mesh.geometry) return;
    const report = measureWinding(mesh.geometry, object.name || object.type);
    total += report.total;
    inward += report.inward;
    offenders.push(...report.offenders);
  });
  return { total, inward, offenders };
}

describe('Capsule facial hair geometry', () => {
  it('builds mustaches and beards with outward-facing triangles', () => {
    for (const facialHairId of [
      'mustache_handlebar',
      'full_beard',
    ] as CapsuleFacialHairId[]) {
      const kit = buildCapsuleHairKit({ ...DEFAULT_CAPSULE_DNA, facialHairId });
      const report = measureTree(kit.facialHairGroup);
      kit.dispose();

      expect(report.total)
        .withContext(`${facialHairId} produced no triangles`)
        .toBeGreaterThan(0);
      expect(report.inward)
        .withContext(
          `${facialHairId} has ${report.inward}/${report.total} inside-out triangles: ${report.offenders.join(', ')}`,
        )
        .toBe(0);
    }
  });
});
