/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fn, If, abs, cameraPosition, cos, dFdx, dFdy, dot, exp, float, length, mat3, max, mix, sin, smoothstep, sub, uniform, vec2, vec3 } from 'three/tsl';
import type { HeightSource } from 'triangular-engine/lod-surface/core';
import { SEA_LEVEL_M, SHORE_LOOK, landHeightNode, shoreDeepness, shoreFoam, shoreWeight, waterDepthM, type IShoreLookParams } from './water-lod-spike-land';

/**
 * Spike-local wave spectrum for plan 080 (W0b): 64 directional sines with jittered wavelengths from 300 m to 0.5 m
 * (log-spaced, denser at the long end), directions spread around one wind direction and random phases. Every wave has the same steepness (amplitude x
 * wavenumber), so each octave adds the same slope variance. The CPU twin (`heightAt`) and the TSL nodes read this one table.
 *
 * Why not the earlier 16-wave table: four bands of four near-equal wavelengths spread over golden-angle directions sum to
 * a regular lattice and concentric rings at every distance. No fade or amplitude tuning removes that; only an irregular
 * spectrum does. `waveSlopeRegularity` measures it (see the spec).
 *
 * Anti-aliasing, two filters with one rule (keep a wave only where it is sampled at least twice per wavelength):
 * - Shading: each wave's weight comes from the pixel footprint along that wave's own direction (screen derivatives of
 *   the position), so it is anisotropic at grazing angles. The slope covariance the filter removes is returned, and the
 *   material averages its shading over it, so the far water keeps its mean colour.
 * - Vertices: each wave's height weight comes from the mesh spacing, estimated from the camera distance the same way the
 *   lod-surface selector sizes cells (`cellPixels` pixels per cell). The weight is a function of the vertex position, so
 *   vertices shared by two leaves get the same height and no crack opens. The CPU twin keeps every wave.
 */
export interface IWaterWave {
  /** Unit direction of travel in the XZ plane. */
  readonly dirX: number;
  readonly dirZ: number;
  readonly wavelengthM: number;
  readonly amplitudeM: number;
  readonly phase: number;
  /** Deep-water dispersion, rad/s: sqrt(g k). */
  readonly angularSpeed: number;
}

export interface IWaterWaveTableOptions {
  readonly count?: number;
  readonly longestM?: number;
  readonly shortestM?: number;
  /** Amplitude x wavenumber, the same for every wave. */
  readonly steepness?: number;
  /** Wind direction, radians from +X towards +Z. */
  readonly windAngle?: number;
  /**
   * Exponent on the slot position: above 1 packs more waves into the long wavelengths, the ones still on screen far
   * away, so the far water is not left with a handful of waves that read as a lattice. Default 1.5.
   */
  readonly longWaveDensity?: number;
  readonly seed?: number;
}

const GRAVITY = 9.81;

/** Small seeded generator (mulberry32), so the table is the same on every load and in the spec. */
function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds the spectrum. Each wavelength sits at a random point inside its own slot, so no two waves share one. */
export function buildWaterLodSpikeWaveTable(options: IWaterWaveTableOptions = {}): readonly IWaterWave[] {
  const { count = 64, longestM = 300, shortestM = 0.5, steepness = 0.032, windAngle = 0.6, longWaveDensity = 1.5, seed = 80 } = options;
  const random = seededRandom(seed);
  const waves: IWaterWave[] = [];
  for (let i = 0; i < count; i++) {
    const slot = 0.15 + 0.7 * random();
    const wavelengthM = longestM * Math.pow(shortestM / longestM, Math.pow((i + slot) / count, longWaveDensity));
    // Sum of three uniforms: a bell-shaped spread around the wind, about 45 degrees standard deviation.
    const angle = windAngle + (random() + random() + random() - 1.5) * 1.6;
    const k = (2 * Math.PI) / wavelengthM;
    waves.push({
      dirX: Math.cos(angle),
      dirZ: Math.sin(angle),
      wavelengthM,
      amplitudeM: steepness / k,
      phase: random() * 2 * Math.PI,
      angularSpeed: Math.sqrt(GRAVITY * k),
    });
  }
  return waves;
}

