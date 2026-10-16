import { createPlanetMorphUniforms, setPlanetProjectionCentre } from './planet-morph-nodes';

describe('setPlanetProjectionCentre', () => {
  it('writes an orthonormal basis whose forward axis is the centre direction, and turns dynamic mode on', () => {
    const uniforms = createPlanetMorphUniforms();
    setPlanetProjectionCentre(uniforms, { lonDeg: 40, latDeg: 25 });

    const { uProjForward: f, uProjUp: u, uProjRight: r } = uniforms;
    const lon = (40 * Math.PI) / 180;
    const lat = (25 * Math.PI) / 180;
    expect(uniforms.uProjMode.value).toBe(1);
    expect(f.value.x).toBeCloseTo(Math.cos(lat) * Math.sin(lon), 6);
    expect(f.value.y).toBeCloseTo(Math.sin(lat), 6);
    expect(f.value.z).toBeCloseTo(Math.cos(lat) * Math.cos(lon), 6);
    for (const v of [f.value, u.value, r.value]) expect(v.length()).toBeCloseTo(1, 6);
    expect(f.value.dot(u.value)).toBeCloseTo(0, 6);
    expect(f.value.dot(r.value)).toBeCloseTo(0, 6);
    expect(u.value.dot(r.value)).toBeCloseTo(0, 6);
  });

  it('matches the default frame at lon 0, lat 0 (dynamic projection then equals the baked one)', () => {
    const uniforms = createPlanetMorphUniforms();
    setPlanetProjectionCentre(uniforms, { lonDeg: 0, latDeg: 0 });
    expect(uniforms.uProjForward.value.toArray()).toEqual([0, 0, 1]);
    expect(uniforms.uProjUp.value.toArray()).toEqual([0, 1, 0]);
    expect(uniforms.uProjRight.value.x).toBeCloseTo(1, 6);
  });

  it('keeps a valid basis when centred on a pole', () => {
    const uniforms = createPlanetMorphUniforms();
    setPlanetProjectionCentre(uniforms, { lonDeg: 0, latDeg: 90 });
    expect(uniforms.uProjUp.value.length()).toBeCloseTo(1, 6);
    expect(Number.isNaN(uniforms.uProjRight.value.x)).toBe(false);
  });

  it('returns to the static projection with null', () => {
    const uniforms = createPlanetMorphUniforms();
    setPlanetProjectionCentre(uniforms, { lonDeg: 10, latDeg: 0 });
    setPlanetProjectionCentre(uniforms, null);
    expect(uniforms.uProjMode.value).toBe(0);
  });
});
