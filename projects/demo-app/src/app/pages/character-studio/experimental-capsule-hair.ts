import {
  CatmullRomCurve3, Group, MathUtils, Mesh, MeshStandardMaterial, SphereGeometry, TubeGeometry, Vector3,
} from 'three';

export type CapsuleHairStyle = 'pigtails' | 'shaggy';
type Point = readonly [number, number, number];

interface HairFit {
  readonly radii: Point;
  readonly palette: { readonly hair: number; readonly curl: number; readonly band: number };
  readonly curlScale: Point;
}

const curlOffsets = [
  [-.24, .76, .85, .43], [.31, .77, .63, .44], [.66, .38, 1.04, .44],
  [.20, .34, .79, .49], [-.34, .25, .60, .37], [.67, -.12, .98, .43],
  [.24, -.18, .76, .46], [-.25, -.26, .53, .39], [.38, -.60, .45, .40],
  [.05, -.77, .22, .38], [.28, .51, -.63, .47], [.19, -.24, -.72, .47],
  [.52, .24, -.22, .40], [.43, -.32, -.24, .38],
];

// Base, bend and tip of each lock in head-local coordinates. The front row
// sweeps across the forehead, and longer locks form the silhouette at the nape.
const shaggyLocks: readonly (readonly [Point, Point, Point, number])[] = [
  [[-.14, 3.98, .34], [-.02, 4.51, .12], [-.45, 4.80, -.05], .31],
  [[.06, 4.01, -.18], [.39, 4.51, -.27], [.80, 4.62, -.37], .34],
  [[.25, 3.93, -.35], [.80, 4.25, -.49], [1.43, 4.31, -.68], .31],
  [[-.33, 3.91, -.29], [-.82, 4.36, -.45], [-1.30, 4.45, -.70], .32],
  [[-.59, 3.95, -.31], [-1.16, 4.20, -.51], [-1.72, 4.08, -.69], .31],
  [[-.74, 3.84, -.28], [-1.30, 4.04, -.45], [-1.86, 3.80, -.54], .32],
  [[-.71, 3.69, -.38], [-1.33, 3.81, -.59], [-1.86, 3.50, -.65], .32],
  [[-.79, 3.55, -.52], [-1.35, 3.52, -.76], [-1.77, 3.13, -.81], .34],
  [[-.82, 3.43, -.69], [-1.21, 3.16, -.91], [-1.51, 2.78, -.99], .31],
  [[-.76, 3.25, -.83], [-1.17, 2.76, -1.03], [-1.47, 2.31, -1.12], .29],
  [[-.48, 3.39, -1.02], [-.82, 2.89, -1.41], [-1.08, 2.14, -1.34], .32],
  [[.03, 3.68, -1.03], [-.23, 3.10, -1.51], [-.50, 2.43, -1.58], .34],
  [[.44, 3.63, -.94], [.52, 3.17, -1.45], [.27, 2.31, -1.57], .35],
  [[.81, 3.65, -.60], [1.18, 3.43, -.95], [1.30, 3.03, -1.15], .31],
  [[.58, 3.83, .18], [1.10, 3.77, .42], [1.44, 3.42, .51], .31],
  [[.27, 4.04, .45], [.79, 3.98, .96], [1.16, 3.39, 1.08], .34],
  [[.02, 4.13, .54], [.37, 4.01, 1.12], [.68, 3.49, 1.38], .31],
  [[.04, 4.09, .58], [-.26, 3.84, 1.18], [-.31, 3.41, 1.43], .33],
  [[-.19, 4.03, .49], [-.62, 3.67, 1.10], [-.92, 3.18, 1.20], .36],
  [[-.38, 3.99, .24], [-.98, 3.64, .87], [-1.30, 3.10, .96], .34],
  [[-.57, 3.86, -.02], [-1.21, 3.45, .52], [-1.52, 2.94, .59], .32],
];

