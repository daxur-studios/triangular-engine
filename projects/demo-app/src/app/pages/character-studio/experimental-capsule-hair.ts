import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, LatheGeometry, MathUtils, Mesh,
  MeshStandardMaterial, SphereGeometry, Vector2, Vector3, type TubeGeometry,
} from 'three';
import { buildBobGeometry, DEFAULT_BOB_SHAPE, type BobShape } from './experimental-bob-hair';
import { buildClayLock, type ClayLock } from './capsule-clay-lock';
import {
  boundStacheOffset, classicStacheFringe, classicStacheSweep, classicStacheTemple, DEFAULT_STACHE_SHAPE,
} from './classic-stache-shapes';

export type CapsuleHairStyle = 'pigtails' | 'shaggy' | 'classic-stache' | 'bob';
export const DEFAULT_WORKSHOP_HAIR_COLORS: Readonly<Record<CapsuleHairStyle, number>> = {
  pigtails: 0xc06730,
  shaggy: 0x39322e,
  bob: 0x302825,
  'classic-stache': 0x473026,
};
type Point = readonly [number, number, number];

interface HairFit {
  readonly radii: Point;
  readonly scalpProfile: readonly Vector3[];
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

// Sculpt the part and the long front sweep independently of the rear layers.
const shaggyFringe: readonly ClayLock[] = [
  [[.30, 3.98, .34], [.53, 4.58, .59], [.31, 5.18, .48], .35],
  [[-.13, 4.06, .20], [-.42, 4.58, .15], [-.87, 4.89, .02], .34],
  [[.29, 4.02, -.12], [.40, 4.49, -.48], [.78, 4.86, -.64], .34],
  [[.22, 4.16, .42], [.41, 4.11, 1.29], [.12, 3.31, 1.53], .39],
  [[.11, 4.16, .42], [-.31, 4.27, 1.10], [-1.12, 3.73, 1.49], .43],
  [[-.17, 4.09, .48], [-.73, 3.92, 1.36], [-1.43, 3.00, 1.33], .45],
  [[-.38, 3.91, .27], [-1.26, 3.68, 1.07], [-1.94, 2.99, .83], .43],
  [[-.61, 3.76, .06], [-1.49, 3.43, .70], [-2.15, 2.73, .55], .37],
  [[.29, 4.05, .31], [.95, 3.94, 1.08], [1.32, 3.03, 1.20], .36],
  [[.56, 3.95, .14], [1.40, 3.90, .74], [1.96, 3.20, .69], .38],
  [[.71, 3.76, .05], [1.54, 3.48, .48], [2.07, 2.67, .42], .38],
  [[.94, 3.28, .30], [1.41, 2.65, .48], [1.40, 1.65, .49], .28],
  [[-1.02, 3.23, .31], [-1.39, 2.66, .50], [-1.34, 1.68, .53], .28],
];

const shaggyCrown: readonly ClayLock[] = [
  [[-.21, 4.13, -.12], [-.32, 4.54, -.58], [-.66, 4.98, -.78], .32],
  [[.12, 4.12, -.42], [.57, 4.46, -.87], [1.29, 4.52, -1.17], .36],
  [[.08, 4.11, -.42], [-.02, 4.30, -1.17], [-.54, 3.70, -1.96], .41],
];

// Three staggered rows fan from the crown, overlap at the temples, and close at the nape.
function shaggyRearLocks(): ClayLock[] {
  const point = (angle: number, radius: number, y: number): Point => {
    const radians = MathUtils.degToRad(angle);
    const z = Math.cos(radians) * radius;
    return [Math.sin(radians) * radius, y, z < 0 ? z * 1.12 : z];
  };
  const layer = (count: number, first: number, last: number,
    base: readonly [radius: number, height: number],
    bend: readonly [radius: number, height: number, sweepDegrees: number],
    tip: readonly [radius: number, height: number, sweepDegrees: number],
    thickness: number): ClayLock[] =>
    Array.from({ length: count }, (_, index) => {
      const fraction = index / (count - 1);
      const angle = MathUtils.lerp(first, last, fraction);
      const stagger = Math.sin(index * 2.35 + base[1]);
      const sweep = .43 + .57 * stagger;
      return [
        point(angle, base[0], base[1]),
        point(angle + bend[2] * sweep, bend[0] + .06 * stagger, bend[1] + .18 * stagger),
        point(angle + tip[2] * sweep, tip[0] + .12 * stagger,
          tip[1] + .18 * stagger + .44 * Math.abs(2 * fraction - 1)),
        thickness + .045 * stagger,
      ];
    });
  return [
    ...layer(9, 63, 301, [.70, 4.01], [1.37, 4.20, 14], [2.33, 3.78, 21], .36),
    ...layer(9, 77, 282, [1.12, 3.56], [1.68, 3.16, 11], [2.06, 2.07, 17], .41),
    ...layer(8, 101, 259, [1.21, 2.73], [1.45, 1.89, 9], [1.34, .59, 15], .32),
  ];
}

/** Low hairline under the rear locks. Its edges meet the scalp under the fringe and nape. */
function rearScalpCap(width: number, depth: number, drop: number): BufferGeometry {
  const rows = 14;
  const columns = 42;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const rise = row / rows;
    for (let column = 0; column <= columns; column++) {
      const around = column / columns;
      const angle = MathUtils.degToRad(MathUtils.lerp(70, 290, around));
      const edge = 2.86 - drop * Math.pow(Math.sin(Math.PI * around), .62) + .075 * Math.cos(11 * angle);
      const y = MathUtils.lerp(edge, 3.89, rise);
      const taper = Math.max(0, (y - 2.81) / 1.08);
      const ease = Math.sin(Math.PI * rise) * Math.sin(Math.PI * around);
      const radius = .985 - .20 * taper * taper + .096 * ease;
      positions.push(width * radius * Math.sin(angle), y, depth * radius * Math.cos(angle));
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
  return geometry;
}

/** Builds the hairstyle in scalp coordinates so a head and a preview can share the same recipe. */
export function buildExperimentalCapsuleHair({ radii: [x, y, z], scalpProfile, palette, curlScale }: HairFit) {
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
  let rearCap: BufferGeometry | undefined;
  const lockMeshes: Mesh<TubeGeometry, MeshStandardMaterial>[] = [];
  const shaggyMaterials: MeshStandardMaterial[] = [];

  function buildShaggy() {
    const group = new Group();
    group.name = 'capsule-hair-shaggy';
    shaggyMaterials.push(...Array.from({ length: 3 }, () => new MeshStandardMaterial({ roughness: .67 })));
    // Carry the crown under the fringe so the roots stay covered at every lock length.
    ellipsoid(group, shaggyMaterials[0], [0, 3.65, -.10], [1.31, .81, 1.40]);
    rearCap = rearScalpCap(x, z, 2.13);
    group.add(new Mesh(rearCap, shaggyMaterials[0]));
    [...shaggyFringe, ...shaggyCrown, ...shaggyRearLocks()].forEach(([base, bend, tip, radius], index) => {
      const lock = new Mesh(buildClayLock([base, bend, tip, radius]), shaggyMaterials[index % shaggyMaterials.length]);
      lock.position.set(...base);
      group.add(lock);
      lockMeshes.push(lock);
    });
    return group;
  }

  let classic: Group | undefined;
  let classicCap: BufferGeometry | undefined;
  let classicCrown: BufferGeometry | undefined;
  let classicFringe: Mesh<TubeGeometry, MeshStandardMaterial> | undefined;
  let fringeOffset = DEFAULT_STACHE_SHAPE.fringe;
  const classicLocks: Mesh<TubeGeometry, MeshStandardMaterial>[] = [];
  const classicMaterials: MeshStandardMaterial[] = [];

  function buildClassic() {
    const group = new Group();
    group.name = 'capsule-hair-classic-stache';
    classicMaterials.push(...Array.from({ length: 3 }, () => new MeshStandardMaterial({ roughness: .69 })));
    // Follow the actual scalp curve so skin cannot poke through as the fringe moves.
    const crownProfile = scalpProfile.filter(point => point.y >= .76).map(point => {
      const lift = MathUtils.smoothstep(point.y, .76, .85);
      return new Vector2(point.x * (.994 + .073 * lift), y * point.y + .09 * lift);
    });
    crownProfile.push(new Vector2(0, y + .09));
    classicCrown = new LatheGeometry(crownProfile, 64).scale(x, 1, z);
    const crown = new Mesh(classicCrown, classicMaterials[0]);
    crown.name = 'classic-stache-crown';
    group.add(crown);
    classicCap = rearScalpCap(x, z, 1.34);
    group.add(new Mesh(classicCap, classicMaterials[0]));
    classicStacheSweep.forEach((shape, index) => {
      const lock = new Mesh(buildClayLock(shape, .78), classicMaterials[index % classicMaterials.length]);
      if (shape === classicStacheTemple) lock.name = 'classic-stache-temple';
      lock.position.set(...shape[0]);
      classicLocks.push(lock);
      group.add(lock);
    });
    const shape = classicStacheFringe(fringeOffset);
    classicFringe = new Mesh(buildClayLock(shape, .78), classicMaterials[1]);
    classicFringe.name = 'classic-stache-fringe';
    classicFringe.position.set(...shape[0]);
    classicLocks.push(classicFringe);
    group.add(classicFringe);
    return group;
  }

  let bob: Mesh<BufferGeometry, MeshStandardMaterial> | undefined;
  let bobKey = '';

  return {
    root,
    setStyle(style: CapsuleHairStyle, length: number, requested = DEFAULT_STACHE_SHAPE.fringe,
      color = style === 'pigtails' ? palette.hair : DEFAULT_WORKSHOP_HAIR_COLORS[style],
      bobShape: BobShape = DEFAULT_BOB_SHAPE,
    ) {
      if (style === 'shaggy') {
        shaggy ??= buildShaggy();
        shaggyMaterials.forEach((material, index) => material.color.setHex(color).multiplyScalar(1 + .23 * index));
        for (const lock of lockMeshes) lock.scale.setScalar(MathUtils.clamp(length, .86, 1.14));
      }
      if (style === 'classic-stache') {
        classic ??= buildClassic();
        classicMaterials.forEach((material, index) => material.color.setHex(color).multiplyScalar([1, 1.36, 1.17][index]));
        const offset = boundStacheOffset('fringe', ...requested);
        if (offset[0] !== fringeOffset[0] || offset[1] !== fringeOffset[1]) {
          const geometry = buildClayLock(classicStacheFringe(offset), .78);
          classicFringe!.geometry.dispose();
          classicFringe!.geometry = geometry;
          fringeOffset = offset;
        }
      }
      if (style === 'bob') {
        const key = JSON.stringify(bobShape);
        if (!bob) {
          bob = new Mesh(buildBobGeometry(bobShape), new MeshStandardMaterial({ color, roughness: .82, side: DoubleSide }));
          bob.name = 'capsule-hair-bob';
          bobKey = key;
        } else if (bobKey !== key) {
          bob.geometry.dispose();
          bob.geometry = buildBobGeometry(bobShape);
          bobKey = key;
        }
        bob.material.color.setHex(color);
      }
      if (style === 'pigtails') {
        hair.color.setHex(color);
        if (color === palette.hair) curl.color.setHex(palette.curl);
        else curl.color.copy(hair.color).multiplyScalar(1.32);
      }
      // Keep only the chosen part attached so framing excludes hidden hairstyles.
      const active = style === 'shaggy' ? shaggy! : style === 'classic-stache' ? classic! : style === 'bob' ? bob! : pigtails;
      if (root.children[0] !== active) {
        root.clear();
        root.add(active);
      }
    },
    setPigtailLag(pitch: number, roll: number) {
      for (const tuft of tufts) tuft.rotation.set(MathUtils.clamp(pitch, -.28, .28), 0, MathUtils.clamp(roll, -.28, .28));
    },
    dispose() {
      bob?.geometry.dispose();
      bob?.material.dispose();
      sphere.dispose();
      rearCap?.dispose();
      classicCap?.dispose();
      classicCrown?.dispose();
      for (const lock of [...lockMeshes, ...classicLocks]) lock.geometry.dispose();
      for (const material of [...pigtailMaterials, ...shaggyMaterials, ...classicMaterials]) material.dispose();
    },
  };
}
