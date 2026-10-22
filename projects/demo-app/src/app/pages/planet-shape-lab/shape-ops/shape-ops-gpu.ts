/* eslint-disable @typescript-eslint/no-explicit-any */
import { DataTexture, FloatType, NearestFilter, RGBAFormat, RedFormat, Vector3 } from 'three';
import {
  Continue, Fn, If, Loop, abs, atan, bitAnd, clamp, cross, dot, float, floor, int, ivec2, length, max, min, pow, select, shiftRight,
  smoothstep, sqrt, textureLoad, uniform,
} from 'three/tsl';
import { MIN_EDGE_M } from '../planet-shape-field';
import { buildShapeOpIndex, type ShapeOpIndex } from './op-index';
import { angleBetween, shapeOpSizeM, shapeOpsBounds, validateShapeOp, type AltitudeBand, type ShapeOp, type V3 } from './shape-op';

/**
 * Plan 055 Phase 1b: the shader twin of `compileShapeOps`. The ops, their path and tube segments and the op index's
 * per-tile lists are packed into float textures; a sample finds its tile from its up vector and applies that tile's
 * ops in order, so the cost follows the ops near the sample, not the length of the log.
 *
 * Positions are packed relative to an origin near the camera, in doubles, and the shader adds the small
 * camera-to-origin shift to its camera-relative point: an op stays precise near the camera on an Earth-size body.
 * Arcs are worked out from camera-relative differences too (see `arcTo`), never from two nearly equal unit vectors.
 */

/** Shape and blend codes as stored in the op texture. */
export const SHAPE_CODE: Readonly<Record<ShapeOp['shape']['kind'], number>> = { disc: 0, cone: 1, crater: 2, path: 3, sphere: 4, tube: 5 };
export const BLEND_CODE: Readonly<Record<ShapeOp['blend']['mode'], number>> = { add: 0, set: 1, raise: 2, lower: 3, scale: 4, union: 5, subtract: 6, grade: 7 };

/** All textures are this wide; an entry `i` sits at (i & (WIDTH - 1), i >> WIDTH_SHIFT). */
const WIDTH_SHIFT = 7;
const WIDTH = 1 << WIDTH_SHIFT;
const TEXELS_PER_OP = 4;
const TEXELS_PER_SEGMENT = 4;
/** Capacities: the textures are allocated once at these sizes. */
export const MAX_GPU_SHAPE_OPS = 4096;
export const MAX_GPU_SHAPE_SEGMENTS = 4096;
export const MAX_GPU_SHAPE_ENTRIES = 1 << 16;
/** Op index resolution: 6 * 32² tiles of about 2.8° (300 km on an Earth-size body). */
export const GPU_TILES_PER_FACE = 32;
/** `minVisibleSizeM` of ops that are never skipped. */
const NEVER_SKIP = 3e38;

/** The packed ops as shader inputs. */
export interface ShapeOpNodes {
  /** Applies the packed ops to a field value; `x` camera-relative, `up` the unit up vector there. */
  apply(value: any, x: any, up: any, altitude: any, footprint: any): any;
  /**
   * Distance (metres) from `x` to the nearest union shape not skipped at `footprint`, 1e30 if none: a march step past
   * it may miss the shape. The field alone does not bound it, since a volume op leaves the field untouched beyond 2k.
   */
  reach(x: any, footprint: any): any;
}

export interface ShapeOpTextures extends ShapeOpNodes {
  /**
   * Packs `ops` for a body of `radiusM` whose field (before the ops) lies within `base`. Throws on a malformed op or
   * when the capacities are exceeded.
   */
  setOps(ops: readonly ShapeOp[], radiusM: number, base: AltitudeBand): void;
  /** Call whenever the camera moves (body-relative, doubles); repacks only when it has moved far from the origin. */
  setCamera(camera: V3): void;
  /** The base band widened by every op's bounds: what the march must enclose. */
  readonly band: AltitudeBand;
  readonly index: ShapeOpIndex | undefined;
  dispose(): void;
}

