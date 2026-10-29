/* eslint-disable @typescript-eslint/no-explicit-any */
import { BufferAttribute, FrontSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, Vector3 } from 'three';
import { MeshBasicNodeMaterial, type NodeMaterial } from 'three/webgpu';
import {
  attribute, cos, dot, float, floor, fract, fwidth, length, max, min, mix, mod, normalize, positionGeometry,
  smoothstep, step, uniform, uniformArray, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { detailNoiseNode, detailTexelMetres } from './lod-detail-noise';
import { FACE_FRAMES, PLANE_FRAME, type LodDomain, type Vec3 } from './lod-domain';
import type { HeightSource } from './lod-height';
import { SIN_DENOMINATORS, anchorFor, latticeSteps, newAnchor } from './lod-lattice';
import { LEAF_STRIDE, packLeaves } from './lod-leaf-pack';
import { maxLevelFor, type LodSelector, type PatchCells } from './lod-selector';

/**
 * Plan 059 M1 renderer: one shared N x N grid drawn instanced, one instance per drawn leaf, one draw call.
 *
 * Seams (L2, bit-identical): a vertex is addressed by integer lattice coordinates (U, V) on one grid per face of
 * L = patchCells * 2^maxLevel steps (`lod-lattice.ts`), all exact in float32. Its position relative to the camera is a
 * function of those coordinates (on the sphere: of the cube-lattice vector T, the same for both faces at a seam) and
 * of per-frame uniforms only: the anchor, a lattice point near the camera, with its double-precision distance to the
 * camera. No per-leaf float term enters, so every leaf that draws a vertex gets the same bits. An odd vertex on an
 * edge next to a coarser leaf (mask bit) snaps by one grid cell onto the coarse leaf's own vertex.
 *
 * Precision (L7, without the Earth case, which is spike S1): the vertex is anchorRel + R (c / |c| - cA / |cA|) with
 * c = cA + dc and dc = tan(a) - tan(b) = sin(a - b) / (cos a cos b) for angles pi/4 T / L, where a - b comes from the
 * exact integer T - TA, so dc has float relative accuracy and the offset error scales with the distance to the anchor,
 * not the radius. R (...) is rewritten as R (dc / |c| - cA (dc . (2 cA + dc)) / (|c| |cA| (|c| + |cA|))).
 */

/** Debug colouring of the default material: one colour per level (`'lod'`) or a neutral grey (`'shaded'`). */
export type LodView = 'lod' | 'shaded';

/**
 * sin(x) for |x| up to pi / 2 (lattice differences give at most that) as a Taylor polynomial to x^15, error below 1e-10.
 * The built-in `sin` is not safe here: WGSL only bounds its absolute error, and on an RTX 3080 that error wiped out
 * the small offsets of deep leaves (x about 1e-6) and opened holes between leaves on the sphere.
 */
const smallSin = (x: any): any => {
  const x2 = x.mul(x);
  let inner: any = float(1);
  for (let k = SIN_DENOMINATORS.length - 1; k >= 0; k--) inner = float(1).sub(x2.div(SIN_DENOMINATORS[k]).mul(inner));
  return x.mul(inner);
};

/** What {@link createLodSurfaceMesh} needs to build the one-draw-call surface. */
export interface LodSurfaceMeshOptions {
  /** The body drawn: plane or cube-sphere, its size and the cube warp. */
  readonly domain: LodDomain;
  /** Grid cells per leaf side; must be the selector's. */
  readonly patchCells: PatchCells;
  /** Height source (with detail noise already wrapped by `withDetailNoise` when `detail` is set); baked sources are read by lattice point. */
  readonly source: HeightSource;
  /** Instance slots: the selector's leaf cap plus {@link CAP_SLACK} and a few spare. */
  readonly capacity: number;
  /**
   * Material to draw with instead of the built-in debug material (LOD colours, sun lighting, patch bounds). The mesh sets
   * its `positionNode` and nothing else, so colour, lighting and normals are the material's. It is not disposed by
   * {@link LodSurfaceMesh.dispose}: its owner disposes it. The debug setters (`setView`, `setLighting`, `setBounds`,
   * `setSun`) change only the built-in material and do nothing to a supplied one.
   */
  readonly material?: NodeMaterial;
  /**
   * Adds detail noise below the texel size (`lod-detail-noise.ts`) to the height, sized by a height texture of this many
   * texels per face side. Absent: no noise nodes are built. Its amplitude is set with `setDetailNoise`.
   */
  readonly detail?: { readonly cells: number };
}

/** The drawn surface and its controls: one instanced mesh, one draw call. */
export interface LodSurfaceMesh {
  /** The mesh to add to the scene. Its vertices are relative to the camera position last passed to {@link upload}, so keep it at that position (`LodTerrainBody` does). */
  readonly mesh: Mesh;
  /** Same geometry and vertex stage, writing 1 to every drawn pixel: the crack probe's material. */
  readonly probeMaterial: MeshBasicNodeMaterial;
  /** The material in use: the built-in debug material, or the one supplied in the options. */
  readonly material: NodeMaterial;
  /**
   * Writes the drawn leaves for a camera position (doubles); returns the instance count. The leaf arrays are only
   * rewritten, and the GPU buffers only marked for upload, when the selection changed since the last call.
   */
  upload(selector: LodSelector, camera: Vec3): number;
  /** Debug colouring of the built-in material. */
  setView(view: LodView): void;
  /** Draws the dark outline of every leaf patch (built-in material). */
  setBounds(on: boolean): void;
  /** Draws the material as a wireframe (works on a supplied material too). */
  setWireframe(on: boolean): void;
  /** Edge folding on (default) or off, for the probe's known-bad control. */
  setFolding(on: boolean): void;
  /** Shrinks every leaf toward its centre by this share of its size: a gap the crack probe must find. 0 = off. */
  setInjectedGap(share: number): void;
  /** Direction to the sun in the domain frame, for the built-in material's lighting (normalised here). */
  setSun(direction: Vec3): void;
  /** Detail noise amplitude as a share of the texel size (needs the `detail` option; 0 adds nothing). */
  setDetailNoise(share: number): void;
  /** Angle one vertex spacing subtends (cell pixels times the pixel angle): the finest noise octaves fade out below two spacings per wavelength. */
  setDetailFade(spacingAngle: number): void;
  /** Sun lighting on the built-in material (off: flat colour). */
  setLighting(on: boolean): void;
  /** Releases the geometry and the built-in materials (not a supplied one). */
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
  for (const name of ['aLeaf', 'aInfo']) {
    geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(capacity * LEAF_STRIDE), LEAF_STRIDE));
  }
  geometry.instanceCount = 0;
  return geometry;
}

