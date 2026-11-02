/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fn, If, cameraPosition, clamp, color, dot, float, max, min, mix, normalize, positionWorld, pow, sqrt, sub, vec2, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { WATER_LOD_SPIKE_UNIFORMS, createWaterLodSpikeShadingNodes, shoreLookNode, shoreWeightNode } from './water-lod-spike-waves';

/** Foam colour (a little blue-white) and its strength where the foam amount is 1. */
const FOAM_COLOUR = color('#eef6fa');
const FOAM_STRENGTH = 0.9;

/** Fixed sun direction (towards the sun): low and ahead of the default camera, so the glint is in view. */
const SUN_DIRECTION = [0.4, 0.35, -0.85] as const;
/** Slope variance of the ripples below the shortest wave, so even the near glint has a width. */
const BASE_SLOPE_VARIANCE = 0.004;
/** Sun glint strength. The glint is clamped per quadrature sample, like the display clamps a supersampled pixel. */
const GLINT_SCALE = 4;

/** Total lost slope variance under which the quadrature collapses to one sample (the glint's own base variance is 200 times this). */
const NEGLIGIBLE_LOST_VARIANCE = 2e-5;

/** x^5 by multiplication: a power node with a constant exponent costs a log and an exp. */
function fifthPower(x: any): any {
  const squared = x.mul(x);
  return squared.mul(squared).mul(x);
}

/**
 * Three-point Gauss-Hermite rule for a unit normal distribution (probabilists'): nodes and weights. The 5 x 5 rule it
 * replaced (25 samples) measured the same on the aliasing suite (worst colour error 3.8 against 3.6/255), so 9 samples do.
 */
const GAUSS_HERMITE = [
  [-1.7320508075688772, 1 / 6],
  [0, 2 / 3],
  [1.7320508075688772, 1 / 6],
] as const;

/**
 * Spike-local water material for plan 080 (W0b).
 *
 * The slope at a pixel is a distribution: the mean is the filtered wave gradient and the covariance is what the filter
 * removed (`createWaterLodSpikeShadingNodes`). The colour is the shading averaged over that distribution with a 3 x 3 Gauss-Hermite rule weighted by visible area, each sample
 * clamped to the displayable range first. That is what a supersampled pixel of the full surface shows, so the far water
 * keeps its colour where waves fade out, and a narrow glint on resolved waves does not sparkle.
 *
 * Shading per sample: Schlick Fresnel (F0 0.02) between a lit deep-water colour and the sky, plus a normalised
 * Blinn-Phong sun glint. `transfer` off (the colour-step control) drops the covariance: one sample at the mean slope.
 *
 * The wireframe toggle flips `material.wireframe` on this material, never `<scene>`'s `[wireframe]` input
 * (AGENTS.md rule for spikes). Assumes the plane is untransformed, so `positionWorld` is the plane-frame position.
 */
export function createWaterLodSpikeMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const view = normalize(sub(cameraPosition, positionWorld));
  const sun = normalize(vec3(...SUN_DIRECTION));
  const half = normalize(view.add(sun));
  const specularFresnel = fifthPower(float(1).sub(clamp(dot(half, view), 0, 1))).mul(0.98).add(0.02);
  const deepWater = color('#0a2a3c');
  // Over shallow ground the water is lighter and greener (the sea floor's colour, little absorbed).
  const shallowWater = color('#2c8a8f');
  let deep: any = deepWater;
  const sky = color('#a9c8da');

  const { gradient, lostXX, lostXZ, lostZZ } = createWaterLodSpikeShadingNodes(positionWorld);
  // At the shore the waves flatten (shore weight), so the shading slope goes with them; the lost variance keeps the glint width.
  const mean = vec2(gradient.x, gradient.z).mul(shoreWeightNode(positionWorld));
  const transfer = WATER_LOD_SPIKE_UNIFORMS.transfer.mul(WATER_LOD_SPIKE_UNIFORMS.lostScale);
  const xx = lostXX.mul(transfer);
  const xz = lostXZ.mul(transfer);
  const zz = lostZZ.mul(transfer);

  // The samples spread over the whole lost covariance (Cholesky L); each sample's glint keeps the base width.
  const exponent = float(Math.max(2 / BASE_SLOPE_VARIANCE - 2, 1));
  const l11 = sqrt(max(xx, 1e-10));
  const l21 = xz.div(l11);
  const l22 = sqrt(max(zz.sub(l21.mul(l21)), 0));

  const shade = (slopeX: any, slopeZ: any) => {
    const normal = normalize(vec3(slopeX.negate(), 1, slopeZ.negate()));
    const facing = clamp(dot(view, normal), 0, 1);
    const fresnel = fifthPower(float(1).sub(facing)).mul(0.98).add(0.02);
    const lambert = max(dot(normal, sun), 0);
    const water = deep.mul(float(0.55).add(lambert.mul(0.45)));
    const glint = pow(max(dot(normal, half), 0), exponent).mul(exponent.add(2).div(8 * Math.PI)).mul(specularFresnel).mul(lambert).mul(GLINT_SCALE);
    return { colour: min(mix(water, sky, fresnel as any).add(glint), vec3(1)), facing };
  };

  // Visible-normal weighting: a facet is seen in proportion to its projected area (view . n), and facets turned away
  // from the camera are hidden behind the next crest. This is why a rasterised wave field is darker at grazing angles
  // than the shading of the whole slope distribution, and the weight puts it back.
  // Where the filter removed next to nothing (resolved water), every quadrature sample is the mean one: shade once.
  const result: any = Fn(() => {
    // Foam and the shallow-to-deep colour read the water depth D once per pixel (both off: foam 0, deepness 1, no cost beyond the branch).
    const look = shoreLookNode(positionWorld).toVar();
    deep = mix(shallowWater, deepWater, look.y);
    const out = vec3(0).toVar();
    If(xx.add(zz).lessThan(NEGLIGIBLE_LOST_VARIANCE), () => {
      out.assign(shade(mean.x, mean.y).colour);
    }).Else(() => {
      const colour = vec3(0).toVar();
      const visible = float(1e-6).toVar();
      for (const [u, wu] of GAUSS_HERMITE) {
        for (const [v, wv] of GAUSS_HERMITE) {
          const slopeX = mean.x.add(l11.mul(u));
          const slopeZ = mean.y.add(l21.mul(u)).add(l22.mul(v));
          const sample = shade(slopeX, slopeZ);
          const weight = pow(max(sample.facing, 1e-3), WATER_LOD_SPIKE_UNIFORMS.visibility).mul(wu * wv);
          colour.addAssign(sample.colour.mul(weight));
          visible.addAssign(weight);
        }
      }
      out.assign(colour.div(visible));
    });
    // Foam is a lit white laid over the water, thinned by nothing else: its edge is the depth contour, so it follows the waterline.
    return mix(out, FOAM_COLOUR, look.x.mul(FOAM_STRENGTH));
  })();
  material.colorNode = result;
  material.wireframe = false;
  return material;
}