function floatTexture(height: number, format: typeof RGBAFormat | typeof RedFormat): DataTexture {
  const data = new Float32Array(WIDTH * height * (format === RGBAFormat ? 4 : 1));
  const texture = new DataTexture(data, WIDTH, height, format, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Polynomial smooth maximum (nodes), as `smoothMax` in `shape-op.ts`. */
function smoothMaxNode(a: any, b: any, k: any): any {
  const h = clamp(float(0.5).add(b.sub(a).mul(0.5).div(k)), 0, 1);
  return a.add(b.sub(a).mul(h)).add(k.mul(h).mul(float(1).sub(h)));
}

function smoothMinNode(a: any, b: any, k: any): any {
  return smoothMaxNode(a.negate(), b.negate(), k).negate();
}

export function createShapeOpTextures(): ShapeOpTextures {
  const opTexture = floatTexture((MAX_GPU_SHAPE_OPS * TEXELS_PER_OP) / WIDTH, RGBAFormat);
  const segmentTexture = floatTexture((MAX_GPU_SHAPE_SEGMENTS * TEXELS_PER_SEGMENT) / WIDTH, RGBAFormat);
  const tileCount = 6 * GPU_TILES_PER_FACE * GPU_TILES_PER_FACE;
  const tileTexture = floatTexture(Math.ceil(tileCount / WIDTH), RGBAFormat);
  const listTexture = floatTexture(MAX_GPU_SHAPE_ENTRIES / WIDTH, RedFormat);
  /** Camera minus the packing origin (metres, small). */
  const uShift = uniform(new Vector3()) as any;
  const uRadius = uniform(1) as any;
  /** The union ops, listed after the tiles' entries: where the list starts and how long it is. */
  const uUnionFirst = uniform(0, 'int') as any;
  const uUnionCount = uniform(0, 'int') as any;

  let ops: readonly ShapeOp[] = [];
  let radius = 1;
  let origin: V3 = [0, 0, 0];
  let band: AltitudeBand = { bottomM: 0, topM: 0 };
  let index: ShapeOpIndex | undefined;

  const load = (texture: DataTexture, i: any): any => textureLoad(texture, ivec2(bitAnd(i, int(WIDTH - 1)), shiftRight(i, int(WIDTH_SHIFT))), int(0));

  /** Tile of a unit direction, as `buildShapeOpIndex`'s `tileOf`. */
  const tileOf = (d: any): any => {
    const a = (abs(d) as any).toVar();
    const axis = select(a.x.greaterThanEqual(a.y).and(a.x.greaterThanEqual(a.z)), int(0), select(a.y.greaterThanEqual(a.z), int(1), int(2))).toVar();
    const major = select(axis.equal(0), d.x, select(axis.equal(1), d.y, d.z)).toVar();
    const u = select(axis.equal(0), d.y, select(axis.equal(1), d.z, d.x)).div(abs(major));
    const v = select(axis.equal(0), d.z, select(axis.equal(1), d.x, d.y)).div(abs(major));
    const n = GPU_TILES_PER_FACE;
    const cell = (s: any): any => int(clamp(floor(s.add(1).mul(0.5 * n)), 0, n - 1));
    const face = axis.mul(2).add(select(major.greaterThanEqual(0), int(0), int(1)));
    return face.mul(n * n).add(cell(v).mul(n)).add(cell(u));
  };

  /**
   * Angle (radians) between the point `P` (at distance `lenP` from the body centre, unit `up`) and the point `P + D`:
   * the angle between `P` and `P + D` from their cross and dot products divided by `|P|`, which only ever multiply
   * `up` with the small difference `D`.
   */
  const arcTo = (D: any, up: any, lenP: any): any => atan(length(cross(up, D)), lenP.add(dot(up, D)));

  /** Distance from `p` to the straight segment `a`..`b`. */
  const segmentDistance = (p: any, a: any, b: any): any => {
    const ab = b.sub(a).toVar();
    const ap = p.sub(a).toVar();
    const t = clamp(dot(ap, ab).div(max(dot(ab, ab), float(1e-30))), 0, 1);
    return length(ap.sub(ab.mul(t)));
  };

  /** Signed distance from `y` (origin-relative) to a sphere or tube op (header texels `h0`, `h1`, `h3`). */
  const volumeDistance = (y: any, shape: any, h0: any, h1: any, h3: any): any => {
    const distance = float(0).toVar();
    If(shape.equal(SHAPE_CODE.sphere), () => {
      distance.assign(length(y.sub(h0.xyz)).sub(h1.x));
    }).Else(() => {
      const best = float(1e30).toVar();
      const segment0 = int(h3.x).toVar();
      Loop({ start: int(0), end: int(h3.y), type: 'int', condition: '<', name: 's' } as any, ({ s }: any) => {
        const at = segment0.add(s).mul(TEXELS_PER_SEGMENT).toVar();
        best.assign(min(best, segmentDistance(y, load(segmentTexture, at).xyz, load(segmentTexture, at.add(1)).xyz)));
      });
      distance.assign(best.sub(h1.x));
    });
    return distance;
  };

  const reachFn = Fn(([x, footprint]: any[]) => {
    const y = x.add(uShift).toVar();
    const nearest = float(1e30).toVar();
    Loop({ start: int(0), end: uUnionCount, type: 'int', condition: '<', name: 'n' } as any, ({ n }: any) => {
      const op = int(load(listTexture, uUnionFirst.add(n)).x).mul(TEXELS_PER_OP).toVar();
      const h2 = load(opTexture, op.add(2)).toVar();
      If(footprint.greaterThan(h2.w), () => { Continue(); });
      const h0 = load(opTexture, op).toVar();
      nearest.assign(min(nearest, volumeDistance(y, int(h0.w), h0, load(opTexture, op.add(1)), load(opTexture, op.add(3)))));
    });
    return nearest;
  });

  const applyFn = Fn(([value0, x, up, altitude, footprint]: any[]) => {
    const value = float(value0).toVar();
    const y = x.add(uShift).toVar();
    const lenP = uRadius.add(altitude).toVar();
    const tile = load(tileTexture, tileOf(up)).toVar();
    const first = int(tile.x).toVar();
    Loop({ start: int(0), end: int(tile.y), type: 'int', condition: '<', name: 'n' } as any, ({ n }: any) => {
      const op = int(load(listTexture, first.add(n)).x).mul(TEXELS_PER_OP).toVar();
      const h0 = load(opTexture, op).toVar();
      const h1 = load(opTexture, op.add(1)).toVar();
      const h2 = load(opTexture, op.add(2)).toVar();
      const h3 = load(opTexture, op.add(3)).toVar();
      If(footprint.greaterThan(h2.w), () => { Continue(); });
      const shape = int(h0.w).toVar();
      const blend = int(h1.w).toVar();
      If(shape.greaterThanEqual(SHAPE_CODE.sphere), () => {
        // Volume ops: a signed distance, combined smoothly and faded out between k and 2k (see `shape-op.ts`).
        const distance = volumeDistance(y, shape, h0, h1, h3);
        const k = h2.z;
        If(distance.lessThan(k.mul(2)), () => {
          const combined = select(blend.equal(BLEND_CODE.union), smoothMinNode(value, distance, k), smoothMaxNode(value, distance.negate(), k)).toVar();
          value.assign(select(distance.lessThanEqual(k), combined, combined.add(value.sub(combined).mul(smoothstep(k, k.mul(2), distance)))));
        });
      }).Else(() => {
        // Height ops: a profile (height, weight, metres beyond the core) from the arc to the shape, then the blend.
        const height = float(0).toVar();
        const weight = float(0).toVar();
        const beyond = float(0).toVar();
        const edge = h1.y;
        If(shape.equal(SHAPE_CODE.path), () => {
          const best = float(1e30).toVar();
          const segment0 = int(h3.x).toVar();
          Loop({ start: int(0), end: int(h3.y), type: 'int', condition: '<', name: 's' } as any, ({ s }: any) => {
            const at = segment0.add(s).mul(TEXELS_PER_SEGMENT).toVar();
            const s0 = load(segmentTexture, at).toVar();
            const s1 = load(segmentTexture, at.add(1)).toVar();
            const s2 = load(segmentTexture, at.add(2)).toVar();
            const s3 = load(segmentTexture, at.add(3)).toVar();
            const fromA = y.sub(s0.xyz).toVar();
            // Signed angle along the great circle from `a` to the foot of the point (around the circle's normal). The CPU
            // also requires the foot not to be antipodal; a point in a tile that lists the path never is.
            const along = atan(dot(cross(s3.xyz, fromA), s2.xyz), s3.w.add(dot(s3.xyz, fromA))).toVar();
            const angle = float(0).toVar();
            const t = float(0).toVar();
            If(along.greaterThanEqual(0).and(along.lessThanEqual(s2.w)), () => {
              // asin(sin), as atan: some GPUs' asin is a few per cent off at small angles (seen: 0.00206 for 0.002).
              const sine = min(float(1), abs(dot(fromA, s2.xyz)).div(lenP)).toVar();
              angle.assign(atan(sine, sqrt(max(float(1).sub(sine.mul(sine)), float(0)))));
              t.assign(select(s2.w.greaterThan(0), min(float(1), along.div(s2.w)), float(0)));
            }).Else(() => {
              const toA = arcTo(s0.xyz.sub(y), up, lenP).toVar();
              const toB = arcTo(s1.xyz.sub(y), up, lenP).toVar();
              angle.assign(min(toA, toB));
              t.assign(select(toA.lessThanEqual(toB), float(0), float(1)));
            });
            If(angle.lessThan(best), () => {
              best.assign(angle);
              height.assign(s0.w.add(s1.w.sub(s0.w).mul(t)));
            });
          });
          const r = best.mul(uRadius).toVar();
          const half = h1.x;
          height.assign(select(h2.x.greaterThan(0.5), height.mul(float(1).sub(smoothstep(float(0), half.add(edge), r))), height));
          weight.assign(float(1).sub(smoothstep(half, half.add(edge), r)));
          beyond.assign(max(r.sub(half), float(0)));
        }).Else(() => {
          const r = arcTo(h0.xyz.sub(y), up, lenP).mul(uRadius).toVar();
          const radiusM = h1.x;
          If(shape.equal(SHAPE_CODE.disc), () => {
            height.assign(h1.z);
            weight.assign(float(1).sub(smoothstep(radiusM, radiusM.add(edge), r)));
            beyond.assign(max(r.sub(radiusM), float(0)));
          }).ElseIf(shape.equal(SHAPE_CODE.cone), () => {
            height.assign(h1.z.mul(pow(float(1).sub(smoothstep(float(0), radiusM, r)), h2.x)));
            weight.assign(float(1).sub(smoothstep(radiusM, radiusM.add(edge), r)));
            beyond.assign(max(r.sub(radiusM), float(0)));
          }).Else(() => {
            // Crater: h1.z depth, h2.x rim height, h2.y rim width.
            const outer = radiusM.add(h2.y).toVar();
            const s = r.div(radiusM);
            height.assign(select(
              r.lessThan(radiusM),
              h1.z.negate().add(h1.z.add(h2.x).mul(s).mul(s)),
              h2.x.mul(float(1).sub(smoothstep(radiusM, outer, r))),
            ));
            weight.assign(float(1).sub(smoothstep(outer, outer.add(edge), r)));
            beyond.assign(max(r.sub(outer), float(0)));
          });
        });
        const k = h2.z;
        If(blend.equal(BLEND_CODE.grade), () => {
          // Banks of slope k from the profile's level, outside the weight too (see `shape-op.ts`).
          const level = altitude.sub(height).toVar();
          value.assign(max(min(value, level.add(k.mul(beyond))), level.sub(k.mul(beyond))));
        }).ElseIf(weight.greaterThan(0), () => {
          const target = altitude.sub(height).toVar();
          If(blend.equal(BLEND_CODE.add), () => {
            value.assign(value.sub(height.mul(weight)));
          }).ElseIf(blend.equal(BLEND_CODE.set), () => {
            value.assign(value.add(target.sub(value).mul(weight)));
          }).ElseIf(blend.equal(BLEND_CODE.raise), () => {
            value.assign(value.add(smoothMinNode(value, target, k).sub(value).mul(weight)));
          }).ElseIf(blend.equal(BLEND_CODE.lower), () => {
            value.assign(value.add(smoothMaxNode(value, target, k).sub(value).mul(weight)));
          }).Else(() => {
            value.assign(altitude.add(value.sub(altitude).mul(float(1).add(k.sub(1).mul(weight)))));
          });
        });
      });
    });
    return value;
  });

  /** Writes positions relative to `origin` (doubles in, float32 out). */
  const packPositions = () => {
    const opData = opTexture.image.data as Float32Array;
    const segmentData = segmentTexture.image.data as Float32Array;
    let segment = 0;
    ops.forEach((op, i) => {
      const at = i * TEXELS_PER_OP * 4;
      const shape = op.shape;
      if (shape.kind === 'path' || shape.kind === 'tube') {
        const points = shape.points;
        const heights = shape.kind === 'path' ? shape.heightsM ?? points.map(() => 0) : undefined;
        for (let s = 1; s < points.length; s++, segment++) {
          const a = points[s - 1];
          const b = points[s];
          const o = segment * TEXELS_PER_SEGMENT * 4;
          segmentData.set([a[0] - origin[0], a[1] - origin[1], a[2] - origin[2], heights ? heights[s - 1] : 0], o);
          segmentData.set([b[0] - origin[0], b[1] - origin[1], b[2] - origin[2], heights ? heights[s] : 0], o + 4);
          if (shape.kind === 'path') {
            const lengthA = Math.hypot(a[0], a[1], a[2]);
            const lengthB = Math.hypot(b[0], b[1], b[2]);
            const da: V3 = [a[0] / lengthA, a[1] / lengthA, a[2] / lengthA];
            const db: V3 = [b[0] / lengthB, b[1] / lengthB, b[2] / lengthB];
            const c = [da[1] * db[2] - da[2] * db[1], da[2] * db[0] - da[0] * db[2], da[0] * db[1] - da[1] * db[0]];
            const cl = Math.hypot(c[0], c[1], c[2]);
            segmentData.set([c[0] / cl, c[1] / cl, c[2] / cl, angleBetween(da, db)], o + 8);
            segmentData.set([da[0], da[1], da[2], lengthA], o + 12);
          }
        }
      } else {
        opData[at] = shape.centre[0] - origin[0];
        opData[at + 1] = shape.centre[1] - origin[1];
        opData[at + 2] = shape.centre[2] - origin[2];
      }
    });
    opTexture.needsUpdate = true;
    segmentTexture.needsUpdate = true;
  };

  const packOps = () => {
    const opData = opTexture.image.data as Float32Array;
    let segment = 0;
    ops.forEach((op, i) => {
      const at = i * TEXELS_PER_OP * 4;
      const shape = op.shape;
      const fidelity = op.fidelity ?? 'relaxed';
      const minVisible = fidelity === 'contact' || fidelity === 'topology' ? NEVER_SKIP : op.minVisibleSizeM ?? shapeOpSizeM(op);
      const blend = op.blend;
      const blendParam = blend.mode === 'scale' ? blend.factor : blend.mode === 'grade' ? blend.slope ?? 1
        : blend.mode === 'add' || blend.mode === 'set' ? 0 : Math.max(blend.smoothM ?? 0, MIN_EDGE_M);
      const edge = shape.kind === 'sphere' || shape.kind === 'tube' ? 0 : Math.max(shape.edgeM ?? 0, MIN_EDGE_M);
      let h1: number[] = [0, 0, 0];
      let h2xy: number[] = [0, 0];
      switch (shape.kind) {
        case 'disc': h1 = [shape.radiusM, edge, shape.heightM ?? 0]; break;
        case 'cone': h1 = [shape.radiusM, edge, shape.heightM]; h2xy = [shape.sharpness ?? 1, 0]; break;
        case 'crater': h1 = [shape.radiusM, edge, shape.depthM]; h2xy = [shape.rimHeightM, shape.rimWidthM]; break;
        case 'path': h1 = [shape.widthM / 2, edge, 0]; h2xy = [shape.profile === 'round' ? 1 : 0, 0]; break;
        case 'sphere':
        case 'tube': h1 = [shape.radiusM, 0, 0]; break;
      }
      const segments = shape.kind === 'path' || shape.kind === 'tube' ? shape.points.length - 1 : 0;
      opData[at + 3] = SHAPE_CODE[shape.kind];
      opData.set([...h1, BLEND_CODE[blend.mode]], at + 4);
      opData.set([...h2xy, blendParam, minVisible], at + 8);
      opData.set([segment, segments, 0, 0], at + 12);
      segment += segments;
    });
    packPositions();
  };

  return {
    apply: (value, x, up, altitude, footprint) => applyFn(value, x, up, altitude, footprint),
    reach: (x, footprint) => reachFn(x, footprint),
    setOps(next, radiusM, base) {
      next.forEach(validateShapeOp);
      if (next.length > MAX_GPU_SHAPE_OPS) throw new Error(`At most ${MAX_GPU_SHAPE_OPS} shape ops on the GPU`);
      const segments = next.reduce((sum, op) => sum + (op.shape.kind === 'path' || op.shape.kind === 'tube' ? op.shape.points.length - 1 : 0), 0);
      if (segments > MAX_GPU_SHAPE_SEGMENTS) throw new Error(`At most ${MAX_GPU_SHAPE_SEGMENTS} path and tube segments on the GPU`);
      const built = buildShapeOpIndex(shapeOpsBounds(next, radiusM, base), base, GPU_TILES_PER_FACE);
      const unions = next.flatMap((op, i) => (op.blend.mode === 'union' ? [i] : []));
      if (built.stats.entries + unions.length > MAX_GPU_SHAPE_ENTRIES) throw new Error(`At most ${MAX_GPU_SHAPE_ENTRIES} op index entries on the GPU`);
      ops = next;
      radius = radiusM;
      uRadius.value = radiusM;
      index = built;
      const tileData = tileTexture.image.data as Float32Array;
      const listData = listTexture.image.data as Float32Array;
      let entry = 0;
      let bottom = base.bottomM;
      let top = base.topM;
      for (let tile = 0; tile < tileCount; tile++) {
        const list = built.opsInTile(tile);
        const tileBand = built.bandInTile(tile);
        tileData.set([entry, list.length, tileBand.bottomM, tileBand.topM], tile * 4);
        listData.set(list, entry);
        entry += list.length;
        bottom = Math.min(bottom, tileBand.bottomM);
        top = Math.max(top, tileBand.topM);
      }
      listData.set(unions, entry);
      uUnionFirst.value = entry;
      uUnionCount.value = unions.length;
      band = { bottomM: bottom, topM: top };
      tileTexture.needsUpdate = true;
      listTexture.needsUpdate = true;
      packOps();
    },
    setCamera(camera) {
      // Repack when the camera is far from the origin: the shift stays small next to the distances that matter there.
      const moved = Math.hypot(camera[0] - origin[0], camera[1] - origin[1], camera[2] - origin[2]);
      const altitude = Math.max(Math.hypot(camera[0], camera[1], camera[2]) - radius, 0);
      if (moved > Math.max(1000, altitude * 0.1)) {
        origin = [camera[0], camera[1], camera[2]];
        packPositions();
      }
      uShift.value.set(camera[0] - origin[0], camera[1] - origin[1], camera[2] - origin[2]);
    },
    get band() { return band; },
    get index() { return index; },
    dispose() {
      for (const texture of [opTexture, segmentTexture, tileTexture, listTexture]) texture.dispose();
    },
  };
}

