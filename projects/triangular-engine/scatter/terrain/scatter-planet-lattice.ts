import { hashScatterLatticeCell01 } from '../core/scatter-lattice-hash';
import { composeScatterInstanceId, type ScatterInstanceId } from '../core/scatter-instance-id';

/**
 * Planet shell lattice: the second scatter domain beside the terrain
 * quadtree (`selectFixedLevelScatterCells`). The quadtree's cells are a
 * level, not metres, and change size across a cube-sphere face; this domain
 * is a fixed 3-D body-fixed lattice with a cell size in metres, the same on
 * every part of the sphere and with no face seams.
 *
 * Every lattice cell owns one jittered candidate point. The cells that count
 * are those whose point lies in the one-cell shell `[R, R + cellSizeM)` above
 * the datum sphere, so there is about one candidate per `cellSizeM²` of
 * surface. A candidate is projected to the ground, kept when the layer's
 * density beats the cell's own draw, and gets its yaw and size from the
 * cell's own hash. The request window only selects which cells are emitted:
 * nothing depends on the camera, the window centre or size, or the request
 * order, so a place always holds the same object (as colliders and
 * persistence need).
 */

export type ScatterPlanetVector3 = readonly [number, number, number];

/** Density in [0, 1] at a ground point: `pointM` is body-fixed metres, `heightM` above the datum, `direction` the unit direction. */
export type ScatterPlanetDensityFn = (pointM: ScatterPlanetVector3, heightM: number, direction: ScatterPlanetVector3) => number;

/** One object class on the planet shell lattice (for example trees or rocks). */
export interface IScatterPlanetLayerDefinition {
  /** Layer id; also the species id of its instance ids. */
  readonly id: string;
  /** Bumping this changes every instance id of the layer (a breaking regeneration). */
  readonly generatorVersion: number;
  /**
   * Integer seed of the layer's draws. Layers with different seeds draw
   * independently from the same lattice. Each seed uses salts `seed × 8` to
   * `seed × 8 + 5`.
   */
  readonly seed: number;
  /** Lattice cell size in metres: at most one instance per cell. */
  readonly cellSizeM: number;
  /** Uniform instance scale, drawn per cell between `[min, max]`. For a unit-size asset this is its size in metres. */
  readonly sizeRange: readonly [number, number];
  /** Keep probability at a ground point; build it from `evaluateScatterDensityField` to share it with the far form. */
  readonly density: ScatterPlanetDensityFn;
}

/** One request: which part of the lattice to emit and the ground under it. */
export interface IScatterPlanetLatticeOptions {
  /** Unit direction of the window centre, body-fixed. */
  readonly centre: ScatterPlanetVector3;
  /** Datum radius in metres. */
  readonly radiusM: number;
  /** Window radius in metres along the datum sphere (see `computeScatterWindowRadiusM`). */
  readonly windowRadiusM: number;
  /**
   * Instance buffer size. When the window holds more, the nearest `maxCount`
   * are kept, so a short buffer loses the far edge, never a row.
   */
  readonly maxCount?: number;
  /**
   * Ground height above the datum in metres at a unit direction, or `null`
   * where nothing may stand (water, ice). Usually the planet's height sampler
   * in a worker. Up is radial on this path: slope rules are not applied.
   */
  heightAt(direction: ScatterPlanetVector3): number | null;
}

/**
 * Instances of one request, nearest first, in transferable arrays. Positions
 * are float32 offsets from `originM` (the datum point under the window
 * centre, float64), so they stay precise at planet scale.
 */
export interface IScatterPlanetLatticeResult {
  readonly originM: ScatterPlanetVector3;
  /** Ground point of each instance minus `originM`, metres (x, y, z per instance). */
  readonly offsetsM: Float32Array;
  /** Yaw around the radial up, in [0, 1) of a full turn. */
  readonly yaw01: Float32Array;
  /** Uniform scale within the layer's `sizeRange`. */
  readonly scale: Float32Array;
  /** Lattice cell of each instance (ix, iy, iz per instance): its identity, see {@link composeScatterPlanetInstanceId}. */
  readonly cells: Int32Array;
  /** Cells that passed the density test, before `maxCount` cut the farthest. */
  readonly accepted: number;
}

/** Salt of draw `k` of a layer. */
const salt = (seed: number, k: number): number => seed * 8 + k;

/**
 * Emits the layer's instances inside a window of the planet shell lattice.
 * See the file comment for the guarantees.
 */