/** The spike's spectrum, shared by the CPU twin and the TSL nodes. */
export const WATER_LOD_SPIKE_WAVES: readonly IWaterWave[] = buildWaterLodSpikeWaveTable();

/**
 * Uniforms the page drives. `filter` and `transfer` are the controls the aliasing suite switches off (1 on, 0 off);
 * `pixelAngle` (radians per pixel, vertical) and `cellPixels` size the vertex filter.
 */
export const WATER_LOD_SPIKE_UNIFORMS = {
  /** Seconds; the waves move with it. The page advances it; tests freeze it. */
  time: uniform(0),
  /** 1: footprint and mesh-spacing filters on. 0: every wave at full weight (the aliasing control). */
  filter: uniform(1),
  /** 1: lost slope variance goes into the glint roughness. 0: it is dropped (the colour-step control). */
  transfer: uniform(1),
  /** Diagnostic scale on the vertex height. 0 keeps the mesh flat while the shading normal still comes from the waves. */
  vertexHeightScale: uniform(1),
  pixelAngle: uniform(0.001),
  /** The lod-surface target cell size in pixels (`<flatTerrain [cellPixels]>`, default 4). */
  cellPixels: uniform(4),
  /** Exponent of the visible-area weight (view . normal) on the quadrature samples; 1 is projected area, 0 weights equally (material). */
  visibility: uniform(0.4),
  /** Scale of the lost slope covariance. Calibrated against the supersampled reference: the sinusoid sum is less heavy-tailed than the Gaussian that stands in for it (material). */
  lostScale: uniform(0.8),
  /** Multiplies every wave's pixel footprint in the shading filter: 2 fades each wave out at twice the wavelength (quality tier). */
  lodBias: uniform(1),
  /** 1: wave height and shading slope are scaled by the shore weight of the water depth under the land (needs the land). 0: off (control). */
  shore: uniform(0),
  /** Metres of water depth from which the waves have their full height (ER 080, shoreline review). */
  shoreRampM: uniform(12),
  /** 1: foam at the waterline and breaker lines from the water depth D (needs the land). 0: off. */
  foam: uniform(0),
  /** 1: the water colour goes from shallow to deep with D (needs the land). 0: off. */
  depthColour: uniform(0),
  /** The shore look's depth scales, metres (see `IShoreLookParams`). */
  foamEdgeM: uniform(SHORE_LOOK.edgeM),
  foamZoneM: uniform(SHORE_LOOK.zoneM),
  foamSpacingM: uniform(SHORE_LOOK.spacingM),
  foamSpeedMS: uniform(SHORE_LOOK.speedMS),
  tintScaleM: uniform(SHORE_LOOK.tintScaleM),
};

/**
 * Foam (x) and water deepness (y) at a plane position node, both from the water depth D of the land under it. Foam is 0 and
 * deepness 1 where both looks are off, so the material needs no branch of its own. The land's height is read once for both.
 */
export function shoreLookNode(position: any): any {
  return (Fn(() => {
    const look = vec2(0, 1).toVar();
    If(WATER_LOD_SPIKE_UNIFORMS.foam.greaterThan(0).or(WATER_LOD_SPIKE_UNIFORMS.depthColour.greaterThan(0)), () => {
      const depth = float(SEA_LEVEL_M).sub(landHeightNode(position));
      const u = WATER_LOD_SPIKE_UNIFORMS;
      If(u.foam.greaterThan(0), () => {
        const edge = float(1).sub(smoothstep(0, u.foamEdgeM, depth));
        const phase = depth.add(u.foamSpeedMS.mul(u.time)).div(u.foamSpacingM);
        const stripe = smoothstep(0.75, 1, cos(phase.mul(2 * Math.PI)).mul(0.5).add(0.5));
        const breakers = float(1).sub(smoothstep(u.foamEdgeM, u.foamZoneM, depth)).mul(stripe).mul(0.8);
        look.x.assign(max(edge, breakers));
      });
      If(u.depthColour.greaterThan(0), () => {
        look.y.assign(float(1).sub(exp(max(depth, 0).negate().div(u.tintScaleM))));
      });
    });
    return look;
  }) as any)();
}

