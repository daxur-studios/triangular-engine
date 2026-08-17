import { createProceduralRandom01, sampleProceduralRange } from '../core/procedural-hash';
import { type IPartArchetype, validatePartArchetype } from './parts-archetype';
import { deriveSolidFromEndpoints, type IPartSolid } from './parts-solid';

export const MAX_PART_SOLIDS = 128;

/**
 * Deterministically synthesizes concrete primitive solids from an archetype and seed.
 */
export function generatePartSkeleton(
  archetype: IPartArchetype,
  seed: number,
): readonly IPartSolid[] {
  validatePartArchetype(archetype);
  const rng = createProceduralRandom01(seed);

  const solids: IPartSolid[] = [];

  for (const config of archetype.solids) {
    let repeatCount = 1;
    if (config.repeatCount !== undefined) {
      if (Array.isArray(config.repeatCount)) {
        const draw = rng();
        repeatCount = Math.round(
          sampleProceduralRange(config.repeatCount as readonly [number, number], draw),
        );
      } else {
        repeatCount = config.repeatCount as number;
      }
    }
    repeatCount = Math.max(1, Math.min(repeatCount, 32));

    for (let r = 0; r < repeatCount; r++) {
      if (solids.length >= MAX_PART_SOLIDS) {
        throw new RangeError(
          `Part archetype "${archetype.id}" exceeded maximum solid count (${MAX_PART_SOLIDS}).`,
        );
      }

      const solidId = repeatCount > 1 ? `${config.id}-${r}` : config.id;
      const repeatScale =
        config.repeatScale01 !== undefined
          ? Array.isArray(config.repeatScale01)
            ? sampleProceduralRange(config.repeatScale01 as readonly [number, number], rng()) ** r
            : (config.repeatScale01 as number) ** r
          : 1;

      // Dimensions sampling
      const dimensionsM: number[] = [];
      for (const dim of config.dimensionsM) {
        if (Array.isArray(dim)) {
          dimensionsM.push(
            sampleProceduralRange(dim as readonly [number, number], rng()) * repeatScale,
          );
        } else {
          dimensionsM.push((dim as number) * repeatScale);
        }
      }



      if (config.endpoints) {
        const startM: [number, number, number] = [
          config.endpoints.startM[0] + (config.repeatOffsetM ? config.repeatOffsetM[0] * r : 0),
          config.endpoints.startM[1] + (config.repeatOffsetM ? config.repeatOffsetM[1] * r : 0),
          config.endpoints.startM[2] + (config.repeatOffsetM ? config.repeatOffsetM[2] * r : 0),
        ];
        const endM: [number, number, number] = [
          config.endpoints.endM[0] + (config.repeatOffsetM ? config.repeatOffsetM[0] * r : 0),
          config.endpoints.endM[1] + (config.repeatOffsetM ? config.repeatOffsetM[1] * r : 0),
          config.endpoints.endM[2] + (config.repeatOffsetM ? config.repeatOffsetM[2] * r : 0),
        ];

        const derived = deriveSolidFromEndpoints({
          id: solidId,
          shape: config.shape as 'cylinder' | 'capsule' | 'cone',
          startM,
          endM,
          radiusM: config.shape === 'cone' ? [dimensionsM[0], dimensionsM[1]] : dimensionsM[0],
          linkId: config.linkId,
          embedDepthM: config.embedDepthM,
          materialHex: config.materialHex,
          collidable: config.collidable,
        });
        solids.push(derived);
      } else {
        // Position sampling
        let positionM: [number, number, number] = [0, 0, 0];
        if (config.positionM) {
          if (Array.isArray(config.positionM[0])) {
            const px = sampleProceduralRange(config.positionM[0] as readonly [number, number], rng());
            const py = sampleProceduralRange(config.positionM[1] as readonly [number, number], rng());
            const pz = sampleProceduralRange(config.positionM[2] as readonly [number, number], rng());
            positionM = [px, py, pz];
          } else {
            positionM = [
              config.positionM[0] as number,
              config.positionM[1] as number,
              config.positionM[2] as number,
            ];
          }
        }

        if (config.repeatOffsetM) {
          positionM[0] += config.repeatOffsetM[0] * r;
          positionM[1] += config.repeatOffsetM[1] * r;
          positionM[2] += config.repeatOffsetM[2] * r;
        }

        const orientation: readonly [number, number, number, number] =
          config.orientation ?? [0, 0, 0, 1];

        solids.push({
          id: solidId,
          shape: config.shape,
          positionM,
          orientation,
          dimensionsM,
          linkId: config.linkId ?? 0,
          embedDepthM: config.embedDepthM,
          materialHex: config.materialHex,
          collidable: config.collidable ?? true,
        });
      }
    }
  }

  return solids;
}