export function scatterPlanetLattice(
  layer: IScatterPlanetLayerDefinition,
  options: IScatterPlanetLatticeOptions,
): IScatterPlanetLatticeResult {
  const { centre, radiusM: R, windowRadiusM } = options;
  const S = layer.cellSizeM;
  if (
    !(S > 0) ||
    !(R > S) ||
    !(windowRadiusM >= 0) ||
    !Number.isInteger(layer.seed) ||
    !(layer.sizeRange[1] >= layer.sizeRange[0])
  ) {
    throw new RangeError('Planet scatter layer or options are invalid.');
  }
  const a2 = windowRadiusM * windowRadiusM;
  // Iterate the two body axes other than the centre's dominant one; solve the third from the shell.
  const ax = Math.abs(centre[0]);
  const ay = Math.abs(centre[1]);
  const az = Math.abs(centre[2]);
  const k = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  const u = (k + 1) % 3;
  const v = (k + 2) % 3;
  const sign = centre[k] >= 0 ? 1 : -1;
  const origin: ScatterPlanetVector3 = [centre[0] * R, centre[1] * R, centre[2] * R];
  const cell = [0, 0, 0];
  const found: number[] = [];
  const cellsFound: number[] = [];
  const arcs: number[] = [];
  const [sizeMin, sizeMax] = layer.sizeRange;
  const iuMin = Math.floor((origin[u] - windowRadiusM) / S);
  const iuMax = Math.floor((origin[u] + windowRadiusM) / S);
  const ivMin = Math.floor((origin[v] - windowRadiusM) / S);
  const ivMax = Math.floor((origin[v] + windowRadiusM) / S);
  for (let iu = iuMin; iu <= iuMax; iu++) {
    for (let iv = ivMin; iv <= ivMax; iv++) {
      // Where along the dominant axis the shell can be for this column of cells (padded for the sphere's slope).
      const pu = (iu + 0.5) * S;
      const pv = (iv + 0.5) * S;
      const rest = pu * pu + pv * pv;
      const innerSq = R * R - rest;
      const outerSq = (R + S) * (R + S) - rest;
      if (outerSq <= 0) continue;
      const a = Math.sqrt(Math.max(innerSq, 0));
      const b = Math.sqrt(outerSq);
      const from = sign > 0 ? a - 2 * S : -b - 2 * S;
      const to = sign > 0 ? b + 2 * S : -a + 2 * S;
      for (let ik = Math.floor(from / S); ik <= Math.floor(to / S); ik++) {
        cell[k] = ik;
        cell[u] = iu;
        cell[v] = iv;
        const [cx, cy, cz] = cell;
        const px = (cx + hashScatterLatticeCell01(cx, cy, cz, salt(layer.seed, 0))) * S;
        const py = (cy + hashScatterLatticeCell01(cx, cy, cz, salt(layer.seed, 1))) * S;
        const pz = (cz + hashScatterLatticeCell01(cx, cy, cz, salt(layer.seed, 2))) * S;
        const r = Math.hypot(px, py, pz);
        if (r < R || r >= R + S) continue;
        const direction: ScatterPlanetVector3 = [px / r, py / r, pz / r];
        const cosine = direction[0] * centre[0] + direction[1] * centre[1] + direction[2] * centre[2];
        const arc = R * Math.acos(Math.min(cosine, 1));
        if (arc * arc > a2) continue;
        const heightM = options.heightAt(direction);
        if (heightM === null) continue;
        const ground = R + heightM;
        const point: ScatterPlanetVector3 = [direction[0] * ground, direction[1] * ground, direction[2] * ground];
        if (hashScatterLatticeCell01(cx, cy, cz, salt(layer.seed, 3)) >= layer.density(point, heightM, direction)) continue;
        const sizeDraw = hashScatterLatticeCell01(cx, cy, cz, salt(layer.seed, 5));
        found.push(
          point[0] - origin[0],
          point[1] - origin[1],
          point[2] - origin[2],
          hashScatterLatticeCell01(cx, cy, cz, salt(layer.seed, 4)),
          sizeMin + sizeDraw * (sizeMax - sizeMin),
        );
        cellsFound.push(cx, cy, cz);
        arcs.push(arc);
      }
    }
  }
  const accepted = arcs.length;
  const keep = Math.min(accepted, options.maxCount ?? accepted);
  const order = arcs
    .map((_, i) => i)
    .sort((p, q) => arcs[p] - arcs[q])
    .slice(0, keep);
  const offsetsM = new Float32Array(keep * 3);
  const yaw01 = new Float32Array(keep);
  const scale = new Float32Array(keep);
  const cells = new Int32Array(keep * 3);
  order.forEach((from, to) => {
    offsetsM[to * 3] = found[from * 5];
    offsetsM[to * 3 + 1] = found[from * 5 + 1];
    offsetsM[to * 3 + 2] = found[from * 5 + 2];
    yaw01[to] = found[from * 5 + 3];
    scale[to] = found[from * 5 + 4];
    cells[to * 3] = cellsFound[from * 3];
    cells[to * 3 + 1] = cellsFound[from * 3 + 1];
    cells[to * 3 + 2] = cellsFound[from * 3 + 2];
  });
  return { originM: origin, offsetsM, yaw01, scale, cells, accepted };
}