/** CPU twin of {@link shoreLookNode}. */
export function shoreLookAt(x: number, z: number): { foam: number; deepness: number } {
  const u = WATER_LOD_SPIKE_UNIFORMS;
  const look: IShoreLookParams = {
    edgeM: u.foamEdgeM.value as number,
    zoneM: u.foamZoneM.value as number,
    spacingM: u.foamSpacingM.value as number,
    speedMS: u.foamSpeedMS.value as number,
    tintScaleM: u.tintScaleM.value as number,
  };
  const depth = waterDepthM(x, z);
  return {
    foam: (u.foam.value as number) > 0 ? shoreFoam(depth, u.time.value as number, look) : 0,
    deepness: (u.depthColour.value as number) > 0 ? shoreDeepness(depth, look) : 1,
  };
}

/** Shore weight at a plane position node: 1 where the shore is off, else `smoothstep(0, ramp, D)` with D from the land's height. */
export function shoreWeightNode(position: any): any {
  return (Fn(() => {
    const weight = float(1).toVar();
    If(WATER_LOD_SPIKE_UNIFORMS.shore.greaterThan(0), () => {
      const depth = float(SEA_LEVEL_M).sub(landHeightNode(position));
      weight.assign(smoothstep(0, WATER_LOD_SPIKE_UNIFORMS.shoreRampM, depth));
    });
    return weight;
  }) as any)();
}

/** CPU twin of {@link shoreWeightNode}. */
export function shoreWeightAt(x: number, z: number): number {
  if ((WATER_LOD_SPIKE_UNIFORMS.shore.value as number) <= 0) return 1;
  return shoreWeight(waterDepthM(x, z), WATER_LOD_SPIKE_UNIFORMS.shoreRampM.value as number);
}

/** Footprint/wavelength ratio where the shading weight starts to fall, and where it reaches 0 (wavelengths of 2.9 and 1.4 pixels). */
export const FOOTPRINT_FADE_START = 0.35;
export const FOOTPRINT_FADE_END = 0.7;

/**
 * Shading weight of a wave from the pixel footprint along its direction (metres per pixel): 1 down to about 3 pixels per
 * wavelength, 0 at about 1.4. The late fade keeps resolved detail that a blurrier cut would turn into false shimmer; the
 * quadrature supplies the rest.
 */
export function waveFootprintWeight(footprintM: number, wavelengthM: number): number {
  return 1 - smoothstepNumber(FOOTPRINT_FADE_START, FOOTPRINT_FADE_END, footprintM / wavelengthM);
}

/** Height weight of a wave from the mesh spacing (metres): 1 at 8 cells per wavelength or more, 0 at 4 or less. */
export function waveSpacingWeight(spacingM: number, wavelengthM: number): number {
  return smoothstepNumber(4 * spacingM, 8 * spacingM, wavelengthM);
}

