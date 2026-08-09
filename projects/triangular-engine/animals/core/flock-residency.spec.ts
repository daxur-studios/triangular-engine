import { updateFlockResidency } from './flock-residency';

describe('updateFlockResidency', () => {
  const definition = { id: 'birds', seed: 1, origin: { x: 0, y: 0, z: 0 }, count: 2, spacing: 1, speed: 1, cullDistance: 10, hysteresis: 3 };

  it('enters and exits deterministically using the configured thresholds', () => {
    const observer = (x: number) => ({ position: { x, y: 0, z: 0 }, radius: 0 });
    expect(updateFlockResidency(definition, observer(10)).visible).toBeTrue();
    expect(updateFlockResidency(definition, observer(10.01)).visible).toBeFalse();
    expect(updateFlockResidency(definition, observer(12.9), true).visible).toBeTrue();
    expect(updateFlockResidency(definition, observer(13.01), true).visible).toBeFalse();
  });

  it('accounts for observer radius', () => {
    expect(updateFlockResidency(definition, { position: { x: 11, y: 0, z: 0 }, radius: 1 }).visible).toBeTrue();
  });
});
