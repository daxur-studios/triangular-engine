import { Color, DoubleSide } from 'three';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs,
  asin,
  attribute,
  clamp,
  dot,
  float,
  length,
  max,
  mix,
  select,
  smoothstep,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { IPlanetMorphUniforms } from './planet-morph-nodes';
import {
  equalEarthFlat,
  equirectangularFlat,
  seamEdgeCrosses,
  seamProjectedLon,
} from './projection-nodes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Flat-map x/y for a projected lon/lat under the live projection type (equirectangular or Equal Earth). */
function flatXY(uniforms: IPlanetMorphUniforms, lon: any, lat: any): any {
  const u = uniforms as any;
  return select(
    u.uProjectionType.lessThan(0.5),
    equirectangularFlat(lon, lat, u.uMapWidth, u.uMapHeight),
    equalEarthFlat(lon, lat, u.uMapWidth),
  );
}

export interface IPlanetBorderMaterialOptions {
  readonly color?: string | Color;
  readonly opacity?: number;
  /**
   * Flat-map ribbon width (map units). 0 draws plain lines (`LineBasicNodeMaterial`, for `LineSegments`).
   * Above 0 the geometry is a triangle ribbon (`MeshBasicNodeMaterial`): each vertex is pushed sideways in the
   * flat map, using `uv` for the side and the segment direction.
   */
  readonly ribbonWidth?: number;
}

export interface IPlanetBorderMaterial {
  readonly material: LineBasicNodeMaterial | MeshBasicNodeMaterial;
  readonly color: any;
  readonly opacity: any;
  readonly ribbonWidth: any;
  /** Vertex attributes read, counting against WebGPU's limit of 8 vertex buffers. */
  readonly vertexAttributes: readonly string[];
}

/**
 * Cell-grid / border lines that follow the sphere <-> flat morph. A port of `createPlanetBorderMorphMaterial`.
 *
 * Reads `aSpherePos`, `aFlatPos`, `aSphereNorm` and `aOtherDir` (the segment's other end, for the seam test), plus
 * `uv` when a ribbon is used. Edges that cross the antimeridian are discarded while morphing (the GLSL moves
 * the vertex off-screen; here the whole primitive is discarded in the fragment stage, which is equivalent
 * because both vertices of an edge agree on whether it crosses), and so is anything the `fwidth` test catches.
 */
export function planetBorderMaterial(
  uniforms: IPlanetMorphUniforms,
  options: IPlanetBorderMaterialOptions = {},
): IPlanetBorderMaterial {
  const u = uniforms as any;
  const color: any = uniform(options.color instanceof Color ? options.color : new Color(options.color ?? '#ffffff'));
  const opacity: any = uniform(options.opacity ?? 0.6);
  const ribbonWidth: any = uniform(options.ribbonWidth ?? 0);
  const ribbon = (options.ribbonWidth ?? 0) > 0;

  const aSpherePos = attribute('aSpherePos', 'vec3' as const);
  const aFlatPos = attribute('aFlatPos', 'vec3' as const);
  const aSphereNorm = attribute('aSphereNorm', 'vec3' as const);
  const aOtherDir = attribute('aOtherDir', 'vec3' as const);
  const vertexAttributes = ['aSpherePos', 'aFlatPos', 'aSphereNorm', 'aOtherDir'];

  const dynamic = u.uProjMode.greaterThan(0.5);
  const pLon = seamProjectedLon(aSphereNorm, u.uProjForward, u.uProjRight);
  const pLat = asin(clamp(dot(aSphereNorm, u.uProjUp), -1, 1));
  let flat: any = flatXY(uniforms, pLon, pLat);

  if (ribbon) {
    vertexAttributes.push('uv');
    const oLon = seamProjectedLon(aOtherDir, u.uProjForward, u.uProjRight);
    const oLat = asin(clamp(dot(aOtherDir, u.uProjUp), -1, 1));
    const other = flatXY(uniforms, oLon, oLat);
    const d = other.sub(flat);
    const dLen = length(d);
    const flip = select(uv().y.lessThan(0.5), float(1), float(-1));
    const segDir = d.div(max(dLen, 1e-12)).mul(flip);
    const sideDir = vec2(segDir.y.negate(), segDir.x);
    const sideSign = select(uv().x.lessThan(0.5), float(-1), float(1));
    const offset = sideDir.mul(ribbonWidth.mul(0.5).mul(sideSign));
    flat = select(ribbonWidth.greaterThan(0.0001).and(dLen.greaterThan(0.00001)), flat.add(offset), flat);
  }

  const dynFlatPos = vec3(flat.x, flat.y, aFlatPos.z);
  const flatPos = select(dynamic, dynFlatPos, aFlatPos);
  const position = mix(aSpherePos, flatPos, u.uMorph);

  const vProjLon: any = varying(select(dynamic, pLon, float(0)), 'vBorderProjLon');
  const crosses = seamEdgeCrosses(aSphereNorm, aOtherDir, u.uProjForward, u.uProjRight);
  const vCull: any = varying(select(dynamic.and(crosses), float(1), float(0)), 'vBorderSeamCull');
  const cullActive = dynamic.and(u.uMorph.greaterThan(0.05));
  // `fwidth` is evaluated unconditionally (WGSL: derivatives only in uniform control flow).
  const fw = vProjLon.fwidth().toVar();
  const hidden = cullActive.and(vCull.greaterThan(0.5).or(fw.greaterThan(2.8)));

  const material = ribbon ? new MeshBasicNodeMaterial() : new LineBasicNodeMaterial();
  material.positionNode = position;
  material.colorNode = vec4(color, opacity);
  material.maskNode = hidden.not();
  material.transparent = true;
  material.depthWrite = false;
  material.side = DoubleSide;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -4;
  return { material, color, opacity, ribbonWidth, vertexAttributes };
}

