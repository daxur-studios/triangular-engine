import { Vector3, Vector4 } from 'three';
import { Fn, If, Loop, abs, clamp, dot, float, length, max, min, mix, normalize, select, smoothstep, uniform, uniformArray, vec2, vec3 } from 'three/tsl';
import type { IPlanetContext, SurfaceLayer } from 'triangular-engine/planet-material';
import { PIXEL_PER_DISTANCE } from './forest-field';
import { MIN_SUN_TAN } from './forest-shading';
import { bodyFixed, shadowFactorNode, splitLayerWeight, sunUpRamp, type IForestLayer } from './forest-layer';
import { buildingBands, buildingTone, type IBuilding } from './building-field';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Size of the building uniform arrays: the placement keeps "a few dozen", well under this. */
export const MAX_BUILDINGS = 64;

export interface IBuildingLayer {
  readonly layer: SurfaceLayer;
  /** Live uniforms: change `.value`, nothing recompiles. */
  readonly uniforms: {
    /** 0 hides both forms (the panel's show toggle). */
    readonly enabled: any;
    readonly meshStartM: any;
    readonly meshEndM: any;
  };
  /** Opacity of the building meshes at a camera distance (node): 1 near, 0 once the footprint has taken over. */
  meshOpacity(distance: any): any;
  /** Colour of a roof and a wall before the per-building tone. */
  readonly roofAlbedo: any;
  /** Hands the placed list to the shader (at most {@link MAX_BUILDINGS}). */
  setBuildings(buildings: readonly IBuilding[]): void;
  /** The runway's tangent frame, which the building list is placed in. */
  setSite(along: readonly number[], across: readonly number[]): void;
}

/**
 * Plan 063 spike S1, the building class's far form. Per pixel, over the placed list (a uniform array, a few dozen
 * entries), in the runway's tangent frame:
 *
 * - Roof: the footprint box, in the roof tone, once the meshes have dissolved (`meshStartM`..`meshEndM`, about 4 km).
 * - Shadow: the convex hull of the footprint and the footprint moved away from the sun by `height / tan(elevation)`
 *   (`footprintShadowDistance` of `building-field.ts`, the CPU twin), darkened by the same sky-only factor as the
 *   trees' shadows. Drawn at every distance, since the meshes cast none; up close the mesh hides the part under it.
 * - Gone: each building's far form fades from 2 px to 1 px of its smallest side.
 *
 * No march: a flat-ground shadow, so it does not climb slopes or fall on other roofs. Baked into the albedo like the
 * forest's (see `forestLayer`), for the same temporary reason.
 */
