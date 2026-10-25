/* eslint-disable @typescript-eslint/no-explicit-any */
import { BufferAttribute, Color, FrontSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, abs, attribute, cos, dot, float, floor, fract, fwidth, max, min, mix, mod, normalize, positionGeometry, select, sign, sin,
  smoothstep, step, tan, uniform, uniformArray, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { FACE_FRAMES, PLANE_FRAME, cubePoint, type LodDomain, type Vec3 } from './lod-domain';
import type { HeightSource } from './lod-height';
import type { LodSelector, PatchCells } from './lod-selector';

/**
 * Plan 059 M1 renderer: one shared N x N grid drawn instanced, one instance per drawn leaf, one draw call.
 *
 * Precision (L7, without the Earth case, which is spike S1): every leaf gets its centre relative to the camera from
 * doubles on the CPU (`aOrigin`); the vertex stage adds the vertex's offset from that centre, computed so its float
 * error scales with the leaf size, not the radius. On the sphere the offset is R (c / |c| - cC / |cC|) rewritten as
 * R (dc / |c| - cC (dc . (2 cC + dc)) / (|c| |cC| (|c| + |cC|))), with dc from a tan difference and a per-leaf
 * correction for the float rounding of cC (`aCubeError`), so dc is the exact cube-space difference to float accuracy.
 *
 * Cracks (L2): heights and normals are read at the vertex's global parameters, which are exact float lattice values
 * shared bit for bit by every leaf touching that vertex (the warp is exactly +-1 at a face edge, so neighbouring faces
 * agree too). Odd vertices on an edge next to a coarser leaf (mask bit) are placed at the mean of their two even
 * neighbours' final positions, which is where the coarser leaf's edge runs.
 */

export type LodView = 'lod' | 'shaded';

/** Floats per instance attribute (four vec4). */
const STRIDE = 4;

export interface LodSurfaceMeshOptions {
  readonly domain: LodDomain;
  readonly patchCells: PatchCells;
  readonly source: HeightSource;
  readonly capacity: number;
}

export interface LodSurfaceMesh {
  readonly mesh: Mesh;
  /** Same geometry and vertex stage, writing 1 to every drawn pixel: the crack probe's material. */
  readonly probeMaterial: MeshBasicNodeMaterial;
  readonly material: MeshBasicNodeMaterial;
  /** Writes the drawn leaves for a camera position (doubles); returns the instance count. */
  upload(selector: LodSelector, camera: Vec3): number;
  setView(view: LodView): void;
  setBounds(on: boolean): void;
  setWireframe(on: boolean): void;
  /** Edge folding on (default) or off, for the probe's known-bad control. */
  setFolding(on: boolean): void;
  /** Shrinks every leaf toward its centre by this share of its size: a gap the crack probe must find. 0 = off. */
  setInjectedGap(share: number): void;
  setSun(direction: Vec3): void;
  dispose(): void;
}

/** Grid vertices (gx, gy, 0) in `position`, two triangles per cell wound counter-clockwise seen from outside. */
function gridGeometry(cells: number, capacity: number): InstancedBufferGeometry {
  const side = cells + 1;
  const positions = new Float32Array(side * side * 3);
  for (let y = 0; y <= cells; y++) {
    for (let x = 0; x <= cells; x++) {
      const k = (y * side + x) * 3;
      positions[k] = x;
      positions[k + 1] = y;
    }
  }
  const index = new Uint32Array(cells * cells * 6);
  let k = 0;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const a = y * side + x;
      index.set([a, a + 1, a + side + 1, a, a + side + 1, a + side], k);
      k += 6;
    }
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  for (const name of ['aOrigin', 'aCube', 'aCubeError', 'aInfo']) {
    geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(capacity * STRIDE), STRIDE));
  }
  geometry.instanceCount = 0;
  return geometry;
}

/** Bit e of a 0..15 mask held in a float, as 0 or 1. */
const bit = (mask: any, e: number) => mod(floor(mask.div(2 ** e)), 2);

