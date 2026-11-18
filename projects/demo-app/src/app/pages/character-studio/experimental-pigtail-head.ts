import {
  BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Group, MathUtils, Mesh,
  MeshStandardMaterial, SphereGeometry, TubeGeometry, Vector3,
  type Material,
} from 'three';
import {
  DEFAULT_CAPSULE_DNA,
  projectCapsuleFaceState,
  type CapsuleBrowRigPose,
  type CapsuleEyeRigPose,
  type FacialAnimationController,
} from 'triangular-engine/characters';
import { createCapsuleBodyMaterial } from 'triangular-engine/procedural';
import { createPigtailEyeMaterial } from './pigtail-eye-material';

export const EXPERIMENTAL_PIGTAIL_HEAD_ID = 'experimental-pigtail-head';

export const EXPERIMENTAL_PIGTAIL_PRESETS = [
  { value: EXPERIMENTAL_PIGTAIL_HEAD_ID, label: 'Orange Pigtails (Experimental)', seed: undefined },
  { value: 'experimental-pigtail-7', label: 'Plum Pigtails (Seed 7)', seed: 7 },
  { value: 'experimental-pigtail-4', label: 'Honey Pigtails (Seed 4)', seed: 4 },
  { value: 'experimental-pigtail-25', label: 'Chestnut Pigtails (Seed 25)', seed: 25 },
] as const;

type Point = readonly [number, number, number];

const width = 2.72;
const depth = 2.78;
const height = 4.35;
const vertical = new Vector3(0, 1, 0);

const orangePalette = {
  skin: '#eab995', nose: 0xd9885b, brow: 0xb46430, hair: 0xc06730, curl: 0xd37a37, band: 0x505b63, freckle: 0xb67554,
};
const variantPalettes = [
  { skin: '#bc855f', nose: 0xa56353, brow: 0x523244, hair: 0x442a40, curl: 0x6b425c, band: 0xb0ad8e, freckle: 0x754738 },
  { skin: '#ce9874', nose: 0xb9755b, brow: 0x573329, hair: 0x5d392f, curl: 0x845240, band: 0x698d87, freckle: 0x9e614c },
  { skin: '#f1c4a9', nose: 0xda9474, brow: 0xa67039, hair: 0xbe8c42, curl: 0xd9ab59, band: 0x9b7062, freckle: 0xbd7c5c },
];

function pigtailAppearance(seed: number | undefined) {
  if (seed === undefined) {
    return { palette: orangePalette, scale: [1, 1, 1] as Point, curls: [1, 1, 1] as Point, freckles: [] };
  }

  let state = seed >>> 0;
  // Mulberry32 uses per-head state so Studio updates cannot affect the generated appearance.
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let hash = Math.imul(state ^ (state >>> 15), 1 | state);
    hash = (hash + Math.imul(hash ^ (hash >>> 7), 61 | hash)) ^ hash;
    return ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
  };
  const sample = (min: number, max: number) => MathUtils.lerp(min, max, random());
  const palette = variantPalettes[Math.floor(random() * variantPalettes.length)];
  const scale: Point = [sample(.90, 1.10), sample(.90, 1.10), sample(.94, 1.06)];
  const curls: Point = [sample(.80, 1.24), sample(.70, 1.28), sample(.90, 1.16)];
  const count = [0, 3, 5][Math.floor(random() * 3)];
  const freckles = [-1, 1].flatMap(side => [
    [.30, 1.66], [.43, 1.69], [.56, 1.66], [.38, 1.52], [.51, 1.53],
  ].slice(0, count).map(([angle, y]) => ({
    angle: side * (angle + sample(-.021, .021)),
    y: y + sample(-.034, .034),
    radius: sample(.022, .039),
  })));
  return { palette, scale, curls, freckles };
}

