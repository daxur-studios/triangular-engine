/**
 * Modular Hair & Facial Hair Kit for Capsule Doodle characters.
 *
 * Implements procedural sculpt-like hair chunks (tapered Catmull-Rom spline locks,
 * curly puff clusters, space buns, ponytails, mullets, mohawks, handlebar mustaches,
 * and full beards) plus a hybrid socket helper (`attachExternalHairGltf`) for swapping
 * in external Blender `.glb` hair chunks scaled by `bodyRadius`.
 */

import {
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type {
  CapsuleCharacterDNA,
  CapsuleFacialHairId,
  CapsuleHairStyleId,
} from 'triangular-engine/characters';

export interface CapsuleHairKitResult {
  readonly root: Group;
  readonly crownSocket: Group;
  readonly secondaryMotionGroup: Group;
  readonly facialHairGroup: Group;
  readonly rebuild: (dna: CapsuleCharacterDNA) => void;
  readonly attachExternalHairGltf: (gltfRoot: Object3D, referenceRadius?: number) => void;
  readonly dispose: () => void;
}

/**
 * Generates a tapered spline lock of hair along a `CatmullRomCurve3` with a plump middle
 * and pinched root/tip, producing the sculpted clay-lock aesthetic in the concept sheets.
 */
function createTaperedSplineLockGeometry(
  points: readonly Vector3[],
  maxRadius: number,
  tubularSegments = 14,
  radialSegments = 8,
  flattenRatio = 0.65,
): BufferGeometry {
  const curve = new CatmullRomCurve3([...points]);
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const ringVerts = radialSegments + 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    const pt = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];

    // Plump near base/mid (t ~ 0.35), tapering smoothly to a crisp point at t = 1
    const profile = Math.sin(Math.pow(t, 0.72) * Math.PI) * (1 - t * 0.25);
    const rx = Math.max(0.002, maxRadius * profile);
    const ry = rx * flattenRatio;

    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const vx = pt.x + rx * cosT * N.x + ry * sinT * B.x;
      const vy = pt.y + rx * cosT * N.y + ry * sinT * B.y;
      const vz = pt.z + rx * cosT * N.z + ry * sinT * B.z;
      positions.push(vx, vy, vz);

      const nx = cosT * N.x + sinT * B.x;
      const ny = cosT * N.y + sinT * B.y;
      const nz = cosT * N.z + sinT * B.z;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / len, ny / len, nz / len);
    }
  }

  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * ringVerts + j;
      const b = (i + 1) * ringVerts + j;
      const c = (i + 1) * ringVerts + (j + 1);
      const d = i * ringVerts + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

function addScalpBaseCap(
  parent: Group,
  r: number,
  hairMat: MeshStandardMaterial,
  thetaLength = Math.PI * 0.46,
): void {
  const capGeo = new SphereGeometry(r * 1.035, 24, 14, 0, Math.PI * 2, 0, thetaLength);
  const capMesh = new Mesh(capGeo, hairMat);
  capMesh.rotation.x = -0.22; // Tilt back so front hairline stays clear of googly eyes
  capMesh.castShadow = true;
  parent.add(capMesh);
}

function addPartedFrontBangs(
  parent: Group,
  r: number,
  hairMat: MeshStandardMaterial,
): void {
  for (const sign of [-1, 1] as const) {
    const bangGeo = createTaperedSplineLockGeometry(
      [
        new Vector3(sign * r * 0.05, r * 0.96, r * 0.42),
        new Vector3(sign * r * 0.42, r * 0.86, r * 0.72),
        new Vector3(sign * r * 0.76, r * 0.56, r * 0.56),
        new Vector3(sign * r * 0.92, r * 0.25, r * 0.28),
      ],
      r * 0.22,
      12,
      8,
      0.55,
    );
    const bangMesh = new Mesh(bangGeo, hairMat);
    bangMesh.castShadow = true;
    parent.add(bangMesh);
  }
}