export function createLodSurfaceMesh(options: LodSurfaceMeshOptions): LodSurfaceMesh {
  const { domain, patchCells, source, capacity } = options;
  const sphere = domain.kind === 'sphere';
  const equalAngle = domain.warp === 'equal-angle';
  const geometry = gridGeometry(patchCells, capacity);
  const frames = uniformArray(FACE_FRAMES.flatMap(({ u, v }) => [new Vector3(...u), new Vector3(...v)]), 'vec3') as any;
  const uFolding = uniform(1) as any;
  const uGap = uniform(0) as any;
  const uLodColour = uniform(1) as any;
  const uBounds = uniform(1) as any;
  const uSun = uniform(new Vector3(0.4, 0.8, 0.45).normalize()) as any;
  const size = float(domain.sizeM);
  const cells = float(patchCells);

  const origin = attribute('aOrigin', 'vec4') as any;
  const cube = attribute('aCube', 'vec4') as any;
  const cubeError = attribute('aCubeError', 'vec4') as any;
  const info = attribute('aInfo', 'vec4') as any;
  const du = info.x;
  const mask = info.z;
  const face = info.w.toInt();
  const axisU = sphere ? frames.element(face.mul(2)) : vec3(...PLANE_FRAME.u);
  const axisV = sphere ? frames.element(face.mul(2).add(1)) : vec3(...PLANE_FRAME.v);
  const axisN = sphere ? axisU.cross(axisV) : vec3(...PLANE_FRAME.n);

  /** Cube coordinate of a parameter, exactly +-1 at the face edge. */
  const warp = (u: any): any => {
    const t = u.mul(2).sub(1);
    if (!equalAngle) return t;
    return select(abs(t).greaterThanEqual(1), sign(t), tan(t.mul(Math.PI / 4)));
  };
  /** Exact cube-space difference warp(u) - warp(uC) for a parameter offset d = u - uC. */
  const warpDelta = (u: any, uC: any, d: any): any => {
    if (!equalAngle) return d.mul(2);
    return sin(d.mul(Math.PI / 2)).div(cos(u.mul(2).sub(1).mul(Math.PI / 4)).mul(cos(uC.mul(2).sub(1).mul(Math.PI / 4))));
  };

  /** Global base point (for heights and normals), the leaf-relative offset, and the outward normal at grid point g. */
  const basePoint = (g: any) => {
    const local = g.mul(1 / patchCells).sub(0.5).mul(du);
    const uC = cube.w;
    const vC = cubeError.w;
    const u = uC.add(local.x);
    const v = vC.add(local.y);
    if (!sphere) {
      const global = axisU.mul(u.sub(0.5).mul(size)).add(axisV.mul(v.sub(0.5).mul(size)));
      const offset = axisU.mul(local.x).add(axisV.mul(local.y)).mul(size);
      return { global, offset, up: axisN };
    }
    const up = normalize(axisN.add(axisU.mul(warp(u))).add(axisV.mul(warp(v))));
    const cC = cube.xyz;
    const dc = axisU.mul(warpDelta(u, uC, local.x)).add(axisV.mul(warpDelta(v, vC, local.y))).add(cubeError.xyz);
    const c = cC.add(dc);
    const lc = c.length();
    const lC = cC.length();
    const offset = dc.div(lc).sub(cC.mul(dot(dc, cC.mul(2).add(dc)).div(lc.mul(lC).mul(lc.add(lC))))).mul(size);
    return { global: up.mul(size), offset, up };
  };

  const surfacePoint = Fn(([g]: [any]) => {
    const { global, offset, up } = basePoint(g);
    return origin.xyz.add(offset.mul(float(1).sub(uGap))).add(up.mul(source.heightNode(global)));
  });

  const grid = positionGeometry.xy as any;
  // Folding: an odd vertex on a coarser edge moves to the mean of its even neighbours along that edge.
  const oddX = mod(grid.x, 2);
  const oddY = mod(grid.y, 2);
  const south = float(1).sub(step(0.5, grid.y));
  const north = step(cells.sub(0.5), grid.y);
  const west = float(1).sub(step(0.5, grid.x));
  const east = step(cells.sub(0.5), grid.x);
  const alongX = min(1, south.mul(bit(mask, 0)).add(north.mul(bit(mask, 2)))).mul(oddX).mul(uFolding);
  const alongY = min(1, east.mul(bit(mask, 1)).add(west.mul(bit(mask, 3)))).mul(oddY).mul(uFolding);
  const foldStep = vec2(alongX as any, alongY as any);
  const positionNode = surfacePoint(grid.sub(foldStep)).add(surfacePoint(grid.add(foldStep))).mul(0.5);

  // Lighting normal from the height gradient at the vertex's own grid point.
  const own = basePoint(grid);
  const gradient = source.gradientNode(own.global) as any;
  const tangential = gradient.sub(own.up.mul(dot(gradient, own.up)));
  const shadingNormal = varying(normalize(own.up.sub(tangential)), 'vLodNormal') as any;
  const patchUv = varying(grid.mul(1 / patchCells), 'vLodPatchUv') as any;
  const level = varying(info.y, 'vLodLevel') as any;

  const hue = fract(level.mul(0.137).add(0.05));
  const palette = vec3(0.5).add(vec3(0.5).mul(cos(vec3(hue, hue.add(1 / 3), hue.add(2 / 3)).mul(2 * Math.PI))));
  const base = mix(vec3(0.62, 0.64, 0.6), palette, uLodColour);
  const light = max(dot(normalize(shadingNormal), uSun), 0).mul(0.85).add(0.2);
  const border = min(min(patchUv.x, float(1).sub(patchUv.x)), min(patchUv.y, float(1).sub(patchUv.y)));
  const line = float(1).sub(smoothstep(0, fwidth(border).mul(1.5), border)).mul(uBounds);
  const colorNode = vec4(mix(base.mul(light), vec3(0.05, 0.05, 0.08), line.mul(0.85)), 1);

  const material = new MeshBasicNodeMaterial({ side: FrontSide });
  material.positionNode = positionNode;
  material.colorNode = colorNode;
  const probeMaterial = new MeshBasicNodeMaterial({ side: FrontSide });
  probeMaterial.positionNode = positionNode;
  probeMaterial.colorNode = vec4(1, 1, 1, 1);
  probeMaterial.toneMapped = false;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'LOD surface';

  const attributes = ['aOrigin', 'aCube', 'aCubeError', 'aInfo'].map((name) => geometry.getAttribute(name) as InstancedBufferAttribute);
  const [originData, cubeData, errorData, infoData] = attributes.map((attr) => attr.array as Float32Array);
  const point: Vec3 = [0, 0, 0];

  return {
    mesh,
    material,
    probeMaterial,
    upload(selector, camera) {
      const count = Math.min(selector.stats.drawn, capacity);
      for (let k = 0; k < count; k++) {
        const node = selector.leaves[k];
        const level = selector.level[node];
        const step = 1 / 2 ** level;
        const uC = (selector.i[node] + 0.5) * step;
        const vC = (selector.j[node] + 0.5) * step;
        const o = k * STRIDE;
        const root = selector.root[node];
        if (sphere) {
          // cC rounded to float as the shader sees it; the origin is that float point on the sphere, in doubles.
          cubePoint(root, uC, vC, domain.warp, point);
          let length2 = 0;
          for (let a = 0; a < 3; a++) {
            const rounded = Math.fround(point[a]);
            cubeData[o + a] = rounded;
            errorData[o + a] = point[a] - rounded;
            length2 += rounded * rounded;
          }
          const scale = domain.sizeM / Math.sqrt(length2);
          for (let a = 0; a < 3; a++) originData[o + a] = cubeData[o + a] * scale - camera[a];
        } else {
          const x = (uC - 0.5) * domain.sizeM;
          const y = (vC - 0.5) * domain.sizeM;
          for (let a = 0; a < 3; a++) {
            originData[o + a] = x * PLANE_FRAME.u[a] + y * PLANE_FRAME.v[a] - camera[a];
            cubeData[o + a] = 0;
            errorData[o + a] = 0;
          }
        }
        cubeData[o + 3] = uC;
        errorData[o + 3] = vC;
        infoData[o] = step;
        infoData[o + 1] = level;
        infoData[o + 2] = selector.masks[k];
        infoData[o + 3] = root;
      }
      for (const attr of attributes) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, Math.max(1, count) * STRIDE);
        attr.needsUpdate = true;
      }
      geometry.instanceCount = count;
      return count;
    },
    setView(view) { uLodColour.value = view === 'lod' ? 1 : 0; },
    setBounds(on) { uBounds.value = on ? 1 : 0; },
    setWireframe(on) { material.wireframe = on; material.needsUpdate = true; },
    setFolding(on) { uFolding.value = on ? 1 : 0; },
    setInjectedGap(share) { uGap.value = share; },
    setSun(direction) { (uSun.value as Vector3).set(...direction).normalize(); },
    dispose() {
      geometry.dispose();
      material.dispose();
      probeMaterial.dispose();
    },
  };
}

/** Background colour of the lab. */
export const SKY = new Color(0x0b1220);
