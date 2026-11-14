/**
 * Modular Hair & Facial Hair Kit for Capsule Doodle characters.
 *
 * Implements procedural sculpted clay hair locks (surface-aligned Catmull-Rom
 * spline ribbons and wedges, curly puff clusters, multi-lobe buns, blunt bobs,
 * swept coiffs, mullets, mohawks, handlebar mustaches, and sculpted beards),
 * optional bubble-helmet containment clamping, plus a hybrid socket helper
 * (`attachExternalHairGltf`) for swapping in external glTF hair scaled by `bodyRadius`.
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

interface HelmetClampContext {
  readonly centerY: number;
  readonly safeRadius: number;
}

interface SplineLockOptions {
  readonly rootScale?: number;
  readonly tipBluntness?: number;
  readonly ridgeCrease?: number;
  readonly refCenterY?: number;
  readonly helmetClamp?: HelmetClampContext;
}

const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_FWD = new Vector3(0, 0, 1);

function computeHelmetClamp(dna: CapsuleCharacterDNA): HelmetClampContext | undefined {
  if (!dna.helmet) return undefined;
  const r = dna.bodyRadius;
  const domeRadius = r * 1.54;
  // Convert the space-gear bubble dome center into `crownSocket` coordinates (`y = bodyHeight * 0.5`).
  const centerY = dna.suitSplitY + r * 0.04 + domeRadius * 0.56 - dna.bodyHeight * 0.5;
  return {
    centerY,
    safeRadius: r * 1.44,
  };
}

function clampPositionToDome(pt: Vector3, dome: HelmetClampContext): Vector3 {
  const dx = pt.x;
  const dy = pt.y - dome.centerY;
  const dz = pt.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist <= dome.safeRadius || dist < 1e-6) return pt;
  const scale = dome.safeRadius / dist;
  return new Vector3(dx * scale, dome.centerY + dy * scale, dz * scale);
}

function clampGeometryVerticesToDome(
  geometry: BufferGeometry,
  worldOffset: Vector3,
  dome: HelmetClampContext,
): void {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) return;
  let clampedAny = false;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i) + worldOffset.x;
    const vy = posAttr.getY(i) + worldOffset.y;
    const vz = posAttr.getZ(i) + worldOffset.z;
    const dx = vx;
    const dy = vy - dome.centerY;
    const dz = vz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > dome.safeRadius && dist > 1e-6) {
      const scale = dome.safeRadius / dist;
      posAttr.setXYZ(
        i,
        dx * scale - worldOffset.x,
        dome.centerY + dy * scale - worldOffset.y,
        dz * scale - worldOffset.z,
      );
      clampedAny = true;
    }
  }
  if (clampedAny) {
    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
}

/**
 * Generates a surface-aligned tapered clay lock along a `CatmullRomCurve3`.
 * Uses outward head normals rather than twist-prone Frenet frames so flat locks
 * stay oriented cleanly against the capsule skull, with configurable tip bluntness
 * and optional helmet dome clamping.
 */
function createTaperedSplineLockGeometry(
  points: readonly Vector3[],
  maxRadius: number,
  tubularSegments = 14,
  radialSegments = 10,
  flattenRatio = 0.58,
  options: SplineLockOptions = {},
): BufferGeometry {
  const helmetClamp = options.helmetClamp;
  const clampedPoints = helmetClamp
    ? points.map((pt) => clampPositionToDome(pt, helmetClamp))
    : [...points];
  const curve = new CatmullRomCurve3(clampedPoints);
  const ringVerts = radialSegments + 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const rootScale = options.rootScale ?? 0.62;
  const tipBluntness = options.tipBluntness ?? 0;
  const ridgeCrease = options.ridgeCrease ?? 0.12;
  const refCenterY = options.refCenterY ?? 0;

  const ref = new Vector3();
  const lateral = new Vector3();
  const outward = new Vector3();
  let hasPrevLateral = false;
  const prevLateral = new Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    const pt = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();

    ref.set(pt.x, pt.y - refCenterY, pt.z);
    if (ref.lengthSq() < 1e-6) ref.copy(WORLD_UP);
    else ref.normalize();

    // Right-handed triad: lateral × outward = +tangent
    lateral.crossVectors(ref, tangent);
    if (lateral.lengthSq() < 0.04) {
      const fallback = Math.abs(tangent.y) < 0.85 ? WORLD_UP : WORLD_FWD;
      lateral.crossVectors(fallback, tangent);
    }
    lateral.normalize();
    if (hasPrevLateral && lateral.dot(prevLateral) < 0) {
      lateral.negate();
    }
    prevLateral.copy(lateral);
    hasPrevLateral = true;

    outward.crossVectors(tangent, lateral).normalize();

    const arch = Math.sin(Math.pow(t, 0.68) * Math.PI);
    const pointed = Math.max((1 - t) * (1 - t) * rootScale + arch * 0.55, arch * (1 - t * 0.15));
    const blunt = tipBluntness > 0
      ? (rootScale + (1 - rootScale) * Math.min(1, t * 2.5))
        * (t > 0.86 ? Math.max(0.08, Math.cos(((t - 0.86) / 0.14) * Math.PI * 0.5)) : 1)
      : 0;
    const baseProfile = Math.max(
      0.02,
      Math.min(1.08, Math.max(pointed * (1 - tipBluntness * 0.7), blunt)),
    );
    const closedTip = i === tubularSegments;
    const rx = closedTip ? 0.001 : Math.max(0.002, maxRadius * baseProfile);
    const ry = closedTip ? 0.001 : Math.max(0.002, rx * flattenRatio);

    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const ridgeMul = sinT > 0
        ? 1 + ridgeCrease * Math.pow(sinT, 2.5)
        : 0.82;
      const localRx = rx;
      const localRy = ry * ridgeMul;

      let vx = pt.x + localRx * cosT * lateral.x + localRy * sinT * outward.x;
      let vy = pt.y + localRx * cosT * lateral.y + localRy * sinT * outward.y;
      let vz = pt.z + localRx * cosT * lateral.z + localRy * sinT * outward.z;

      if (helmetClamp) {
        const dx = vx;
        const dy = vy - helmetClamp.centerY;
        const dz = vz;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > helmetClamp.safeRadius && dist > 1e-6) {
          const scale = helmetClamp.safeRadius / dist;
          vx = dx * scale;
          vy = helmetClamp.centerY + dy * scale;
          vz = dz * scale;
        }
      }
      positions.push(vx, vy, vz);

      if (closedTip) {
        normals.push(tangent.x, tangent.y, tangent.z);
      } else {
        const invRx = cosT / Math.max(1e-4, localRx);
        const invRy = sinT / Math.max(1e-4, localRy);
        const nx = invRx * lateral.x + invRy * outward.x;
        const ny = invRx * lateral.y + invRy * outward.y;
        const nz = invRx * lateral.z + invRy * outward.z;
        const len = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / len, ny / len, nz / len);
      }
    }
  }

  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * ringVerts + j;
      const b = (i + 1) * ringVerts + j;
      const c = (i + 1) * ringVerts + (j + 1);
      const d = i * ringVerts + (j + 1);
      indices.push(a, d, b, b, d, c);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

