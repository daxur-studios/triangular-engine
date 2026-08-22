import type { IStructureJointConfig } from './structures-archetype';
import type { IStructureColliderDescriptor } from './structures-colliders';
import type { IStructureFootprint2D } from './structures-footprint';
import type { IStructureSocket } from './structures-sockets';
import type { IStructureSolid } from './structures-solid';

export interface IStructureVariant {
  readonly archetypeId: string;
  readonly seed: number;
  readonly solids: readonly IStructureSolid[];
  readonly sockets: readonly IStructureSocket[];
  readonly colliders: readonly IStructureColliderDescriptor[];
  readonly footprint: IStructureFootprint2D;
  readonly joints?: readonly IStructureJointConfig[];
}

export function structureQuaternionFromAxisAngle(
  axis: readonly [number, number, number],
  angleRad: number,
): readonly [number, number, number, number] {
  const len = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
  if (len < 1e-6) {
    return [0, 0, 0, 1];
  }
  const normX = axis[0] / len;
  const normY = axis[1] / len;
  const normZ = axis[2] / len;

  const half = angleRad * 0.5;
  const sinHalf = Math.sin(half);
  const cosHalf = Math.cos(half);

  return [normX * sinHalf, normY * sinHalf, normZ * sinHalf, cosHalf];
}

export function structureMultiplyQuaternions(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;

  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function structureRotateVectorByQuaternion(
  v: readonly [number, number, number],
  q: readonly [number, number, number, number],
): readonly [number, number, number] {
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;

  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;

  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

/**
 * Poses a structure variant at specified joint values (radians for hinges, meters for prismatic joints).
 * Updates solids, sockets, and colliders consistently with full parent-to-child kinematic hierarchy chaining.
 * Pure mathematical operation (DOM-free, Three.js-free, worker-safe).
 */
export function poseStructureVariant(
  variant: IStructureVariant,
  jointPoses: Readonly<Record<string, number>>, // key can be jointId or `link-${linkId}`
): IStructureVariant {
  if (!variant.joints || variant.joints.length === 0) {
    return variant;
  }

  // 1. Index local joint transforms by linkId
  interface ILocalJointTransform {
    readonly translation: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
    readonly anchor: readonly [number, number, number];
    readonly parentLinkId: number;
  }
  const localTransforms = new Map<number, ILocalJointTransform>();

  for (const joint of variant.joints) {
    const rawVal = jointPoses[joint.id] ?? jointPoses[`link-${joint.linkId}`] ?? joint.rest;
    const clampedVal = Math.max(joint.range[0], Math.min(joint.range[1], rawVal));

    if (joint.type === 'prismatic') {
      const len = Math.sqrt(
        joint.axis[0] * joint.axis[0] + joint.axis[1] * joint.axis[1] + joint.axis[2] * joint.axis[2],
      );
      const nx = len > 1e-6 ? joint.axis[0] / len : 0;
      const ny = len > 1e-6 ? joint.axis[1] / len : 1;
      const nz = len > 1e-6 ? joint.axis[2] / len : 0;
      localTransforms.set(joint.linkId, {
        translation: [nx * clampedVal, ny * clampedVal, nz * clampedVal],
        rotation: [0, 0, 0, 1],
        anchor: joint.anchorM,
        parentLinkId: joint.parentLinkId ?? 0,
      });
    } else {
      // hinge revolute
      const rot = structureQuaternionFromAxisAngle(joint.axis, clampedVal);
      localTransforms.set(joint.linkId, {
        translation: [0, 0, 0],
        rotation: rot,
        anchor: joint.anchorM,
        parentLinkId: joint.parentLinkId ?? 0,
      });
    }
  }

  // 2. Helper to recursively propagate kinematic transforms from linkId up through all parent links
  function transformPointAndRotation(
    point: readonly [number, number, number],
    rotation: readonly [number, number, number, number],
    linkId: number,
  ): {
    readonly position: [number, number, number];
    readonly orientation: [number, number, number, number];
  } {
    let currPos: [number, number, number] = [point[0], point[1], point[2]];
    let currRot: [number, number, number, number] = [rotation[0], rotation[1], rotation[2], rotation[3]];
    let currLinkId = linkId;

    const visited = new Set<number>();
    while (currLinkId > 0 && localTransforms.has(currLinkId) && !visited.has(currLinkId)) {
      visited.add(currLinkId);
      const lt = localTransforms.get(currLinkId)!;
      const { anchor, rotation: jRot, translation: jTrans, parentLinkId } = lt;

      const relPos: [number, number, number] = [
        currPos[0] - anchor[0],
        currPos[1] - anchor[1],
        currPos[2] - anchor[2],
      ];
      const rotatedRel = structureRotateVectorByQuaternion(relPos, jRot);
      currPos = [
        anchor[0] + rotatedRel[0] + jTrans[0],
        anchor[1] + rotatedRel[1] + jTrans[1],
        anchor[2] + rotatedRel[2] + jTrans[2],
      ];
      currRot = structureMultiplyQuaternions(jRot, currRot) as [number, number, number, number];
      currLinkId = parentLinkId;
    }

    return { position: currPos, orientation: currRot };
  }

  // 3. Posed solids
  const posedSolids = variant.solids.map((solid) => {
    const linkId = solid.linkId ?? 0;
    if (linkId === 0 || !localTransforms.has(linkId)) {
      return solid;
    }
    const { position, orientation } = transformPointAndRotation(
      solid.positionM,
      solid.orientation,
      linkId,
    );
    return {
      ...solid,
      positionM: position,
      orientation,
    };
  });

  // 4. Posed colliders
  const posedColliders = variant.colliders.map((col) => {
    const linkId = col.linkId ?? 0;
    if (linkId === 0 || !localTransforms.has(linkId)) {
      return col;
    }
    const { position, orientation } = transformPointAndRotation(
      col.anchorRelativePositionM,
      col.rotation,
      linkId,
    );
    return {
      ...col,
      anchorRelativePositionM: position,
      rotation: orientation,
    };
  });

  // 5. Posed sockets
  const solidMap = new Map<string, IStructureSolid>();
  for (const s of posedSolids) {
    solidMap.set(s.id, s);
  }

  const posedSockets = variant.sockets.map((sock) => {
    if (sock.solidId && solidMap.has(sock.solidId)) {
      const parentSolid = solidMap.get(sock.solidId)!;
      const origSolid = variant.solids.find((s) => s.id === sock.solidId);
      const baseOffset: [number, number, number] = origSolid
        ? [
            sock.positionM[0] - origSolid.positionM[0],
            sock.positionM[1] - origSolid.positionM[1],
            sock.positionM[2] - origSolid.positionM[2],
          ]
        : [0, 0, 0];
      const rotatedOffset = structureRotateVectorByQuaternion(baseOffset, parentSolid.orientation);
      const newPos: [number, number, number] = [
        parentSolid.positionM[0] + rotatedOffset[0],
        parentSolid.positionM[1] + rotatedOffset[1],
        parentSolid.positionM[2] + rotatedOffset[2],
      ];
      return {
        ...sock,
        positionM: newPos,
        orientation: structureMultiplyQuaternions(parentSolid.orientation, sock.orientation),
      };
    }
    return sock;
  });

  return {
    ...variant,
    solids: posedSolids,
    colliders: posedColliders,
    sockets: posedSockets,
  };
}

