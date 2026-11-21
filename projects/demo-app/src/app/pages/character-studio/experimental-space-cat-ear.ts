import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Shape, ShapeUtils } from 'three';

/** Give the pink cup a shared boundary with the fur rim and a recessed floor. */
export function fitConceptCatEar(ear: Group): void {
  const outline = new Shape();
  outline.moveTo(-0.077, -0.067);
  outline.quadraticCurveTo(-0.082, -0.026, -0.056, 0.024);
  outline.quadraticCurveTo(-0.027, 0.083, -0.008, 0.092);
  outline.quadraticCurveTo(0, 0.098, 0.008, 0.092);
  outline.quadraticCurveTo(0.034, 0.078, 0.059, 0.019);
  outline.quadraticCurveTo(0.079, -0.024, 0.075, -0.065);
  outline.quadraticCurveTo(0.006, -0.092, -0.077, -0.067);

  const profile = outline.getPoints(7).slice(0, -1);
  if (ShapeUtils.isClockWise(profile)) profile.reverse();
  const count = profile.length;
  const centerY = -0.012;
  const rings = [
    { scale: 0.58, z: -0.056 },
    { scale: 0.88, z: -0.041 },
    { scale: 1, z: -0.015 },
    { scale: 0.95, z: 0.018 },
    { scale: 0.79, z: 0.033 },
    { scale: 0.67, z: 0.028 },
    { scale: 0.57, z: 0.011 },
    { scale: 0.42, z: -0.008 },
    { scale: 0.23, z: -0.014 },
  ];
  const firstInsetRing = 5;
  const positions = rings.flatMap(({ scale, z }) =>
    profile.flatMap(point => [point.x * scale, centerY + (point.y - centerY) * scale, z]));
  const back = rings.length * count;
  const floor = back + 1;
  positions.push(0, centerY, -0.061, 0, centerY, -0.018);

  const fur: number[] = [];
  const inset: number[] = [];
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    fur.push(back, next, i);
    for (let ring = 0; ring < rings.length - 1; ring++) {
      const vertex = ring * count;
      const nextRing = vertex + count;
      const material = ring < firstInsetRing ? fur : inset;
      material.push(vertex + i, vertex + next, nextRing + next, vertex + i, nextRing + next, nextRing + i);
    }
    const lastRing = (rings.length - 1) * count;
    inset.push(lastRing + i, lastRing + next, floor);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex([...fur, ...inset]);
  geometry.addGroup(0, fur.length, 0);
  geometry.addGroup(fur.length, inset.length, 1);
  geometry.computeVertexNormals();

  // Keep the rig's original fur and inner-ear materials so color controls
  // and ear poses still pass through the standard cat face rig.
  const [oldFur, oldInset] = ear.children as Mesh<BufferGeometry, MeshStandardMaterial>[];
  const pinna = new Mesh(geometry, [oldFur.material, oldInset.material]);
  pinna.name = 'concept-cat-ear';
  pinna.castShadow = pinna.receiveShadow = true;
  oldFur.geometry.dispose();
  oldInset.geometry.dispose();
  ear.remove(oldFur, oldInset);
  ear.add(pinna);
}
