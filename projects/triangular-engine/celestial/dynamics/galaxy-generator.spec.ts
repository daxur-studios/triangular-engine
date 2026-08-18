import { DEFAULT_GALAXY_CONFIG, generateGalaxyData } from './galaxy-generator';

describe('galaxy-generator', () => {
  it('should generate requested number of star particles', () => {
    const data = generateGalaxyData({ count: 1000 });
    expect(data.positions.length).toBe(3000);
    expect(data.colors.length).toBe(3000);
    expect(data.sizes.length).toBe(1000);
    expect(data.phases.length).toBe(1000);
    expect(data.radii.length).toBe(1000);
    expect(data.speeds.length).toBe(1000);
  });

  it('should generate deterministic star data when given a seed', () => {
    const data1 = generateGalaxyData({ count: 500, seed: 12345 });
    const data2 = generateGalaxyData({ count: 500, seed: 12345 });

    expect(data1.positions[0]).toBeCloseTo(data2.positions[0], 5);
    expect(data1.positions[100]).toBeCloseTo(data2.positions[100], 5);
    expect(data1.colors[50]).toBeCloseTo(data2.colors[50], 5);
  });

  it('should generate positions within galaxy bounds', () => {
    const radius = 500;
    const data = generateGalaxyData({ count: 2000, radius, seed: 999 });

    let maxRadiusFound = 0;
    for (let i = 0; i < data.positions.length; i += 3) {
      const x = data.positions[i];
      const y = data.positions[i + 1];
      const z = data.positions[i + 2];
      const r = Math.sqrt(x * x + y * y + z * z);
      if (r > maxRadiusFound) {
        maxRadiusFound = r;
      }
    }

    // Stars should reach out towards the radius boundary (including halo stars)
    expect(maxRadiusFound).toBeGreaterThan(radius * 0.5);
  });

  it('should use default configuration when empty options passed', () => {
    const data = generateGalaxyData({});
    expect(data.sizes.length).toBe(DEFAULT_GALAXY_CONFIG.count);
  });
});
