/* eslint-disable @typescript-eslint/no-explicit-any */
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, Vector2, Vector3, Vector4 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { abs, attribute, cross, dFdx, dFdy, dot, float, floor, min, mod, normalize, positionView, select, step, uniform, varying, vec3, vec4 } from 'three/tsl';
import type { LodDomain } from './lod-domain';
import { latticeSteps } from './lod-lattice';
import type { MorphFrame } from './lod-morph-frame';
import { OUTLINE_WRAP, latticeOffset, outlineDistances, p2Position, type MorphLattice, type MorphOutline } from './lod-morph-math';
import { MORPH_FAR, MORPH_TSL_LIB, type MorphStage } from './lod-morph-stage';
import { fanFrameWords, fanPolarPosition, packPoleFanVertices, type FanFrameNodes, type PoleFanSpecs } from './lod-morph-fan';
import { maxLevelFor, type PatchCells } from './lod-selector';

/**
 * Plan 059, step G6d, the GPU side of the pole fan: the vertex stage of the fan's descriptions (`lod-morph-fan.ts`) as TSL nodes over
 * {@link MORPH_TSL_LIB}. Everything the stage reads is an attribute of a fan vertex (set when the topology is built) or a uniform the
 * CPU writes each frame ({@link PoleFanStage.setFrame}); the camera, the morph and the projection move the vertices without a rebuild.
 *
 * A chord vertex is the point on the chord between two grid vertices of its leaf. Each end runs the lattice stage the leaf's neighbours
 * run (`latticeOffset` from the anchor and from the pole, then `p2Position`, with the leaf's folding), so a boundary sample is the vertex
 * the neighbour draws. A polar vertex runs `p2FromAngles` from double-float differences of its longitude and colatitude and the anchor's
 * values (`fanPolarPosition`). Fragments outside the map's outline are discarded with the leaves' own test (`MorphStage.keepNode`), which
 * takes off the overhang of a copy across the cut.
 *
 * The fan is drawn in a flat colour with its own material: a supplied surface material does not reach it, and it has no height (it sits
 * on the base sphere, as the morph's uniform-height vertices do).
 */

/** The attribute names of the fan's vertex inputs, in the order {@link packPoleFanVertices} gives them. */
export const FAN_ATTRIBUTES = ['aFanLeaf', 'aFanGrid', 'aFanRef', 'aFanPolar1', 'aFanPolar2', 'aFanMisc'] as const;

/** The lattice uniforms of the mesh that the fan's chord ends are evaluated with: the anchor's lattice values and the face axes. */
export interface PoleFanLattice {
  /** The anchor's lattice vector T (vec3 uniform). */
  readonly anchorT: any;
  /** The anchor's cube point, its rounding error and `cos(pi/4 T/L)` (vec3 uniforms). */
  readonly anchorCube: any;
  readonly anchorError: any;
  readonly anchorCos: any;
  /** The face axes as the mesh holds them (`uniformArray`: element 2 face is the face's u axis, 2 face + 1 its v axis). */
  readonly frames: any;
  /** The vertex stage's folding switch (float, 1 on). */
  readonly folding: any;
}

/** The fan's mesh and its per-frame and per-build entry points. */
export interface PoleFanStage {
  /** The fan's mesh, positioned like the surface (its vertices are camera-relative). Hidden until it has triangles. */
  readonly mesh: Mesh;
  /** The fan's material (a flat colour, the clip of the outline). */
  readonly material: MeshBasicNodeMaterial;
  /** Writes the frame's uniforms: the polar path's anchor values, the poles and the outline. Allocates nothing of its own. */
  setFrame(frame: MorphFrame): void;
  /** Replaces the fan's vertices and triangles from the topology's descriptions (`undefined` empties it). */
  upload(specs: PoleFanSpecs | undefined): void;
  /** Releases the geometry and the material. */
  dispose(): void;
}

/**
 * Builds the fan's vertex stage. `morph` is the surface's morph stage (its anchor values and the outline clip are shared with it), `lattice`
 * the mesh's lattice uniforms, `domain` the sphere the fan is drawn on and `patchCells` the surface's grid.
 */
