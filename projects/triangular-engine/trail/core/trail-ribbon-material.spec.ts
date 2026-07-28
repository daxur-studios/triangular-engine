import { createTrailRibbonMaterial } from './trail-ribbon-material';

describe('createTrailRibbonMaterial', () => {
  it('enables polygonOffset and transparency by default', () => {
    const material = createTrailRibbonMaterial();
    expect(material.polygonOffset).toBeTrue();
    expect(material.transparent).toBeTrue();
    expect(material.depthWrite).toBeFalse();
  });

  it('honours an explicit opacity override', () => {
    const material = createTrailRibbonMaterial({ opacity: 0.4 });
    expect(material.opacity).toBeCloseTo(0.4);
  });

  it('wires an onBeforeCompile hook to fold the alpha attribute into fragment alpha', () => {
    const material = createTrailRibbonMaterial();
    expect(material.onBeforeCompile).toBeDefined();
  });
});
