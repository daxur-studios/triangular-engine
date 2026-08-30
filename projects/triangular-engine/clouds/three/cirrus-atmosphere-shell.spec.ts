import { Vector3 } from 'three';
import { buildCirrusAtmosphereShell } from './cirrus-atmosphere-shell';

describe('Cirrus Atmosphere Shell', () => {
  it('creates shell mesh with shader material and initial uniforms', () => {
    const shell = buildCirrusAtmosphereShell({
      radius: 60,
      coverage: 0.7,
      wispiness: 0.4,
      flowSpeed: 0.1,
      faceted: true,
    });

    expect(shell.mesh).toBeDefined();
    expect(shell.material).toBeDefined();
    expect(shell.material.uniforms['uRadius'].value).toBe(60);
    expect(shell.material.uniforms['uCoverage'].value).toBe(0.7);
    expect(shell.material.uniforms['uWispiness'].value).toBe(0.4);
    expect(shell.material.uniforms['uFlowSpeed'].value).toBe(0.1);
    expect(shell.material.uniforms['uFaceted'].value).toBe(1.0);

    shell.dispose();
  });

  it('updates animation time and uniforms dynamically', () => {
    const shell = buildCirrusAtmosphereShell({ radius: 50 });

    shell.update(12.5);
    expect(shell.material.uniforms['uTime'].value).toBe(12.5);

    shell.setCoverage(0.85);
    expect(shell.material.uniforms['uCoverage'].value).toBe(0.85);

    shell.setWispiness(0.2);
    expect(shell.material.uniforms['uWispiness'].value).toBe(0.2);

    shell.setFlowSpeed(0.25);
    expect(shell.material.uniforms['uFlowSpeed'].value).toBe(0.25);

    shell.setFaceted(false);
    expect(shell.material.uniforms['uFaceted'].value).toBe(0.0);

    shell.setSunDirection(new Vector3(0, 1, 0));
    expect(shell.material.uniforms['uSunDirection'].value.y).toBeCloseTo(1, 4);

    shell.dispose();
  });
});
