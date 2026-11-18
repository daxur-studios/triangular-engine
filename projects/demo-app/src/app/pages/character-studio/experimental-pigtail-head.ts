import {
  BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Group, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, TubeGeometry, Vector3,
  type Material,
} from 'three';
import {
  DEFAULT_CAPSULE_DNA,
  projectCapsuleFaceState,
  type CapsuleBrowRigPose,
  type CapsuleEyeRigPose,
  type CapsuleSdfMouthUniforms,
  type FacialAnimationController,
} from 'triangular-engine/characters';

export const EXPERIMENTAL_PIGTAIL_HEAD_ID = 'experimental-pigtail-head';

type Point = readonly [number, number, number];

const width = 2.72;
const depth = 2.78;
const height = 4.35;
const vertical = new Vector3(0, 1, 0);

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

/** The approved head geometry in the Studio scene, with the shared expression controller. */
export function buildExperimentalPigtailHead(face: FacialAnimationController) {
  const head = new Group();
  head.name = EXPERIMENTAL_PIGTAIL_HEAD_ID;
  head.scale.setScalar(0.35);

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
  const skin = mat(0xecc4a4);
  const white = mat(0xfff9f0, .49);
  const ink = mat(0x2b211b, .54);
  const hair = mat(0xc97235, .66);
  const curl = mat(0xd7813e, .66);
  const band = mat(0x505b63);
  const brow = mat(0xb46430);
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

  head.add(new Mesh(buildSkin(profile), skin));
  ellipsoid(head, hair, [0, y * .811, -.16 * z], [x * 1.075, y * .207, z * 1.03]);
  ellipsoid(head, hair, [0, y * .695, -.68 * z], [x * .98, y * .24, z * .55]);
  ellipsoid(head, mat(0xd9885b), [.018, 1.78, z * 1.011], [.098, .097, .096]);

  const eyeRadius = .625;
  const lidRadius = eyeRadius * 1.031;
  const upperLidGeometry = new SphereGeometry(lidRadius, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const lowerLidGeometry = new SphereGeometry(lidRadius, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
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
    head.add(eye);
    ellipsoid(eye, white, [0, 0, 0], [eyeRadius, eyeRadius * 1.014, eyeRadius * .99]);
    const gaze = new Group();
    eye.add(gaze);
    const pupil = ellipsoid(gaze, ink, [-.025 * side, .035, eyeRadius * .966], [1, 1, 1]);

    const lids = new Group();
    const upperLid = new Mesh(upperLidGeometry, skin);
    const lowerLid = new Mesh(lowerLidGeometry, skin);
    const upperLidPivot = new Group();
    const lashes = new Group();
    upperLidPivot.add(upperLid, lashes);
    lashes.rotation.x = 1.34;
    lids.add(upperLidPivot, lowerLid);
    eye.add(lids);

    for (let lash = 0; lash < 3; lash++) {
      const dx = .50 - lash * .047;
      const lashY = .18 + lash * .13;
      roundedStroke(lashes, ink, [
        [side * dx, lashY, .24],
        [side * (dx + .17 - lash * .02), lashY + .083 + lash * .047, .24 - lash * .027],
      ], .028);
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

    const bunchX = side * (x + .99);
    const bunchY = y * .713;
    const bunchZ = -1.08;
    ellipsoid(head, hair, [bunchX, bunchY, bunchZ], [.65, 1.02, .73]);
    curlOffsets.forEach(([dx, dy, dz, radius], index) => {
      ellipsoid(head, index % 3 === 0 ? hair : curl,
        [bunchX + side * dx, bunchY + dy, bunchZ + dz],
        [radius, radius * (index === 9 ? 1.43 : 1.1), radius * 1.08], -side * .19);
    });

    return (pose: CapsuleEyeRigPose, browPose: CapsuleBrowRigPose) => {
      gaze.rotation.set(pose.gazePitch, pose.gazeYaw, 0);
      const size = eyeRadius * pose.pupilScale;
      pupil.scale.set(size, size, size * .287);
      upperLidPivot.rotation.x = -1.34 + pose.upperLidAngle;
      lowerLid.rotation.x = 1.18 - pose.lowerLidAngle;
      lids.rotation.z = pose.lidTiltZ;
      browPivot.position.y = browY + browPose.heightOffset;
      browPivot.rotation.z = browPose.zRotation;
    };
  });

  const updateMouth = buildMouth(head, profile);
  const faceDna = { ...DEFAULT_CAPSULE_DNA, bodyRadius: x, pupilScale: .30, buckTeeth: false };

  function update(deltaSeconds: number): void {
    const pose = projectCapsuleFaceState(face.update(deltaSeconds), faceDna);
    updateMouth(pose.mouth);
    updateEye[0](pose.leftEye, pose.leftBrow);
    updateEye[1](pose.rightEye, pose.rightBrow);
  }

  return {
    head,
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

function buildMouth(head: Group, profile: readonly Vector3[]) {
  const segments = 40;
  const positions = new Float32BufferAttribute(new Float32Array((segments + 1) * 4 * 3), 3);
  const indices: number[] = [];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', positions);
  for (let row = 0; row < 2; row++) {
    const start = indices.length;
    for (let step = 0; step < segments; step++) {
      const a = row * 2 * (segments + 1) + step * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.addGroup(start, indices.length - start, row);
  }
  geometry.setIndex(indices);
  const mouth = new Mesh(geometry, [
    new MeshBasicMaterial({ color: 0x291c19 }),
    new MeshBasicMaterial({ color: 0xc56d53 }),
  ]);
  mouth.name = 'pigtail-mouth';
  mouth.frustumCulled = false;
  head.add(mouth);

  // Sample the same radius profile used for the skin mesh so the lip and
  // opening sweep across the head surface in every view.
  function placeVertex(index: number, x: number, y: number): void {
    const normalizedY = y / height;
    const upper = profile.findIndex(ring => ring.y >= normalizedY);
    const a = profile[upper - 1];
    const b = profile[upper];
    const t = (normalizedY - a.y) / (b.y - a.y);
    const radius = a.x + (b.x - a.x) * t;
    const z = depth / 2 * Math.sqrt(Math.max(0, radius * radius - (2 * x / width) ** 2));
    positions.setXYZ(index, x, y, z + .018);
  }

  return ({ mouthOpen, mouthWidth, mouthCurve, mouthWave }: CapsuleSdfMouthUniforms) => {
    const halfWidth = mouthWidth * .56;
    const smile = Math.max(0, mouthCurve);
    const aperture = mouthOpen * (1.20 - .94 * smile);
    for (let step = 0; step <= segments; step++) {
      const u = step * 2 / segments - 1;
      const taper = Math.sqrt(Math.max(0, 1 - u * u));
      const x = halfWidth * u;
      const center = 1.29 + .18 * mouthCurve * (u * u - .15) + mouthWave * .05 * Math.sin(u * Math.PI * 2);
      const upper = center + (aperture * .36 + .029) * taper;
      const lower = center - (aperture * .64 + .029) * taper;
      const lip = lower - (.012 + .105 * smile) * taper ** 3;
      placeVertex(step * 2, x, upper);
      placeVertex(step * 2 + 1, x, lower);
      const lipIndex = (segments + 1) * 2 + step * 2;
      placeVertex(lipIndex, x, lower);
      placeVertex(lipIndex + 1, x, lip);
    }
    positions.needsUpdate = true;
    geometry.computeBoundingBox();
  };
}