function smoothstepNumber(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * How regular the slope field of the waves at or above `minWavelengthM` is: the normalised slope autocorrelation
 * sum (a k)^2 cos(k . tau) / sum (a k)^2 sampled over lags tau in the annulus [rMinM, rMaxM]. A lattice or ring pattern keeps
 * the correlation high far from the origin; an irregular spectrum lets it fall. Returns the RMS and the largest |value|.
 */
export function waveSlopeRegularity(
  waves: readonly IWaterWave[], minWavelengthM: number, rMinM: number, rMaxM: number,
): { readonly waves: number; readonly rms: number; readonly max: number } {
  const kept = waves.filter((wave) => wave.wavelengthM >= minWavelengthM).map((wave) => {
    const k = (2 * Math.PI) / wave.wavelengthM;
    return { kx: k * wave.dirX, kz: k * wave.dirZ, weight: (wave.amplitudeM * k) ** 2 };
  });
  const total = kept.reduce((sum, wave) => sum + wave.weight, 0);
  let max = 0;
  let sumSquares = 0;
  let samples = 0;
  for (let ri = 0; ri < 200; ri++) {
    const r = rMinM + ((rMaxM - rMinM) * ri) / 199;
    for (let ai = 0; ai < 90; ai++) {
      const a = (Math.PI * ai) / 90;
      const tx = r * Math.cos(a);
      const tz = r * Math.sin(a);
      let value = 0;
      for (const wave of kept) value += wave.weight * Math.cos(wave.kx * tx + wave.kz * tz);
      value /= total;
      max = Math.max(max, Math.abs(value));
      sumSquares += value * value;
      samples++;
    }
  }
  return { waves: kept.length, rms: Math.sqrt(sumSquares / samples), max };
}

/** Phase of one wave at a plane-frame position node and the time uniform. */
function wavePhase(position: any, wave: IWaterWave): any {
  const k = (2 * Math.PI) / wave.wavelengthM;
  return dot(vec2(position.x, position.z), vec2(wave.dirX, wave.dirZ)).mul(k).add(wave.phase).sub(WATER_LOD_SPIKE_UNIFORMS.time.mul(wave.angularSpeed));
}

/** Mesh spacing estimate at a plane-frame position (vertex stage): cellPixels x pixel angle x camera distance. */
function meshSpacingNode(position: any): any {
  return length(sub(position, cameraPosition)).mul(WATER_LOD_SPIKE_UNIFORMS.pixelAngle).mul(WATER_LOD_SPIKE_UNIFORMS.cellPixels);
}

/** Height weight node of one wave, 1 when the filter is off. */
function spacingWeightNode(spacing: any, wave: IWaterWave): any {
  const weight = smoothstep(spacing.mul(4), spacing.mul(8), float(wave.wavelengthM));
  return mix(float(1), weight, WATER_LOD_SPIKE_UNIFORMS.filter);
}

/**
 * Fragment-stage shading nodes at a world position (the plane is untransformed): the filtered height gradient
 * (dh/dx, 0, dh/dz) and the covariance of the slopes the filter removed (each wave adds (1 - w^2) (a k)^2 / 2 along its
 * own direction), as `lostXX`, `lostXZ`, `lostZZ`.
 */
export function createWaterLodSpikeShadingNodes(position: any): { gradient: any; lostXX: any; lostXZ: any; lostZZ: any } {
  // The lost covariance starts at its total (every wave dropped) and each wave that is still in the shading takes its
  // part back, so a wave whose footprint is too wide costs one cheap test: no smoothstep, no cosine, no accumulation.
  // Neighbouring pixels drop the same waves, so the branch is coherent. The derivatives come first, in uniform control flow.
  let totalXX = 0;
  let totalXZ = 0;
  let totalZZ = 0;
  for (const wave of WATER_LOD_SPIKE_WAVES) {
    const slope = (wave.amplitudeM * 2 * Math.PI) / wave.wavelengthM;
    totalXX += 0.5 * slope * slope * wave.dirX * wave.dirX;
    totalXZ += 0.5 * slope * slope * wave.dirX * wave.dirZ;
    totalZZ += 0.5 * slope * slope * wave.dirZ * wave.dirZ;
  }
  const shading: any = Fn(() => {
    const ddx = dFdx(vec2(position.x, position.z));
    const ddy = dFdy(vec2(position.x, position.z));
    const gradient = vec3(0, 0, 0).toVar();
    const lostXX = float(totalXX).toVar();
    const lostXZ = float(totalXZ).toVar();
    const lostZZ = float(totalZZ).toVar();
    for (const wave of WATER_LOD_SPIKE_WAVES) {
      const k = (2 * Math.PI) / wave.wavelengthM;
      const direction = vec2(wave.dirX, wave.dirZ);
      // Metres per pixel along this wave's direction, summed over both screen axes, in wavelengths.
      const ratio = abs(dot(ddx, direction)).add(abs(dot(ddy, direction))).mul(1 / wave.wavelengthM);
      const slope = wave.amplitudeM * k;
      // With the filter off the test passes for every wave; the quality bias widens every footprint.
      const gate = ratio.mul(WATER_LOD_SPIKE_UNIFORMS.filter).mul(WATER_LOD_SPIKE_UNIFORMS.lodBias);
      If(gate.lessThan(FOOTPRINT_FADE_END), () => {
        const crest = cos(wavePhase(position, wave)).mul(slope).toVar();
        const keptVariance = 0.5 * slope * slope;
        // Most kept waves are resolved (weight 1): no fade to evaluate and a constant share of the variance to take back.
        If(gate.lessThan(FOOTPRINT_FADE_START), () => {
          gradient.addAssign(vec3(wave.dirX, 0, wave.dirZ).mul(crest));
          lostXX.subAssign(keptVariance * wave.dirX * wave.dirX);
          lostXZ.subAssign(keptVariance * wave.dirX * wave.dirZ);
          lostZZ.subAssign(keptVariance * wave.dirZ * wave.dirZ);
        }).Else(() => {
          // Only reached with the filter on (gate above the fade start), where the gate is the biased ratio.
          const weight = float(1).sub(smoothstep(FOOTPRINT_FADE_START, FOOTPRINT_FADE_END, gate));
          gradient.addAssign(vec3(wave.dirX, 0, wave.dirZ).mul(crest.mul(weight)));
          const kept = weight.mul(weight).mul(keptVariance);
          lostXX.subAssign(kept.mul(wave.dirX * wave.dirX));
          lostXZ.subAssign(kept.mul(wave.dirX * wave.dirZ));
          lostZZ.subAssign(kept.mul(wave.dirZ * wave.dirZ));
        });
      });
    }
    return mat3(gradient, vec3(lostXX, lostXZ, lostZZ), vec3(0, 0, 0));
  })();
  const gradient = shading.element(0);
  const lost = shading.element(1);
  return { gradient, lostXX: lost.x, lostXZ: lost.y, lostZZ: lost.z };
}

/**
 * A `HeightSource` for `<flatTerrain [heights]>`: the plane's water height as the sum of the spectrum. The vertex stage
 * (`heightNode`, `gradientNode`) applies the mesh-spacing filter; the CPU twin (`heightAt`) keeps every wave at the
 * current `time` uniform value, so it differs from the drawn mesh by at most the filtered waves' amplitudes (centimetres).
 */
export function createWaterLodSpikeWaves(): HeightSource {
  const boundM = WATER_LOD_SPIKE_WAVES.reduce((sum, wave) => sum + wave.amplitudeM, 0);
  return {
    // HeightSourceId is a closed union; 'bumps' is its analytic id. lod-surface keys nothing on it for planes.
    id: 'bumps',
    boundM,
    heightAt(x, _y, z) {
      const t = WATER_LOD_SPIKE_UNIFORMS.time.value as number;
      let h = 0;
      for (const wave of WATER_LOD_SPIKE_WAVES) {
        const k = (2 * Math.PI) / wave.wavelengthM;
        h += wave.amplitudeM * Math.sin(k * (x * wave.dirX + z * wave.dirZ) + wave.phase - wave.angularSpeed * t);
      }
      return h * shoreWeightAt(x, z);
    },
    // Waves the mesh cannot carry (spacing weight 0) are skipped: far vertices keep only the long waves.
    heightNode(position) {
      return (Fn(() => {
        const spacing = meshSpacingNode(position);
        const h = float(0).toVar();
        for (const wave of WATER_LOD_SPIKE_WAVES) {
          const weight = spacingWeightNode(spacing, wave).toVar();
          If(weight.greaterThan(0), () => {
            h.addAssign(sin(wavePhase(position, wave)).mul(wave.amplitudeM).mul(weight));
          });
        }
        return h.mul(shoreWeightNode(position)).mul(WATER_LOD_SPIKE_UNIFORMS.vertexHeightScale);
      }) as any)();
    },
    gradientNode(position) {
      return (Fn(() => {
        const spacing = meshSpacingNode(position);
        const g = vec3(0, 0, 0).toVar();
        for (const wave of WATER_LOD_SPIKE_WAVES) {
          const k = (2 * Math.PI) / wave.wavelengthM;
          const weight = spacingWeightNode(spacing, wave).toVar();
          If(weight.greaterThan(0), () => {
            g.addAssign(vec3(wave.dirX, 0, wave.dirZ).mul(cos(wavePhase(position, wave)).mul(wave.amplitudeM * k).mul(weight)));
          });
        }
        return g.mul(shoreWeightNode(position));
      }) as any)();
    },
  } as HeightSource;
}

