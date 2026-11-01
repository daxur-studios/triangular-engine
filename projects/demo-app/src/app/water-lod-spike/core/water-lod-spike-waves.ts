/* eslint-disable @typescript-eslint/no-explicit-any */
import { cos, dot, float, sin, vec3 } from 'three/tsl';
import type { HeightSource } from 'triangular-engine/lod-surface/core';

/**
 * Spike-local wave table for plan 080 (W0b): 16 directional sines in four
 * wavelength bands, fixed for the whole spike. Each wave is `amp * sin(k . p + phase)`
 * over the plane's base position (metres, plane frame). The CPU twin (`heightAt`)
 * and the TSL nodes read this one table, so they agree to float32 rounding.
 *
 * Not built here (plan 080 W0b / S-W1 follow-up): per-wave distance fade, the
 * sigma-squared roughness transfer, wind-driven amplitude, and any time term.
 * The heights are static, so the mesh does not animate.
 */
interface IWaterWave {
  readonly axis: readonly [number, number, number];
  readonly wavelengthM: number;
  readonly amplitudeM: number;
  readonly phase: number;
}

const BAND_WAVELENGTHS_M = [400, 120, 40, 12] as const;
/*
 * Raised from [1.2, 0.35, 0.1, 0.03] so each band has a slope near 0.03 to 0.05 (amplitude x wavenumber). The earlier
 * slopes were around 0.016 to 0.019, too flat to read as 3D water from the orbit camera.
 */
const BAND_AMPLITUDES_M = [2, 0.9, 0.3, 0.08] as const;
const WAVES_PER_BAND = 4;
/** Golden angle in radians: spreads the directions of the 16 waves without clustering them. */
const GOLDEN_ANGLE = 2.39996322972865332;

function buildWaves(): readonly IWaterWave[] {
  const waves: IWaterWave[] = [];
  for (let band = 0; band < BAND_WAVELENGTHS_M.length; band++) {
    for (let i = 0; i < WAVES_PER_BAND; i++) {
      const index = band * WAVES_PER_BAND + i;
      const angle = index * GOLDEN_ANGLE;
      waves.push({
        axis: [Math.cos(angle), 0, Math.sin(angle)],
        wavelengthM: BAND_WAVELENGTHS_M[band] * (1 + 0.07 * i),
        amplitudeM: BAND_AMPLITUDES_M[band],
        phase: 0.7 * index,
      });
    }
  }
  return waves;
}

/** The 16 waves, shared by the CPU twin and the TSL nodes. */
export const WATER_LOD_SPIKE_WAVES: readonly IWaterWave[] = buildWaves();

/**
 * A `HeightSource` for `<flatTerrain [heights]>`: the plane's water height as a
 * sum of the spike's 16 waves. Gives the lod-surface mesh its vertex-stage height
 * (`heightNode`), its gradient (`gradientNode`) and the CPU twin used by
 * selection and ground queries (`heightAt`).
 */
export function createWaterLodSpikeWaves(): HeightSource {
  const boundM = WATER_LOD_SPIKE_WAVES.reduce((sum, wave) => sum + wave.amplitudeM, 0);
  return {
    id: 'bumps',
    boundM,
    heightAt(x, y, z) {
      let h = 0;
      for (const { axis, wavelengthM, amplitudeM, phase } of WATER_LOD_SPIKE_WAVES) {
        h += amplitudeM * Math.sin(((2 * Math.PI) / wavelengthM) * (x * axis[0] + y * axis[1] + z * axis[2]) + phase);
      }
      return h;
    },
    heightNode(position) {
      let h: any = float(0);
      for (const { axis, wavelengthM, amplitudeM, phase } of WATER_LOD_SPIKE_WAVES) {
        h = h.add(sin(dot(position, vec3(...axis)).mul((2 * Math.PI) / wavelengthM).add(phase)).mul(amplitudeM));
      }
      return h;
    },
    gradientNode(position) {
      let g: any = vec3(0, 0, 0);
      for (const { axis, wavelengthM, amplitudeM, phase } of WATER_LOD_SPIKE_WAVES) {
        const k = (2 * Math.PI) / wavelengthM;
        const term = cos(dot(position, vec3(...axis)).mul(k).add(phase)).mul(amplitudeM * k);
        g = g.add(vec3(...axis).mul(term));
      }
      return g;
    },
  } as HeightSource;
}