export function createPoleFanStage(domain: LodDomain, patchCells: PatchCells, morph: MorphStage, lattice: PoleFanLattice): PoleFanStage {
  const steps = latticeSteps(patchCells, maxLevelFor(patchCells));
  const cells = float(patchCells);
  const latticeKind: MorphLattice = { steps, equalAngle: domain.warp === 'equal-angle' };
  const L = MORPH_TSL_LIB;
  const anchor = morph.anchor;
  const anchorT = [lattice.anchorT.x, lattice.anchorT.y, lattice.anchorT.z];
  const anchorOrigin = {
    cube: [lattice.anchorCube.x, lattice.anchorCube.y, lattice.anchorCube.z],
    error: [lattice.anchorError.x, lattice.anchorError.y, lattice.anchorError.z],
    cos: [lattice.anchorCos.x, lattice.anchorCos.y, lattice.anchorCos.z],
  };
  const poleOrigin = { cube: anchor.poleCube, error: anchor.poleError, cos: anchor.poleCos };

  // The polar path's per-frame values as float32 double-floats (`fanFrameWords`), and the poles' lattice vectors (far away when a pole is
  // not a lattice vertex, so that `onPole` is false).
  const uPs = uniform(new Vector4()) as any;
  const uCol = uniform(new Vector4()) as any;
  const uLam = uniform(new Vector2()) as any;
  const F: FanFrameNodes<any> = {
    psHiP: uPs.x, psHiM: uPs.y, psLoP: uPs.z, psLoM: uPs.w,
    colHiP: uCol.x, colHiM: uCol.y, colLoP: uCol.z, colLoM: uCol.w,
    lamHi: uLam.x, lamLo: uLam.y,
  };
  const uPoleUp = uniform(new Vector3(MORPH_FAR, MORPH_FAR, MORPH_FAR)) as any;
  const uPoleDown = uniform(new Vector3(MORPH_FAR, MORPH_FAR, MORPH_FAR)) as any;
  const outline: MorphOutline<any> = {
    right: Array.from({ length: 2 * OUTLINE_WRAP + 1 }, () => uniform(0)),
    left: Array.from({ length: 2 * OUTLINE_WRAP + 1 }, () => uniform(0)),
    top: uniform(0),
    bottom: uniform(0),
  };
  const scratch = new Float64Array(10);

  const bit = (mask: any, e: number) => mod(floor(mask.div(2 ** e)), 2);
  const onPole = (t: any[], pole: any) => abs(t[0].sub(pole.x)).add(abs(t[1].sub(pole.y))).add(abs(t[2].sub(pole.z))).lessThan(0.5);
  const vec3Of = (v: readonly any[]): any => vec3(v[0], v[1], v[2]);

  /**
   * One end of a chord: a grid vertex of the leaf placed near longitude `ref`, through the lattice stage (folded as the neighbours fold it)
   * and P2. `poleLon` is the longitude the exact pole vertex takes (the edge's, or `ref` where the leaf gives none).
   */
  const endAt = (gx: any, gy: any, leaf: any, mask: any, ref: any, poleLon: any) => {
    const south = float(1).sub(step(0.5, gy));
    const north = step(cells.sub(0.5), gy);
    const west = float(1).sub(step(0.5, gx));
    const east = step(cells.sub(0.5), gx);
    const oddX = mod(gx, 2);
    const oddY = mod(gy, 2);
    const alongX = min(1, south.mul(bit(mask, 0)).add(north.mul(bit(mask, 2)))).mul(oddX).mul(lattice.folding);
    const alongY = min(1, east.mul(bit(mask, 1)).add(west.mul(bit(mask, 3)))).mul(oddY).mul(lattice.folding);
    const lx = leaf.x.add(gx.sub(alongX).mul(leaf.z));
    const ly = leaf.y.add(gy.sub(alongY).mul(leaf.z));
    const face = leaf.w.toInt();
    const axisU = lattice.frames.element(face.mul(2));
    const axisV = lattice.frames.element(face.mul(2).add(1));
    const axisN = axisU.cross(axisV);
    const t = axisN.mul(steps).add(axisU.mul(lx.mul(2).sub(steps))).add(axisV.mul(ly.mul(2).sub(steps)));
    const tv = [t.x, t.y, t.z];
    const dT = tv.map((x, k) => x.sub(anchorT[k]));
    const fromAnchor = latticeOffset(L, latticeKind, tv as any, dT as any, anchorOrigin as any);
    const dTp = tv.map((x, k) => x.sub(anchor.poleHi[k]).sub(anchor.poleLo[k]));
    const fromPole = latticeOffset(L, latticeKind, tv as any, dTp as any, poleOrigin as any);
    const is = onPole(tv, uPoleUp).or(onPole(tv, uPoleDown));
    const p2 = p2Position(L, anchor, fromAnchor.du, fromPole.du, float(1), float(0), { is, lon: poleLon }, ref);
    const d = outlineDistances(L, anchor, outline, p2);
    return { rel: vec3Of(p2.rel), edges: vec4(d[0], d[1], d[2], d[3]), dlam: p2.dlam, du: vec3Of(fromAnchor.du) };
  };

  /** A fan vertex: a chord point between its two ends, or a polar point; the camera-relative position and the clip's inputs. */
  const position = (inputs: { leaf: any; grid: any; ref: any; polar1: any; polar2: any; misc: any }) => {
    const { leaf, grid, ref, polar1, polar2, misc } = inputs;
    const mask = misc.x;
    // A leaf with a pole at a corner (`misc.y >= 0`) gives its exact pole vertex the meridian edge's longitude (`ref.w`); otherwise the
    // vertex keeps the longitude it is placed near.
    const corner = misc.y.greaterThan(-0.5);
    const a = endAt(grid.x, grid.y, leaf, mask, ref.x, select(corner, ref.w, ref.x));
    const b = endAt(grid.z, grid.w, leaf, mask, ref.y, select(corner, ref.w, ref.y));
    const w = ref.z;
    const chordRel = a.rel.add(b.rel.sub(a.rel).mul(w));
    const chordEdges = a.edges.add(b.edges.sub(a.edges).mul(w));
    const chordDlam = a.dlam.add(b.dlam.sub(a.dlam).mul(w));
    const chordDu = a.du.add(b.du.sub(a.du).mul(w));
    const params = { lonHi: polar1.x, lonLo: polar1.y, cHi: polar1.z, cLo: polar1.w, eHi: polar2.x, eLo: polar2.y, sgn: polar2.z };
    const p = fanPolarPosition(L, anchor, F, params, float(0));
    const pe = outlineDistances(L, anchor, outline, p);
    const isPolar = polar2.w.greaterThan(0.5);
    return {
      rel: select(isPolar, vec3Of(p.rel), chordRel),
      edges: select(isPolar, vec4(pe[0], pe[1], pe[2], pe[3]), chordEdges),
      dlam: select(isPolar, p.dlam, chordDlam),
      du: select(isPolar, vec3(0, 0, 0), chordDu),
    };
  };

  const out = position({
    leaf: attribute(FAN_ATTRIBUTES[0], 'vec4'), grid: attribute(FAN_ATTRIBUTES[1], 'vec4'), ref: attribute(FAN_ATTRIBUTES[2], 'vec4'),
    polar1: attribute(FAN_ATTRIBUTES[3], 'vec4'), polar2: attribute(FAN_ATTRIBUTES[4], 'vec4'), misc: attribute(FAN_ATTRIBUTES[5], 'vec4'),
  });
  // The clip is the leaves' own test with no torn leaf (the fan has no seam triangles): the vertex values are interpolated across each
  // triangle, as the leaves' clip reads them.
  const keep = morph.keepNode(
    varying(out.edges, 'vFanEdge') as any, varying(out.dlam, 'vFanDlam') as any, varying(out.du, 'vFanDu') as any, float(0), float(0),
  );
  const light = abs(dot(normalize(cross(dFdx(positionView), dFdy(positionView))), normalize(vec3(0.3, 0.6, 0.75)))).mul(0.75).add(0.25);
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.positionNode = out.rel;
  material.maskNode = keep;
  material.colorNode = vec4(vec3(0.3, 0.8, 0.9).mul(light), 1);

  const placeholder = (): BufferGeometry => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    const zero = new BufferAttribute(new Float32Array(4), 4);
    for (const name of FAN_ATTRIBUTES) g.setAttribute(name, zero);
    g.setIndex(new BufferAttribute(new Uint32Array(3), 1));
    g.setDrawRange(0, 0);
    return g;
  };
  let geometry = placeholder();
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'LOD pole fan';
  mesh.visible = false;

  return {
    mesh,
    material,
    setFrame(frame) {
      fanFrameWords(frame.values, scratch);
      (uPs.value as Vector4).set(scratch[0], scratch[1], scratch[2], scratch[3]);
      (uCol.value as Vector4).set(scratch[4], scratch[5], scratch[6], scratch[7]);
      (uLam.value as Vector2).set(scratch[8], scratch[9]);
      const o = frame.outline;
      for (let i = 0; i < 2 * OUTLINE_WRAP + 1; i++) {
        (outline.right[i] as any).value = o.right[i];
        (outline.left[i] as any).value = o.left[i];
      }
      (outline.top as any).value = o.top;
      (outline.bottom as any).value = o.bottom;
      const up = frame.poles[0];
      const down = frame.poles[1];
      if (up) (uPoleUp.value as Vector3).set(up[0], up[1], up[2]);
      else (uPoleUp.value as Vector3).set(MORPH_FAR, MORPH_FAR, MORPH_FAR);
      if (down) (uPoleDown.value as Vector3).set(down[0], down[1], down[2]);
      else (uPoleDown.value as Vector3).set(MORPH_FAR, MORPH_FAR, MORPH_FAR);
    },
    upload(specs) {
      const next = specs && specs.index.length > 0 ? fanGeometry(specs) : placeholder();
      mesh.visible = !!specs && specs.index.length > 0;
      mesh.geometry = next;
      geometry.dispose();
      geometry = next;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** The fan's geometry from its descriptions: the packed attributes and the triangles (`position` is a placeholder for the draw). */
function fanGeometry(specs: PoleFanSpecs): BufferGeometry {
  const data = packPoleFanVertices(specs);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(data.vertexCount * 3), 3));
  const sources = [data.leaf, data.grid, data.ref, data.polar1, data.polar2, data.misc];
  FAN_ATTRIBUTES.forEach((name, k) => g.setAttribute(name, new BufferAttribute(sources[k], 4)));
  g.setIndex(new BufferAttribute(data.index, 1));
  return g;
}
