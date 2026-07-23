import { GerstnerSurface } from '../core/water-surface';
import {
  WATER_RENDER_PRESETS,
  resolveWaterRenderPreset,
} from './water-render-preset';

describe('water render presets', () => {
  it('deep-merges sections while replacing waves wholesale', () => {
    const resolved = resolveWaterRenderPreset(WATER_RENDER_PRESETS.cinematic, {
      waves: WATER_RENDER_PRESETS.pixel.waves,
      shading: { colorDeep: '#000011' },
      farField: { glintStrength: 0.25 },
      grid: { ringCount: 3 },
    });

    expect(resolved.waves).toBe(WATER_RENDER_PRESETS.pixel.waves);
    expect(resolved.shading.colorDeep).toBe('#000011');
    expect(resolved.shading.fresnelPower).toBe(
      WATER_RENDER_PRESETS.cinematic.shading.fresnelPower,
    );
    expect(resolved.farField?.glintStrength).toBe(0.25);
    expect(resolved.farField?.cascadeCount).toBe(3);
    expect(resolved.grid.ringCount).toBe(3);
    expect(resolved.grid.patchResolution).toBe(
      WATER_RENDER_PRESETS.cinematic.grid.patchResolution,
    );
  });

  it('ships JSON-round-trippable preset data', () => {
    const roundTrip = JSON.parse(JSON.stringify(WATER_RENDER_PRESETS));
    expect(roundTrip).toEqual(WATER_RENDER_PRESETS);
  });

  it('ships wave sets accepted by GerstnerSurface without warnings', () => {
    const warn = spyOn(console, 'warn');

    for (const preset of Object.values(WATER_RENDER_PRESETS)) {
      expect(() => new GerstnerSurface(preset.waves.waves)).not.toThrow();
    }

    expect(warn).not.toHaveBeenCalled();
  });
});
