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

import type { IStructureArchetype } from './structures-archetype';
import type { IStructureSolid } from './structures-solid';

export interface IStructureMeshResult {
  readonly geometry: BufferGeometry;
  readonly triangleCount: number;
  readonly vertexCount: number;
}

export const STRUCTURES_MAX_TRIANGLES_PER_MESH = 60_000;
const RADIAL_SEGMENTS = 16;

function parseHexColor(hex?: string): [number, number, number] {
  if (!hex || typeof hex !== 'string') {
    return [0.65, 0.68, 0.72];
  }
  const color = new Color(hex);
  return [color.r, color.g, color.b];
}

function createSolidGeometry(solid: IStructureSolid): BufferGeometry {
  const [d0, d1, d2] = solid.dimensionsM;
  let geom: BufferGeometry;

  switch (solid.shape) {
    case 'box':
      geom = new BoxGeometry(d0, d1, d2);
      break;
    case 'cylinder':
      geom = new CylinderGeometry(d0, d0, d1, RADIAL_SEGMENTS);
      break;
    case 'cone':
      geom = new CylinderGeometry(d1, d0, d2, RADIAL_SEGMENTS);
      break;
    case 'capsule': {
      const capRadius = d0;
      const bodyLength = Math.max(0, d1 - 2 * capRadius);
      geom = new CapsuleGeometry(capRadius, bodyLength, 4, RADIAL_SEGMENTS);
      break;
    }
    case 'sphere':
      geom = new SphereGeometry(d0, RADIAL_SEGMENTS, RADIAL_SEGMENTS / 2);
      break;
  }

  const pos = new Vector3(...solid.positionM);
  const quat = new Quaternion(...solid.orientation);
  geom.applyQuaternion(quat);
  geom.translate(pos.x, pos.y, pos.z);

  return geom;
}

export function buildStructureMesh(
  solids: readonly IStructureSolid[],
  _archetype?: IStructureArchetype,
): IStructureMeshResult {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const linkIds: number[] = [];
  const colors: number[] = [];

  let indexOffset = 0;
  let triangleCount = 0;

  for (const solid of solids) {
    const geom = createSolidGeometry(solid);
    const posAttr = geom.getAttribute('position');
    const normAttr = geom.getAttribute('normal');
    const idx = geom.getIndex();

    const [cr, cg, cb] = parseHexColor(solid.materialHex);
    const vCount = posAttr.count;

    for (let i = 0; i < vCount; i++) {
      positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      if (normAttr) {
        normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
      } else {
        normals.push(0, 1, 0);
      }
      linkIds.push(solid.linkId ?? 0);
      colors.push(cr, cg, cb);
    }

    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices.push(indexOffset + idx.getX(i));
      }
      triangleCount += idx.count / 3;
    } else {
      for (let i = 0; i < vCount; i++) {
        indices.push(indexOffset + i);
      }
      triangleCount += vCount / 3;
    }

    indexOffset += vCount;
    geom.dispose();
  }

  if (triangleCount > STRUCTURES_MAX_TRIANGLES_PER_MESH) {
    throw new RangeError(
      `Structure mesh budget exceeded: generated ${triangleCount} triangles (max ${STRUCTURES_MAX_TRIANGLES_PER_MESH}).`,
    );
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('linkId', new Float32BufferAttribute(linkIds, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);

  return {
    geometry,
    triangleCount,
    vertexCount: positions.length / 3,
  };
}

/**
 * Builds a Three.js Group with separated child meshes/groups per linkId.
 * This enables 60fps pivot and translation animation for multi-link structures (towers, chopsticks, rotors).
 */
export function buildStructureMeshGroup(
  solids: readonly IStructureSolid[],
  archetype?: IStructureArchetype,
): Group {
  const rootGroup = new Group();
  rootGroup.name = archetype?.id ?? 'procedural-structure';

  const sharedMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    metalness: 0.25,
  });

  const uniqueLinkIds = Array.from(new Set(solids.map((s) => s.linkId ?? 0))).sort((a, b) => a - b);
  const linkGroups = new Map<number, Group>();

  for (const linkId of uniqueLinkIds) {
    const linkSolids = solids.filter((s) => (s.linkId ?? 0) === linkId);
    if (linkSolids.length === 0) continue;

    const joint = archetype?.joints?.find((j) => j.linkId === linkId);
    const anchor = joint ? new Vector3(...joint.anchorM) : new Vector3(0, 0, 0);

    const relativeSolids: IStructureSolid[] = linkSolids.map((s) => ({
      ...s,
      positionM: [
        s.positionM[0] - anchor.x,
        s.positionM[1] - anchor.y,
        s.positionM[2] - anchor.z,
      ],
    }));

    const res = buildStructureMesh(relativeSolids);
    const mesh = new Mesh(res.geometry, sharedMaterial);
    mesh.name = `link-${linkId}-mesh`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const linkGroup = new Group();
    linkGroup.name = `link-${linkId}`;
    linkGroup.position.copy(anchor);
    linkGroup.add(mesh);

    linkGroups.set(linkId, linkGroup);
  }

  for (const linkId of uniqueLinkIds) {
    const linkGroup = linkGroups.get(linkId);
    if (!linkGroup) continue;

    const joint = archetype?.joints?.find((j) => j.linkId === linkId);
    const parentId = joint?.parentLinkId ?? 0;

    if (linkId === 0 || parentId === linkId || !linkGroups.has(parentId)) {
      rootGroup.add(linkGroup);
    } else {
      const parentGroup = linkGroups.get(parentId)!;
      linkGroup.position.sub(parentGroup.position);
      parentGroup.add(linkGroup);
    }
  }

  return rootGroup;
}
