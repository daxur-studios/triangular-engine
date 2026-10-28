import { float, floor, int, mix, smoothstep, uint, vec3 } from 'three/tsl';
import type { IScatterDensityFieldDefinition, IScatterHeightBand } from 'triangular-engine/scatter';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * `hashScatterLattice01` in TSL: the same constants and the same 32-bit
 * wrap-around. `ix`, `iy`, `iz` are `uint` nodes (a negative `int` cast to
 * `uint` keeps its bits, as `Math.imul` does on the CPU).
 */
export function scatterLatticeHashNode(ix: any, iy: any, iz: any): any {
  let h: any = ix
    .mul(uint(0x8da6b343))
    .bitXor(iy.mul(uint(0xd8163841)))
    .bitXor(iz.mul(uint(0xcb1ab31f)));
  h = h.bitXor(h.shiftRight(uint(13)));
  h = h.mul(uint(0x85ebca6b));
  h = h.bitXor(h.shiftRight(uint(16)));
  return float(h.shiftRight(uint(8))).div(16777216);
}

/** `scatterValueNoise3` in TSL. `p` is a vec3 node of body-fixed metres. */
export function scatterValueNoiseNode(p: any, cellM: number, octave: number): any {
  const o = octave * 1013.7;
  const q = vec3(p.x.add(o), p.y.add(o * 0.7), p.z.add(o * 1.3)).div(cellM);
  const f = floor(q);
  const t = q.sub(f);
  const s = t.mul(t).mul(vec3(3, 3, 3).sub(t.mul(2)));
  const ix = uint(int(f.x));
  const iy = uint(int(f.y));
  const iz = uint(int(f.z));
  const corner = (dx: number, dy: number, dz: number) =>
    scatterLatticeHashNode(ix.add(uint(dx)), iy.add(uint(dy)), iz.add(uint(dz)));
  return mix(
    mix(mix(corner(0, 0, 0), corner(1, 0, 0), s.x), mix(corner(0, 1, 0), corner(1, 1, 0), s.x), s.y),
    mix(mix(corner(0, 0, 1), corner(1, 0, 1), s.x), mix(corner(0, 1, 1), corner(1, 1, 1), s.x), s.y),
    s.z,
  );
}

/** `evaluateScatterDensityNoise` in TSL: the weighted octave sum, before the edge and height band. */
export function scatterDensityNoiseNode(definition: IScatterDensityFieldDefinition, p: any): any {
  const offset = definition.octaveOffset ?? 0;
  let n: any = float(0);
  definition.octaves.forEach((octave, i) => {
    n = n.add(scatterValueNoiseNode(p, octave.cellM, offset + i).mul(octave.weight));
  });
  return n;
}

/** `evaluateScatterHeightBand` in TSL; `heightM` is a float node. */
export function scatterHeightBandNode(band: IScatterHeightBand | undefined, heightM: any): any {
  if (!band) return float(1);
  const rise: any = smoothstep(float(band.rise[0]), float(band.rise[1]), heightM);
  return band.fall ? rise.mul(float(1).sub(smoothstep(float(band.fall[0]), float(band.fall[1]), heightM))) : rise;
}

/**
 * `evaluateScatterDensityField` in TSL: the same field the CPU scatter places
 * instances from, for a surface material's far form. `p` is a vec3 node of
 * body-fixed metres and `heightM` a float node of height above the datum.
 * The definition is baked into the graph: changing it means a new node.
 */
export function scatterDensityFieldNode(definition: IScatterDensityFieldDefinition, p: any, heightM: any): any {
  const n = scatterDensityNoiseNode(definition, p);
  return smoothstep(float(definition.edge[0]), float(definition.edge[1]), n).mul(
    scatterHeightBandNode(definition.heightBandM, heightM),
  );
}
