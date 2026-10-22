/* eslint-disable @typescript-eslint/no-explicit-any */
import { Vector3 } from 'three';
import { uniform } from 'three/tsl';
import {
  BIOME_OFFSET, MASK_OFFSETS, ROCK_OCTAVES, bottomAltitudeM, densityAt, fieldFrameMatrices, noiseFrame, noiseOrigin, padEdit,
  topAltitudeM, unitM, type FieldNodes,
} from '../planet-shape-field';
import { createNoiseTexture } from '../planet-shape-noise';
import { shapeOpFromTerrainEdit, type AltitudeBand, type ShapeOp } from '../shape-ops/shape-op';
import { createShapeOpTextures } from '../shape-ops/shape-ops-gpu';

/**
 * Plan 055 contender B: the terrain v2 field (`planet-shape-field.ts`) as TSL nodes around one origin, set up as
 * terrain v2 sets it up (`planet-shape-raymarch-lit.ts`), so both contenders draw the same ground. Points are given
 * relative to the origin; `density` takes the altitude separately, so a caller that knows it exactly (a column at a
 * given altitude) loses nothing to float32.
 */
export interface BField {
  readonly field: FieldNodes;
  /** The origin in the body frame: a node, for altitudes of origin-relative points. */
  readonly origin: any;
  /** `|origin|^2 - R^2` (doubles, then float32), for `altitudeOf`. */
  readonly originQ: any;
  readonly radius: any;
  /** Signed field in metres (negative in rock) at the origin-relative point `x` with altitude `altitude`. */
  density(x: any, altitude: any, footprint: any): any;
  /** Altitude of the origin-relative point `x`, precise near the origin (see `planet-shape-raymarch.ts`). */
  altitudeOf(x: any): any;
  /** The field's band, widened by the shape ops. */
  readonly band: AltitudeBand;
  readonly radiusM: number;
  setBody(radiusM: number): void;
  setOrigin(x: number, y: number, z: number): void;
  /** Shape ops in order; `undefined` is the default pad under the poses, as terrain v2. */
  setShapeOps(ops: readonly ShapeOp[] | undefined): void;
  setBiome(biome: number | undefined): void;
  setRock(grounded: number | undefined): void;
}

export function createBField(): BField {
  const noiseTexture = createNoiseTexture();
  const uOrigin = uniform(new Vector3()) as any;
  const uOriginQ = uniform(0) as any;
  const uRadius = uniform(1) as any;
  const uUnit = uniform(1) as any;
  const uBiomeOverride = uniform(-1) as any;
  const uRockOverride = uniform(-1) as any;
  const rockFrames = Array.from({ length: ROCK_OCTAVES }, () => noiseFrame());
  const maskFrames = MASK_OFFSETS.map((offset) => noiseFrame(new Vector3(...offset)));
  const biomeFrame = noiseFrame(new Vector3(...BIOME_OFFSET));
  const allFrames = [...rockFrames, ...maskFrames, biomeFrame];
  const shapeOps = createShapeOpTextures();
  const field: FieldNodes = {
    noiseTexture, camera: uOrigin, unit: uUnit, rockFrames, maskFrames, biome: { frame: biomeFrame, override: uBiomeOverride },
    rockOverride: uRockOverride, shapeOps,
  };
  let radius = 1;
  let origin: [number, number, number] = [0, 0, 1];
  let ops: readonly ShapeOp[] | undefined;
  const scratch = new Vector3();

  const updateOps = () => {
    shapeOps.setOps(ops ?? [shapeOpFromTerrainEdit(padEdit(radius), 'pad')], radius, { bottomM: bottomAltitudeM(radius), topM: topAltitudeM(radius) });
  };
  const updateOrigin = () => {
    const [x, y, z] = origin;
    uOrigin.value.set(x, y, z);
    uOriginQ.value = x * x + y * y + z * z - radius * radius;
    for (const frame of allFrames) frame.uOrigin.value.copy(noiseOrigin(frame.matrix, frame.offset, x, y, z, scratch));
    shapeOps.setCamera(origin);
  };

  return {
    field,
    origin: uOrigin,
    originQ: uOriginQ,
    radius: uRadius,
    density: (x, altitude, footprint) => densityAt(field, x, altitude, footprint, false),
    altitudeOf: (x) => uOriginQ.add(uOrigin.dot(x).mul(2)).add(x.dot(x)).div(uOrigin.add(x).length().add(uRadius)),
    get band() { return shapeOps.band; },
    get radiusM() { return radius; },
    setBody(radiusM) {
      radius = radiusM;
      uRadius.value = radiusM;
      uUnit.value = unitM(radiusM);
      const matrices = fieldFrameMatrices(unitM(radiusM));
      rockFrames.forEach((frame, i) => frame.matrix.copy(matrices.rock[i]));
      maskFrames.forEach((frame, i) => frame.matrix.copy(matrices.mask[i]));
      biomeFrame.matrix.copy(matrices.biome);
      for (const frame of allFrames) frame.uMatrix.value.copy(frame.matrix);
      updateOps();
      updateOrigin();
    },
    setOrigin(x, y, z) {
      origin = [x, y, z];
      updateOrigin();
    },
    setShapeOps(next) {
      ops = next;
      updateOps();
      updateOrigin();
    },
    setBiome(biome) { uBiomeOverride.value = biome ?? -1; },
    setRock(grounded) { uRockOverride.value = grounded ?? -1; },
  };
}
