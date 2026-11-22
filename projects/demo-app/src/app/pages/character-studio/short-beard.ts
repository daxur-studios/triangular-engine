import { BufferGeometry, Float32BufferAttribute, Group, MathUtils, Mesh, MeshStandardMaterial, type Vector3 } from 'three';
import { buildClayLock, type ClayLock, type ClayPoint } from './capsule-clay-lock';

export const SHORT_BEARD_REFERENCE_YAW = 32;
export const SHORT_BEARD_MOUTH_Y = 1.23;

const sweep = 1.79;

/** The smooth base fills the space between the layered locks and returns into the skin along the jaw. */
export function buildShortBeard(
  [radiusX, height, radiusZ]: ClayPoint,
  headProfile: readonly Vector3[],
) {
  const root = new Group();
  root.name = 'short-beard';
  const baseMaterial = new MeshStandardMaterial({ roughness: .76 });
  const lockMaterials = Array.from({ length: 3 }, () => new MeshStandardMaterial({ roughness: .74 }));

  function jawRadius(y: number): number {
    const above = headProfile.findIndex(point => point.y * height >= y);
    const before = headProfile[above - 1];
    const after = headProfile[above];
    return MathUtils.lerp(before.x, after.x, (y / height - before.y) / (after.y - before.y));
  }

  function surface(angle: number, rise: number, offset = 0): ClayPoint {
    const side = Math.abs(angle);
    const chin = .106 + .25 * Math.sin(side * .88) ** 2 + .49 * MathUtils.smoothstep(side, 1.21, sweep);
    // Leave a dip below the jaw's full speaking range. Behind the cheeks,
    // sweep up to the sideburns and taper back into the bare head.
    const hairline = .85 + .24 * MathUtils.smoothstep(side, .035, .48)
      + .34 * MathUtils.smoothstep(side, .37, .63)
      + .46 * MathUtils.smoothstep(side, .65, 1.24) - .35 * MathUtils.smoothstep(side, 1.48, sweep);
    const y = MathUtils.lerp(chin, hairline, rise);
    const fullness = MathUtils.lerp(.19, .12, MathUtils.smoothstep(side, .50, 1.40));
    const taper = 1 - MathUtils.smoothstep(side, 1.44, sweep);
    const radius = jawRadius(y) - .016
      + fullness * taper * Math.sin(Math.PI * rise) ** .65 + offset;
    return [radiusX * radius * Math.sin(angle), y, radiusZ * radius * Math.cos(angle)];
  }

  const columns = 72;
  const rows = 20;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      positions.push(...surface(MathUtils.lerp(-sweep, sweep, column / columns), row / rows));
      if (row === rows || column === columns) continue;
      const a = row * (columns + 1) + column;
      const c = a + columns + 1;
      indices.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  root.add(new Mesh(geometry, baseMaterial));

  function lock(shape: ClayLock, material: MeshStandardMaterial): void {
    const strand = buildClayLock(shape, .70);
    const mesh = new Mesh(strand, material);
    mesh.position.set(...shape[0]);
    root.add(mesh);
  }

  for (const [index, angle] of [-1.49, -1.28, -1.07, -.86, -.66, -.48, -.29, -.095, .105, .30, .49, .67, .86, 1.06, 1.27, 1.48].entries()) {
    const drift = .03 * Math.sin(index * 1.7);
    const rootPoint = surface(angle + drift, .97, -.04);
    const bend = surface(angle, .48 + .075 * Math.cos(index * 2.6), -.018);
    const tip = surface(angle - drift - .022, .07 + .09 * (index % 3), -.012);
    const radius = .145 + .033 * MathUtils.smoothstep(Math.abs(angle), .36, .8);
    lock([rootPoint, bend, tip, radius], lockMaterials[index % lockMaterials.length]);
  }

  // The upper-lip locks turn into the cheek mass on both sides of the mouth.
  for (const side of [-1, 1]) {
    lock([[side * .018, 1.735, 1.38], [side * .31, 1.668, 1.435], [side * .94, 1.365, 1.175], .112], lockMaterials[1]);
  }

  return {
    root,
    setColor(color: number) {
      baseMaterial.color.setHex(color);
      lockMaterials.forEach((material, index) => material.color.setHex(color).multiplyScalar(1.17 + index * .09));
    },
  };
}
