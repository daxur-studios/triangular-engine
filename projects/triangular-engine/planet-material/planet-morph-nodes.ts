import { Vector3, type IUniform } from 'three';
import {
  asin,
  attribute,
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  length,
  max,
  mix,
  modelWorldMatrix,
  normalGeometry,
  normalize,
  positionGeometry,
  positionLocal,
  positionWorld,
  select,
  sin,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
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
  /**
   * Planet centre in scene space (`bodyCenterSceneM`). Dynamic projection measures body-fixed positions as
   * `modelWorldMatrix * local - this`. Assumes an unrotated patch group.
   */
  uBodyCentreScene: IUniform<Vector3>;
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
    uBodyCentreScene: uniform(new Vector3(0, 0, 0)),
  };
}

/** Longitude mismatch (radians) between the interpolated and the true projected longitude that marks a seam-spanning fragment. */
const SEAM_LON_MISMATCH = 0.3;
/** `|dot(dir, up)|` above which a fragment is within the projection's polar cap and exempt from that check (about 8 degrees). */
const SEAM_POLE_EXEMPT = 0.99;

/**
 * Centres the dynamic projection on `lonDeg`/`latDeg` (body frame; lon 0 = +Z, lat 0 = the equator) and switches
 * `uProjMode` on, writing the whole basis (`uProjForward`, `uProjUp`, `uProjRight`) as the GLSL views'
 * `computeManualBasis` does. Setting `uProjMode` alone leaves the default frame, which is not what a caller wants.
 * Pass `null` to return to the static, baked projection.
 */