export type PlanetMapBorderStyle = 'simple' | 'cartographic' | 'tactical';

export interface IPlanetMapBorderMaterialOptions {
  readonly color?: string | Color;
  readonly opacity?: number;
  readonly borderStyle?: PlanetMapBorderStyle;
  /** Morph at which the frame is fully visible (default 0.6). */
  readonly fadeStart?: number;
  /** Morph at which it disappears (default 0.4). */
  readonly fadeEnd?: number;
}

export interface IPlanetMapBorderMaterial {
  readonly material: MeshBasicNodeMaterial;
  readonly color: any;
  readonly opacity: any;
  /** 0 simple, 1 cartographic, 2 tactical. A uniform: switching styles does not recompile. */
  readonly style: any;
  readonly fadeStart: any;
  readonly fadeEnd: any;
  readonly vertexAttributes: readonly string[];
}

const STYLE_CODES: Record<PlanetMapBorderStyle, number> = { simple: 0, cartographic: 1, tactical: 2 };

/**
 * The flat-map frame that fades in as the globe unrolls. A port of `createPlanetMapBorderMaterial`.
 * Reads `aSpherePos`, `aFlatPos`, `aSphereNorm`, `aTick` and `uv`.
 */
export function planetMapBorderMaterial(
  uniforms: IPlanetMorphUniforms,
  options: IPlanetMapBorderMaterialOptions = {},
): IPlanetMapBorderMaterial {
  const u = uniforms as any;
  const color: any = uniform(options.color instanceof Color ? options.color : new Color(options.color ?? '#38bdf8'));
  const opacity: any = uniform(options.opacity ?? 0.85);
  const style: any = uniform(STYLE_CODES[options.borderStyle ?? 'simple']);
  const fadeStart: any = uniform(options.fadeStart ?? 0.6);
  const fadeEnd: any = uniform(options.fadeEnd ?? 0.4);

  const aSpherePos = attribute('aSpherePos', 'vec3' as const);
  const aFlatPos = attribute('aFlatPos', 'vec3' as const);
  const aSphereNorm = attribute('aSphereNorm', 'vec3' as const);
  const aTick = attribute('aTick', 'float' as const);

  // Dynamic basis: re-express the sphere point in the tracked frame, keeping its displaced radius.
  const rotated = u.uProjRight
    .mul(aSphereNorm.x)
    .add(u.uProjUp.mul(aSphereNorm.y))
    .add(u.uProjForward.mul(aSphereNorm.z));
  const centre = vec3(0, 0, u.uRadius);
  const rDisplaced = length(aSpherePos.add(centre));
  const sphere = select(u.uProjMode.greaterThan(0.5), rotated.mul(rDisplaced).sub(centre), aSpherePos);

  const vUv: any = varying(uv(), 'vMapBorderUv');
  const vTick: any = varying(aTick, 'vMapBorderTick');
  const fade = clamp(u.uMorph.sub(fadeEnd).div(fadeStart.sub(fadeEnd)), 0, 1);

  // Cartographic: double neatline with coordinate ticks.
  const neatlines = max(
    float(1).sub(smoothstep(0.04, 0.12, abs(vUv.y.sub(0.15)))),
    float(1).sub(smoothstep(0.04, 0.12, abs(vUv.y.sub(0.85)))),
  );
  const tick = select(vTick.greaterThan(0.5), float(1), float(0));
  const tickSpan = tick.mul(float(1).sub(smoothstep(0.12, 0.55, vUv.y)));
  const cartoMask = max(neatlines, tickSpan);
  const cartoColour = mix(color.mul(0.55), color.mul(1.35), cartoMask);
  const cartoAlpha = mix(opacity.mul(fade).mul(0.45), opacity.mul(fade), cartoMask);

  // Tactical HUD: neon edges with ticks.
  const innerGlow = float(1).sub(smoothstep(0, 0.25, vUv.y));
  const outerGlow = smoothstep(0.75, 1, vUv.y);
  const tacticalMask = max(outerGlow, tick);
  const tacticalColour = mix(color.mul(0.8), vec3(1, 1, 1), tacticalMask);
  const tacticalAlpha = mix(opacity.mul(fade).mul(0.3), opacity.mul(fade), max(max(innerGlow, outerGlow), tick));

  const rgb: any = select(style.lessThan(0.5), color, select(style.lessThan(1.5), cartoColour, tacticalColour));
  const alpha: any = select(style.lessThan(0.5), opacity.mul(fade), select(style.lessThan(1.5), cartoAlpha, tacticalAlpha));

  const material = new MeshBasicNodeMaterial();
  material.positionNode = mix(sphere, aFlatPos, u.uMorph);
  material.colorNode = vec4(rgb, alpha);
  material.maskNode = fade.greaterThan(0.001);
  material.transparent = true;
  material.depthWrite = false;
  material.side = DoubleSide;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1.5;
  material.polygonOffsetUnits = -4;
  return {
    material,
    color,
    opacity,
    style,
    fadeStart,
    fadeEnd,
    vertexAttributes: ['aSpherePos', 'aFlatPos', 'aSphereNorm', 'aTick', 'uv'],
  };
}
