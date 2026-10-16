import { Vector3, type IUniform } from 'three';
import {
  asin,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  length,
  mix,
  normalGeometry,
  normalize,
  positionGeometry,
  positionLocal,
  positionWorld,
  select,
  transformNormalToView,
  uniform,
  varying,
  vec3,
} from 'three/tsl';
import {
  equalEarthFlat,
  equirectangularFlat,
  seamProjectedLon,
  seamTriangleCrosses,
} from './projection-nodes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The morph uniforms. Names and value types match the GLSL path's `IDynamicProjectionUniforms`
 * (`worldgen/render`), and a TSL `UniformNode` is structurally an `IUniform<T>`, so the same objects
 * can drive both materials (Plan 050 Phase 0 verified this at type and run time).
 */
export interface IPlanetMorphUniforms {
  /** 0 = sphere, 1 = flat map. */
  uMorph: IUniform<number>;
  uProjForward: IUniform<Vector3>;
  uProjUp: IUniform<Vector3>;
  uProjRight: IUniform<Vector3>;
  /** 0 = static (mix the baked `aSpherePos`/`aFlatPos`), 1 = dynamic basis (project in the shader). */
  uProjMode: IUniform<number>;
  uMapWidth: IUniform<number>;
  uMapHeight: IUniform<number>;
  uRadius: IUniform<number>;
  /** 0 = equirectangular, 1 = Equal Earth. */
  uProjectionType: IUniform<number>;
}

/** Creates the uniform set as TSL uniform nodes (static projection, Equal Earth, unit radius). */
export function createPlanetMorphUniforms(): IPlanetMorphUniforms {
  return {
    uMorph: uniform(0),
    uProjForward: uniform(new Vector3(0, 0, 1)),
    uProjUp: uniform(new Vector3(0, 1, 0)),
    uProjRight: uniform(new Vector3(1, 0, 0)),
    uProjMode: uniform(0),
    uMapWidth: uniform(1),
    uMapHeight: uniform(1),
    uRadius: uniform(1),
    uProjectionType: uniform(1),
  };
}

/** Sets the map extent for a planet of `radiusM`: a 2:1 map, `2 pi r` wide. */
export function setPlanetMapExtent(uniforms: IPlanetMorphUniforms, radiusM: number): void {
  uniforms.uRadius.value = radiusM;
  uniforms.uMapWidth.value = 2 * Math.PI * radiusM;
  uniforms.uMapHeight.value = Math.PI * radiusM;
}

export interface IPlanetMorphGraphOptions {
  /**
   * The geometry's own `position` and `normal` are the sphere position and normal (true for the cell-planet
   * streaming pipeline, which writes `position = aSpherePos`, `normal = aSphereNorm`). Reading them
   * from there instead of `aSpherePos`/`aSphereNorm` saves two vertex buffers. Default true.
   * Set false for geometry whose `position`/`normal` differ from the `aSphere*` attributes.
   */
  readonly sphereFromGeometry?: boolean;
  /**
   * Read `aOtherDir1`/`aOtherDir2` for the vertex-side seam cull in dynamic projection mode. Default false:
   * the streaming pipeline writes zeros there, and WebGPU allows only 8 vertex buffers, which the
   * terrain's attribute set (position, normal, uv, color, aFlatPos, aFlatNorm, macro factor, ...)
   * leaves little room for. The fragment-side `fwidth` cull works without them.
   */
  readonly seamCullAttributes?: boolean;
}

/** Everything stage 1 computes. Position nodes are vertex-stage; the varyings are readable in the fragment stage. */
export interface IPlanetMorphGraph {
  /** `positionNode`: morphed position with the batch transform carried over. */
  readonly positionNode: any;
  /** `normalNode`: the morphed normal in view space. */
  readonly normalNode: any;
  /** Sphere-space unit direction (varying). */
  readonly sphereNormal: any;
  /** Morphed local position before batching (varying). */
  readonly morphedLocal: any;
  /** Unmorphed local position with the batch translation applied (varying). The body-fixed sample point. */
  readonly bodyFixedLocal: any;
  /** Morphed local position with the batch translation applied (varying). The 'morphed' sample point. */
  readonly morphedBatchedLocal: any;
  /** Projected longitude (varying); 0 in static mode. */
  readonly projectedLon: any;
  /** 1 when the triangle spans the antimeridian (varying, constant over a triangle). */
  readonly seamCull: any;
  /** Fragment mask: false where seam-spanning geometry must be discarded. `fwidth` is computed unconditionally. */
  readonly visibleMask: any;
  /** Same as `visibleMask` without derivatives, safe for the shadow pass. */
  readonly visibleMaskShadow: any;
  /** Vertex attributes stage 1 reads, counting against WebGPU's limit of 8 vertex buffers. */
  readonly vertexAttributes: readonly string[];
}

/**
 * Stage 1: sphere <-> flat-map morph. A port of `enablePlanetMorphProjection` as a pure graph.
 *
 * The batching trap: `NodeMaterial` runs `BatchNode` first (writing `batchingMatrix * position` into
 * `positionLocal`) and `positionNode` then replaces `positionLocal`. The batch matrix is private to
 * `BatchNode`, so the per-instance translation is carried over as `positionLocal - positionGeometry`.
 * That is exact for translation-only batch matrices, which is what `TerrainSurfaceComponent` writes
 * (`makeTranslation`). A non-translation batch would need the matrix re-read from the batch textures.
 */
