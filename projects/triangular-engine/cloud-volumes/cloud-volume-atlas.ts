import { Vector2 } from 'three';
import { clamp, dot, float, floor, min, mod, select, texture, vec2, vec4 } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A cubic volume of `size^3` texels stored as a packed 2D atlas (Plan 051, Phase 1, packed in Phase 2b step 1).
 *
 * Each atlas cell is one `size x size` slice-group and holds four consecutive z slices in its R, G, B and A channels.
 * Groups advance by three slices, so slice `3g + 3` is stored twice (as channel 3 of group `g` and channel 0 of group
 * `g + 1`). Any pair of neighbouring slices `(z, z + 1)` therefore sits in one texel of one group, and a trilinear
 * read is a single hardware-bilinear fetch plus a channel blend, where the unpacked layout needed two fetches.
 *
 * Groups tile left to right, then top to bottom, so a 128^3 volume is a 1024 x 768 texture (a very wide row would
 * exceed some WebGL2 limits). A 2D target is written with the same fragment passes on WebGPU and on the WebGL2
 * fallback; a `RenderTarget3D` is not needed.
 */
export class CloudVolumeAtlasLayout {
  /** Slices advanced per group. */
  static readonly STRIDE = 3;

  readonly groups: number;
  readonly columns: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;

  constructor(readonly size: number) {
    this.groups = Math.ceil((size - 1) / CloudVolumeAtlasLayout.STRIDE);
    this.columns = Math.min(this.groups, 8);
    this.rows = Math.ceil(this.groups / this.columns);
    this.width = this.columns * size;
    this.height = this.rows * size;
  }

  /** The group and channel that hold slice `z` for readback (the lower group when two hold it). */
  slotOf(z: number): { group: number; channel: number } {
    const group = Math.min(Math.floor(z / CloudVolumeAtlasLayout.STRIDE), this.groups - 1);
    return { group, channel: z - group * CloudVolumeAtlasLayout.STRIDE };
  }

  /** Atlas pixel of texel `(x, y)` in slice `z`, for CPU readback. Pair it with {@link slotOf} for the channel. */
  pixelOf(x: number, y: number, z: number): Vector2 {
    const { group } = this.slotOf(z);
    return new Vector2((group % this.columns) * this.size + x, Math.floor(group / this.columns) * this.size + y);
  }

  /** Atlas uv of the continuous in-slice position `(x, y)` texels in group `g`. */
  private tapUv(x: any, y: any, g: any): any {
    const col = mod(g, this.columns);
    const row = floor(g.div(this.columns));
    return vec2(col.mul(this.size).add(x).div(this.width), row.mul(this.size).add(y).div(this.height));
  }

  /** Trilinear read of the packed value at unit-frame position `p` (vec3 node, `[0, 1]^3`). One texture fetch. */
  sample(map: any, p: any): any {
    const n = this.size;
    const zf = clamp(p.z.mul(n).sub(0.5), 0, n - 1);
    const z0 = min(floor(zf), n - 2);
    const f = zf.sub(z0);
    const g = floor(z0.div(CloudVolumeAtlasLayout.STRIDE));
    const r = z0.sub(g.mul(CloudVolumeAtlasLayout.STRIDE));
    const x = clamp(p.x, 0.5 / n, 1 - 0.5 / n).mul(n);
    const y = clamp(p.y, 0.5 / n, 1 - 0.5 / n).mul(n);
    const t = texture(map, this.tapUv(x, y, g), 0);
    const one = (k: number) => select(r.equal(k), float(1).sub(f), select(r.equal(k - 1), f, float(0)));
    return dot(t, vec4(one(0), one(1), one(2), one(3)));
  }
}
