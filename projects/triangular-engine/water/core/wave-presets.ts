import type { WaterWavePreset } from './water-surface';

/** Small ripples suitable for a sheltered lake or harbour. */
export const CALM_LAKE_PRESET: WaterWavePreset = {
  name: 'calm-lake',
  waves: [
    { direction: [1, 0.2], wavelength: 6, amplitude: 0.05, steepness: 0.3 },
    {
      direction: [0.4, 1],
      wavelength: 3.5,
      amplitude: 0.025,
      steepness: 0.25,
      speedMultiplier: 1.1,
    },
  ],
};

/** Open-water swell with a dominant direction plus cross-chop. */
export const OCEAN_SWELL_PRESET: WaterWavePreset = {
  name: 'ocean-swell',
  waves: [
    { direction: [1, 0], wavelength: 40, amplitude: 0.8, steepness: 0.5 },
    {
      direction: [0.7, 0.7],
      wavelength: 22,
      amplitude: 0.4,
      steepness: 0.45,
      speedMultiplier: 1.15,
    },
    {
      direction: [-0.3, 1],
      wavelength: 11,
      amplitude: 0.2,
      steepness: 0.35,
      speedMultiplier: 1.3,
    },
    {
      direction: [0.9, -0.4],
      wavelength: 5,
      amplitude: 0.08,
      steepness: 0.25,
      speedMultiplier: 1.6,
    },
  ],
};

/** Heavy, steep seas. Intentionally near the steepness-sum warning threshold. */
export const STORM_PRESET: WaterWavePreset = {
  name: 'storm',
  waves: [
    { direction: [1, 0], wavelength: 55, amplitude: 2.2, steepness: 0.6 },
    {
      direction: [0.6, 0.8],
      wavelength: 30,
      amplitude: 1.3,
      steepness: 0.55,
      speedMultiplier: 1.1,
    },
    {
      direction: [-0.5, 0.85],
      wavelength: 16,
      amplitude: 0.7,
      steepness: 0.5,
      speedMultiplier: 1.25,
    },
    {
      direction: [0.85, -0.5],
      wavelength: 8,
      amplitude: 0.3,
      steepness: 0.4,
      speedMultiplier: 1.5,
    },
  ],
};

export const WATER_WAVE_PRESETS = {
  calmLake: CALM_LAKE_PRESET,
  oceanSwell: OCEAN_SWELL_PRESET,
  storm: STORM_PRESET,
} as const;
