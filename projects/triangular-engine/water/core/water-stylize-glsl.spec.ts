import {
  createWaterStylizeUniforms,
  waterPosterizeChannel,
} from './water-stylize-glsl';

describe('water stylize math', () => {
  it('posterizes a channel into the configured number of bands', () => {
    expect(waterPosterizeChannel(0.49, 4)).toBe(0.25);
    expect(waterPosterizeChannel(1, 4)).toBe(1);
  });

  it('clamps the uniform to at least two steps', () => {
    expect(createWaterStylizeUniforms({ colorSteps: 1 }).uColorSteps.value).toBe(2);
  });
});
