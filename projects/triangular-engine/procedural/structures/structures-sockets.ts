import {
  deriveProceduralSocketId,
  type IProceduralSocket,
} from '../core/procedural-socket';
import type {
  IStructureArchetype,
  IStructureSocketConfig,
  StructureSocketKind,
  StructureSocketRole,
} from './structures-archetype';
import {
  structureQuaternionFromUnitY,
  type IStructureSolid,
} from './structures-solid';

export interface IStructureSocket extends IProceduralSocket<StructureSocketKind> {
  readonly role?: StructureSocketRole;
  readonly size?: number;
  readonly solidId?: string;
}

/**
 * Derives typed functional sockets with stable IDs, load-bearing orientations,
 * and operational role tags from a solid skeleton and archetype.
 */
export function deriveStructureSockets(
  skeleton: readonly IStructureSolid[],
  archetype: IStructureArchetype,
  seed: number,
): readonly IStructureSocket[] {
  const sockets: IStructureSocket[] = [];
  const solidMap = new Map<string, IStructureSolid>();
  for (const solid of skeleton) {
    solidMap.set(solid.id, solid);
  }

  const rawConfigs: IStructureSocketConfig[] = archetype.sockets ? [...archetype.sockets] : [];

  // Default sockets if none explicitly declared
  if (rawConfigs.length === 0) {
    rawConfigs.push({
      kind: 'spawn-point',
      role: 'launch',
      offsetM: [0, 0, 0],
      primaryDirection: [0, 1, 0],
      clearanceRadiusM: 10,
    });
  }

  for (let i = 0; i < rawConfigs.length; i++) {
    const config = rawConfigs[i];
    const id = deriveProceduralSocketId({
      archetypeId: archetype.id,
      seed,
      schemaVersion: archetype.schemaVersion,
      kind: config.kind,
      ordinal: i,
    });

    let positionM: [number, number, number] = [0, 0, 0];
    const baseOffset = config.offsetM ?? [0, 0, 0];

    if (config.solidId && solidMap.has(config.solidId)) {
      const solid = solidMap.get(config.solidId)!;
      positionM = [
        solid.positionM[0] + baseOffset[0],
        solid.positionM[1] + baseOffset[1],
        solid.positionM[2] + baseOffset[2],
      ];
    } else {
      positionM = [baseOffset[0], baseOffset[1], baseOffset[2]];
    }

    const primaryDir = config.primaryDirection ?? [0, 1, 0];
    const orientation = structureQuaternionFromUnitY(primaryDir);

    sockets.push({
      id,
      kind: config.kind,
      role: config.role,
      size: config.size,
      solidId: config.solidId,
      positionM,
      orientation,
      clearanceRadiusM: config.clearanceRadiusM ?? 5.0,
    });
  }

  return sockets;
}
