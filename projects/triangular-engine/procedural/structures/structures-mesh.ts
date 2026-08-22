import {
  Box3,
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

export interface IStructureMeshOptions {
  /**
   * Level of detail:
   * 0: Full detail (24-seg cylinders, full micro-solids & decals)
   * 1: Medium detail (10-seg cylinders, strips non-collidable decals & lights)
   * 2: Low detail (5-seg cylinders, strips small sub-solids < 1.2m)
   * 3: Proxy box / simplified bounding envelope
   */
  readonly lod?: number;
}

export const STRUCTURES_MAX_TRIANGLES_PER_MESH = 60_000;

function parseHexColor(hex?: string): [number, number, number] {
  if (!hex || typeof hex !== 'string') {
    return [0.65, 0.68, 0.72];
  }
  const color = new Color(hex);
  return [color.r, color.g, color.b];
}

function resolveRadialSegments(lod: number): number {
  switch (lod) {
    case 0:
      return 24;
    case 1:
      return 10;
    case 2:
      return 5;
    default:
      return 3;
  }
}

function createSolidGeometry(solid: IStructureSolid, lod = 0): BufferGeometry {
  const [d0, d1, d2] = solid.dimensionsM;
  const radialSegs = resolveRadialSegments(lod);
  const heightSegs = lod === 0 ? 12 : lod === 1 ? 6 : lod === 2 ? 3 : 2;
  let geom: BufferGeometry;

  switch (solid.shape) {
    case 'box':
      geom = new BoxGeometry(d0, d1, d2);
      break;
    case 'cylinder':
      geom = new CylinderGeometry(d0, d0, d1, radialSegs);
      break;
    case 'cone':
      geom = new CylinderGeometry(d1, d0, d2, radialSegs);
      break;
    case 'capsule': {
      const capRadius = d0;
      const bodyLength = Math.max(0, d1 - 2 * capRadius);
      geom = new CapsuleGeometry(capRadius, bodyLength, Math.max(2, Math.floor(heightSegs * 0.5)), radialSegs);
      break;
    }
    case 'sphere':
      geom = new SphereGeometry(d0, radialSegs, heightSegs);
      break;
  }

  const pos = new Vector3(...solid.positionM);
  const quat = new Quaternion(...solid.orientation);
  geom.applyQuaternion(quat);
  geom.translate(pos.x, pos.y, pos.z);

  return geom;
}

function filterSolidsByLod(solids: readonly IStructureSolid[], lod: number): readonly IStructureSolid[] {
  if (lod <= 0 || solids.length <= 1) {
    return solids;
  }

  // LOD 1: Strip non-collidable decorative details (stripes, light bulbs)
  let filtered = solids.filter((s) => s.collidable !== false);
  if (filtered.length === 0) filtered = [solids[0]];

  // LOD 2: Strip tiny sub-solids (< 1.2m)
  if (lod >= 2 && filtered.length > 1) {
    const significant = filtered.filter((s) => {
      const maxDim = Math.max(...s.dimensionsM);
      return maxDim >= 1.2;
    });
    if (significant.length > 0) {
      filtered = significant;
    }
  }

  // LOD 3: If multiple solids remain, keep only the largest core structural solids
  if (lod >= 3 && filtered.length > 2) {
    filtered = filtered
      .slice()
      .sort((a, b) => {
        const volA = a.dimensionsM.reduce((acc, v) => acc * v, 1);
        const volB = b.dimensionsM.reduce((acc, v) => acc * v, 1);
        return volB - volA;
      })
      .slice(0, 2);
  }

  return filtered;
}

export function buildStructureMesh(
  solids: readonly IStructureSolid[],
  _archetype?: IStructureArchetype,
  options?: IStructureMeshOptions,
): IStructureMeshResult {
  const lod = Math.max(0, Math.floor(options?.lod ?? 0));
  const activeSolids = filterSolidsByLod(solids, lod);

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const linkIds: number[] = [];
  const colors: number[] = [];

  let indexOffset = 0;
  let triangleCount = 0;

  for (const solid of activeSolids) {
    const geom = createSolidGeometry(solid, lod);
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
  options?: IStructureMeshOptions,
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

    const res = buildStructureMesh(relativeSolids, archetype, options);
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
