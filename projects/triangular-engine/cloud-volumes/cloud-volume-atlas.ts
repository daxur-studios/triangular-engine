import { Vector2 } from 'three';
import { clamp, floor, mix, mod, texture, vec2 } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A cubic volume of `size^3` texels stored as a 2D atlas of `size` square slices (Plan 051, Phase 1).
 *
 * Slices tile left to right, then top to bottom, so a 128^3 volume is a 2048 x 1024 texture (16384 wide would
 * exceed some WebGL2 limits). A 2D target is written with the same fragment passes on WebGPU and on the WebGL2
 * fallback; a `RenderTarget3D` is not needed. Reads filter bilinearly inside a slice and blend the two nearest
 * slices by hand.
 */
export class CloudVolumeAtlasLayout {
  readonly columns: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;

  constructor(readonly size: number) {
    this.columns = Math.min(size, 16);
    this.rows = Math.ceil(size / this.columns);
    this.width = this.columns * size;
    this.height = this.rows * size;
  }

  /** Atlas pixel of texel `(x, y)` in slice `z`, for CPU readback. */
  pixelOf(x: number, y: number, z: number): Vector2 {
    return new Vector2((z % this.columns) * this.size + x, Math.floor(z / this.columns) * this.size + y);
  }

  /** Atlas uv of the continuous in-slice position `(x, y)` texels in slice `z`. */
  private tapUv(x: any, y: any, z: any): any {
    const col = mod(z, this.columns);
    const row = floor(z.div(this.columns));
    return vec2(col.mul(this.size).add(x).div(this.width), row.mul(this.size).add(y).div(this.height));
  }

  /** Trilinear read of the red channel at unit-frame position `p` (vec3 node, `[0, 1]^3`). */
  sample(map: any, p: any): any {
    const n = this.size;
    const zf = clamp(p.z.mul(n).sub(0.5), 0, n - 1);
    const z0 = floor(zf);
    const z1 = clamp(z0.add(1), 0, n - 1);
    const f = zf.sub(z0);
    const x = clamp(p.x, 0.5 / n, 1 - 0.5 / n).mul(n);
    const y = clamp(p.y, 0.5 / n, 1 - 0.5 / n).mul(n);
    const a = texture(map, this.tapUv(x, y, z0), 0).r;
    const b = texture(map, this.tapUv(x, y, z1), 0).r;
    return mix(a, b, f);
  }
}
