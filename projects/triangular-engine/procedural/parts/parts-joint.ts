import type { IPartJointConfig } from './parts-archetype';
import type { IPartColliderDescriptor } from './parts-colliders';
import { derivePartMassProperties, type IPartMassProperties } from './parts-mass';
import type { IPartSocket } from './parts-sockets';
import type { IPartSolid } from './parts-solid';

export interface IPartVariant {
  readonly solids: readonly IPartSolid[];
  readonly sockets: readonly IPartSocket[];
  readonly colliders: readonly IPartColliderDescriptor[];
  readonly mass: IPartMassProperties;
  readonly joint?: IPartJointConfig;
}

export function quaternionFromAxisAngle(
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

export function multiplyQuaternions(
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

export function rotateVectorByQuaternion(
  v: readonly [number, number, number],
  q: readonly [number, number, number, number],
): readonly [number, number, number] {
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;

  // q * v * q^-1
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
 * Poses a part variant at a specified hinge deploy angle (radians).
 * Only solids, sockets, and colliders with linkId: 1 are rotated about the joint anchor.
 * Pure mathematical operation (DOM-free, Three.js-free, worker-safe).
 */
export function posePartVariant(variant: IPartVariant, deployRad: number): IPartVariant {
  if (!variant.joint) {
    return variant;
  }

  const { anchorM, axis, rangeRad } = variant.joint;
  const clampedAngle = Math.max(rangeRad[0], Math.min(rangeRad[1], deployRad));
  const rotQuat = quaternionFromAxisAngle(axis, clampedAngle);

  const [ax, ay, az] = anchorM;

  // 1. Pose Solids
  const posedSolids: IPartSolid[] = variant.solids.map((solid) => {
    if (solid.linkId !== 1) {
      return solid;
    }

    const relPos: [number, number, number] = [
      solid.positionM[0] - ax,
      solid.positionM[1] - ay,
      solid.positionM[2] - az,
    ];
    const rotatedRel = rotateVectorByQuaternion(relPos, rotQuat);
    const newPos: [number, number, number] = [
      rotatedRel[0] + ax,
      rotatedRel[1] + ay,
      rotatedRel[2] + az,
    ];
    const newQuat = multiplyQuaternions(rotQuat, solid.orientation);

    let newEndpoints = solid.endpoints;
    if (solid.endpoints) {
      const relStart: [number, number, number] = [
        solid.endpoints.startM[0] - ax,
        solid.endpoints.startM[1] - ay,
        solid.endpoints.startM[2] - az,
      ];
      const relEnd: [number, number, number] = [
        solid.endpoints.endM[0] - ax,
        solid.endpoints.endM[1] - ay,
        solid.endpoints.endM[2] - az,
      ];
      const rotStart = rotateVectorByQuaternion(relStart, rotQuat);
      const rotEnd = rotateVectorByQuaternion(relEnd, rotQuat);

      newEndpoints = {
        startM: [rotStart[0] + ax, rotStart[1] + ay, rotStart[2] + az],
        endM: [rotEnd[0] + ax, rotEnd[1] + ay, rotEnd[2] + az],
      };
    }

    return {
      ...solid,
      positionM: newPos,
      orientation: newQuat,
      endpoints: newEndpoints,
    };
  });

  // 2. Pose Sockets
  const solidMap = new Map<string, IPartSolid>();
  for (const s of variant.solids) solidMap.set(s.id, s);

  const posedSockets: IPartSocket[] = variant.sockets.map((socket) => {
    const parentSolid = socket.solidId ? solidMap.get(socket.solidId) : undefined;
    const isLink1 = parentSolid ? parentSolid.linkId === 1 : socket.kind === 'foot';

    if (!isLink1) {
      return socket;
    }

    const relPos: [number, number, number] = [
      socket.positionM[0] - ax,
      socket.positionM[1] - ay,
      socket.positionM[2] - az,
    ];
    const rotatedRel = rotateVectorByQuaternion(relPos, rotQuat);
    const newPos: [number, number, number] = [
      rotatedRel[0] + ax,
      rotatedRel[1] + ay,
      rotatedRel[2] + az,
    ];
    const newQuat = multiplyQuaternions(rotQuat, socket.orientation);

    return {
      ...socket,
      positionM: newPos,
      orientation: newQuat,
    };
  });

  // 3. Pose Colliders
  const posedColliders: IPartColliderDescriptor[] = variant.colliders.map((collider) => {
    if (collider.linkId !== 1) {
      return collider;
    }

    const relPos: [number, number, number] = [
      collider.anchorRelativePositionM[0] - ax,
      collider.anchorRelativePositionM[1] - ay,
      collider.anchorRelativePositionM[2] - az,
    ];
    const rotatedRel = rotateVectorByQuaternion(relPos, rotQuat);
    const newPos: [number, number, number] = [
      rotatedRel[0] + ax,
      rotatedRel[1] + ay,
      rotatedRel[2] + az,
    ];
    const newQuat = multiplyQuaternions(rotQuat, collider.rotation);

    return {
      ...collider,
      anchorRelativePositionM: newPos,
      rotation: newQuat,
    };
  });

  // 4. Update Mass Properties
  const posedMass = derivePartMassProperties(posedSolids);

  return {
    solids: posedSolids,
    sockets: posedSockets,
    colliders: posedColliders,
    mass: posedMass,
    joint: variant.joint,
  };
}