function addSplineLock(
  parent: Group,
  points: readonly Vector3[],
  maxRadius: number,
  mat: MeshStandardMaterial,
  tubularSegments = 14,
  radialSegments = 10,
  flattenRatio = 0.58,
  options: SplineLockOptions = {},
): Mesh {
  const geo = createTaperedSplineLockGeometry(
    points,
    maxRadius,
    tubularSegments,
    radialSegments,
    flattenRatio,
    options,
  );
  const mesh = new Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addHairSphere(
  parent: Group,
  x: number,
  y: number,
  z: number,
  radius: number,
  mat: MeshStandardMaterial,
  helmetClamp?: HelmetClampContext,
  scaleX = 1,
  scaleY = 1,
  scaleZ = 1,
): Mesh {
  const geo = new SphereGeometry(radius, 14, 12);
  if (scaleX !== 1 || scaleY !== 1 || scaleZ !== 1) {
    geo.scale(scaleX, scaleY, scaleZ);
  }
  const pos = new Vector3(x, y, z);
  if (helmetClamp) {
    clampGeometryVerticesToDome(geo, pos, helmetClamp);
  }
  const mesh = new Mesh(geo, mat);
  mesh.position.copy(pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Subtle recessed core blocker under thick locks so close-ups show zero skin pinholes. */
function addScalpBaseCap(
  parent: Group,
  r: number,
  hairMat: MeshStandardMaterial,
  helmetClamp?: HelmetClampContext,
): void {
  const capGeo = new SphereGeometry(r * 1.008, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.40);
  capGeo.rotateX(-0.32);
  if (helmetClamp) {
    clampGeometryVerticesToDome(capGeo, new Vector3(), helmetClamp);
  }
  capGeo.computeBoundingBox();
  capGeo.computeBoundingSphere();
  const capMesh = new Mesh(capGeo, hairMat);
  capMesh.castShadow = true;
  parent.add(capMesh);
}

/** Multi-strand parted forehead curtain bangs plus optional cheek-framing temple tendrils. */
function addFullCurtainBangs(
  parent: Group,
  r: number,
  hairMat: MeshStandardMaterial,
  options: {
    readonly includeLongTendrils?: boolean;
    readonly helmetClamp?: HelmetClampContext;
  } = {},
): void {
  const { includeLongTendrils = false, helmetClamp } = options;
  for (const sign of [-1, 1] as const) {
    // Upper crown S-curved wave framing the top forehead with clear room above arched brows
    addSplineLock(
      parent,
      [
        new Vector3(sign * r * 0.03, r * 0.90, r * 0.48),
        new Vector3(sign * r * 0.30, r * 0.72, r * 0.88),
        new Vector3(sign * r * 0.64, r * 0.58, r * 0.80),
        new Vector3(sign * r * 0.92, r * 0.44, r * 0.42),
      ],
      r * 0.20,
      hairMat,
      14,
      10,
      0.52,
      { rootScale: 0.78, helmetClamp },
    );
    // Soft scalloped foreground hairline wave above the eyebrows
    addSplineLock(
      parent,
      [
        new Vector3(sign * r * 0.04, r * 0.82, r * 0.66),
        new Vector3(sign * r * 0.32, r * 0.64, r * 0.92),
        new Vector3(sign * r * 0.66, r * 0.52, r * 0.82),
        new Vector3(sign * r * 0.92, r * 0.38, r * 0.44),
      ],
      r * 0.18,
      hairMat,
      14,
      10,
      0.52,
      { rootScale: 0.74, helmetClamp },
    );
    // Outer temple sweep bridging forehead waves cleanly back toward the ear/hairband above eye level
    addSplineLock(
      parent,
      [
        new Vector3(sign * r * 0.22, r * 0.88, r * 0.30),
        new Vector3(sign * r * 0.74, r * 0.66, r * 0.54),
        new Vector3(sign * r * 0.98, r * 0.42, r * 0.24),
        new Vector3(sign * r * 1.02, r * 0.16, -r * 0.04),
      ],
      r * 0.21,
      hairMat,
      14,
      10,
      0.56,
      { rootScale: 0.72, helmetClamp },
    );

    if (includeLongTendrils) {
      addSplineLock(
        parent,
        [
          new Vector3(sign * r * 0.66, r * 0.62, r * 0.62),
          new Vector3(sign * r * 0.96, r * 0.38, r * 0.58),
          new Vector3(sign * r * 1.03, r * 0.06, r * 0.46),
          new Vector3(sign * r * 0.95, -r * 0.24, r * 0.34),
        ],
        r * 0.17,
        hairMat,
        14,
        10,
        0.56,
        { rootScale: 0.64, helmetClamp },
      );
    }
  }
}

/** Parted sculpted clay ribs wrapping the crown, sides, and rear skull down to the nape. */
function addSculptedPartedBackScalp(
  parent: Group,
  r: number,
  hairMat: MeshStandardMaterial,
  options: {
    readonly upwardPull?: boolean;
    readonly helmetClamp?: HelmetClampContext;
  } = {},
): void {
  const { upwardPull = false, helmetClamp } = options;
  const ribCountPerSide = 8;
  for (const sign of [-1, 1] as const) {
    for (let i = 0; i < ribCountPerSide; i++) {
      const u = i / (ribCountPerSide - 1);
      // Trace meridians strictly outside skull sphere/cylinder from center back (`±175°`) to temple (`±63°`)
      const azimuth = sign * (Math.PI - 0.08 - u * 1.96);
      const sinA = Math.sin(azimuth);
      const cosA = Math.cos(azimuth);
      const napeY = -r * (0.32 - u * 0.08);

      const p0 = upwardPull
        ? new Vector3(sign * r * (0.04 + u * 0.14), r * 0.88, -r * 0.34)
        : new Vector3(
            sign * r * (0.04 + u * 0.20),
            r * (0.98 - u * 0.08),
            cosA * r * 0.24 + r * 0.04,
          );
      const p1 = upwardPull
        ? new Vector3(sinA * r * 0.78, r * (0.72 - u * 0.08), cosA * r * 0.78)
        : new Vector3(sinA * r * 0.84, r * 0.64, cosA * r * 0.84);
      const p2 = new Vector3(sinA * r * 1.06, r * (upwardPull ? 0.18 : 0.14), cosA * r * 1.06);
      const p3 = new Vector3(sinA * r * 1.05, napeY, cosA * r * 1.05);

      addSplineLock(
        parent,
        [p0, p1, p2, p3],
        r * 0.32,
        hairMat,
        14,
        10,
        0.52,
        { rootScale: 0.82, tipBluntness: 0.90, ridgeCrease: 0.03, helmetClamp },
      );
    }
  }
}

/** Shared helper for overlapping layered back/side cascades (used by `spiky`, `swept`, `mullet`). */
function addLayeredBackCascade(
  parent: Group,
  r: number,
  hairMat: MeshStandardMaterial,
  tiers: readonly {
    readonly count: number;
    readonly minAzimuth: number;
    readonly maxAzimuth: number;
    readonly startY: number;
    readonly midY: number;
    readonly endY: number;
    readonly midReach: number;
    readonly endReach: number;
    readonly maxRadius: number;
    readonly flickX?: number;
    readonly tipBluntness?: number;
  }[],
  helmetClamp?: HelmetClampContext,
): void {
  for (const tier of tiers) {
    // Keep cascade roots hugging outside the capsule surface at `startY` instead of buried inside
    const surfaceFactor =
      tier.startY > 0
        ? Math.sqrt(Math.max(0.25, 1 - (tier.startY / r) ** 2))
        : 1.0;
    const startReach = Math.max(0.58, surfaceFactor * 0.98);

    for (let i = 0; i < tier.count; i++) {
      const u = tier.count > 1 ? i / (tier.count - 1) : 0.5;
      const azimuth = tier.minAzimuth + u * (tier.maxAzimuth - tier.minAzimuth);
      const sinA = Math.sin(azimuth);
      const cosA = Math.cos(azimuth);
      const stagger = (i % 2 === 0 ? 1 : -1) * 0.05 * r;
      const flick = (tier.flickX ?? 0) * Math.sign(sinA || 1);

      addSplineLock(
        parent,
        [
          new Vector3(sinA * r * startReach, tier.startY, cosA * r * startReach),
          new Vector3(sinA * r * tier.midReach, tier.midY + stagger, cosA * r * tier.midReach),
          new Vector3(
            sinA * r * tier.endReach + flick,
            tier.endY + stagger * 0.8,
            cosA * r * tier.endReach,
          ),
        ],
        tier.maxRadius,
        hairMat,
        12,
        10,
        0.54,
        { rootScale: 0.76, tipBluntness: tier.tipBluntness ?? 0, helmetClamp },
      );
    }
  }
}

function buildHairStyleMeshes(
  dna: CapsuleCharacterDNA,
  staticCrown: Group,
  secondaryGroup: Group,
  hairMat: MeshStandardMaterial,
  highlightMat: MeshStandardMaterial,
): void {
  const style: CapsuleHairStyleId = dna.hairStyleId;
  if (style === 'bald') return;

  const r = dna.bodyRadius;
  const helmetClamp = computeHelmetClamp(dna);

  switch (style) {
    case 'sprout': {
      // Minimal 2-stem antenna hair sprout, kept inside the bubble helmet dome when equipped
      const tipYScale = helmetClamp ? 0.82 : 1.0;
      addSplineLock(
        secondaryGroup,
        [
          new Vector3(-r * 0.04, r * 0.94, r * 0.08),
          new Vector3(-r * 0.16, r * (1.20 * tipYScale), r * 0.12),
          new Vector3(-r * 0.30, r * (1.30 * tipYScale), r * 0.14),
        ],
        r * 0.084,
        hairMat,
        12,
        8,
        0.78,
        { helmetClamp },
      );
      addSplineLock(
        secondaryGroup,
        [
          new Vector3(r * 0.04, r * 0.94, r * 0.06),
          new Vector3(r * 0.08, r * (1.24 * tipYScale), r * 0.10),
          new Vector3(-r * 0.04, r * (1.36 * tipYScale), r * 0.12),
        ],
        r * 0.080,
        hairMat,
        12,
        8,
        0.78,
        { helmetClamp },
      );
      break;
    }

    case 'space_buns': {
      addScalpBaseCap(staticCrown, r, hairMat, helmetClamp);
      addSculptedPartedBackScalp(staticCrown, r, hairMat, { helmetClamp });
      addFullCurtainBangs(staticCrown, r, hairMat, { includeLongTendrils: true, helmetClamp });

      // Coiled multi-lobe twin top buns
      for (const sign of [-1, 1] as const) {
        const bx = sign * r * 0.84;
        const by = r * 0.84;
        const bz = -r * 0.08;
        addHairSphere(secondaryGroup, bx, by, bz, r * 0.32, hairMat, helmetClamp, 1.02, 0.94, 1.02);

        for (let c = 0; c < 3; c++) {
          const coilAngle = (c / 3) * Math.PI * 2;
          const ox = Math.cos(coilAngle) * r * 0.18;
          const oz = Math.sin(coilAngle) * r * 0.18;
          addSplineLock(
            secondaryGroup,
            [
              new Vector3(bx + ox * 0.5, by - r * 0.18, bz + oz * 0.5),
              new Vector3(bx + ox * 1.45, by + r * 0.06, bz + oz * 1.45),
              new Vector3(bx - oz * 1.1, by + r * 0.28, bz + ox * 1.1),
            ],
            r * 0.16,
            hairMat,
            10,
            8,
            0.78,
            { rootScale: 0.72, tipBluntness: 0.55, refCenterY: by, helmetClamp },
          );
        }
      }
      break;
    }

    case 'bob_cut': {
      addScalpBaseCap(staticCrown, r, hairMat, helmetClamp);

      // Blunt continuous forehead fringe (7 overlapping clay slabs with slight center part)
      const fringeCount = 7;
      for (let i = 0; i < fringeCount; i++) {
        const u = (i / (fringeCount - 1)) * 2 - 1; // -1 .. +1
        const partShift = Math.sign(u || -1) * r * 0.025;
        const xOff = u * r * 0.64 + partShift;
        const zArch = Math.sqrt(Math.max(0.28, 1 - (u * 0.72) ** 2)) * r;
        addSplineLock(
          staticCrown,
          [
            new Vector3(xOff * 0.45, r * 0.96, zArch * 0.24),
            new Vector3(xOff * 0.88, r * 0.64, zArch * 0.94),
            new Vector3(xOff * 0.98, r * 0.22, zArch * 1.06),
          ],
          r * 0.23,
          hairMat,
          12,
          10,
          0.46,
          { rootScale: 0.78, tipBluntness: 0.74, ridgeCrease: 0.06, helmetClamp },
        );
      }

      // Smooth continuous side and back chin-length bell bob (16 overlapping wide blunt slabs)
      const panelCount = 16;
      for (let i = 0; i < panelCount; i++) {
        const t = i / (panelCount - 1);
        const azimuth = 0.56 + t * (Math.PI * 2 - 1.12);
        const sinA = Math.sin(azimuth);
        const cosA = Math.cos(azimuth);

        addSplineLock(
          secondaryGroup,
          [
            new Vector3(sinA * r * 0.45, r * 0.96, cosA * r * 0.45),
            new Vector3(sinA * r * 1.04, r * 0.54, cosA * r * 1.04),
            new Vector3(sinA * r * 1.14, r * 0.08, cosA * r * 1.14),
            new Vector3(sinA * r * 1.05, -r * 0.62, cosA * r * 1.05),
          ],
          r * 0.29,
          hairMat,
          14,
          10,
          0.50,
          { rootScale: 0.78, tipBluntness: 0.78, ridgeCrease: 0.05, helmetClamp },
        );
      }
      break;
    }

    case 'afro': {
      addScalpBaseCap(staticCrown, r, hairMat, helmetClamp);

      // Dense 58-puff multi-ring curly cloud framing face, sides, and full nape
      const rings: readonly {
        readonly count: number;
        readonly y: number;
        readonly ringRadius: number;
        readonly minAzimuth: number;
        readonly maxAzimuth: number;
        readonly puffRadius: number;
      }[] = [
        // Top crown dome
        { count: 1, y: 1.30, ringRadius: 0.04, minAzimuth: 0, maxAzimuth: 0, puffRadius: 0.34 },
        { count: 6, y: 1.22, ringRadius: 0.46, minAzimuth: 0, maxAzimuth: Math.PI * 1.67, puffRadius: 0.31 },
        // Upper halo & forehead hairline (open across front face eyes)
        { count: 11, y: 0.96, ringRadius: 0.88, minAzimuth: -Math.PI + 0.22, maxAzimuth: Math.PI - 0.22, puffRadius: 0.30 },
        { count: 3, y: 0.84, ringRadius: 0.84, minAzimuth: -0.45, maxAzimuth: 0.45, puffRadius: 0.25 },
        // Mid halo around temples and full back
        { count: 12, y: 0.54, ringRadius: 1.12, minAzimuth: 0.66, maxAzimuth: Math.PI * 2 - 0.66, puffRadius: 0.29 },
        // Cheek/ear level sides and back
        { count: 13, y: 0.10, ringRadius: 1.18, minAzimuth: 0.76, maxAzimuth: Math.PI * 2 - 0.76, puffRadius: 0.28 },
        // Lower jawline sides and full nape
        { count: 12, y: -0.34, ringRadius: 1.06, minAzimuth: 0.88, maxAzimuth: Math.PI * 2 - 0.88, puffRadius: 0.26 },
      ];

      for (let ringIdx = 0; ringIdx < rings.length; ringIdx++) {
        const ring = rings[ringIdx];
        for (let i = 0; i < ring.count; i++) {
          const u = ring.count > 1 ? i / (ring.count - 1) : 0;
          const azimuth = ring.minAzimuth + u * (ring.maxAzimuth - ring.minAzimuth);
          const jitter = ((i + ringIdx) % 2 === 0 ? 1 : -1) * 0.04;
          const px = Math.sin(azimuth) * r * (ring.ringRadius + jitter);
          const pz = Math.cos(azimuth) * r * (ring.ringRadius + jitter);
          const py = r * (ring.y + jitter * 0.8);
          addHairSphere(
            secondaryGroup,
            px,
            py,
            pz,
            r * ring.puffRadius,
            hairMat,
            helmetClamp,
          );
        }
      }
      break;
    }

    case 'curly': {
      addScalpBaseCap(staticCrown, r, hairMat, helmetClamp);

      // 38 compact overlapping curl clusters framing forehead, sides, and nape
      const curlRings: readonly {
        readonly count: number;
        readonly y: number;
        readonly ringRadius: number;
        readonly minAzimuth: number;
        readonly maxAzimuth: number;
        readonly puffRadius: number;
      }[] = [
        { count: 1, y: 1.14, ringRadius: 0.02, minAzimuth: 0, maxAzimuth: 0, puffRadius: 0.26 },
        { count: 6, y: 1.04, ringRadius: 0.44, minAzimuth: 0, maxAzimuth: Math.PI * 1.67, puffRadius: 0.24 },
        { count: 3, y: 0.80, ringRadius: 0.80, minAzimuth: -0.36, maxAzimuth: 0.36, puffRadius: 0.22 },
        { count: 8, y: 0.76, ringRadius: 0.86, minAzimuth: 0.65, maxAzimuth: Math.PI * 2 - 0.65, puffRadius: 0.23 },
        { count: 11, y: 0.38, ringRadius: 0.96, minAzimuth: 0.72, maxAzimuth: Math.PI * 2 - 0.72, puffRadius: 0.22 },
        { count: 10, y: -0.06, ringRadius: 0.94, minAzimuth: 0.90, maxAzimuth: Math.PI * 2 - 0.90, puffRadius: 0.21 },
      ];

      for (let rIdx = 0; rIdx < curlRings.length; rIdx++) {
        const ring = curlRings[rIdx];
        for (let i = 0; i < ring.count; i++) {
          const u = ring.count > 1 ? i / (ring.count - 1) : 0;
          const az = ring.minAzimuth + u * (ring.maxAzimuth - ring.minAzimuth);
          const jitter = ((i + rIdx) % 2 === 0 ? 1 : -1) * 0.03;
          addHairSphere(
            secondaryGroup,
            Math.sin(az) * r * (ring.ringRadius + jitter),
            r * (ring.y + jitter),
            Math.cos(az) * r * (ring.ringRadius + jitter),
            r * ring.puffRadius,
            hairMat,
            helmetClamp,
          );
        }
      }
      break;
    }

    case 'ponytail': {
      addScalpBaseCap(staticCrown, r, hairMat, helmetClamp);
      addFullCurtainBangs(staticCrown, r, hairMat, { includeLongTendrils: true, helmetClamp });
      addSculptedPartedBackScalp(staticCrown, r, hairMat, { upwardPull: true, helmetClamp });

      // Centered high back-crown hairband matching "HIGH BLONDE PONYTAIL"
      const tieCenter = new Vector3(0, r * 0.90, -r * 0.34);
      const bandGeo = new TorusGeometry(r * 0.21, r * 0.055, 10, 18);
      bandGeo.rotateX(Math.PI * 0.28);
      if (helmetClamp) {
        clampGeometryVerticesToDome(bandGeo, tieCenter, helmetClamp);
      }
      const bandMesh = new Mesh(bandGeo, highlightMat);
      bandMesh.position.copy(tieCenter);
      bandMesh.castShadow = true;
      staticCrown.add(bandMesh);

      // 9-lock fountain plume arching up above the crown (visible in front) & flaring down behind
      const plumeLocks: ReadonlyArray<readonly [number, number, number, number]> = [
        [0, 0.44, -0.52, 0.26],
        [-0.24, 0.38, -0.48, 0.24],
        [0.24, 0.38, -0.48, 0.24],
        [-0.46, 0.22, -0.42, 0.23],
        [0.46, 0.22, -0.42, 0.23],
        [-0.18, 0.04, -0.78, 0.25],
        [0.18, 0.04, -0.78, 0.25],
        [-0.42, -0.18, -0.70, 0.22],
        [0.42, -0.18, -0.70, 0.22],
      ];
      for (const [ox, oy, oz, rad] of plumeLocks) {
        addSplineLock(
          secondaryGroup,
          [
            tieCenter.clone(),
            new Vector3(ox * r * 0.62, r * (1.36 + oy * 0.34), -r * 0.56 + oz * r * 0.30),
            new Vector3(ox * r * 1.15, r * (0.98 + oy * 0.68), -r * 0.92 + oz * r * 0.56),
            new Vector3(ox * r * 1.32, r * (0.30 + oy * 0.68), -r * 0.94 + oz * r * 0.48),
          ],
          r * rad,
          hairMat,
          14,
          10,
          0.62,
          { rootScale: 0.72, refCenterY: tieCenter.y, helmetClamp },
        );
      }
      break;
    }

    case 'pigtails': {
      addScalpBaseCap(staticCrown, r, hairMat, helmetClamp);
      addSculptedPartedBackScalp(staticCrown, r, hairMat, { helmetClamp });
      addFullCurtainBangs(staticCrown, r, hairMat, { includeLongTendrils: false, helmetClamp });

      // Twin side curly berry clusters with tilted highlight hairbands
      const berryOffsets: ReadonlyArray<readonly [number, number, number, number]> = [
        [1.10, 0.64, -0.04, 0.18],
        [1.26, 0.68, -0.04, 0.27],
        [1.36, 0.82, 0.13, 0.24],
        [1.38, 0.82, -0.17, 0.24],
        [1.48, 0.62, 0.19, 0.23],
        [1.50, 0.60, -0.21, 0.23],
        [1.64, 0.60, -0.02, 0.26],
        [1.26, 0.46, 0.18, 0.22],
        [1.28, 0.44, -0.20, 0.22],
        [1.46, 0.36, 0.08, 0.22],
        [1.48, 0.32, -0.14, 0.22],
        [1.24, 0.90, -0.04, 0.22],
        [1.32, 0.22, -0.02, 0.21],
        [1.58, 0.78, 0.0, 0.22],
      ];
      for (const sign of [-1, 1] as const) {
        const bandPos = new Vector3(sign * r * 0.95, r * 0.62, -r * 0.04);
        const bandGeo = new TorusGeometry(r * 0.20, r * 0.072, 12, 18);
        bandGeo.rotateY(sign * Math.PI * 0.42);
        bandGeo.rotateZ(sign * 0.48);
        if (helmetClamp) clampGeometryVerticesToDome(bandGeo, bandPos, helmetClamp);
        const band = new Mesh(bandGeo, highlightMat);
        band.position.copy(bandPos);
        staticCrown.add(band);

        for (const [px, py, pz, pr] of berryOffsets) {
          addHairSphere(
            secondaryGroup,
            sign * r * px,
            r * py,
            r * pz,
            r * pr,
            hairMat,
            helmetClamp,
          );
        }
      }
      break;
    }

    case 'buns': {
      addScalpBaseCap(staticCrown, r, hairMat, helmetClamp);
      addSculptedPartedBackScalp(staticCrown, r, hairMat, { helmetClamp });
      addFullCurtainBangs(staticCrown, r, hairMat, { helmetClamp });

      for (const sign of [-1, 1] as const) {
        addHairSphere(
          secondaryGroup,
          sign * r * 0.86,
          r * 0.86,
          -r * 0.06,
          r * 0.38,
          hairMat,
          helmetClamp,
          1.0,
          0.92,
          1.0,
        );

        const bandPos = new Vector3(sign * r * 0.68, r * 0.72, -r * 0.05);
        const bandGeo = new TorusGeometry(r * 0.26, r * 0.045, 10, 18);
        bandGeo.rotateX(0.2);
        bandGeo.rotateY(sign * 0.6);
        bandGeo.rotateZ(sign * 0.7);
        if (helmetClamp) clampGeometryVerticesToDome(bandGeo, bandPos, helmetClamp);
        const band = new Mesh(bandGeo, highlightMat);
        band.position.copy(bandPos);
        staticCrown.add(band);
      }
      break;
    }

    case 'top_bun': {
      addScalpBaseCap(staticCrown, r, hairMat, helmetClamp);
      addSculptedPartedBackScalp(staticCrown, r, hairMat, { upwardPull: true, helmetClamp });
      addFullCurtainBangs(staticCrown, r, hairMat, { helmetClamp });

      addHairSphere(
        secondaryGroup,
        -r * 0.14,
        r * 1.20,
        -r * 0.16,
        r * 0.40,
        hairMat,
        helmetClamp,
        1.05,
        0.88,
        1.05,
      );

      const bandPos = new Vector3(-r * 0.12, r * 0.96, -r * 0.12);
      const bandGeo = new TorusGeometry(r * 0.28, r * 0.05, 10, 18);
      bandGeo.rotateX(Math.PI * 0.45);
      if (helmetClamp) clampGeometryVerticesToDome(bandGeo, bandPos, helmetClamp);
      const band = new Mesh(bandGeo, highlightMat);
      band.position.copy(bandPos);
      staticCrown.add(band);
      break;
    }

    case 'spiky': {
      addScalpBaseCap(staticCrown, r, hairMat, helmetClamp);

      // 1. Forehead & front crown shaggy asymmetric sweep (no bare forehead cap line)
      for (let i = 0; i < 7; i++) {
        const u = (i / 6) * 2 - 1;
        const flareX = u * r * 0.88 + (i >= 3 ? r * 0.18 : -r * 0.12);
        const liftY = r * (0.98 + (1 - Math.abs(u)) * 0.26);
        addSplineLock(
          secondaryGroup,
          [
            new Vector3(u * r * 0.35, r * 0.68, r * 0.74),
            new Vector3(u * r * 0.68, r * 0.92, r * 0.96),
            new Vector3(flareX * 1.15, liftY, r * 0.88),
          ],
          r * 0.26,
          hairMat,
          12,
          10,
          0.56,
          { rootScale: 0.78, helmetClamp },
        );
      }

      // 2. Top crown splayed clay wedges
      for (let i = 0; i < 7; i++) {
        const angle = (i / 7) * Math.PI * 2 + 0.3;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        addSplineLock(
          secondaryGroup,
          [
            new Vector3(cosA * r * 0.15, r * 0.96, sinA * r * 0.15),
            new Vector3(cosA * r * 0.68, r * 1.24, sinA * r * 0.62),
            new Vector3(cosA * r * 1.32, r * 1.10, sinA * r * 1.16),
          ],
          r * 0.28,
          hairMat,
          12,
          10,
          0.58,
          { rootScale: 0.78, helmetClamp },
        );
      }

      // 3. Temple & sideburn shaggy locks flanking eyes down toward jawline
      for (const sign of [-1, 1] as const) {
        const sideHeights: ReadonlyArray<readonly [number, number, number]> = [
          [0.74, 0.56, 0.44],
          [0.52, 0.26, 0.30],
          [0.26, -0.06, 0.18],
          [0.02, -0.36, 0.08],
        ];
        for (const [sy, ey, zBias] of sideHeights) {
          addSplineLock(
            secondaryGroup,
            [
              new Vector3(sign * r * 0.72, r * sy, r * (0.28 + zBias * 0.3)),
              new Vector3(sign * r * 1.05, r * ((sy + ey) * 0.5 + 0.05), r * zBias),
              new Vector3(sign * r * 1.24, r * ey, r * (zBias - 0.14)),
            ],
            r * 0.24,
            hairMat,
            12,
            10,
            0.56,
            { rootScale: 0.76, helmetClamp },
          );
        }
      }

      // 4. Three overlapping tiers of rear pinecone shaggy locks down to the nape
      addLayeredBackCascade(
        secondaryGroup,
        r,
        hairMat,
        [
          { count: 5, minAzimuth: 1.55, maxAzimuth: Math.PI * 2 - 1.55, startY: r * 0.94, midY: r * 0.78, endY: r * 0.36, midReach: 1.04, endReach: 1.26, maxRadius: r * 0.27 },
          { count: 5, minAzimuth: 1.35, maxAzimuth: Math.PI * 2 - 1.35, startY: r * 0.62, midY: r * 0.34, endY: -r * 0.12, midReach: 1.06, endReach: 1.24, maxRadius: r * 0.26 },
          { count: 5, minAzimuth: 1.45, maxAzimuth: Math.PI * 2 - 1.45, startY: r * 0.22, midY: -r * 0.14, endY: -r * 0.54, midReach: 1.05, endReach: 1.20, maxRadius: r * 0.25 },
        ],
        helmetClamp,
      );
      break;
    }

    case 'wacky': {
      addScalpBaseCap(staticCrown, r, hairMat, helmetClamp);

      // 1. Messy upper crown spikes sitting cleanly above the forehead goggles
      const upperSpikes = 9;
      for (let i = 0; i < upperSpikes; i++) {
        const angle = (i / upperSpikes) * Math.PI * 2 + 0.22;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const frontLift = sinA > 0.25 ? 0.38 : 0.20;
        const reach = 1.32 + (i % 3) * 0.12;
        addSplineLock(
          secondaryGroup,
          [
            new Vector3(cosA * r * 0.22, r * 0.88, sinA * r * 0.22),
            new Vector3(cosA * r * 0.74, r * (1.14 + frontLift * 0.35), sinA * r * 0.72),
            new Vector3(cosA * r * reach, r * (0.86 + frontLift), sinA * r * (reach * 0.90)),
          ],
          r * 0.26,
          hairMat,
          12,
          10,
          0.56,
          { rootScale: 0.78, helmetClamp },
        );
      }

      // 2. Forehead crest spikes sweeping above goggle rims (`y >= +0.36r`)
      for (let i = -2; i <= 2; i++) {
        const xSpread = i * r * 0.26;
        addSplineLock(
          secondaryGroup,
          [
            new Vector3(xSpread * 0.5, r * 0.88, r * 0.36),
            new Vector3(xSpread * 0.92, r * 0.74, r * 0.92),
            new Vector3(xSpread * 1.18, r * 0.38, r * 1.12),
          ],
          r * 0.23,
          hairMat,
          12,
          10,
          0.54,
          { rootScale: 0.78, helmetClamp },
        );
      }

      // 3. Messy temple tufts beside/below goggle rims
      for (const sign of [-1, 1] as const) {
        for (const [sy, ey, zOff] of [[0.32, 0.04, 0.18], [0.08, -0.32, -0.08]] as const) {
          addSplineLock(
            secondaryGroup,
            [
              new Vector3(sign * r * 0.78, r * sy, r * zOff),
              new Vector3(sign * r * 1.06, r * ((sy + ey) * 0.5), r * (zOff - 0.06)),
              new Vector3(sign * r * 1.24, r * ey, r * (zOff - 0.16)),
            ],
            r * 0.22,
            hairMat,
            12,
            10,
            0.56,
            { rootScale: 0.75, helmetClamp },
          );
        }
      }

      // 4. Upper back spikes above the goggle strap & dense lower nape spikes bridging behind strap
      addLayeredBackCascade(
        secondaryGroup,
        r,
        hairMat,
        [
          { count: 6, minAzimuth: 1.42, maxAzimuth: Math.PI * 2 - 1.42, startY: r * 0.88, midY: r * 0.62, endY: r * 0.16, midReach: 1.05, endReach: 1.24, maxRadius: r * 0.26 },
          { count: 8, minAzimuth: 1.32, maxAzimuth: Math.PI * 2 - 1.32, startY: r * 0.34, midY: -r * 0.08, endY: -r * 0.46, midReach: 1.08, endReach: 1.22, maxRadius: r * 0.25 },
        ],
        helmetClamp,
      );
      break;
    }

    case 'mullet': {
      addScalpBaseCap(staticCrown, r, hairMat, helmetClamp);

      // Start forehead bangs tucked inside the front beanie cuff (`z ≈ 0.86r, y ≈ 0.34r`) and
      // emerge downward below its ribbed rim (`y ≈ 0.08r..0.20r`) cleanly above the eyebrows.
      for (let i = -2; i <= 2; i++) {
        const u = i / 2;
        const partBias = i === 0 ? 0.14 : Math.sign(i) * 0.16;
        addSplineLock(
          staticCrown,
          [
            new Vector3(u * r * 0.28, r * 0.34, r * 0.86),
            new Vector3((u + partBias * 0.45) * r * 0.56, r * 0.22, r * 1.03),
            new Vector3((u + partBias) * r * 0.78, r * 0.14, r * 1.02),
          ],
          r * 0.20,
          hairMat,
          12,
          10,
          0.52,
          { rootScale: 0.76, tipBluntness: 0.35, helmetClamp },
        );
      }

      // Long face-framing side locks emerging below the side beanie rim down to collar
      for (const sign of [-1, 1] as const) {
        const sidePanels: ReadonlyArray<readonly [number, number, number]> = [
          [0.34, 0.28, -0.84],
          [0.14, 0.16, -0.94],
          [-0.08, 0.04, -0.90],
        ];
        for (const [zStart, zEnd, yEnd] of sidePanels) {
          addSplineLock(
            secondaryGroup,
            [
              new Vector3(sign * r * 0.90, r * 0.22, r * zStart),
              new Vector3(sign * r * 1.12, -r * 0.06, r * ((zStart + zEnd) * 0.5)),
              new Vector3(sign * r * 1.18, r * -0.48, r * zEnd),
              new Vector3(sign * r * 1.26, r * yEnd, r * (zEnd - 0.08)),
            ],
            r * 0.24,
            hairMat,
            14,
            10,
            0.56,
            { rootScale: 0.76, helmetClamp },
          );
        }
      }

      // Dense two-tier layered back cascade tucked beneath rear cuff down to lower collar
      addLayeredBackCascade(
        secondaryGroup,
        r,
        hairMat,
        [
          { count: 9, minAzimuth: 1.38, maxAzimuth: Math.PI * 2 - 1.38, startY: r * 0.16, midY: -r * 0.16, endY: -r * 0.54, midReach: 1.07, endReach: 1.16, maxRadius: r * 0.26, tipBluntness: 0.55 },
          { count: 7, minAzimuth: 1.46, maxAzimuth: Math.PI * 2 - 1.46, startY: -r * 0.14, midY: -r * 0.50, endY: -r * 0.98, midReach: 1.10, endReach: 1.24, maxRadius: r * 0.26, flickX: r * 0.08 },
        ],
        helmetClamp,
      );
      break;
    }

    case 'swept': {
      addScalpBaseCap(staticCrown, r, hairMat, helmetClamp);

      // 1. Tall side-parted pompadour wave sweeping left-to-right across the front crown
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const startX = (-0.58 + t * 0.35) * r;
        const peakX = (-0.18 + t * 0.90) * r;
        const tipX = (0.34 + t * 0.64) * r;
        addSplineLock(
          secondaryGroup,
          [
            new Vector3(startX, r * (0.68 + t * 0.16), r * (0.64 - t * 0.14)),
            new Vector3(peakX, r * (1.20 - t * 0.10), r * (0.80 - t * 0.22)),
            new Vector3(tipX, r * (0.86 - t * 0.14), r * (0.82 - t * 0.42)),
          ],
          r * 0.28,
          hairMat,
          14,
          10,
          0.66,
          { rootScale: 0.78, tipBluntness: 0.40, helmetClamp },
        );
      }

      // 2. Swept-back sculpted temples and sideburns (`4` locks per side reaching into back nape)
      for (const sign of [-1, 1] as const) {
        const templeRows: ReadonlyArray<readonly [number, number]> = [
          [0.64, 0.42],
          [0.42, 0.14],
          [0.18, -0.14],
          [-0.04, -0.38],
        ];
        for (const [sy, ey] of templeRows) {
          addSplineLock(
            staticCrown,
            [
              new Vector3(sign * r * 0.72, r * sy, r * 0.56),
              new Vector3(sign * r * 1.04, r * ((sy + ey) * 0.5), r * 0.04),
              new Vector3(sign * r * 0.94, r * ey, -r * 0.56),
            ],
            r * 0.23,
            hairMat,
            12,
            10,
            0.54,
            { rootScale: 0.76, tipBluntness: 0.55, helmetClamp },
          );
        }
      }

      // 3. Layered three-tier rear coiff cascade tapering cleanly into the nape
      addLayeredBackCascade(
        staticCrown,
        r,
        hairMat,
        [
          { count: 6, minAzimuth: 1.55, maxAzimuth: Math.PI * 2 - 1.55, startY: r * 0.96, midY: r * 0.74, endY: r * 0.32, midReach: 1.05, endReach: 1.14, maxRadius: r * 0.26, tipBluntness: 0.45 },
          { count: 7, minAzimuth: 1.45, maxAzimuth: Math.PI * 2 - 1.45, startY: r * 0.56, midY: r * 0.22, endY: -r * 0.14, midReach: 1.06, endReach: 1.12, maxRadius: r * 0.25, tipBluntness: 0.55 },
          { count: 7, minAzimuth: 1.48, maxAzimuth: Math.PI * 2 - 1.48, startY: r * 0.12, midY: -r * 0.18, endY: -r * 0.44, midReach: 1.05, endReach: 1.07, maxRadius: r * 0.25, tipBluntness: 0.72 },
        ],
        helmetClamp,
      );
      break;
    }

    case 'receding': {
      // Bald top dome with low side/back horseshoe tufts (Headset runner variant B)
      for (const sign of [-1, 1] as const) {
        const sidePos = new Vector3(sign * r * 0.94, r * 0.18, -r * 0.12);
        const sideGeo = new CapsuleGeometry(r * 0.16, r * 0.38, 8, 12);
        sideGeo.rotateX(Math.PI * 0.42);
        if (helmetClamp) clampGeometryVerticesToDome(sideGeo, sidePos, helmetClamp);
        const sideMesh = new Mesh(sideGeo, hairMat);
        sideMesh.position.copy(sidePos);
        sideMesh.castShadow = true;
        staticCrown.add(sideMesh);
      }
      const backPos = new Vector3(0, r * 0.12, -r * 0.92);
      const backGeo = new CapsuleGeometry(r * 0.16, r * 0.55, 8, 12);
      backGeo.rotateZ(Math.PI * 0.5);
      if (helmetClamp) clampGeometryVerticesToDome(backGeo, backPos, helmetClamp);
      const backMesh = new Mesh(backGeo, hairMat);
      backMesh.position.copy(backPos);
      staticCrown.add(backMesh);
      break;
    }

    case 'mohawk': {
      // Two-tone center crest + side racing stripes
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        const angle = -0.35 + t * 1.35;
        const y = Math.cos(angle) * r;
        const z = Math.sin(angle - 0.55) * r * 0.85;
        addSplineLock(
          secondaryGroup,
          [
            new Vector3(0, y * 0.85, z * 0.85),
            new Vector3(0, y + r * 0.28, z - r * 0.06),
            new Vector3(0, y + r * 0.46, z - r * 0.18),
          ],
          r * 0.20,
          i % 2 === 0 ? hairMat : highlightMat,
          12,
          10,
          0.62,
          { helmetClamp },
        );
      }
      for (const sign of [-1, 1] as const) {
        const stripePos = new Vector3(sign * r * 0.38, r * 0.82, r * 0.12);
        const stripeGeo = new CapsuleGeometry(r * 0.075, r * 0.45, 6, 10);
        stripeGeo.rotateX(Math.PI * 0.35);
        if (helmetClamp) clampGeometryVerticesToDome(stripeGeo, stripePos, helmetClamp);
        const stripe = new Mesh(stripeGeo, highlightMat);
        stripe.position.copy(stripePos);
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
  const helmetClamp = computeHelmetClamp(dna);
  // Facial hair attaches in torsoGroup space while helmetClamp is in crownSocket space; shift centerY back.
  const torsoDome = helmetClamp
    ? { centerY: helmetClamp.centerY + dna.bodyHeight * 0.5, safeRadius: helmetClamp.safeRadius }
    : undefined;

  if (style === 'mustache_handlebar') {
    for (const sign of [-1, 1] as const) {
      addSplineLock(
        facialGroup,
        [
          new Vector3(sign * r * 0.01, mouthY + r * 0.12, r * 1.03),
          new Vector3(sign * r * 0.34, mouthY + r * 0.07, r * 1.03),
          new Vector3(sign * r * 0.66, mouthY + r * 0.10, r * 0.86),
          new Vector3(sign * r * 0.80, mouthY + r * 0.25, r * 0.70),
        ],
        r * 0.195,
        hairMat,
        14,
        10,
        0.80,
        { rootScale: 0.76, refCenterY: mouthY, helmetClamp: torsoDome },
      );
    }
  } else if (style === 'full_beard') {
    // Sculpted upper mustache framing the upper lip cleanly without hiding the mouth
    for (const sign of [-1, 1] as const) {
      addSplineLock(
        facialGroup,
        [
          new Vector3(sign * r * 0.01, mouthY + r * 0.13, r * 1.03),
          new Vector3(sign * r * 0.34, mouthY + r * 0.09, r * 1.00),
          new Vector3(sign * r * 0.62, mouthY - r * 0.08, r * 0.84),
        ],
        r * 0.155,
        hairMat,
        12,
        10,
        0.78,
        { rootScale: 0.78, refCenterY: mouthY, helmetClamp: torsoDome },
      );

      // Sideburn bridges climbing cheeks to meet the temple hair locks
      addSplineLock(
        facialGroup,
        [
          new Vector3(sign * r * 0.94, dna.bodyHeight * 0.5 - r * 0.18, r * 0.32),
          new Vector3(sign * r * 0.98, mouthY + r * 0.28, r * 0.44),
          new Vector3(sign * r * 0.90, mouthY - r * 0.02, r * 0.56),
        ],
        r * 0.17,
        hairMat,
        12,
        10,
        0.60,
        { rootScale: 0.78, refCenterY: mouthY, helmetClamp: torsoDome },
      );
    }

    // 9 overlapping downward sculpted beard locks wrapping the lower jaw & chin
    const lockCount = 9;
    for (let i = 0; i < lockCount; i++) {
      const u = (i / (lockCount - 1)) * 2 - 1; // -1 .. +1
      const azimuth = u * 1.08;
      const sinA = Math.sin(azimuth);
      const cosA = Math.cos(azimuth);
      const sideLift = Math.abs(u) * r * 0.24;
      const centerDrop = (1 - Math.abs(u)) * r * 0.10;
      const rootY = mouthY - r * 0.11 + sideLift;
      const tipY = mouthY - r * 0.40 - centerDrop + sideLift * 0.55;

      addSplineLock(
        facialGroup,
        [
          new Vector3(sinA * r * 0.96, rootY, cosA * r * 1.02),
          new Vector3(sinA * r * 1.00, (rootY + tipY) * 0.5, cosA * r * 1.12),
          new Vector3(sinA * r * 0.96, tipY, cosA * r * 1.08),
        ],
        r * (0.20 + (1 - Math.abs(u)) * 0.03),
        hairMat,
        12,
        10,
        0.64,
        { rootScale: 0.78, refCenterY: mouthY, helmetClamp: torsoDome },
      );
    }
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
      nextDna,
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