/** Builds the hairstyle in scalp coordinates so a head and a preview can share the same recipe. */
export function buildExperimentalCapsuleHair({ radii: [x, y, z], palette, curlScale }: HairFit) {
  const root = new Group();
  root.name = 'capsule-hair';
  const sphere = new SphereGeometry(1, 32, 24);
  const pigtailMaterials = [palette.hair, palette.curl, palette.band].map(color =>
    new MeshStandardMaterial({ color, roughness: .66 }));
  const [hair, curl, band] = pigtailMaterials;
  band.roughness = .76;

  function ellipsoid(parent: Group, material: MeshStandardMaterial, position: Point, size: Point, rotation = 0) {
    const mesh = new Mesh(sphere, material);
    mesh.position.set(...position);
    mesh.scale.set(...size);
    mesh.rotation.z = rotation;
    parent.add(mesh);
    return mesh;
  }

  const pigtails = new Group();
  pigtails.name = 'capsule-hair-pigtails';
  const tufts: Group[] = [];
  ellipsoid(pigtails, hair, [0, y * .811, -.16 * z], [x * 1.075, y * .207, z * 1.03]);
  ellipsoid(pigtails, hair, [0, y * .695, -.68 * z], [x * .98, y * .24, z * .55]);

  function pigtailLock(material: MeshStandardMaterial, base: Point, tip: Point, halfWidth: number, halfDepth: number) {
    const point = new Vector3(...base);
    const delta = new Vector3(...tip).sub(point);
    const center = point.addScaledVector(delta, .5);
    const mesh = ellipsoid(pigtails, material, [center.x, center.y, center.z],
      [halfWidth, delta.length() * .58, halfDepth]);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
  }

  for (const side of [-1, 1]) {
    pigtailLock(hair, [side * .02 * x, y * .946, z * .43], [side * .58 * x, y * .879, z * .92], .39, .265);
    pigtailLock(curl, [side * .35 * x, y * .937, z * .40], [side * .88 * x, y * .810, z * .79], .355, .25);
    pigtailLock(hair, [side * .76 * x, y * .888, z * .25], [side * .99 * x, y * .725, z * .47], .29, .24);
    pigtailLock(hair, [side * .77 * x, y * .812, z * .12], [side * .86 * x, y * .543, -.99 * z], .30, .32);
    pigtailLock(band, [side * 1.12 * x, y * .920, -.37], [side * 1.22 * x, y * .780, -.61], .17, .265);

    const tuft = new Group();
    tuft.name = side < 0 ? 'pigtail-tuft-left' : 'pigtail-tuft-right';
    tuft.position.set(side * 1.17 * x, y * .85, -.49);
    tuft.scale.set(...curlScale);
    tufts.push(tuft);
    pigtails.add(tuft);
    const bunchX = side * (x + .99) - tuft.position.x;
    const bunchY = y * .713 - tuft.position.y;
    const bunchZ = -1.08 - tuft.position.z;
    ellipsoid(tuft, hair, [bunchX, bunchY, bunchZ], [.65, 1.02, .73]);
    curlOffsets.forEach(([dx, dy, dz, radius], index) => {
      ellipsoid(tuft, index % 3 === 0 ? hair : curl,
        [bunchX + side * dx, bunchY + dy, bunchZ + dz],
        [radius, radius * (index === 9 ? 1.43 : 1.1), radius * 1.08], -side * .19);
    });
  }
  root.add(pigtails);

  let shaggy: Group | undefined;
  const lockMeshes: Mesh<TubeGeometry, MeshStandardMaterial>[] = [];
  const shaggyMaterials: MeshStandardMaterial[] = [];

  function buildShaggy() {
    const group = new Group();
    group.name = 'capsule-hair-shaggy';
    shaggyMaterials.push(...[0x332824, 0x3b2e27, 0x42342b].map(color =>
      new MeshStandardMaterial({ color, roughness: .73 })));
    ellipsoid(group, shaggyMaterials[0], [0, 3.65, -.32], [1.31, .81, 1.27]);
    ellipsoid(group, shaggyMaterials[0], [0, 3.28, -.72], [1.21, .86, .79]);
    shaggyLocks.forEach(([base, bend, tip, radius], index) => {
      const origin = new Vector3(...base);
      const curve = new CatmullRomCurve3([new Vector3(), new Vector3(...bend).sub(origin), new Vector3(...tip).sub(origin)]);
      const segments = 16;
      const sides = 12;
      const geometry = new TubeGeometry(curve, segments, radius, sides);
      const positions = geometry.getAttribute('position');
      const point = new Vector3();
      for (let ring = 0; ring <= segments; ring++) {
        const t = ring / segments;
        const center = curve.getPointAt(t);
        const taper = Math.pow(Math.sin(Math.PI * t), .62) * (1.20 - .46 * t);
        for (let side = 0; side <= sides; side++) {
          const vertex = ring * (sides + 1) + side;
          point.fromBufferAttribute(positions, vertex).lerp(center, 1 - taper);
          positions.setXYZ(vertex, point.x, point.y, point.z);
        }
      }
      geometry.computeVertexNormals();
      // TubeGeometry duplicates the seam vertex for UVs. Average the seam normals
      // so the lock stays rounded under side lighting.
      const normals = geometry.getAttribute('normal');
      const seam = new Vector3();
      for (let ring = 1; ring < segments; ring++) {
        const first = ring * (sides + 1);
        const last = first + sides;
        seam.fromBufferAttribute(normals, first).add(point.fromBufferAttribute(normals, last)).normalize();
        normals.setXYZ(first, seam.x, seam.y, seam.z);
        normals.setXYZ(last, seam.x, seam.y, seam.z);
      }
      const lock = new Mesh(geometry, shaggyMaterials[index % shaggyMaterials.length]);
      lock.position.copy(origin);
      group.add(lock);
      lockMeshes.push(lock);
    });
    return group;
  }

  return {
    root,
    setStyle(style: CapsuleHairStyle, length: number) {
      if (style === 'shaggy') {
        shaggy ??= buildShaggy();
        for (const lock of lockMeshes) lock.scale.setScalar(MathUtils.clamp(length, .86, 1.14));
      }
      // Keep only the chosen part attached so framing excludes hidden hairstyles.
      const active = style === 'shaggy' ? shaggy! : pigtails;
      if (root.children[0] !== active) {
        root.clear();
        root.add(active);
      }
    },
    setPigtailLag(pitch: number, roll: number) {
      for (const tuft of tufts) tuft.rotation.set(MathUtils.clamp(pitch, -.28, .28), 0, MathUtils.clamp(roll, -.28, .28));
    },
    dispose() {
      sphere.dispose();
      for (const lock of lockMeshes) lock.geometry.dispose();
      for (const material of [...pigtailMaterials, ...shaggyMaterials]) material.dispose();
    },
  };
}
