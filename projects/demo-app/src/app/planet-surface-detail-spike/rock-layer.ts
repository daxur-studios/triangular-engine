import { Vector3 } from 'three';
import { float, floor, int, mix, select, smoothstep, uint, uniform, vec3 } from 'three/tsl';
import type { IPlanetContext, SurfaceLayer } from 'triangular-engine/planet-material';
import { FOREST_COAST_M } from './forest-field';
import { bodyFixed, fieldDensityNode, noiseNode, splitLayerWeight, type IForestLayer } from './forest-layer';
import { ROCK_COVER, ROCK_EDGE, ROCK_OCTAVES, ROCK_OCTAVE_OFFSET, ROCK_UNDER_FOREST, rockBands } from './rock-field';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface IRockLayer {
  readonly layer: SurfaceLayer;
  /** Live uniforms: change `.value`, nothing recompiles. */
  readonly uniforms: {
    /** 0 hides both forms (the panel's show toggle). */
    readonly enabled: any;
    readonly meshStartM: any;
    readonly meshEndM: any;
    readonly speckleStartM: any;
    readonly speckleEndM: any;
  };
  /** Weight of the speckle at a camera distance (node): 0 near, rising over the mesh band, back to 0 over the far band. */
  speckleWeight(distance: any): any;
  /** Opacity of the rock meshes at a camera distance (node): 1 near, 0 once the speckle has taken over. */
  meshOpacity(distance: any): any;
  /** Colour of one rock, and so of the speckle. */
  readonly rockAlbedo: any;
}

const smooth = (edge0: number, edge1: number, x: any): any => smoothstep(float(edge0), float(edge1), x);

/** The integer hash of `forestHash` on a fine cell, in TSL: a per-metre speckle pattern, not a lattice for placement. */
function speckleHash(ix: any, iy: any, iz: any): any {
  let h: any = ix
    .mul(uint(0x8da6b343))
    .bitXor(iy.mul(uint(0xd8163841)))
    .bitXor(iz.mul(uint(0xcb1ab31f)));
  h = h.bitXor(h.shiftRight(uint(13)));
  h = h.mul(uint(0x85ebca6b));
  h = h.bitXor(h.shiftRight(uint(16)));
  return float(h.shiftRight(uint(8))).div(16777216);
}

/**
 * Plan 063 spike S1, the rock class: the far form of the boulders, evaluated per pixel from the same rock field the
 * meshes are scattered from.
 *
 * - Mesh band: the meshes dissolve out over `meshStartM`..`meshEndM`, derived from the rock size; the speckle dissolves
 *   in over the same band.
 * - Speckle: the ground mixes toward the rock albedo by the field's coverage (`ROCK_COVER` x density), broken up by a
 *   per-metre hash so it reads as scattered grains rather than a tint, and roughens. Past `speckleStartM` it dissolves
 *   out again: under about a pixel there is nothing left to draw, so the far form is nothing.
 */
export function rockLayer(forest: IForestLayer, radiusM: number): IRockLayer {
  const bands = rockBands();
  const enabled: any = uniform(1);
  const meshStartM: any = uniform(bands.meshStartM);
  const meshEndM: any = uniform(bands.meshEndM);
  const speckleStartM: any = uniform(bands.speckleStartM);
  const speckleEndM: any = uniform(bands.speckleEndM);
  const rockAlbedo: any = uniform(new Vector3(0.11, 0.1, 0.09));
  const mode: any = forest.uniforms.mode;

  /** Layer weight against the mesh band, honouring the forest's view mode (1 meshes only, 2 layer only, 3 split). */
  const nearWeight = (distance: any): any =>
    select(
      mode.equal(1),
      float(0),
      select(mode.equal(2), float(1), select(mode.equal(3), splitLayerWeight(), smoothstep(meshStartM, meshEndM, distance))),
    );
  const farWeight = (distance: any): any => float(1).sub(smoothstep(speckleStartM, speckleEndM, distance));

  const density = (p: any, heightM: any): any => {
    let n: any = float(0);
    ROCK_OCTAVES.forEach((octave, i) => {
      n = n.add(noiseNode(p, octave.cellM, ROCK_OCTAVE_OFFSET + i).mul(octave.weight));
    });
    const land = smooth(FOREST_COAST_M[0], FOREST_COAST_M[1], heightM);
    const underForest = float(1).sub(fieldDensityNode(p, heightM).mul(1 - ROCK_UNDER_FOREST));
    return smooth(ROCK_EDGE[0], ROCK_EDGE[1], n).mul(land).mul(underForest).mul(forest.clearance(p));
  };

  const speckleWeight = (distance: any): any => nearWeight(distance).mul(farWeight(distance)).mul(enabled);
  const meshOpacity = (distance: any): any => float(1).sub(nearWeight(distance)).mul(enabled);

  const layer: SurfaceLayer = (context: IPlanetContext, below) => {
    const p = bodyFixed(context);
    const heightM = p.length().sub(radiusM);
    const cell: any = floor(p);
    const grain = speckleHash(uint(int(cell.x)), uint(int(cell.y)), uint(int(cell.z)));
    // Coverage with a hard-ish grain: a pixel is rock where its metre-cell draw falls under the coverage.
    const cover = density(p, heightM).mul(ROCK_COVER);
    const grains = smoothstep(grain.sub(0.06), grain.add(0.06), cover);
    const weight = grains.mul(speckleWeight(context.cameraDistance));
    const tone = mix(float(0.75), float(1.25), speckleHash(uint(int(cell.x.add(97))), uint(int(cell.y)), uint(int(cell.z))));
    return {
      ...below,
      albedo: mix(below.albedo, vec3(rockAlbedo).mul(tone), weight),
      roughness: mix(below.roughness, float(0.97), weight),
    };
  };

  return { layer, uniforms: { enabled, meshStartM, meshEndM, speckleStartM, speckleEndM }, speckleWeight, meshOpacity, rockAlbedo };
}