/** Bit e of a 0..15 mask held in a float, as 0 or 1. */
const bit = (mask: any, e: number) => mod(floor(mask.div(2 ** e)), 2);

/**
 * Builds the surface mesh: one shared grid drawn instanced, one instance per drawn leaf. Call {@link LodSurfaceMesh.upload}
 * every frame with the selector and the camera position, and keep the mesh at that camera position so the camera-relative
 * vertices land where they belong.
 */
export function createLodSurfaceMesh(options: LodSurfaceMeshOptions): LodSurfaceMesh {
  const { domain, patchCells, source, capacity, detail } = options;
  const sphere = domain.kind === 'sphere';
  const equalAngle = domain.warp === 'equal-angle';
  const maxLevel = maxLevelFor(patchCells);
  const steps = latticeSteps(patchCells, maxLevel);
  const geometry = gridGeometry(patchCells, capacity);
  const frames = uniformArray(FACE_FRAMES.flatMap(({ u, v }) => [new Vector3(...u), new Vector3(...v)]), 'vec3') as any;
  const uFolding = uniform(1) as any;
  const uGap = uniform(0) as any;
  const uLodColour = uniform(1) as any;
  const uBounds = uniform(1) as any;
  const uLighting = uniform(1) as any;
  const uDetailAmp = uniform(0) as any;
  const uDetailFade = uniform(0.004) as any;
  const detailCells = detail?.cells ?? 1;
  const detailTexelM = detailTexelMetres(domain, detailCells);
  const uSun = uniform(new Vector3(0.4, 0.8, 0.45).normalize()) as any;
  // Per-frame anchor (lod-lattice.ts): its lattice vector, cube point, rounding error, cosines, and distance to the camera.
  const uAnchorT = uniform(new Vector3()) as any;
  const uAnchorCube = uniform(new Vector3()) as any;
  const uAnchorError = uniform(new Vector3()) as any;
  const uAnchorCos = uniform(new Vector3(1, 1, 1)) as any;
  const uAnchorRel = uniform(new Vector3()) as any;
  const size = float(domain.sizeM);
  const cells = float(patchCells);

  const leaf = attribute('aLeaf', 'vec4') as any; // U0, V0, lattice step per cell, face
  const info = attribute('aInfo', 'vec4') as any; // level, edge mask
  const mask = info.y;
  const face = leaf.w.toInt();
  const axisU = sphere ? frames.element(face.mul(2)) : vec3(...PLANE_FRAME.u);
  const axisV = sphere ? frames.element(face.mul(2).add(1)) : vec3(...PLANE_FRAME.v);
  const axisN = sphere ? axisU.cross(axisV) : vec3(...PLANE_FRAME.n);
  const centreLattice = leaf.xy.add(leaf.z.mul(patchCells / 2));

  /**
   * Position relative to the camera, global base point (for heights and normals) and outward normal at grid point g.
   * Everything derives from the vertex's lattice coordinates and the anchor uniforms; `gap` shrinks the vertex toward
   * its leaf centre in lattice units (the injected-gap control; it adds exactly 0 when 0).
   */
  const basePoint = (g: any, gap: any) => {
    const lattice = leaf.xy.add(g.mul(leaf.z));
    const toCentre = centreLattice.sub(lattice);
    if (!sphere) {
      const delta = lattice.sub(uAnchorT.xy).add(toCentre.mul(gap));
      const offset = axisU.mul(delta.x).add(axisV.mul(delta.y)).mul(domain.sizeM / steps);
      const global = axisU.mul(lattice.x.div(steps).sub(0.5).mul(size)).add(axisV.mul(lattice.y.div(steps).sub(0.5).mul(size)));
      return { global, offset: uAnchorRel.add(offset), up: axisN, lattice, c: undefined as any, lc: undefined as any, t: undefined as any };
    }
    // Cube-lattice vector: one component is +-L; the others are 2U - L, 2V - L. Integers, exact in float32.
    const t = axisN.mul(steps).add(axisU.mul(lattice.x.mul(2).sub(steps))).add(axisV.mul(lattice.y.mul(2).sub(steps)));
    const dT = t.sub(uAnchorT).add(axisU.mul(toCentre.x.mul(2)).add(axisV.mul(toCentre.y.mul(2))).mul(gap));
    const angle = Math.PI / 4 / steps;
    // tan(a) - tan(b) = sin(a - b) / (cos a cos b), with a - b from the exact integer difference.
    const dcRaw = equalAngle ? smallSin(dT.mul(angle)).div(cos(t.mul(angle)).mul(uAnchorCos)) : dT.div(steps);
    const dc = dcRaw.add(uAnchorError);
    const cA = uAnchorCube;
    const c = cA.add(dc);
    const lc = c.length();
    const lC = cA.length();
    const offset = dc.div(lc).sub(cA.mul(dot(dc, cA.mul(2).add(dc)).div(lc.mul(lC).mul(lc.add(lC))))).mul(size);
    const up = c.div(lc);
    return { global: up.mul(size), offset: uAnchorRel.add(offset), up, lattice, c, lc, t };
  };

  /**
   * Detail noise at a vertex (`lod-detail-noise.ts`): height in metres and its slopes per lattice step (like a source's
   * `slopeNode`). The noise coordinate is the vertex's lattice point (plane) or cube-lattice vector T (sphere), in texel units,
   * so it is the same for every leaf that draws the vertex; the fade depends on the vertex's camera distance only.
   */
  const detailAt = (own: { lattice: any; t: any; offset: any }) => {
    const unit = steps / detailCells;
    const p = sphere ? own.t.div(2 * unit) : vec3(own.lattice.x, own.lattice.y, 0).div(unit);
    const noise = detailNoiseNode(p, length(own.offset), uDetailFade, detailTexelM);
    const gradient = noise.gradient.mul(uDetailAmp);
    // T = n L + axisU (2U - L) + axisV (2V - L), so dp/dU = axisU / unit and dp/dV = axisV / unit.
    const slope = sphere ? vec2(dot(gradient, axisU), dot(gradient, axisV)) : vec2(gradient.x, gradient.y);
    return { height: noise.value.mul(uDetailAmp), slope: slope.div(unit) };
  };

  // Baked sources are read by (face, lattice): a function of the vertex's own integer coordinates, never of the gap or of
  // float positions, so seam vertices (including folded ones, which sit on a coarser lattice point) get the same bits.
  const surfacePoint = (g: any) => {
    const own = basePoint(g, uGap);
    const { global, offset, up, lattice } = own;
    const base = source.lattice ? source.lattice.heightNode(face, lattice) : source.heightNode(global);
    const noise = detail ? detailAt(own) : undefined;
    const height = noise ? base.add(noise.height) : base;
    return { position: offset.add(up.mul(height)), detailSlope: noise?.slope };
  };

  /**
   * Surface gradient of a lattice height from its slopes per lattice step (hU, hV): with the tangents eU, eV of one step
   * (scaled by the nominal step length so the metric stays O(1) in float32) it is (G hU - F hV) eU + (E hV - F hU) eV over
   * (E G - F^2). Plane: constant tangents. Sphere: from the cube point c = n + a axisU + b axisV, d(a)/dU the warp's slope.
   */
  const latticeGradient = (own: { lattice: any; c: any; lc: any }, slope: any) => {
    const unit = domain.sizeM / steps;
    let eU: any;
    let eV: any;
    if (!sphere) {
      eU = axisU;
      eV = axisV;
    } else {
      const a = dot(own.c, axisU);
      const b = dot(own.c, axisV);
      const dA = equalAngle ? a.mul(a).add(1).mul(Math.PI / (2 * steps)) : float(2 / steps);
      const dB = equalAngle ? b.mul(b).add(1).mul(Math.PI / (2 * steps)) : float(2 / steps);
      const lc = own.lc;
      const tangent = (axis: any, along: any, slopeAlong: any) => axis.mul(slopeAlong).div(lc).sub(own.c.mul(along.mul(slopeAlong).div(lc.mul(lc).mul(lc)))).mul(size.div(unit));
      eU = tangent(axisU, a, dA);
      eV = tangent(axisV, b, dB);
    }
    const E = dot(eU, eU);
    const F = dot(eU, eV);
    const G = dot(eV, eV);
    return eU.mul(G.mul(slope.x).sub(F.mul(slope.y))).add(eV.mul(E.mul(slope.y).sub(F.mul(slope.x)))).div(E.mul(G).sub(F.mul(F)).mul(unit));
  };

  const grid = positionGeometry.xy as any;
  // Folding: an odd vertex on a coarser edge snaps one grid cell back along that edge, onto the coarse leaf's own vertex.
  const oddX = mod(grid.x, 2);
  const oddY = mod(grid.y, 2);
  const south = float(1).sub(step(0.5, grid.y));
  const north = step(cells.sub(0.5), grid.y);
  const west = float(1).sub(step(0.5, grid.x));
  const east = step(cells.sub(0.5), grid.x);
  const alongX = min(1, south.mul(bit(mask, 0)).add(north.mul(bit(mask, 2)))).mul(oddX).mul(uFolding);
  const alongY = min(1, east.mul(bit(mask, 1)).add(west.mul(bit(mask, 3)))).mul(oddY).mul(uFolding);
  const foldStep = vec2(alongX as any, alongY as any);
  const { position: positionNode, detailSlope } = surfacePoint(grid.sub(foldStep));

  // Lighting normal from the height gradient at the vertex's own grid point. The detail noise is built once per vertex, at
  // the folded, gapped point: folded edge vertices take the coarse vertex's detail slope (they sit on it), and the debug
  // gap only nudges the fade. The base source slope stays at the unfolded grid point.
  const own = basePoint(grid, float(0));
  const gradient = (source.lattice
    ? latticeGradient(own, detailSlope ? (source.lattice.slopeNode(face, own.lattice) as any).add(detailSlope) : source.lattice.slopeNode(face, own.lattice))
    : detailSlope ? (source.gradientNode(own.global) as any).add(latticeGradient(own, detailSlope)) : source.gradientNode(own.global)) as any;
  const tangential = gradient.sub(own.up.mul(dot(gradient, own.up)));
  const shadingNormal = varying(normalize(own.up.sub(tangential)), 'vLodNormal') as any;
  const patchUv = varying(grid.mul(1 / patchCells), 'vLodPatchUv') as any;
  const level = varying(info.x, 'vLodLevel') as any;

  const hue = fract(level.mul(0.137).add(0.05));
  const palette = vec3(0.5).add(vec3(0.5).mul(cos(vec3(hue, hue.add(1 / 3), hue.add(2 / 3)).mul(2 * Math.PI))));
  const base = mix(vec3(0.62, 0.64, 0.6), palette, uLodColour);
  const light = max(dot(normalize(shadingNormal), uSun), 0).mul(0.85).add(0.2);
  const border = min(min(patchUv.x, float(1).sub(patchUv.x)), min(patchUv.y, float(1).sub(patchUv.y)));
  const line = float(1).sub(smoothstep(0, fwidth(border).mul(1.5), border)).mul(uBounds);
  const colorNode = vec4(mix(base.mul(mix(float(1), light, uLighting)), vec3(0.05, 0.05, 0.08), line.mul(0.85)), 1);

  const ownMaterial = options.material === undefined;
  const material: NodeMaterial = options.material ?? new MeshBasicNodeMaterial({ side: FrontSide });
  material.positionNode = positionNode;
  if (ownMaterial) material.colorNode = colorNode;
  const probeMaterial = new MeshBasicNodeMaterial({ side: FrontSide });
  probeMaterial.positionNode = positionNode;
  probeMaterial.colorNode = vec4(1, 1, 1, 1);
  probeMaterial.toneMapped = false;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'LOD surface';

  const attributes = ['aLeaf', 'aInfo'].map((name) => geometry.getAttribute(name) as InstancedBufferAttribute);
  const [leafData, infoData] = attributes.map((attr) => attr.array as Float32Array);
  const anchor = newAnchor();
  let packedFrom: LodSelector | undefined;
  let packedVersion = -1;
  let packedCount = 0;

  return {
    mesh,
    material,
    probeMaterial,
    upload(selector, camera) {
      if (selector !== packedFrom || selector.version !== packedVersion) {
        packedFrom = selector;
        packedVersion = selector.version;
        packedCount = packLeaves(selector, patchCells, maxLevel, capacity, leafData, infoData);
        // Reuse the one update range of each attribute instead of allocating a new one per upload.
        for (const attr of attributes) {
          const ranges = attr.updateRanges;
          if (ranges.length === 1) {
            ranges[0].start = 0;
            ranges[0].count = Math.max(1, packedCount) * LEAF_STRIDE;
          } else {
            ranges.length = 0;
            ranges.push({ start: 0, count: Math.max(1, packedCount) * LEAF_STRIDE });
          }
          attr.needsUpdate = true;
        }
        geometry.instanceCount = packedCount;
      }
      anchorFor(domain, camera, steps, anchor);
      setVector(uAnchorT.value as Vector3, anchor.t);
      setVector(uAnchorCube.value as Vector3, anchor.cube);
      setVector(uAnchorError.value as Vector3, anchor.error);
      setVector(uAnchorCos.value as Vector3, anchor.cos);
      setVector(uAnchorRel.value as Vector3, anchor.rel);
      return packedCount;
    },
    setView(view) { uLodColour.value = view === 'lod' ? 1 : 0; },
    setBounds(on) { uBounds.value = on ? 1 : 0; },
    setWireframe(on) { (material as NodeMaterial & { wireframe: boolean }).wireframe = on; material.needsUpdate = true; },
    setFolding(on) { uFolding.value = on ? 1 : 0; },
    setInjectedGap(share) { uGap.value = share; },
    setLighting(on) { uLighting.value = on ? 1 : 0; },
    setDetailNoise(share) { uDetailAmp.value = share * detailTexelM; },
    setDetailFade(spacingAngle) { uDetailFade.value = Math.max(spacingAngle, 1e-6); },
    setSun(direction) { (uSun.value as Vector3).set(...direction).normalize(); },
    dispose() {
      geometry.dispose();
      if (ownMaterial) material.dispose();
      probeMaterial.dispose();
    },
  };
}

const setVector = (target: Vector3, v: Vec3): void => {
  target.set(v[0], v[1], v[2]);
};

