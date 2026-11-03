/* eslint-disable @typescript-eslint/no-explicit-any */
import { Vector3 } from 'three';
import { Fn, If, clamp, color, dot, float, max, min, mix, normalize, pow, smoothstep, sqrt, uniform, vec2, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { LodSurfaceNodes, LodSurfaceNodesConsumer, LodSurfaceSunConsumer, Vec3 } from 'triangular-engine/lod-surface/core';
import { SEA_LEVEL_M } from './water-lod-spike-land';
import { sphereLandHeightNode } from './water-lod-spike-sphere-land';
import { createSphereWaterShadingNodes, type ISphereWaterHeights } from './water-lod-spike-sphere-waves';
import { WATER_LOD_SPIKE_UNIFORMS, shoreLookFromDepth, shoreWeightFromDepth } from './water-lod-spike-waves';

/** Foam colour and strength: the plane's. */
const FOAM_COLOUR = color('#eef6fa');
const FOAM_STRENGTH = 0.9;
/** Slope variance of the ripples below the shortest wave, so even the near glint has a width (the plane's). */
const BASE_SLOPE_VARIANCE = 0.004;
/** Sun glint strength, clamped per quadrature sample (the plane's). */
const GLINT_SCALE = 4;
/** Total lost slope variance under which the quadrature collapses to one sample (the plane's). */
const NEGLIGIBLE_LOST_VARIANCE = 2e-5;
/** Light left on the night side, as a share of the day-side light (water colour and reflected sky). */
export const SPHERE_WATER_AMBIENT = 0.06;
/** The sun's elevation range over which the day factor goes from 0 to 1: sine of the angle between the local up and the sun. */
export const SPHERE_WATER_TERMINATOR = [-0.12, 0.2] as const;

/** x^5 by multiplication: a power node with a constant exponent costs a log and an exp. */
function fifthPower(x: any): any {
  const squared = x.mul(x);
  return squared.mul(squared).mul(x);
}

/** Three-point Gauss-Hermite rule for a unit normal distribution (probabilists'), as the plane's. */
const GAUSS_HERMITE = [
  [-1.7320508075688772, 1 / 6],
  [0, 2 / 3],
  [1.7320508075688772, 1 / 6],
] as const;

/**
 * Day factor at a point whose local up has the cosine `upDotSun` with the sun: 0 at night, 1 by day, smooth across the terminator.
 * CPU twin of the node the material builds.
 */
export function sphereWaterDayFactor(upDotSun: number): number {
  const t = Math.min(1, Math.max(0, (upDotSun - SPHERE_WATER_TERMINATOR[0]) / (SPHERE_WATER_TERMINATOR[1] - SPHERE_WATER_TERMINATOR[0])));
  return t * t * (3 - 2 * t);
}

/**
 * Plan 080, water on a planet (stage A): the plane spike's water shading on a `<planetTerrain>` body.
 *
 * The same model as the plane's material: the slope at a pixel is a distribution (mean = filtered gradient, covariance = what
 * the filter removed), shaded with a 3 x 3 Gauss-Hermite rule weighted by visible area, with Schlick Fresnel between a lit
 * deep-water colour and the sky and a normalised Blinn-Phong glint. The differences are the sphere's:
 * - the slopes are along a tangent pair built in the home frame, and the normal is `up - sx t1 - sz t2`;
 * - the sun is the body's (`setSunDirection`), with a day factor that dims the water colour, the reflected sky and the glint
 *   across the terminator, and a small ambient floor, so the night side is dark instead of lit from "above";
 * - the shore, foam and depth colour read the land of `water-lod-spike-sphere-land` at the base point's direction.
 *
 * Limits of the spike: this is a `MeshBasicNodeMaterial`, so the planet atmosphere gives it its sky backdrop only: no aerial
 * haze or light colour on the water (only `IAtmosphereSurface` materials get those). The sky colour in the reflection is a
 * constant, not the atmosphere's. Both are for the later stage that makes the water an atmosphere surface.
 *
 * The wireframe toggle flips `material.wireframe` on this material, never `<scene>`'s `[wireframe]` input.
 */
export class SphereWaterMaterial extends MeshBasicNodeMaterial implements LodSurfaceNodesConsumer, LodSurfaceSunConsumer {
  /** Unit direction to the sun in the body frame. */
  readonly sun = uniform(new Vector3(0.4, 0.35, -0.85).normalize());

  constructor(private readonly heights: ISphereWaterHeights) {
    super();
    this.wireframe = false;
  }

  setSunDirection(direction: Vec3): void {
    this.sun.value.set(direction[0], direction[1], direction[2]).normalize();
  }

  bindLodSurfaceNodes(nodes: LodSurfaceNodes): void {
    const heightNode = this.heights.vertexHeight();
    if (!heightNode) throw new Error('SphereWaterMaterial: the height source has not built a vertex stage yet');
    const u = WATER_LOD_SPIKE_UNIFORMS;
    const sun = this.sun;
    const view = normalize(nodes.position.negate());
    const half = normalize(view.add(sun));
    const specularFresnel = fifthPower(float(1).sub(clamp(dot(half, view), 0, 1))).mul(0.98).add(0.02);
    const deepWater = color('#0a2a3c');
    // Over shallow ground the water is lighter and greener (the sea floor's colour, little absorbed).
    const shallowWater = color('#2c8a8f');
    const sky = color('#a9c8da');

    const { t1, t2, slopeX, slopeZ, lostXX, lostXZ, lostZZ } = createSphereWaterShadingNodes({ position: nodes.position, up: nodes.up, height: heightNode });
    const transfer = u.transfer.mul(u.lostScale);
    const xx = lostXX.mul(transfer);
    const xz = lostXZ.mul(transfer);
    const zz = lostZZ.mul(transfer);
    const up = normalize(nodes.up);

    const day = smoothstep(SPHERE_WATER_TERMINATOR[0], SPHERE_WATER_TERMINATOR[1], dot(up, sun));
    const lightFactor = day.mul(1 - SPHERE_WATER_AMBIENT).add(SPHERE_WATER_AMBIENT);

    const exponent = float(Math.max(2 / BASE_SLOPE_VARIANCE - 2, 1));
    const l11 = sqrt(max(xx, 1e-10));
    const l21 = xz.div(l11);
    const l22 = sqrt(max(zz.sub(l21.mul(l21)), 0));

    const shade = (deep: any, slopeU: any, slopeV: any) => {
      const normal = normalize(up.sub(t1.mul(slopeU)).sub(t2.mul(slopeV)));
      const facing = clamp(dot(view, normal), 0, 1);
      const fresnel = fifthPower(float(1).sub(facing)).mul(0.98).add(0.02);
      const lambert = max(dot(normal, sun), 0);
      const water = deep.mul(float(0.55).add(lambert.mul(0.45))).mul(lightFactor);
      const glint = pow(max(dot(normal, half), 0), exponent).mul(exponent.add(2).div(8 * Math.PI)).mul(specularFresnel).mul(lambert).mul(GLINT_SCALE).mul(day);
      return { colour: min(mix(water, sky.mul(lightFactor), fresnel as any).add(glint), vec3(1)), facing };
    };

    const result: any = Fn(() => {
      // The shore weight, the foam and the shallow-to-deep colour share one read of the water depth D per pixel (all off: no read).
      const depth = float(0).toVar();
      If(u.shore.greaterThan(0).or(u.foam.greaterThan(0)).or(u.depthColour.greaterThan(0)), () => {
        depth.assign(float(SEA_LEVEL_M).sub(sphereLandHeightNode(up)));
      });
      const look = shoreLookFromDepth(depth).toVar();
      const deep = mix(shallowWater, deepWater, look.y);
      const mean = vec2(slopeX, slopeZ).mul(shoreWeightFromDepth(depth));
      const out = vec3(0).toVar();
      If(xx.add(zz).lessThan(NEGLIGIBLE_LOST_VARIANCE), () => {
        out.assign(shade(deep, mean.x, mean.y).colour);
      }).Else(() => {
        const colour = vec3(0).toVar();
        const visible = float(1e-6).toVar();
        for (const [a, wa] of GAUSS_HERMITE) {
          for (const [b, wb] of GAUSS_HERMITE) {
            const sample = shade(deep, mean.x.add(l11.mul(a)), mean.y.add(l21.mul(a)).add(l22.mul(b)));
            const weight = pow(max(sample.facing, 1e-3), u.visibility).mul(wa * wb);
            colour.addAssign(sample.colour.mul(weight));
            visible.addAssign(weight);
          }
        }
        out.assign(colour.div(visible));
      });
      // Foam is a white laid over the water; its edge is the depth contour, so it follows the waterline. It is lit like the water.
      return mix(out, FOAM_COLOUR.mul(lightFactor), look.x.mul(FOAM_STRENGTH));
    })();
    this.colorNode = result;
  }
}
