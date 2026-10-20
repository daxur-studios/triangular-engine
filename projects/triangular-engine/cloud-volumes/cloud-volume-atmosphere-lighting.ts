import { Vector3 } from 'three';
import type { CloudVolume } from './cloud-volume';

type Rgb = readonly [number, number, number];

/** Cosine range below a volume's horizon over which its sun colour fades out (about 4 degrees). */
const TERMINATOR_FADE = 0.07;

/**
 * What the lighting needs from an atmosphere, as plain functions, so this entry point does not import
 * `triangular-engine/atmosphere`. The atmosphere's baked tables satisfy it:
 *
 * ```ts
 * const luts = bakeAtmosphereLuts(profile);
 * const source = {
 *   planetRadiusM: profile.planetRadiusM,
 *   sunTransmittance: (p, s) => sunTransmittanceFromLut(luts, p, s),
 *   skyIrradiance: (alt, mu) => sampleIrradianceLut(luts, alt, mu),
 * };
 * ```
 */
export interface CloudAtmosphereSource {
  readonly planetRadiusM: number;
  /** Sunlight transmittance (0..1 per channel) at a point with the planet centred on the origin, 0 in the planet's shadow. */
  sunTransmittance(point: Rgb, sunDirection: Rgb): Rgb;
  /** Sky light on an upward surface at `altitudeM`, relative to the sun's irradiance, for a sun-zenith cosine `muSun`. */
  skyIrradiance(altitudeM: number, muSun: number): Rgb;
}

export interface CloudVolumeAtmosphereLightingOptions {
  /** World position of the planet's centre. Default the origin. */
  planetCenter?: Vector3;
  /** Metres of atmosphere per world unit. Default 1. */
  metersPerUnit?: number;
  /** Scales the sky light that fills the shade. Default 1. */
  ambientScale?: number;
}

/**
 * Plan 051 Phase 3: sun colour and sky ambient for cloud volumes from an atmosphere.
 *
 * Once per call and per volume, on the CPU, at the volume's centre: the transmitted sun colour (orange near the
 * horizon, black in the planet's shadow) and the sky light at that altitude. They go into each volume's
 * `uSunColor` and `uAmbient` uniforms, so the GPU cost is zero. A volume is lit as a whole: one that straddles the
 * terminator flips as its centre crosses it. (A per-pixel sun colour would remove that; it costs a table read in the march.)
 */
export class CloudVolumeAtmosphereLighting {
  ambientScale: number;
  readonly planetCenter: Vector3;
  metersPerUnit: number;

  private readonly point = new Vector3();
  private readonly sun = new Vector3();
  private readonly lit = new Vector3();

  constructor(
    private readonly source: CloudAtmosphereSource,
    options: CloudVolumeAtmosphereLightingOptions = {},
  ) {
    this.planetCenter = options.planetCenter?.clone() ?? new Vector3();
    this.metersPerUnit = options.metersPerUnit ?? 1;
    this.ambientScale = options.ambientScale ?? 1;
  }

  /**
   * The sun's colour and a 0..1 sky brightness on the ground under `above` (a world point; default the planet's top), for
   * lighting the planet's own surface or a scene light alongside the clouds.
   */
  groundLight(sunWorld: Vector3, above: Vector3 = new Vector3(0, this.source.planetRadiusM / this.metersPerUnit, 0).add(this.planetCenter)): {
    sun: Rgb;
    sky: number;
  } {
    this.sun.copy(sunWorld).normalize();
    this.point.copy(above).sub(this.planetCenter).normalize().multiplyScalar(this.source.planetRadiusM + 1);
    const mu = this.point.dot(this.sun) / this.point.length();
    const sun = this.source.sunTransmittance([this.point.x, this.point.y, this.point.z], [this.sun.x, this.sun.y, this.sun.z]);
    const sky = this.source.skyIrradiance(0, mu);
    const luminance = 0.2126 * sky[0] + 0.7152 * sky[1] + 0.0722 * sky[2];
    return { sun, sky: Math.max(0, Math.min(1, luminance / 0.15)) };
  }

  /** Lights every volume for a sun at `sunWorld` (a direction in world space; it need not be normalized). */
  update(volumes: readonly CloudVolume[], sunWorld: Vector3): void {
    this.sun.copy(sunWorld).normalize();
    const sun: Rgb = [this.sun.x, this.sun.y, this.sun.z];
    for (const volume of volumes) {
      this.point.setFromMatrixPosition(volume.mesh.matrixWorld).sub(this.planetCenter).multiplyScalar(this.metersPerUnit);
      const r = this.point.length();
      if (r === 0) continue;
      const muSun = this.point.dot(this.sun) / r;
      // The source returns exactly 0 once the planet blocks the sun, so a volume's light would snap off at the
      // horizon. Sample just above the horizon instead and fade over a few degrees below it.
      const ratio = Math.min(1, this.source.planetRadiusM / r);
      const muHorizon = -Math.sqrt(1 - ratio * ratio);
      const muLit = Math.max(muSun, muHorizon + 1e-3);
      let direct: Rgb;
      if (muLit === muSun) {
        direct = this.source.sunTransmittance([this.point.x, this.point.y, this.point.z], sun);
      } else {
        const k = Math.sqrt(Math.max(0, 1 - muLit * muLit) / Math.max(1e-6, 1 - muSun * muSun));
        this.lit.set(this.sun.x - (this.point.x / r) * muSun, this.sun.y - (this.point.y / r) * muSun, this.sun.z - (this.point.z / r) * muSun);
        this.lit.multiplyScalar(k).addScaledVector(this.point, muLit / r);
        const edge = this.source.sunTransmittance([this.point.x, this.point.y, this.point.z], [this.lit.x, this.lit.y, this.lit.z]);
        const fade = Math.max(0, Math.min(1, (muSun - (muHorizon - TERMINATOR_FADE)) / TERMINATOR_FADE));
        const f = fade * fade * (3 - 2 * fade);
        direct = [edge[0] * f, edge[1] * f, edge[2] * f];
      }
      const sky = this.source.skyIrradiance(Math.max(0, r - this.source.planetRadiusM), muSun);
      volume.uSunColor.value.set(direct[0], direct[1], direct[2]);
      volume.uAmbient.value.set(sky[0], sky[1], sky[2]).multiplyScalar(this.ambientScale);
    }
  }
}