export function setPlanetProjectionCentre(
  uniforms: IPlanetMorphUniforms,
  centre: { readonly lonDeg: number; readonly latDeg: number } | null,
): void {
  if (!centre) {
    uniforms.uProjMode.value = 0;
    return;
  }
  const lon = (centre.lonDeg * Math.PI) / 180;
  const lat = (centre.latDeg * Math.PI) / 180;
  const forward = uniforms.uProjForward.value.set(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
  const up = uniforms.uProjUp.value.set(0, 1, 0);
  up.addScaledVector(forward, -forward.y);
  // A centre on a pole has no horizontal tangent: use -Z / +Z as the up reference, as the GLSL helper does.
  if (up.lengthSq() < 1e-8) up.set(0, 0, forward.y > 0 ? -1 : 1);
  up.normalize();
  uniforms.uProjRight.value.crossVectors(up, forward);
  uniforms.uProjMode.value = 1;
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
  /**
   * A `mat3` uniform (`IPlanetMorphLightingUniforms.uMorphLightingTurn`). When set, the shading normal is
   * the sphere normal turned by it, not the morphed normal, so a flat map keeps its relief and sun angle.
   */
  readonly lightingTurn?: unknown;
  /** Shape interpolation mode: 'bend' (default, curvature-based) or 'linear' (Cartesian mix). */
  readonly morphShape?: 'bend' | 'linear';
}

const tslSinc = (a: any): any => {
  const a2 = a.mul(a);
  return select(a2.lessThan(1e-6), float(1).sub(a2.div(6)), sin(a).div(a));
};

const tslPlanetStaticEquirectXY = (
  dirY: any,
  flatPos: any,
  radius: any,
  projType: any,
  mapWidth: any,
): any => {
  const EE_M = 0.8660254037844386;
  const EE_A1 = 1.340264;
  const EE_A2 = -0.081106;
  const EE_A3 = 0.000893;
  const EE_A4 = 0.003796;
  const EE_RAW_X_MAX = 2.7066299836960748;

  const sinLat: any = clamp(dirY, -1, 1);
  const lat: any = asin(sinLat as any);
  const theta = asin(clamp(sinLat.mul(EE_M), -1, 1));
  const theta2 = theta.mul(theta);
  const theta6 = theta2.mul(theta2).mul(theta2);
  const denom = theta6
    .mul(theta2.mul(9 * EE_A4).add(7 * EE_A3))
    .add(theta2.mul(3 * EE_A2))
    .add(EE_A1)
    .mul(EE_M);
  const eeXPerLon = cos(theta).div(denom);
  const scale = float(mapWidth).div(2 * EE_RAW_X_MAX);
  const rawX = flatPos.x.div(scale);
  const eeLon = rawX.div(max(eeXPerLon, 1e-6));
  const eeY = theta
    .mul(theta6.mul(theta2.mul(EE_A4).add(EE_A3)).add(theta2.mul(EE_A2)).add(EE_A1))
    .mul(scale);

  // Same as the GLSL `planetStaticEquirectXY` and the CPU `recoverStaticEquirectXY`: the baked flat y's offset
  // from the projected latitude row is carried over, so geometry nudged off its row in the map stays nudged.
  const eqX = select(projType.lessThan(0.5), flatPos.x, eeLon.mul(radius));
  const eqY = select(projType.lessThan(0.5), flatPos.y, lat.mul(radius).add(flatPos.y.sub(eeY)));
  return vec2(eqX, eqY);
};

const tslPlanetBendTransform = (
  mapXY: any,
  height: any,
  morph: any,
  radius: any,
): { pos: any; east: any; north: any; up: any } => {
  const k = float(1).sub(clamp(morph, 0, 1)).div(max(radius, 1e-4));
  const zCenterShift = float(1).sub(clamp(morph, 0, 1)).mul(radius);
  const kx = k.mul(mapXY.x);
  const ky = k.mul(mapXY.y);
  const cx = cos(kx);
  const sx = sin(kx);
  const cy = cos(ky);
  const sy = sin(ky);
  const outEast = vec3(cx as any, float(0), sx.negate() as any);
  const outNorth = vec3(sy.negate().mul(sx) as any, cy as any, sy.negate().mul(cx) as any);
  const outUp = vec3(cy.mul(sx) as any, sy as any, cx.mul(cy) as any);
  const sincHalfX = tslSinc(float(0.5).mul(kx));
  const sincHalfY = tslSinc(float(0.5).mul(ky));
  const z = float(-0.5)
    .mul(k)
    .mul(mapXY.x)
    .mul(mapXY.x)
    .mul(sincHalfX)
    .mul(sincHalfX)
    .sub(cx.mul(0.5).mul(k).mul(mapXY.y).mul(mapXY.y).mul(sincHalfY).mul(sincHalfY))
    .add(zCenterShift);
  const pos = vec3(
    cy.mul(mapXY.x).mul(tslSinc(kx)) as any,
    mapXY.y.mul(tslSinc(ky)) as any,
    z as any,
  ).add(outUp.mul(height));
  return { pos, east: outEast, north: outNorth, up: outUp };
};

/** Inputs of {@link planetBentSurfaceNodes}. All positions are body-fixed: the planet's centre is the origin. */
export interface IPlanetBentSurfaceInputs {
  /** Sphere point (radius + height along the radial direction). */
  readonly sphere: any;
  /** Unit radial direction of `sphere`, never a terrain normal (that tilts with relief). */
  readonly dir: any;
  /** Flat-map target x/y: the baked position in static mode, the shader-projected one in dynamic mode. */
  readonly flatXY: any;
  /** Height above the flat map's plane. */
  readonly flatHeight: any;
  /** Longitude/latitude of `dir` in the tracked basis (dynamic mode only). Omit for geometry built in the map frame. */
  readonly projLon?: any;
  readonly projLat?: any;
}

/**
 * The bent-planet morph shared by every TSL planet material (terrain, ocean, lines): the point bends on a sphere of
 * curvature `(1 - morph) / R` (centre shifted forward by `(1 - morph) R`), so morph 0 is the globe and morph 1 the flat
 * map, with every in-between shape a piece of a sphere. Mirrors the GLSL `planetBendTransform` path of
 * `enablePlanetMorphProjection` and the CPU `bendPlanetSurfacePoint`. Returns body-frame position and ground frame.
 */
export function planetBentSurfaceNodes(
  uniforms: IPlanetMorphUniforms,
  inputs: IPlanetBentSurfaceInputs,
): { pos: any; east: any; north: any; up: any } {
  const u = uniforms as any;
  const morph = u.uMorph;
  const radius = u.uRadius;
  const dynamic = u.uProjMode.greaterThan(0.5);
  const statEqXY = tslPlanetStaticEquirectXY(inputs.dir.y, inputs.flatXY, radius, u.uProjectionType, u.uMapWidth);
  // Without projected lon/lat the geometry lives in the map frame already (the map's frame): its baked coordinates
  // hold in both modes, and only the final turn into the tracked basis differs.
  const eqXY =
    inputs.projLon !== undefined && inputs.projLat !== undefined
      ? select(dynamic, vec2(inputs.projLon.mul(radius) as any, inputs.projLat.mul(radius) as any), statEqXY)
      : statEqXY;
  const mapXY = mix(eqXY, inputs.flatXY, morph);
  const h = mix(length(inputs.sphere).sub(radius), inputs.flatHeight, morph);
  const bent = tslPlanetBendTransform(mapXY, h, morph, radius);
  // Dynamic mode bends in the tracked basis' map frame (x right, y up, z forward): turn the result back into body
  // axes, so morph 0 is the body-fixed globe and the flat map lies tangent at the tracked point. Same as the GLSL
  // `planetMapFrameToBody` and `CellPlanetMorphCameraRig`.
  const toBody = (v: any): any => u.uProjRight.mul(v.x).add(u.uProjUp.mul(v.y)).add(u.uProjForward.mul(v.z));
  return {
    pos: select(dynamic, toBody(bent.pos), bent.pos),
    east: select(dynamic, toBody(bent.east), bent.east),
    north: select(dynamic, toBody(bent.north), bent.north),
    up: select(dynamic, toBody(bent.up), bent.up),
  };
}

/** Everything stage 1 computes. Position nodes are vertex-stage; the varyings are readable in the fragment stage. */
export interface IPlanetMorphGraph {
  /** `positionNode`: morphed position with the batch transform carried over. */
  readonly positionNode: any;
  /** `normalNode`: the morphed normal in view space. */
  readonly normalNode: any;
  /** Sphere-space unit direction (varying). On terrain this is the surface normal, which tilts with relief. */
  readonly sphereNormal: any;
  /** Unit direction from the planet centre to the shaded point (fragment stage): geography lookups use this, not the tilted normal. */
  readonly radialDirection: any;
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
  const morphShape = options.morphShape ?? 'bend';
  const morph = uniforms.uMorph as any;
  const mode = uniforms.uProjMode as any;
  const forward = uniforms.uProjForward as any;
  const up = uniforms.uProjUp as any;
  const right = uniforms.uProjRight as any;
  const mapWidth = uniforms.uMapWidth as any;
  const mapHeight = uniforms.uMapHeight as any;
  const projectionType = uniforms.uProjectionType as any;
  const bodyCentreScene = uniforms.uBodyCentreScene as any;

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

  // Dynamic basis: project the radial direction in the tracked frame. It is the body-fixed position
  // normalised, not `aSphereNorm`: on terrain that is the surface normal, which tilts with relief.
  // `batchOffset` is a `toVar` read first inside `positionNode` (written `batchOffset.add(morphedLocal)` so it
  // builds before anything else reads `positionLocal`): there `positionLocal` is the batched, unmorphed
  // position. An inline expression, or a read from another node first, sees it after `positionNode` replaced it.
  // Streamed tiles store `aSpherePos`/`aFlatPos` relative to the patch centre, which the batch/mesh translation
  // restores, so the absolute direction adds it back and the absolute map position takes it off again.
  const batchOffset = positionLocal.sub(positionGeometry).toVar('planetBatchOffset');
  // The batch matrix holds `centerWorldM - batchAnchor` and the anchor (it follows the camera) sits in
  // `modelWorldMatrix`, so local positions are anchor-relative: lift through the model matrix to get the
  // patch's body-fixed offset (0 when the worker sets no render origin).
  const bodyShift = modelWorldMatrix
    .mul(vec4(batchOffset, 1))
    .xyz.sub(bodyCentreScene)
    .toVar('planetDynBodyShift');
  const dir = normalize(aSpherePos.add(bodyShift)).toVar('planetRadialDir');
  const projLon = seamProjectedLon(dir, forward, right);
  const projLat = asin(clamp(dot(dir, up), -1, 1));
  const flatXY = select(
    projectionType.lessThan(0.5),
    equirectangularFlat(projLon, projLat, mapWidth, mapHeight),
    equalEarthFlat(projLon, projLat, mapWidth),
  );
  const dynFlatPos = vec3(flatXY.x.sub(bodyShift.x), flatXY.y.sub(bodyShift.y), aFlatPos.z);
  const flatPos = select(dynamic, dynFlatPos, aFlatPos);
  // Static mode uses the baked flat normal, which carries the terrain relief for the baked projection centre. In
  // dynamic mode the map is re-centred in the shader and that relief frame no longer matches, so the flat normal
  // is plain +Z, as in the GLSL material.
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

  let morphedLocal: any;
  let morphedNormal: any;

  if (morphShape === 'linear') {
    morphedLocal = mix(aSpherePos, flatPos, morph);
    const blendedNormal = mix(aSphereNorm, flatNorm, morph);
    const blendedLength = length(blendedNormal);
    morphedNormal = select(blendedLength.greaterThan(1e-4), blendedNormal.div(blendedLength), flatNorm);
  } else {
    // Streamed tiles store `aSpherePos`/`aFlatPos` relative to the patch centre; the bend needs the absolute
    // body-fixed point (curvature is about the planet centre), then the shift is taken off again.
    const absFlat = flatPos.add(bodyShift);
    const bent = planetBentSurfaceNodes(uniforms, {
      sphere: aSpherePos.add(bodyShift),
      dir,
      flatXY: absFlat.xy,
      flatHeight: absFlat.z,
      projLon,
      projLat,
    });
    // At morph 0 keep the baked sphere point exact (the bend reproduces it only to float precision at planet scale).
    morphedLocal = select(morph.lessThan(1e-4), aSpherePos, bent.pos.sub(bodyShift));
    const bentReliefNorm = flatNorm.x
      .mul(bent.east)
      .add(flatNorm.y.mul(bent.north))
      .add(flatNorm.z.mul(bent.up));
    const blendedNormal = mix(aSphereNorm, bentReliefNorm, morph);
    const blendedLength = length(blendedNormal);
    const normalizedBlended = select(blendedLength.greaterThan(1e-4), blendedNormal.div(blendedLength), bentReliefNorm);
    morphedNormal = select(morph.lessThan(1e-4), aSphereNorm, normalizedBlended);
  }

  const vProjLon: any = varying(select(dynamic, projLon, float(0)), 'vProjLon');
  // Constant 0 without aOtherDir attributes: do not spend an inter-stage slot (16 max) on it.
  const vSeamCull: any = seamCullAttributes ? varying(cull, 'vSeamCull') : float(0);
  const vSphereNorm: any = varying(aSphereNorm, 'vSphereNorm');
  const vMorphedLocal: any = varying(morphedLocal, 'vMorphedLocal');
  // Snapshot the batch translation (`positionLocal` is still batched-but-unmorphed here), so later reads
  // of it are not affected by `positionNode` replacing `positionLocal`.
  const vBodyFixedLocal: any = varying(aSpherePos.add(batchOffset), 'vBodyFixedLocal');
  const vMorphedBatched: any = varying(morphedLocal.add(batchOffset), 'vMorphedBatched');
  // The morphed normal reads `dir` and `bodyShift`, which come from `batchOffset`. Left as an expression it would be
  // rebuilt in the fragment stage by `normalNode`, where `positionLocal` is the varying of whatever `positionNode`
  // produced (the morph displacement, or a camera-relative position), so the projection would follow that.
  // Evaluate it in the vertex stage. Skipped under `lightingTurn`, which shades with the sphere normal and
  // must not spend an inter-stage slot (16 max) on a normal it never reads.
  const vMorphedNormal: any = options.lightingTurn ? null : varying(morphedNormal, 'vMorphedNormal');

  // GLSL: `vProjMode > 0.5 && vMorph > 0.001 && (vSeamCull > 0.5 || fwidth(vProjLon) > 2.8)`.
  // WGSL only allows derivatives in uniform control flow, so `fwidth` is evaluated once, outside any branch.
  const cullActive = mode.greaterThan(0.5).and(morph.greaterThan(0.001));
  const fw = vProjLon.fwidth().toVar();
  // Attribute-free seam check for geometry without `aOtherDir1/2` (indexed streaming tiles). Across a triangle
  // that spans the antimeridian the interpolated `vProjLon` runs the long way round, so it parts from the
  // longitude of the interpolated direction by up to a full turn, at any triangle size. Inside an ordinary
  // triangle the two agree to a few hundredths of a radian. Near the projection pole longitude changes fast
  // and linear interpolation is legitimately off, so that cap is exempt.
  // `vBodyFixedLocal` is anchor-relative; `modelWorldMatrix` is a uniform, so lift it here (no extra varying).
  const bodyDirFrag = modelWorldMatrix.mul(vec4(vBodyFixedLocal, 1)).xyz.sub(bodyCentreScene);
  const trueLon = seamProjectedLon(bodyDirFrag, forward, right);
  const lonMismatch = vProjLon
    .sub(trueLon)
    .abs()
    .greaterThan(SEAM_LON_MISMATCH)
    .and(dot(normalize(bodyDirFrag), up).abs().lessThan(SEAM_POLE_EXEMPT));
  const seamSpan = vSeamCull.greaterThan(0.5).or(lonMismatch);
  const discardFragment = cullActive.and(seamSpan.or(fw.greaterThan(2.8)));
  const discardShadow = cullActive.and(seamSpan);

  return {
    positionNode: batchOffset.add(morphedLocal),
    normalNode: transformNormalToView(
      options.lightingTurn ? normalize((options.lightingTurn as any).mul(aSphereNorm)) : normalize(vMorphedNormal),
    ),
    sphereNormal: vSphereNorm,
    radialDirection: normalize(bodyDirFrag),
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
