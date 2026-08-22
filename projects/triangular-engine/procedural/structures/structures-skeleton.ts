import { hashProceduralKey } from '../core/procedural-hash';
import type { IStructureArchetype, IStructureSolidConfig } from './structures-archetype';
import {
  deriveStructureSolidFromEndpoints,
  type IStructureSolid,
  type StructureSolidShape,
} from './structures-solid';

export const STRUCTURE_MAX_SOLIDS_PER_VARIANT = 500;

function sampleDimension(
  dim: number | readonly [number, number],
  solidId: string,
  dimIndex: number,
  archetypeId: string,
  seed: number,
  schemaVersion: number,
): number {
  if (typeof dim === 'number') {
    return dim;
  }
  const key = `${archetypeId}|${seed}|${schemaVersion}|solid:${solidId}|dim:${dimIndex}`;
  const h = hashProceduralKey(key);
  const u = (h & 0xffff) / 0xffff;
  return dim[0] + u * (dim[1] - dim[0]);
}

function samplePosition(
  pos: IStructureSolidConfig['positionM'],
  solidId: string,
  archetypeId: string,
  seed: number,
  schemaVersion: number,
): readonly [number, number, number] {
  if (!pos) {
    return [0, 0, 0];
  }
  const [x, y, z] = pos;
  const sx =
    typeof x === 'number'
      ? x
      : x[0] +
        ((hashProceduralKey(`${archetypeId}|${seed}|${schemaVersion}|solid:${solidId}|posX`) & 0xffff) / 0xffff) *
          (x[1] - x[0]);
  const sy =
    typeof y === 'number'
      ? y
      : y[0] +
        ((hashProceduralKey(`${archetypeId}|${seed}|${schemaVersion}|solid:${solidId}|posY`) & 0xffff) / 0xffff) *
          (y[1] - y[0]);
  const sz =
    typeof z === 'number'
      ? z
      : z[0] +
        ((hashProceduralKey(`${archetypeId}|${seed}|${schemaVersion}|solid:${solidId}|posZ`) & 0xffff) / 0xffff) *
          (z[1] - z[0]);

  return [sx, sy, sz];
}

export function generateStructureSkeleton(
  archetype: IStructureArchetype,
  seed: number,
): readonly IStructureSolid[] {
  const result: IStructureSolid[] = [];

  for (const solidCfg of archetype.solids) {
    let repeatCount = 1;
    if (solidCfg.repeatCount !== undefined) {
      if (typeof solidCfg.repeatCount === 'number') {
        repeatCount = Math.max(1, Math.floor(solidCfg.repeatCount));
      } else {
        const key = `${archetype.id}|${seed}|${archetype.schemaVersion}|solid:${solidCfg.id}|repeatCount`;
        const h = hashProceduralKey(key);
        const u = (h & 0xffff) / 0xffff;
        repeatCount = Math.max(
          1,
          Math.floor(solidCfg.repeatCount[0] + u * (solidCfg.repeatCount[1] - solidCfg.repeatCount[0] + 1)),
        );
      }
    }

    const repeatOffset = solidCfg.repeatOffsetM ?? [0, 0, 0];
    const repeatScale =
      typeof solidCfg.repeatScale01 === 'number'
        ? solidCfg.repeatScale01
        : solidCfg.repeatScale01 !== undefined
          ? solidCfg.repeatScale01[0]
          : 1.0;

    const baseDimensions: number[] = [];
    for (let i = 0; i < solidCfg.dimensionsM.length; i++) {
      baseDimensions.push(
        sampleDimension(
          solidCfg.dimensionsM[i],
          solidCfg.id,
          i,
          archetype.id,
          seed,
          archetype.schemaVersion,
        ),
      );
    }

    const basePosition = samplePosition(
      solidCfg.positionM,
      solidCfg.id,
      archetype.id,
      seed,
      archetype.schemaVersion,
    );

    for (let rep = 0; rep < repeatCount; rep++) {
      if (result.length >= STRUCTURE_MAX_SOLIDS_PER_VARIANT) {
        throw new RangeError(
          `Structure variant exceeded max solid count of ${STRUCTURE_MAX_SOLIDS_PER_VARIANT}.`,
        );
      }

      const repId = repeatCount > 1 ? `${solidCfg.id}-${rep}` : solidCfg.id;
      const currentScale = Math.pow(repeatScale, rep);
      const repDims = baseDimensions.map((d) => d * currentScale);

      if (solidCfg.endpoints) {
        const sx = solidCfg.endpoints.startM[0] + rep * repeatOffset[0];
        const sy = solidCfg.endpoints.startM[1] + rep * repeatOffset[1];
        const sz = solidCfg.endpoints.startM[2] + rep * repeatOffset[2];
        const ex = solidCfg.endpoints.endM[0] + rep * repeatOffset[0];
        const ey = solidCfg.endpoints.endM[1] + rep * repeatOffset[1];
        const ez = solidCfg.endpoints.endM[2] + rep * repeatOffset[2];

        const derived = deriveStructureSolidFromEndpoints({
          id: repId,
          shape: solidCfg.shape as 'cylinder' | 'capsule' | 'cone',
          startM: [sx, sy, sz],
          endM: [ex, ey, ez],
          radiusM: repDims[0],
          linkId: solidCfg.linkId ?? 0,
          embedDepthM: solidCfg.embedDepthM,
          materialHex: solidCfg.materialHex,
          collidable: solidCfg.collidable ?? true,
        });
        result.push(derived);
      } else {
        const repPos: [number, number, number] = [
          basePosition[0] + rep * repeatOffset[0],
          basePosition[1] + rep * repeatOffset[1],
          basePosition[2] + rep * repeatOffset[2],
        ];

        result.push({
          id: repId,
          shape: solidCfg.shape as StructureSolidShape,
          positionM: repPos,
          orientation: solidCfg.orientation ?? [0, 0, 0, 1],
          dimensionsM: repDims,
          linkId: solidCfg.linkId ?? 0,
          embedDepthM: solidCfg.embedDepthM,
          materialHex: solidCfg.materialHex,
          collidable: solidCfg.collidable ?? true,
        });
      }
    }
  }

  return result;
}