export function buildingLayer(forest: IForestLayer): IBuildingLayer {
  const bands = buildingBands();
  const enabled: any = uniform(1);
  const meshStartM: any = uniform(bands.meshStartM);
  const meshEndM: any = uniform(bands.meshEndM);
  const count: any = uniform(0, 'int');
  const roofAlbedo: any = uniform(new Vector3(0.16, 0.155, 0.15));
  const boxes: any = uniformArray(Array.from({ length: MAX_BUILDINGS }, () => new Vector4()), 'vec4');
  const extras: any = uniformArray(Array.from({ length: MAX_BUILDINGS }, () => new Vector4()), 'vec4');
  const along: any = uniform(new Vector3(1, 0, 0));
  const across: any = uniform(new Vector3(0, 0, 1));
  const mode: any = forest.uniforms.mode;
  const sunBody: any = forest.uniforms.sunBody;

  /** Footprint weight against the mesh band, honouring the forest's view mode (1 meshes only, 2 layer only, 3 split). */
  const farWeight = (distance: any): any =>
    select(
      mode.equal(1),
      float(0),
      select(mode.equal(2), float(1), select(mode.equal(3), splitLayerWeight(), smoothstep(meshStartM, meshEndM, distance))),
    );
  const meshOpacity = (distance: any): any => float(1).sub(farWeight(distance)).mul(enabled);

  const layer: SurfaceLayer = (context: IPlanetContext, below) => {
    const p = bodyFixed(context);
    const distance = context.cameraDistance;
    const pixelM = distance.mul(PIXEL_PER_DISTANCE);
    const q = vec2(dot(p, along), dot(p, across));
    const n = normalize(p);
    const sinElevation = dot(sunBody, n);
    const sun2 = vec2(dot(sunBody, along), dot(sunBody, across));
    const cosElevation = max(length(sun2), 1e-6);
    const away = sun2.negate().div(cosElevation);
    const perpendicular = vec2(away.y.negate(), away.x);
    const reach = float(1).div(max(sinElevation.div(cosElevation), MIN_SUN_TAN));
    const far = farWeight(distance);
    const roofEdge = max(pixelM.mul(0.5), 0.5);
    const shadowEdge = max(pixelM, 1.5);

    const result: any = Fn(() => {
      const roof: any = float(0).toVar();
      const tone: any = float(1).toVar();
      const shade: any = float(0).toVar();
      If(enabled.greaterThan(0), () => {
        // `end` is a uniform (the list length); the typings only take a number there.
        Loop({ start: 0, end: count, type: 'int', name: 'bi' } as any, ({ bi }: any) => {
          const box = boxes.element(bi);
          const extra = extras.element(bi);
          const r = q.sub(box.xy);
          const half = box.zw;
          const side = min(half.x, half.y).mul(2);
          const gone = float(1).sub(smoothstep(side.div(2 * PIXEL_PER_DISTANCE), side.div(PIXEL_PER_DISTANCE), distance));
          // Roof: the box's own distance.
          const qa = abs(r).sub(half);
          const inside = length(max(qa, 0)).add(min(max(qa.x, qa.y), 0));
          const w = float(1).sub(smoothstep(roofEdge.negate(), roofEdge, inside)).mul(far).mul(gone);
          tone.assign(mix(tone, extra.y, w));
          roof.assign(max(roof, w));
          // Shadow: the hull of the box and the box moved by v, as plane distances.
          const v = away.mul(extra.x).mul(reach);
          const dx = max(r.x.sub(half.x).sub(max(v.x, 0)), r.x.negate().sub(half.x).sub(max(v.x.negate(), 0)));
          const dy = max(r.y.sub(half.y).sub(max(v.y, 0)), r.y.negate().sub(half.y).sub(max(v.y.negate(), 0)));
          const s = dot(r, perpendicular);
          const dp = abs(s).sub(half.x.mul(abs(perpendicular.x)).add(half.y.mul(abs(perpendicular.y))));
          const hull = max(max(dx, dy), dp);
          shade.assign(max(shade, float(1).sub(smoothstep(shadowEdge.negate(), shadowEdge, hull)).mul(gone)));
        });
      });
      return vec3(roof, tone, shade);
    })();

    const shade = result.z.mul(sunUpRamp(sinElevation));
    const shadowed = below.albedo.mul(mix(float(1), shadowFactorNode(sinElevation), shade));
    const roofColour = vec3(roofAlbedo).mul(result.y);
    const roof = clamp(result.x, 0, 1);
    return {
      ...below,
      albedo: mix(shadowed, roofColour, roof),
      roughness: mix(below.roughness, float(0.85), roof),
    };
  };

  return {
    layer,
    uniforms: { enabled, meshStartM, meshEndM },
    meshOpacity,
    roofAlbedo,
    setBuildings(buildings) {
      const list = buildings.slice(0, MAX_BUILDINGS);
      list.forEach((o, i) => {
        boxes.array[i].set(o.a, o.b, o.hx, o.hy);
        extras.array[i].set(o.heightM, buildingTone(o.tone), 0, 0);
      });
      count.value = list.length;
    },
    setSite(a, b) {
      along.value.set(a[0], a[1], a[2]);
      across.value.set(b[0], b[1], b[2]);
    },
  };
}