/** The buffers of a result, for `postMessage(result, transfer)` from a worker. */
export function scatterPlanetLatticeTransferables(result: IScatterPlanetLatticeResult): ArrayBuffer[] {
  return [result.offsetsM.buffer, result.yaw01.buffer, result.scale.buffer, result.cells.buffer] as ArrayBuffer[];
}

/** The lattice cell key `ix,iy,iz`, the `cellKey` of an instance id. */
export function scatterPlanetCellKey(ix: number, iy: number, iz: number): string {
  return `${ix},${iy},${iz}`;
}

/**
 * Stable instance id of the instance in lattice cell `(ix, iy, iz)`, in the
 * format of `composeScatterInstanceId`, so removal overlays and collider
 * descriptors work on planet instances. Composed on demand: a request does
 * not build strings for every instance.
 */
export function composeScatterPlanetInstanceId(
  layer: Pick<IScatterPlanetLayerDefinition, 'id' | 'generatorVersion'>,
  worldSeed: number,
  ix: number,
  iy: number,
  iz: number,
): ScatterInstanceId {
  return composeScatterInstanceId(
    {
      worldSeed,
      layerId: layer.id,
      speciesId: layer.id,
      generatorVersion: layer.generatorVersion,
      cellKey: scatterPlanetCellKey(ix, iy, iz),
    },
    'c0',
  );
}

/** Options of {@link measureScatterPlanetCover}. */
export interface IMeasureScatterPlanetCoverOptions {
  /** Footprint radius (metres) of an instance at scale 1, for example half a crown width. */
  readonly footprintRadiusM: number;
  /** Radius (metres) of the disc around the window centre that is sampled; keep it inside the window. */
  readonly sampleRadiusM: number;
  /** Sample points (default 4000), on a fixed sunflower spiral so the result is deterministic. */
  readonly samples?: number;
}

/**
 * Share of the ground the instances' footprints cover seen from above: the
 * area of the union of their discs (radius `footprintRadiusM × scale`) over
 * a disc around the window centre. Use it on a solid stand (density 1) to
 * derive a far form's cover from the scatter itself instead of assuming the
 * sum of the discs: jittered footprints overlap.
 */
export function measureScatterPlanetCover(
  result: IScatterPlanetLatticeResult,
  options: IMeasureScatterPlanetCoverOptions,
): number {
  const [ox, oy, oz] = result.originM;
  const length = Math.hypot(ox, oy, oz);
  const up = [ox / length, oy / length, oz / length];
  // Any tangent basis at the centre.
  const helper = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = [
    helper[1] * up[2] - helper[2] * up[1],
    helper[2] * up[0] - helper[0] * up[2],
    helper[0] * up[1] - helper[1] * up[0],
  ];
  const l1 = Math.hypot(e1[0], e1[1], e1[2]);
  e1[0] /= l1;
  e1[1] /= l1;
  e1[2] /= l1;
  const e2 = [up[1] * e1[2] - up[2] * e1[1], up[2] * e1[0] - up[0] * e1[2], up[0] * e1[1] - up[1] * e1[0]];
  const reach = options.sampleRadiusM;
  const discs: number[] = [];
  let maxRadius = 0;
  for (let i = 0; i < result.scale.length; i++) {
    const x = result.offsetsM[i * 3];
    const y = result.offsetsM[i * 3 + 1];
    const z = result.offsetsM[i * 3 + 2];
    const a = x * e1[0] + y * e1[1] + z * e1[2];
    const b = x * e2[0] + y * e2[1] + z * e2[2];
    const radius = options.footprintRadiusM * result.scale[i];
    maxRadius = Math.max(maxRadius, radius);
    if (Math.hypot(a, b) > reach + radius) continue;
    discs.push(a, b, radius);
  }
  // Bucket the discs on a grid so each sample tests only its neighbours.
  const bucketM = Math.max(2 * maxRadius, 1);
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < discs.length; i += 3) {
    const key = `${Math.floor(discs[i] / bucketM)},${Math.floor(discs[i + 1] / bucketM)}`;
    const list = buckets.get(key) ?? [];
    list.push(i);
    buckets.set(key, list);
  }
  const n = options.samples ?? 4000;
  let covered = 0;
  for (let s = 0; s < n; s++) {
    const r = reach * Math.sqrt((s + 0.5) / n);
    const angle = s * 2.399963229728653;
    const px = r * Math.cos(angle);
    const py = r * Math.sin(angle);
    const bx = Math.floor(px / bucketM);
    const by = Math.floor(py / bucketM);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (const i of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
          if (Math.hypot(discs[i] - px, discs[i + 1] - py) < discs[i + 2]) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) covered++;
  }
  return covered / n;
}
