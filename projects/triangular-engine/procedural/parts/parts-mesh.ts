import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';

import type { IPartArchetype } from './parts-archetype';
import type { IPartSolid } from './parts-solid';

export interface IPartMeshResult {
  readonly geometry: BufferGeometry;
  readonly triangleCount: number;
  readonly vertexCount: number;
}

export const PARTS_MAX_TRIANGLES_PER_MESH = 20_000;
const RADIAL_SEGMENTS = 12;

function parseHexColor(hex?: string): [number, number, number] {
  if (!hex || typeof hex !== 'string') {
    return [0.7, 0.7, 0.7];
  }
  const color = new Color(hex);
  return [color.r, color.g, color.b];
}

function createSolidGeometry(solid: IPartSolid): BufferGeometry {
  const [d0, d1, d2] = solid.dimensionsM;
  let geom: BufferGeometry;

  switch (solid.shape) {
    case 'box':
      geom = new BoxGeometry(d0, d1, d2);
      break;
    case 'cylinder':
      // dimensions: [radius, height]
      geom = new CylinderGeometry(d0, d0, d1, RADIAL_SEGMENTS);
      break;
    case 'cone':
      // dimensions: [radiusBottom, radiusTop, height]
      geom = new CylinderGeometry(d1, d0, d2, RADIAL_SEGMENTS);
      break;
    case 'capsule':
      // dimensions: [radius, totalHeight]
      // three CapsuleGeometry(radius, length, capSubdivisions, radialSegments)
      // totalHeight = length + 2 * radius -> length = max(0, totalHeight - 2 * radius)
      const capRadius = d0;
      const bodyLength = Math.max(0, d1 - 2 * capRadius);
      geom = new CapsuleGeometry(capRadius, bodyLength, 4, RADIAL_SEGMENTS);
      break;
    case 'sphere':
      geom = new SphereGeometry(d0, RADIAL_SEGMENTS, Math.max(6, RADIAL_SEGMENTS / 2));
      break;
    default:
      geom = new BoxGeometry(0.1, 0.1, 0.1);
  }

  // Apply orientation and position
  const quat = new Quaternion(
    solid.orientation[0],
    solid.orientation[1],
    solid.orientation[2],
    solid.orientation[3],
  );
  const pos = new Vector3(solid.positionM[0], solid.positionM[1], solid.positionM[2]);

  geom.applyQuaternion(quat);
  geom.translate(pos.x, pos.y, pos.z);

  return geom;
}

/**
 * Merges a list of primitive solids into a single BufferGeometry with vertex
 * position, normal, color (from materialHex), and linkId attributes.
 */
export function buildPartMesh(
  solids: readonly IPartSolid[],
  _archetype?: IPartArchetype,
): IPartMeshResult {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const linkIds: number[] = [];
  const indices: number[] = [];

  let vertexOffset = 0;

  for (const solid of solids) {
    const geom = createSolidGeometry(solid);
    const posAttr = geom.getAttribute('position');
    const normAttr = geom.getAttribute('normal');
    const geomIndex = geom.getIndex();

    const [cr, cg, cb] = parseHexColor(solid.materialHex);
    const linkId = solid.linkId;

    const count = posAttr.count;

    for (let i = 0; i < count; i++) {
      positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      if (normAttr) {
        normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
      } else {
        normals.push(0, 1, 0);
      }
      colors.push(cr, cg, cb);
      linkIds.push(linkId);
    }

    if (geomIndex) {
      for (let i = 0; i < geomIndex.count; i++) {
        indices.push(geomIndex.getX(i) + vertexOffset);
      }
    } else {
      // Non-indexed template
      for (let i = 0; i < count; i++) {
        indices.push(vertexOffset + i);
      }
    }

    vertexOffset += count;
    geom.dispose();
  }

  const triangleCount = indices.length / 3;
  if (triangleCount > PARTS_MAX_TRIANGLES_PER_MESH) {
    throw new RangeError(
      `Procedural part mesh triangle count (${triangleCount}) exceeds budget (${PARTS_MAX_TRIANGLES_PER_MESH}).`,
    );
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('linkId', new Float32BufferAttribute(linkIds, 1));
  geometry.setIndex(indices);

  return {
    geometry,
    triangleCount,
    vertexCount: positions.length / 3,
  };
}

/**
 * Builds a Three.js Group with separated meshes for link-0 (base) and link-1 (joint child).
 * This enables 60fps pivot rotation without rebuilding the geometry every tick.
 */
export function buildPartMeshGroup(
  solids: readonly IPartSolid[],
  archetype?: IPartArchetype,
): Group {
  const group = new Group();
  group.name = archetype?.id ?? 'procedural-part';

  const link0Solids = solids.filter((s) => s.linkId === 0);
  const link1Solids = solids.filter((s) => s.linkId === 1);

  const sharedMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0.2,
  });

  if (link0Solids.length > 0) {
    const res0 = buildPartMesh(link0Solids);
    const mesh0 = new Mesh(res0.geometry, sharedMaterial);
    mesh0.name = 'link-0';
    group.add(mesh0);
  }

  if (link1Solids.length > 0) {
    if (archetype?.joint) {
      const jointAnchor = new Vector3(...archetype.joint.anchorM);
      const jointGroup = new Group();
      jointGroup.name = 'joint-pivot';
      jointGroup.position.copy(jointAnchor);

      // Re-center link-1 solids relative to the joint anchor
      const relativeSolids: IPartSolid[] = link1Solids.map((s) => ({
        ...s,
        positionM: [
          s.positionM[0] - jointAnchor.x,
          s.positionM[1] - jointAnchor.y,
          s.positionM[2] - jointAnchor.z,
        ],
      }));

      const res1 = buildPartMesh(relativeSolids);
      const mesh1 = new Mesh(res1.geometry, sharedMaterial);
      mesh1.name = 'link-1';
      jointGroup.add(mesh1);
      group.add(jointGroup);
    } else {
      const res1 = buildPartMesh(link1Solids);
      const mesh1 = new Mesh(res1.geometry, sharedMaterial);
      mesh1.name = 'link-1';
      group.add(mesh1);
    }
  }

  return group;
}
