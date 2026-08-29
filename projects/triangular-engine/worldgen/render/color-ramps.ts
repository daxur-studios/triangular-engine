/** Deterministic, well-spread plate color — golden-angle hue step so adjacent plate ids never land near each other on the wheel. */
export function plateColor(plateId: number): string {
  const hue = (plateId * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 65%, 55%)`;
}

/** Elevation -> color ramp: deep ocean blue through to snow-capped peaks, split at sea level. */
export function elevationColor(
  elevation: number,
  seaLevel: number,
  min: number,
  max: number,
): string {
  if (elevation < seaLevel) {
    const t = max > seaLevel ? (elevation - min) / (seaLevel - min || 1) : 0;
    const clamped = Math.max(0, Math.min(1, t));
    const l = 12 + clamped * 28;
    return `hsl(210, 70%, ${l}%)`;
  }
  const t = Math.max(
    0,
    Math.min(1, (elevation - seaLevel) / (max - seaLevel || 1)),
  );
  if (t < 0.6) {
    const l = 30 + (t / 0.6) * 20;
    return `hsl(${100 - t * 30}, 45%, ${l}%)`;
  }
  const l = 50 + ((t - 0.6) / 0.4) * 40;
  return `hsl(30, ${Math.max(0, 25 - (t - 0.6) * 40)}%, ${l}%)`;
}

/** Temperature -> color ramp: cold blue through to hot red. Temperature can dip below
 * -1 from the elevation lapse on high peaks, so the cold end clamps at -1.6, not -1. */
export function temperatureColor(temperature: number): string {
  const t = Math.max(-1.6, Math.min(1, temperature));
  const norm = (t + 1.6) / 2.6;
  const hue = 240 - norm * 240;
  const l = 35 + norm * 20;
  return `hsl(${hue.toFixed(1)}, 65%, ${l}%)`;
}

/** Moisture -> color ramp: arid tan through to saturated teal-blue. */
export function moistureColor(moisture: number): string {
  const m = Math.max(0, Math.min(1, moisture));
  const hue = 40 + m * 160;
  const l = 30 + m * 25;
  return `hsl(${hue.toFixed(1)}, 55%, ${l}%)`;
}

export const BIOME_COLORS: Record<string, string> = {
  ocean: 'hsl(210, 55%, 22%)',
  lake: 'hsl(200, 65%, 42%)',
  ice_cap: 'hsl(195, 40%, 82%)',
  tundra: 'hsl(200, 20%, 55%)',
  taiga: 'hsl(170, 25%, 35%)',
  glacier: 'hsl(190, 50%, 90%)',
  steppe: 'hsl(45, 35%, 55%)',
  meadow: 'hsl(95, 45%, 45%)',
  hills: 'hsl(85, 35%, 38%)',
  jungle: 'hsl(140, 55%, 30%)',
  desert: 'hsl(40, 65%, 60%)',
  savanna: 'hsl(55, 55%, 50%)',
  rainforest: 'hsl(150, 60%, 25%)',
  alpine: 'hsl(0, 0%, 75%)',
  canyon: 'hsl(20, 55%, 40%)',
};

export function biomeColor(biome: string): string {
  return BIOME_COLORS[biome] ?? '#888';
}