function buildHairStyleMeshes(
  style: CapsuleHairStyleId,
  r: number,
  staticCrown: Group,
  secondaryGroup: Group,
  hairMat: MeshStandardMaterial,
  highlightMat: MeshStandardMaterial,
): void {
  if (style === 'bald') return;

  switch (style) {
    case 'ponytail': {
      addScalpBaseCap(staticCrown, r, hairMat);
      addPartedFrontBangs(staticCrown, r, hairMat);

      // Hairband ring on upper-left crown
      const bandGeo = new TorusGeometry(r * 0.20, r * 0.055, 10, 18);
      const bandMesh = new Mesh(bandGeo, highlightMat);
      bandMesh.position.set(-r * 0.52, r * 0.82, -r * 0.12);
      bandMesh.rotation.set(0.3, 0.5, 0.75);
      staticCrown.add(bandMesh);

      // Flowing ponytail lock cluster attached to secondaryGroup for spring bounce
      const lockOffsets = [
        [0, 0.18, 0],
        [-0.14, 0.05, 0.12],
        [0.10, 0.08, -0.14],
        [-0.18, -0.10, -0.06],
        [0.05, -0.12, 0.14],
      ];
      for (const [ox, oy, oz] of lockOffsets) {
        const lockGeo = createTaperedSplineLockGeometry(
          [
            new Vector3(-r * 0.52, r * 0.82, -r * 0.12),
            new Vector3(-r * (0.95 + ox), r * (1.02 + oy), -r * (0.18 + oz)),
            new Vector3(-r * (1.32 + ox * 1.4), r * (0.68 + oy * 1.3), -r * (0.25 + oz * 1.3)),
            new Vector3(-r * (1.46 + ox * 1.5), r * (0.28 + oy * 1.5), -r * (0.20 + oz)),
          ],
          r * 0.24,
        );
        const mesh = new Mesh(lockGeo, hairMat);
        mesh.castShadow = true;
        secondaryGroup.add(mesh);
      }
      break;
    }

    case 'pigtails': {
      addScalpBaseCap(staticCrown, r, hairMat, Math.PI * 0.42);
      addPartedFrontBangs(staticCrown, r, hairMat);

      // Twin side curly puff clusters with blue/highlight hairbands
      for (const sign of [-1, 1] as const) {
        const bandGeo = new TorusGeometry(r * 0.18, r * 0.05, 10, 16);
        const band = new Mesh(bandGeo, highlightMat);
        band.position.set(sign * r * 0.92, r * 0.56, 0);
        band.rotation.y = Math.PI * 0.5;
        staticCrown.add(band);

        const puffPositions = [
          [1.22, 0.65, 0.0],
          [1.42, 0.72, 0.14],
          [1.44, 0.52, -0.14],
          [1.32, 0.36, 0.12],
          [1.56, 0.44, 0.02],
          [1.26, 0.78, -0.15],
          [1.18, 0.40, -0.12],
        ];
        for (let i = 0; i < puffPositions.length; i++) {
          const [px, py, pz] = puffPositions[i];
          const puffR = r * (i === 0 ? 0.25 : 0.19);
          const puffGeo = new SphereGeometry(puffR, 14, 12);
          const puffMesh = new Mesh(puffGeo, hairMat);
          puffMesh.position.set(sign * r * px, r * py, r * pz);
          puffMesh.castShadow = true;
          secondaryGroup.add(puffMesh);
        }
      }
      break;
    }

    case 'buns': {
      addScalpBaseCap(staticCrown, r, hairMat, Math.PI * 0.44);
      addPartedFrontBangs(staticCrown, r, hairMat);

      for (const sign of [-1, 1] as const) {
        const bunGeo = new SphereGeometry(r * 0.38, 18, 14);
        bunGeo.scale(1.0, 0.92, 1.0);
        const bun = new Mesh(bunGeo, hairMat);
        bun.position.set(sign * r * 0.86, r * 0.86, -r * 0.06);
        bun.castShadow = true;
        secondaryGroup.add(bun);

        const bandGeo = new TorusGeometry(r * 0.26, r * 0.045, 10, 18);
        const band = new Mesh(bandGeo, highlightMat);
        band.position.set(sign * r * 0.68, r * 0.72, -r * 0.05);
        band.rotation.set(0.2, sign * 0.6, sign * 0.7);
        staticCrown.add(band);
      }
      break;
    }

    case 'top_bun': {
      addScalpBaseCap(staticCrown, r, hairMat, Math.PI * 0.46);
      addPartedFrontBangs(staticCrown, r, hairMat);

      const bunGeo = new SphereGeometry(r * 0.42, 18, 14);
      bunGeo.scale(1.05, 0.88, 1.05);
      const bun = new Mesh(bunGeo, hairMat);
      bun.position.set(-r * 0.18, r * 1.24, -r * 0.18);
      bun.castShadow = true;
      secondaryGroup.add(bun);

      const bandGeo = new TorusGeometry(r * 0.28, r * 0.05, 10, 18);
      const band = new Mesh(bandGeo, highlightMat);
      band.position.set(-r * 0.14, r * 0.98, -r * 0.12);
      band.rotation.x = Math.PI * 0.45;
      staticCrown.add(band);
      break;
    }

    case 'spiky':
    case 'wacky': {
      addScalpBaseCap(staticCrown, r, hairMat, Math.PI * 0.44);
      const isWacky = style === 'wacky';
      const spikeCount = isWacky ? 9 : 11;
      for (let i = 0; i < spikeCount; i++) {
        const angle = (i / spikeCount) * Math.PI * 2 + 0.25;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        // Keep front-lower face open for eyes
        const lift = sinA > 0.35 ? 0.38 : 0.12;
        const reach = isWacky ? 1.38 + (i % 3) * 0.14 : 1.52 + (i % 2) * 0.16;

        const lockGeo = createTaperedSplineLockGeometry(
          [
            new Vector3(cosA * r * 0.22, r * 0.95, sinA * r * 0.22),
            new Vector3(cosA * r * 0.72, r * (1.16 + lift * 0.4), sinA * r * 0.68),
            new Vector3(cosA * r * reach, r * (0.95 + lift), sinA * r * (reach * 0.85)),
          ],
          r * (isWacky ? 0.24 : 0.27),
        );
        const mesh = new Mesh(lockGeo, hairMat);
        mesh.castShadow = true;
        secondaryGroup.add(mesh);
      }
      break;
    }

    case 'mullet': {
      addScalpBaseCap(staticCrown, r, hairMat, Math.PI * 0.48);
      addPartedFrontBangs(staticCrown, r, hairMat);

      // Crown spikes + long back/side neck drapes
      for (let i = -3; i <= 3; i++) {
        const xSpread = (i / 3) * r * 0.85;
        const zBack = -r * (0.65 + (1 - Math.abs(i) / 4) * 0.42);
        const lockGeo = createTaperedSplineLockGeometry(
          [
            new Vector3(xSpread * 0.6, r * 0.85, zBack * 0.6),
            new Vector3(xSpread * 1.05, r * 0.35, zBack * 1.12),
            new Vector3(xSpread * 1.18, -r * 0.35, zBack * 1.15),
            new Vector3(xSpread * 1.28, -r * 0.88, zBack * 1.05),
          ],
          r * 0.26,
        );
        const mesh = new Mesh(lockGeo, hairMat);
        mesh.castShadow = true;
        secondaryGroup.add(mesh);
      }
      break;
    }

    case 'swept': {
      addScalpBaseCap(staticCrown, r, hairMat, Math.PI * 0.44);
      // Big rounded side-swept front pompadour puffs (Variant C style)
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        const x = (t - 0.45) * r * 1.15;
        const lockGeo = createTaperedSplineLockGeometry(
          [
            new Vector3(-r * 0.35, r * 0.96, r * 0.15),
            new Vector3(x, r * (1.16 - t * 0.08), r * 0.68),
            new Vector3(x + r * 0.28, r * (0.82 - t * 0.12), r * 0.86),
          ],
          r * 0.30,
          12,
          10,
          0.78,
        );
        const mesh = new Mesh(lockGeo, hairMat);
        mesh.castShadow = true;
        secondaryGroup.add(mesh);
      }
      break;
    }

    case 'receding': {
      // Bald top dome with low side/back horseshoe tufts (Headset runner variant B)
      for (const sign of [-1, 1] as const) {
        const sideGeo = new CapsuleGeometry(r * 0.16, r * 0.38, 8, 12);
        sideGeo.rotateX(Math.PI * 0.42);
        const sideMesh = new Mesh(sideGeo, hairMat);
        sideMesh.position.set(sign * r * 0.94, r * 0.18, -r * 0.12);
        sideMesh.castShadow = true;
        staticCrown.add(sideMesh);
      }
      const backGeo = new CapsuleGeometry(r * 0.16, r * 0.55, 8, 12);
      backGeo.rotateZ(Math.PI * 0.5);
      const backMesh = new Mesh(backGeo, hairMat);
      backMesh.position.set(0, r * 0.12, -r * 0.92);
      staticCrown.add(backMesh);
      break;
    }

    case 'mohawk': {
      // Two-tone center crest + side racing stripes (Zero-G variant 1)
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        const angle = -0.35 + t * 1.35; // Front crown to upper back
        const y = Math.cos(angle) * r;
        const z = Math.sin(angle - 0.55) * r * 0.85;
        const spikeGeo = createTaperedSplineLockGeometry(
          [
            new Vector3(0, y * 0.85, z * 0.85),
            new Vector3(0, y + r * 0.28, z - r * 0.06),
            new Vector3(0, y + r * 0.46, z - r * 0.18),
          ],
          r * 0.20,
        );
        const spikeMesh = new Mesh(spikeGeo, i % 2 === 0 ? hairMat : highlightMat);
        spikeMesh.castShadow = true;
        secondaryGroup.add(spikeMesh);
      }
      for (const sign of [-1, 1] as const) {
        const stripeGeo = new CapsuleGeometry(r * 0.075, r * 0.45, 6, 10);
        stripeGeo.rotateX(Math.PI * 0.35);
        const stripe = new Mesh(stripeGeo, highlightMat);
        stripe.position.set(sign * r * 0.38, r * 0.82, r * 0.12);
        staticCrown.add(stripe);
      }
      break;
    }
  }
}

