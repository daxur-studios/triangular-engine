import { Color } from 'three';
import { createWaterShadingUniforms } from './water-shading-glsl';

describe('createWaterShadingUniforms', () => {
  it('applies documented defaults', () => {
    const uniforms = createWaterShadingUniforms();
    expect(uniforms.uDetailNormalMap.value).toBeNull();
    expect(uniforms.uDetailTiling.value).toBe(8);
    expect(uniforms.uDetailScrollSpeed.value.toArray()).toEqual([0.05, 0.03]);
    expect(uniforms.uFresnelPower.value).toBe(3);
    expect(uniforms.uColorShallow.value.getHexString()).toBe('8fe3ff');
    expect(uniforms.uColorDeep.value.getHexString()).toBe('04283f');
    expect(uniforms.uAbsorptionDistance.value).toBe(6);
    expect(uniforms.uShoreFadeDistance.value).toBe(2);
  });

  it('accepts overrides, including pre-built Color instances', () => {
    const shallow = new Color('#ff0000');
    const uniforms = createWaterShadingUniforms({
      detailTiling: 4,
      detailStrength: 0.8,
      fresnelPower: 5,
      colorShallow: shallow,
      colorDeep: '#000011',
      absorptionDistance: 12,
      shoreFadeDistance: 3.5,
    });
    expect(uniforms.uDetailTiling.value).toBe(4);
    expect(uniforms.uDetailStrength.value).toBe(0.8);
    expect(uniforms.uFresnelPower.value).toBe(5);
    expect(uniforms.uColorShallow.value).toBe(shallow);
    expect(uniforms.uColorDeep.value.getHexString()).toBe('000011');
    expect(uniforms.uAbsorptionDistance.value).toBe(12);
    expect(uniforms.uShoreFadeDistance.value).toBe(3.5);
  });
});