export function planetMorphGraph(
  uniforms: IPlanetMorphUniforms,
  options: IPlanetMorphGraphOptions = {},
): IPlanetMorphGraph {
  const sphereFromGeometry = options.sphereFromGeometry ?? true;
  const seamCullAttributes = options.seamCullAttributes ?? false;
  const morph = uniforms.uMorph as any;
  const mode = uniforms.uProjMode as any;
  const forward = uniforms.uProjForward as any;
  const up = uniforms.uProjUp as any;
  const right = uniforms.uProjRight as any;
  const mapWidth = uniforms.uMapWidth as any;
  const mapHeight = uniforms.uMapHeight as any;
  const projectionType = uniforms.uProjectionType as any;

  const vertexAttributes = ['position', 'normal', 'aFlatPos', 'aFlatNorm'];
  const aFlatPos = attribute('aFlatPos', 'vec3' as const);
  const aFlatNorm = attribute('aFlatNorm', 'vec3' as const);
  let aSpherePos: any = positionGeometry;
  let aSphereNorm: any = normalGeometry;
  if (!sphereFromGeometry) {
    aSpherePos = attribute('aSpherePos', 'vec3' as const);
    aSphereNorm = attribute('aSphereNorm', 'vec3' as const);
    vertexAttributes.push('aSpherePos', 'aSphereNorm');
  }

  const dynamic = mode.greaterThan(0.5);

  // Dynamic basis: project the sphere direction in the tracked frame.
  const dir = aSphereNorm;
  const projLon = seamProjectedLon(dir, forward, right);
  const projLat = asin(clamp(dot(dir, up), -1, 1));
  const flatXY = select(
    projectionType.lessThan(0.5),
    equirectangularFlat(projLon, projLat, mapWidth, mapHeight),
    equalEarthFlat(projLon, projLat, mapWidth),
  );
  const dynFlatPos = vec3(flatXY.x, flatXY.y, aFlatPos.z);
  const flatPos = select(dynamic, dynFlatPos, aFlatPos);
  const flatNorm = select(dynamic, vec3(0, 0, 1), aFlatNorm);

  let cull: any = float(0);
  if (seamCullAttributes) {
    const aOtherDir1 = attribute('aOtherDir1', 'vec3' as const);
    const aOtherDir2 = attribute('aOtherDir2', 'vec3' as const);
    vertexAttributes.push('aOtherDir1', 'aOtherDir2');
    const hasOtherDirs = length(aOtherDir1)
      .greaterThan(0.001)
      .and(length(aOtherDir2).greaterThan(0.001));
    const crosses = seamTriangleCrosses(dir, aOtherDir1, aOtherDir2, forward, right);
    cull = select(dynamic.and(hasOtherDirs).and(crosses), float(1), float(0));
  }

  const morphedLocal = mix(aSpherePos, flatPos, morph);
  const morphedNormal = normalize(mix(aSphereNorm, flatNorm, morph));

  const vProjLon: any = varying(select(dynamic, projLon, float(0)), 'vProjLon');
  const vSeamCull: any = varying(cull, 'vSeamCull');
  const vSphereNorm: any = varying(aSphereNorm, 'vSphereNorm');
  const vMorphedLocal: any = varying(morphedLocal, 'vMorphedLocal');
  // Snapshot the batch translation (`positionLocal` is still batched-but-unmorphed here), so later reads
  // of it are not affected by `positionNode` replacing `positionLocal`.
  const batchOffset = positionLocal.sub(positionGeometry).toVar('planetBatchOffset');
  const vBodyFixedLocal: any = varying(aSpherePos.add(batchOffset), 'vBodyFixedLocal');
  const vMorphedBatched: any = varying(morphedLocal.add(batchOffset), 'vMorphedBatched');

  // GLSL: `vProjMode > 0.5 && vMorph > 0.05 && (vSeamCull > 0.5 || fwidth(vProjLon) > 2.8)`.
  // WGSL only allows derivatives in uniform control flow, so `fwidth` is evaluated once, outside any branch.
  const cullActive = mode.greaterThan(0.5).and(morph.greaterThan(0.05));
  const fw = vProjLon.fwidth().toVar();
  const discardFragment = cullActive.and(vSeamCull.greaterThan(0.5).or(fw.greaterThan(2.8)));
  const discardShadow = cullActive.and(vSeamCull.greaterThan(0.5));

  return {
    positionNode: morphedLocal.add(batchOffset),
    normalNode: transformNormalToView(morphedNormal),
    sphereNormal: vSphereNorm,
    morphedLocal: vMorphedLocal,
    bodyFixedLocal: vBodyFixedLocal,
    morphedBatchedLocal: vMorphedBatched,
    projectedLon: vProjLon,
    seamCull: vSeamCull,
    visibleMask: discardFragment.not(),
    visibleMaskShadow: discardShadow.not(),
    vertexAttributes,
  };
}

/** Distance from the camera to the shaded point, in the fragment stage. */
export function planetCameraDistance(): any {
  return length(cameraPosition.sub(positionWorld));
}