function buildFacialHairMeshes(
  style: CapsuleFacialHairId,
  dna: CapsuleCharacterDNA,
  facialGroup: Group,
  hairMat: MeshStandardMaterial,
): void {
  if (style === 'none') return;

  const r = dna.bodyRadius;
  const mouthY = dna.suitSplitY + dna.bodyHeight * 0.16;

  if (style === 'mustache_handlebar') {
    for (const sign of [-1, 1] as const) {
      const stacheGeo = createTaperedSplineLockGeometry(
        [
          new Vector3(sign * r * 0.02, mouthY + r * 0.11, r * 1.02),
          new Vector3(sign * r * 0.34, mouthY + r * 0.06, r * 1.01),
          new Vector3(sign * r * 0.64, mouthY + r * 0.08, r * 0.86),
          new Vector3(sign * r * 0.76, mouthY + r * 0.22, r * 0.72),
        ],
        r * 0.165,
        14,
        10,
        0.78,
      );
      const mesh = new Mesh(stacheGeo, hairMat);
      mesh.castShadow = true;
      facialGroup.add(mesh);
    }
  } else if (style === 'full_beard') {
    // Upper mustache bridge above the SDF mouth
    for (const sign of [-1, 1] as const) {
      const upperGeo = createTaperedSplineLockGeometry(
        [
          new Vector3(sign * r * 0.02, mouthY + r * 0.12, r * 1.01),
          new Vector3(sign * r * 0.36, mouthY + r * 0.07, r * 0.96),
          new Vector3(sign * r * 0.62, mouthY - r * 0.08, r * 0.80),
        ],
        r * 0.14,
        12,
        8,
        0.75,
      );
      facialGroup.add(new Mesh(upperGeo, hairMat));
    }

    // Lower jaw/chin wrap-around beard below the SDF mouth
    const beardGeo = createTaperedSplineLockGeometry(
      [
        new Vector3(-r * 0.82, mouthY + r * 0.22, r * 0.52),
        new Vector3(-r * 0.58, mouthY - r * 0.24, r * 0.86),
        new Vector3(0, mouthY - r * 0.34, r * 1.04),
        new Vector3(r * 0.58, mouthY - r * 0.24, r * 0.86),
        new Vector3(r * 0.82, mouthY + r * 0.22, r * 0.52),
      ],
      r * 0.22,
      20,
      10,
      0.85,
    );
    const beardMesh = new Mesh(beardGeo, hairMat);
    beardMesh.castShadow = true;
    facialGroup.add(beardMesh);
  }
}

