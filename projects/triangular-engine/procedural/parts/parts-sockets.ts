import {
  deriveProceduralSocketId,
  type IProceduralSocket,
} from '../core/procedural-socket';
import type {
  IPartArchetype,
  IPartSocketConfig,
  PartSocketKind,
  PartSocketRole,
} from './parts-archetype';
import type { IPartSolid } from './parts-solid';

export interface IPartSocket extends IProceduralSocket<PartSocketKind> {
  readonly role?: PartSocketRole;
  readonly size?: number;
  readonly solidId?: string;
}

/**
 * Computes a quaternion [x, y, z, w] rotating the canonical primary direction [0, 0, 1] (+Z)
 * to align with the target unit vector.
 */
export function quaternionFromUnitZ(
  dir: readonly [number, number, number],
): readonly [number, number, number, number] {
  const [dx, dy, dz] = dir;
  if (dz > 0.999999) {
    return [0, 0, 0, 1];
  }
  if (dz < -0.999999) {
    return [0, 1, 0, 0]; // 180 flip around Y axis
  }

  // Cross product [0, 0, 1] x [dx, dy, dz] = [-dy, dx, 0]
  const axisX = -dy;
  const axisY = dx;
  const axisZ = 0;
  const axisLen = Math.sqrt(axisX * axisX + axisY * axisY);

  const normX = axisX / axisLen;
  const normY = axisY / axisLen;

  // dz = cos(theta)
  const angle = Math.acos(Math.max(-1, Math.min(1, dz)));
  const halfAngle = angle * 0.5;
  const sinHalf = Math.sin(halfAngle);
  const cosHalf = Math.cos(halfAngle);

  return [normX * sinHalf, normY * sinHalf, 0, cosHalf];
}

/**
 * Derives typed functional sockets with stable IDs, load-bearing orientations,
 * and editor role tags from a solid skeleton and archetype.
 */
export function derivePartSockets(
  skeleton: readonly IPartSolid[],
  archetype: IPartArchetype,
  seed: number,
): readonly IPartSocket[] {
  const sockets: IPartSocket[] = [];
  const solidMap = new Map<string, IPartSolid>();
  for (const solid of skeleton) {
    solidMap.set(solid.id, solid);
  }

  const ordinalByKind = new Map<PartSocketKind, number>();

  for (const config of archetype.sockets) {
    const ordinal = ordinalByKind.get(config.kind) ?? 0;
    ordinalByKind.set(config.kind, ordinal + 1);

    const id = deriveProceduralSocketId({
      archetypeId: archetype.id,
      seed,
      schemaVersion: archetype.schemaVersion,
      kind: config.kind,
      ordinal,
    });

    const solid = config.solidId ? solidMap.get(config.solidId) : skeleton[0];
    let positionM: readonly [number, number, number] = [0, 0, 0];
    let primaryDirection: readonly [number, number, number] = [0, 0, 1];
    let clearanceRadiusM = 0.2;

    if (config.primaryDirection) {
      const d = config.primaryDirection;
      const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
      primaryDirection = len > 1e-6 ? [d[0] / len, d[1] / len, d[2] / len] : [0, 0, 1];
    }

    if (solid) {
      const [sx, sy, sz] = solid.positionM;
      const [d0, d1, d2] = solid.dimensionsM;

      switch (config.kind) {
        case 'attach': {
          if (config.role === 'stack-top') {
            const heightHalf = solid.shape === 'box' ? d1 * 0.5 : d1 * 0.5;
            positionM = [sx, sy + heightHalf, sz];
            primaryDirection = config.primaryDirection ?? [0, 1, 0];
            clearanceRadiusM = Math.max(d0 * 0.5, 0.1);
          } else if (config.role === 'stack-bottom') {
            const heightHalf = solid.shape === 'box' ? d1 * 0.5 : d1 * 0.5;
            positionM = [sx, sy - heightHalf, sz];
            primaryDirection = config.primaryDirection ?? [0, -1, 0];
            clearanceRadiusM = Math.max(d0 * 0.5, 0.1);
          } else if (config.role === 'radial') {
            const depthHalf = solid.shape === 'box' ? d2 * 0.5 : d0;
            positionM = [sx, sy, sz - depthHalf];
            primaryDirection = config.primaryDirection ?? [0, 0, -1];
            clearanceRadiusM = Math.max(d0 * 0.5, 0.1);
          } else {
            positionM = [sx, sy, sz];
          }
          break;
        }
        case 'thrust': {
          // Nozzle exit at bottom center of nozzle cone/cylinder
          const heightHalf = solid.shape === 'cone' ? d2 * 0.5 : d1 * 0.5;
          positionM = [sx, sy - heightHalf, sz];
          primaryDirection = config.primaryDirection ?? [0, -1, 0];
          clearanceRadiusM = (solid.shape === 'cone' ? d0 : d0) * 1.2;
          break;
        }
        case 'foot': {
          // Foot contact point at bottom of link-1 pad/strut
          const heightHalf = solid.shape === 'box' ? d1 * 0.5 : d1 * 0.5;
          positionM = [sx, sy - heightHalf, sz];
          primaryDirection = config.primaryDirection ?? [0, -1, 0];
          clearanceRadiusM = 0.15;
          break;
        }
        case 'pivot': {
          if (archetype.joint) {
            positionM = archetype.joint.anchorM;
            primaryDirection = config.primaryDirection ?? archetype.joint.axis;
          } else {
            positionM = [sx, sy, sz];
          }
          clearanceRadiusM = 0.1;
          break;
        }
        case 'lift': {
          // Wing center of pressure: quarter-chord from leading edge
          positionM = [sx, sy, sz];
          primaryDirection = config.primaryDirection ?? [0, 0, 1]; // Forward flight axis
          clearanceRadiusM = Math.max(d0, d2 ?? 0.5);
          break;
        }
      }
    }

    if (config.offsetM) {
      positionM = [
        positionM[0] + config.offsetM[0],
        positionM[1] + config.offsetM[1],
        positionM[2] + config.offsetM[2],
      ];
    }

    const orientation = quaternionFromUnitZ(primaryDirection);

    sockets.push({
      id,
      kind: config.kind,
      role: config.role,
      size: config.size,
      solidId: config.solidId,
      positionM,
      orientation,
      clearanceRadiusM,
    });
  }

  return sockets;
}