function buildSkin(profile: readonly Vector3[]): BufferGeometry {
  const sides = 64;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [ring, { x: radius, y }] of profile.entries()) {
    for (let segment = 0; segment < sides; segment++) {
      const angle = segment / sides * 2 * Math.PI;
      positions.push(
        radius * Math.cos(angle) * width / 2,
        y * height,
        radius * Math.sin(angle) * depth / 2,
      );
      if (ring === profile.length - 1) continue;
      const a = ring * sides + segment;
      const b = ring * sides + (segment + 1) % sides;
      indices.push(a, a + sides, b, b, a + sides, b + sides);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The approved head geometry, optionally varied by seed, with the shared expression controller. */
export function buildExperimentalPigtailHead(face: FacialAnimationController, seed?: number) {
  const appearance = pigtailAppearance(seed);
  const { palette } = appearance;
  const head = new Group();
  head.name = EXPERIMENTAL_PIGTAIL_HEAD_ID;
  // Scale the assembled face so its features and the mouth shader stay registered to the skin.
  head.scale.set(...appearance.scale).multiplyScalar(.35);

  const profileCurve = new CatmullRomCurve3([
    [0, .001], [0, .63], [.006, .83], [.019, .951], [.04, .99], [.09, 1],
    [.48, 1], [.69, .99], [.78, .95], [.87, .85], [.94, .65], [.985, .34], [1, .001],
  ].map(([y, r]) => new Vector3(r, y, 0)));
  const profile = profileCurve.getSpacedPoints(64);
  for (const ring of profile) {
    ring.x = Math.max(0, ring.x);
    ring.y = Math.max(0, ring.y);
  }

  const sphere = new SphereGeometry(1, 32, 24);
  const mat = (color: number, roughness = .76) => new MeshStandardMaterial({ color, roughness });
  const faceDna = { ...DEFAULT_CAPSULE_DNA, bodyRadius: width / 2, pupilScale: .30, buckTeeth: false };
  const skinTone = palette.skin;
  const { material: headSkin, uniforms: mouthUniforms } = createCapsuleBodyMaterial({
    ...faceDna,
    skinTone,
    // Set the mouth scale in head-local units and put the suit seam below the head.
    bodyRadius: 1.62,
    suitSplitY: -height,
  });
  mouthUniforms.uMouthCenterY.value = 1.29;
  headSkin.roughness = .76;
  headSkin.metalness = 0;
  const ink = mat(0x2b211b, .54);
  const hair = mat(palette.hair, .66);
  const curl = mat(palette.curl, .66);
  const band = mat(palette.band);
  const brow = mat(palette.brow);
  const x = width / 2;
  const y = height;
  const z = depth / 2;

  function ellipsoid(parent: Group, material: Material, position: Point, size: Point, rotation = 0) {
    const mesh = new Mesh(sphere, material);
    mesh.position.set(...position);
    mesh.scale.set(...size);
    mesh.rotation.z = rotation;
    parent.add(mesh);
    return mesh;
  }

  function roundedStroke(parent: Group, material: Material, points: Point[], radius: number) {
    const curve = new CatmullRomCurve3(points.map(point => new Vector3(...point)));
    parent.add(new Mesh(new TubeGeometry(curve, 20, radius, 8), material));
    const tip = [radius, radius, radius] as const;
    ellipsoid(parent, material, points[0], tip);
    ellipsoid(parent, material, points[points.length - 1], tip);
  }

  function lock(material: Material, base: Point, tip: Point, lockWidth: number, lockDepth: number) {
    const point = new Vector3(...base);
    const delta = new Vector3(...tip).sub(point);
    const middle = point.addScaledVector(delta, .5);
    const mesh = ellipsoid(head, material, [middle.x, middle.y, middle.z],
      [lockWidth, delta.length() * .58, lockDepth]);
    mesh.quaternion.setFromUnitVectors(vertical, delta.normalize());
  }

  const skinMesh = new Mesh(buildSkin(profile), headSkin);
  skinMesh.name = 'pigtail-skin';
  head.add(skinMesh);
  ellipsoid(head, hair, [0, y * .811, -.16 * z], [x * 1.075, y * .207, z * 1.03]);
  ellipsoid(head, hair, [0, y * .695, -.68 * z], [x * .98, y * .24, z * .55]);
  ellipsoid(head, mat(palette.nose), [.018, 1.78, z * 1.011], [.098, .097, .096]);

  if (appearance.freckles.length) {
    const freckle = mat(palette.freckle);
    for (const { angle, y: cheekY, radius } of appearance.freckles) {
      // The cheeks are on the constant-radius part of the capsule profile.
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const spot = ellipsoid(head, freckle, [x * sin, cheekY, z * cos], [radius, radius * .78, .009]);
      spot.name = 'pigtail-freckle';
      spot.rotation.y = Math.atan2(sin / x, cos / z);
    }
  }

  const eyeRadius = .625;
  const eyeGeometry = new SphereGeometry(1, 48, 32);
  const curlOffsets = [
    [-.24, .76, .85, .43], [.31, .77, .63, .44], [.66, .38, 1.04, .44],
    [.20, .34, .79, .49], [-.34, .25, .60, .37], [.67, -.12, .98, .43],
    [.24, -.18, .76, .46], [-.25, -.26, .53, .39], [.38, -.60, .45, .40],
    [.05, -.77, .22, .38], [.28, .51, -.63, .47], [.19, -.24, -.72, .47],
    [.52, .24, -.22, .40], [.43, -.32, -.24, .38],
  ];

  const updateEye = [-1, 1].map(side => {
    const eye = new Group();
    eye.position.set(side * .825, 2.26, z * .8);
    eye.scale.set(eyeRadius, eyeRadius * 1.014, eyeRadius * .99);
    head.add(eye);
    const eyeSurface = createPigtailEyeMaterial(skinTone, side);
    const eyeball = new Mesh(eyeGeometry, eyeSurface.material);
    eyeball.name = side < 0 ? 'pigtail-eye-left' : 'pigtail-eye-right';
    eye.add(eyeball);

    const lashes = new Group();
    eye.add(lashes);

    for (let lash = 0; lash < 3; lash++) {
      const lashX = .58 + lash * .125;
      const lashAngle = .84 - lash * .13;
      const crossSection = Math.sqrt(1 - lashX * lashX);
      const root = new Vector3(side * lashX, Math.sin(lashAngle) * crossSection, Math.cos(lashAngle) * crossSection);
      const tip = root.clone().add(new Vector3(side * .12, .22 - lash * .045, -.055));
      root.multiplyScalar(.98);
      roundedStroke(lashes, ink, [
        [root.x, root.y, root.z],
        [tip.x, tip.y, tip.z],
      ], .042 - lash * .004);
    }

    const browPivot = new Group();
    const browY = y * .746;
    browPivot.position.set(side * .65 * x, browY, z * .793);
    head.add(browPivot);
    roundedStroke(browPivot, brow, [
      [-side * .13 * x, 0, z * .073],
      [0, y * -.001, 0],
      [side * .10 * x, y * -.034, z * -.058],
    ], .065);

    lock(hair, [side * .02 * x, y * .946, z * .43], [side * .58 * x, y * .879, z * .92], .39, .265);
    lock(curl, [side * .35 * x, y * .937, z * .40], [side * .88 * x, y * .810, z * .79], .355, .25);
    lock(hair, [side * .76 * x, y * .888, z * .25], [side * .99 * x, y * .725, z * .47], .29, .24);
    lock(hair, [side * .77 * x, y * .812, z * .12], [side * .86 * x, y * .543, -.99 * z], .30, .32);
    lock(band, [side * 1.12 * x, y * .920, -.37], [side * 1.22 * x, y * .780, -.61], .17, .265);

    // Stretch curls around the tie to keep them attached across the allowed shapes.
    const tuft = new Group();
    tuft.name = side < 0 ? 'pigtail-tuft-left' : 'pigtail-tuft-right';
    tuft.position.set(side * 1.17 * x, y * .85, -.49);
    tuft.scale.set(...appearance.curls);
    head.add(tuft);
    const bunchX = side * (x + .99) - tuft.position.x;
    const bunchY = y * .713 - tuft.position.y;
    const bunchZ = -1.08 - tuft.position.z;
    ellipsoid(tuft, hair, [bunchX, bunchY, bunchZ], [.65, 1.02, .73]);
    curlOffsets.forEach(([dx, dy, dz, radius], index) => {
      ellipsoid(tuft, index % 3 === 0 ? hair : curl,
        [bunchX + side * dx, bunchY + dy, bunchZ + dz],
        [radius, radius * (index === 9 ? 1.43 : 1.1), radius * 1.08], -side * .19);
    });

    return (pose: CapsuleEyeRigPose, browPose: CapsuleBrowRigPose, blink: number, awe: number) => {
      eyeSurface.update(pose, blink, awe);
      lashes.rotation.set(pose.upperLidAngle * .52, 0, pose.lidTiltZ, 'ZXY');
      browPivot.position.y = browY + browPose.heightOffset;
      browPivot.rotation.z = browPose.zRotation;
    };
  });

  let elapsedSeconds = 0;
  let aweTarget = 0;
  let awe = 0;

  function update(deltaSeconds: number): void {
    const delta = Math.max(0, deltaSeconds);
    elapsedSeconds += delta;
    awe = MathUtils.damp(awe, aweTarget, 16, delta);
    const frame = face.update(delta);
    const channels = frame.channels;
    if (awe > .001) {
      channels['brow.raise'] = MathUtils.lerp(channels['brow.raise'] ?? 0, .52, awe);
      if (!frame.isSpeaking) {
        channels['mouth.jawOpen'] = MathUtils.lerp(channels['mouth.jawOpen'] ?? 0, .31, awe);
        channels['mouth.round'] = MathUtils.lerp(channels['mouth.round'] ?? 0, .50, awe);
        channels['mouth.smile'] = MathUtils.lerp(channels['mouth.smile'] ?? 0, .13, awe);
      }
    }
    const pose = projectCapsuleFaceState(frame, faceDna, { elapsedSeconds });
    const { mouthOpen, mouthWidth, mouthCurve, mouthWave, tongueVisible } = pose.mouth;
    mouthUniforms.uMouthOpen.value = mouthOpen;
    mouthUniforms.uMouthWidth.value = mouthWidth;
    mouthUniforms.uMouthCurve.value = mouthCurve;
    mouthUniforms.uMouthWave.value = mouthWave;
    mouthUniforms.uTongueVisible.value = tongueVisible;
    const blink = channels['eye.blink'] ?? 0;
    updateEye[0](pose.leftEye, pose.leftBrow, Math.max(blink, channels['eye.blink.left'] ?? 0), awe);
    updateEye[1](pose.rightEye, pose.rightBrow, Math.max(blink, channels['eye.blink.right'] ?? 0), awe);
  }

  return {
    head,
    skinTone,
    setAwe: (active: boolean) => { aweTarget = active ? 1 : 0; },
    update,
    dispose: () => {
      const geometries = new Set<BufferGeometry>();
      const materials = new Set<Material>();
      head.traverse(object => {
        if (object instanceof Mesh) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            materials.add(material);
          }
        }
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
    },
  };
}