/**
 * Builds the modular hair and facial-hair assembly for a Capsule Doodle character.
 */
export function buildCapsuleHairKit(dna: CapsuleCharacterDNA): CapsuleHairKitResult {
  const root = new Group();
  root.name = 'capsule-hair-kit-root';

  const crownSocket = new Group();
  crownSocket.name = 'capsule-hair-crown-socket';
  crownSocket.position.set(0, dna.bodyHeight * 0.5, 0);

  const secondaryMotionGroup = new Group();
  secondaryMotionGroup.name = 'capsule-hair-secondary-motion';
  crownSocket.add(secondaryMotionGroup);

  const facialHairGroup = new Group();
  facialHairGroup.name = 'capsule-facial-hair';

  root.add(crownSocket, facialHairGroup);

  const hairMat = new MeshStandardMaterial({
    color: new Color(dna.hairColor),
    roughness: 0.68,
    metalness: 0.05,
  });

  const highlightMat = new MeshStandardMaterial({
    color: new Color(dna.hairHighlightColor),
    roughness: 0.55,
    metalness: 0.08,
  });

  let currentRadius = dna.bodyRadius;

  const clearGroupGeometries = (grp: Group): void => {
    const toRemove = [...grp.children].filter((c) => c !== secondaryMotionGroup);
    for (const child of toRemove) {
      child.traverse((obj) => {
        if ((obj as Mesh).isMesh) {
          (obj as Mesh).geometry.dispose();
        }
      });
      grp.remove(child);
    }
  };

  const rebuild = (nextDna: CapsuleCharacterDNA): void => {
    currentRadius = nextDna.bodyRadius;
    crownSocket.position.set(0, nextDna.bodyHeight * 0.5, 0);
    hairMat.color.set(nextDna.hairColor);
    highlightMat.color.set(nextDna.hairHighlightColor);

    clearGroupGeometries(crownSocket);
    clearGroupGeometries(secondaryMotionGroup);
    clearGroupGeometries(facialHairGroup);

    buildHairStyleMeshes(
      nextDna.hairStyleId,
      nextDna.bodyRadius,
      crownSocket,
      secondaryMotionGroup,
      hairMat,
      highlightMat,
    );
    buildFacialHairMeshes(nextDna.facialHairId, nextDna, facialHairGroup, hairMat);
  };

  const attachExternalHairGltf = (gltfRoot: Object3D, referenceRadius = 0.36): void => {
    clearGroupGeometries(crownSocket);
    clearGroupGeometries(secondaryMotionGroup);
    const scale = currentRadius / Math.max(0.05, referenceRadius);
    gltfRoot.scale.setScalar(scale);
    secondaryMotionGroup.add(gltfRoot);
  };

  const dispose = (): void => {
    clearGroupGeometries(crownSocket);
    clearGroupGeometries(secondaryMotionGroup);
    clearGroupGeometries(facialHairGroup);
    hairMat.dispose();
    highlightMat.dispose();
  };

  rebuild(dna);

  return {
    root,
    crownSocket,
    secondaryMotionGroup,
    facialHairGroup,
    rebuild,
    attachExternalHairGltf,
    dispose,
  };
}
