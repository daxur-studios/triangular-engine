import { hashProceduralKey } from '../core/procedural-hash';
import type {
  IStructureArchetype,
  StructureFootprintKind,
} from './structures-archetype';

export interface IStructureFootprint2D {
  readonly kind: StructureFootprintKind;
  readonly dimensionsM: readonly number[];
  readonly foundationDepthM: number;
  /** Radius of bounding circle encompassing entire footprint (meters). */
  readonly boundingRadiusM: number;
}

export function deriveStructureFootprint2D(
  archetype: IStructureArchetype,
  seed: number,
): IStructureFootprint2D {
  const cfg = archetype.footprint;
  const dims: number[] = [];

  for (let i = 0; i < cfg.dimensionsM.length; i++) {
    const d = cfg.dimensionsM[i];
    if (typeof d === 'number') {
      dims.push(d);
    } else {
      const key = `${archetype.id}|${seed}|${archetype.schemaVersion}|footprint:${i}`;
      const h = hashProceduralKey(key);
      const u = (h & 0xffff) / 0xffff;
      dims.push(d[0] + u * (d[1] - d[0]));
    }
  }

  let foundationDepthM = 0.5;
  if (cfg.foundationDepthM !== undefined) {
    if (typeof cfg.foundationDepthM === 'number') {
      foundationDepthM = cfg.foundationDepthM;
    } else {
      const key = `${archetype.id}|${seed}|${archetype.schemaVersion}|footprint:depth`;
      const h = hashProceduralKey(key);
      const u = (h & 0xffff) / 0xffff;
      foundationDepthM = cfg.foundationDepthM[0] + u * (cfg.foundationDepthM[1] - cfg.foundationDepthM[0]);
    }
  }

  let boundingRadiusM = 10;
  if (cfg.kind === 'circle') {
    boundingRadiusM = dims[0];
  } else if (cfg.kind === 'rect') {
    const hw = dims[0];
    const hl = dims[1];
    boundingRadiusM = Math.sqrt(hw * hw + hl * hl);
  }

  return {
    kind: cfg.kind,
    dimensionsM: dims,
    foundationDepthM,
    boundingRadiusM,
  };
}
