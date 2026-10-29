import type { BufferGeometry } from 'three';
import { MeshStandardMaterial } from 'three';
import { RubberHoseLimbMesh } from './capsule-rubber-hose-limb';

interface WindingReport {
  readonly total: number;
  readonly inward: number;
  readonly offenders: readonly string[];
}

/**
 * Counts non-degenerate triangles whose winding produces a face normal pointing
 * against the stored vertex normals. A non-zero count means the tube is wound
 * inside out and disappears with backface culling.
 */
function measureWinding(geometry: BufferGeometry): WindingReport {
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
    if (Math.hypot(faceX, faceY, faceZ) < 1e-9) continue;
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
      if (offenders.length < 8) offenders.push(`triangle ${offset / 3}`);
    }
  }

  return { total, inward, offenders };
}

describe('RubberHoseLimbMesh geometry', () => {
  it('builds the default vertical limb with outward-facing triangles', () => {
    const limb = new RubberHoseLimbMesh({
      material: new MeshStandardMaterial(),
    });
    const report = measureWinding(limb.geometry);
    limb.dispose();

    expect(report.total).toBeGreaterThan(0);
    expect(report.inward)
      .withContext(
        `${report.inward}/${report.total} inside-out triangles: ${report.offenders.join(', ')}`,
      )
      .toBe(0);
  });

  it('keeps outward-facing triangles when the curve is deformed', () => {
    const limb = new RubberHoseLimbMesh({
      material: new MeshStandardMaterial(),
    });

    limb.updateCurve(
      { x: 0.18, y: 0.62, z: 0.04 },
      { x: 0.42, y: 0.38, z: 0.16 },
      { x: 0.52, y: 0.12, z: -0.02 },
    );
    const report = measureWinding(limb.geometry);
    limb.dispose();

    expect(report.total).toBeGreaterThan(0);
    expect(report.inward)
      .withContext(
        `${report.inward}/${report.total} inside-out triangles: ${report.offenders.join(', ')}`,
      )
      .toBe(0);
  });
});
