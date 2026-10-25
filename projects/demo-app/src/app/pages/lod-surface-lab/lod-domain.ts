/**
 * Plan 059 base domains: a bounded flat square (one root) and a cube-sphere (six roots). A node is addressed by
 * (root, level, i, j) and covers the parameter square u in [i, i + 1] / 2^level, v likewise. Everything here is in
 * doubles; the renderer receives camera-relative floats (`lod-surface-mesh.ts`).
 */

export type DomainKind = 'plane' | 'sphere';
export type CubeWarp = 'equal-angle' | 'none';
export type Vec3 = [number, number, number];

export interface LodDomain {
  readonly kind: DomainKind;
  /** Plane: side of the square. Sphere: radius. Metres. */
  readonly sizeM: number;
  readonly warp: CubeWarp;
}

export const DOMAIN_PRESETS = [
  { id: 'plane-100km', label: 'plane 100 km', domain: { kind: 'plane', sizeM: 100_000, warp: 'equal-angle' } },
  { id: 'sphere-10km', label: 'sphere 10 km', domain: { kind: 'sphere', sizeM: 10_000, warp: 'equal-angle' } },
  { id: 'sphere-600km', label: 'sphere 600 km', domain: { kind: 'sphere', sizeM: 600_000, warp: 'equal-angle' } },
] as const satisfies readonly { id: string; label: string; domain: LodDomain }[];
export type DomainPresetId = (typeof DOMAIN_PRESETS)[number]['id'];

export function domainPreset(id: DomainPresetId, warp: CubeWarp = 'equal-angle'): LodDomain {
  const preset = DOMAIN_PRESETS.find((entry) => entry.id === id);
  if (!preset) throw new Error(`Unknown domain ${id}`);
  return { ...preset.domain, warp };
}

export function rootCount(domain: LodDomain): number {
  return domain.kind === 'plane' ? 1 : 6;
}

/**
 * Face frames: normal N, axes U and V with U x V = N, so a cell (u, v) -> (u + 1, v) -> (u + 1, v + 1) winds
 * counter-clockwise seen from outside. The plane uses one frame with N = +Y.
 */
export const FACE_FRAMES: readonly { readonly n: Vec3; readonly u: Vec3; readonly v: Vec3 }[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
export const PLANE_FRAME = FACE_FRAMES[2];

/**
 * Parameter u in [0, 1] to the cube coordinate in [-1, 1]. Equal-angle: tan(pi/4 t), odd in t and exactly +-1 at the
 * face edge, so two faces compute the same bits for a shared edge vertex (the shader does the same).
 */
export function warpCoordinate(u: number, warp: CubeWarp): number {
  const t = 2 * u - 1;
  if (warp === 'none' || t === 0) return t;
  if (t >= 1) return 1;
  if (t <= -1) return -1;
  return Math.tan((Math.PI / 4) * t);
}

/** Inverse of {@link warpCoordinate}. */
export function unwarpCoordinate(a: number, warp: CubeWarp): number {
  const t = warp === 'none' ? a : (4 / Math.PI) * Math.atan(a);
  return (t + 1) / 2;
}

/** Point on the cube (not normalised) for face parameters (u, v). */
export function cubePoint(face: number, u: number, v: number, warp: CubeWarp, out: Vec3 = [0, 0, 0]): Vec3 {
  const { n, u: au, v: av } = FACE_FRAMES[face];
  const a = warpCoordinate(u, warp);
  const b = warpCoordinate(v, warp);
  out[0] = n[0] + a * au[0] + b * av[0];
  out[1] = n[1] + a * au[1] + b * av[1];
  out[2] = n[2] + a * au[2] + b * av[2];
  return out;
}

/** Base surface point (height 0) and outward unit normal for (root, u, v). */
export function domainPoint(domain: LodDomain, root: number, u: number, v: number, position: Vec3, normal: Vec3): void {
  if (domain.kind === 'plane') {
    const { n, u: au, v: av } = PLANE_FRAME;
    const x = (u - 0.5) * domain.sizeM;
    const y = (v - 0.5) * domain.sizeM;
    for (let k = 0; k < 3; k++) {
      position[k] = x * au[k] + y * av[k];
      normal[k] = n[k];
    }
    return;
  }
  cubePoint(root, u, v, domain.warp, normal);
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  for (let k = 0; k < 3; k++) {
    normal[k] /= length;
    position[k] = normal[k] * domain.sizeM;
  }
}

/** Which face a direction falls on and its unwarped plane coordinates s, t in [-1, 1] there. */
function faceOfDirection(x: number, y: number, z: number): { face: number; s: number; t: number } {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  const face = ax >= ay && ax >= az ? (x > 0 ? 0 : 1) : ay >= az ? (y > 0 ? 2 : 3) : z > 0 ? 4 : 5;
  const scale = 1 / Math.max(ax, ay, az);
  const { u, v } = FACE_FRAMES[face];
  const px = x * scale;
  const py = y * scale;
  const pz = z * scale;
  return { face, s: px * u[0] + py * u[1] + pz * u[2], t: px * v[0] + py * v[1] + pz * v[2] };
}

/** Edges: 0 south (v = 0), 1 east (u = 1), 2 north (v = 1), 3 west (u = 0). Bit e of an edge mask is edge e. */
export const EDGE_STEP: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export interface NeighbourCell {
  root: number;
  i: number;
  j: number;
}

/**
 * The cell of the same level across edge `edge` of node (root, level, i, j), or false at the plane's border. Across a
 * cube edge the step is taken in unwarped coordinates just past the edge and projected radially onto the next face:
 * parameters along a shared edge agree between faces (the warp is the same odd function), and the step is a sixteenth of
 * a cell, so the projection cannot slide into the next cell along the edge.
 */
export function neighbourCell(domain: LodDomain, root: number, level: number, i: number, j: number, edge: number, out: NeighbourCell): boolean {
  const cells = 2 ** level;
  const ni = i + EDGE_STEP[edge][0];
  const nj = j + EDGE_STEP[edge][1];
  if (ni >= 0 && ni < cells && nj >= 0 && nj < cells) {
    out.root = root;
    out.i = ni;
    out.j = nj;
    return true;
  }
  if (domain.kind === 'plane') return false;
  const step = 1 / (16 * cells);
  const u = ni < 0 ? -step : ni >= cells ? 1 + step : (ni + 0.5) / cells;
  const v = nj < 0 ? -step : nj >= cells ? 1 + step : (nj + 0.5) / cells;
  const { n, u: au, v: av } = FACE_FRAMES[root];
  const s = 2 * u - 1;
  const t = 2 * v - 1;
  const hit = faceOfDirection(n[0] + s * au[0] + t * av[0], n[1] + s * au[1] + t * av[1], n[2] + s * au[2] + t * av[2]);
  out.root = hit.face;
  out.i = Math.min(cells - 1, Math.max(0, Math.floor(((hit.s + 1) / 2) * cells)));
  out.j = Math.min(cells - 1, Math.max(0, Math.floor(((hit.t + 1) / 2) * cells)));
  return true;
}
