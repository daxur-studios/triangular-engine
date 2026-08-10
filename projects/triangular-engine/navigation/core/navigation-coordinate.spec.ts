import {
  assertNavigationLocation,
  createNavigationCoordinateContract,
  navigationDistanceSquared,
} from './navigation-coordinate';

describe('navigation coordinate contract', () => {
  it('defines the stable Y-up, X/Z terrain convention', () => {
    expect(createNavigationCoordinateContract('planet:surface')).toEqual({
      frameId: 'planet:surface',
      version: 1,
      units: 'world',
      upAxis: 'y',
      horizontalAxes: ['x', 'z'],
    });
  });

  it('rejects non-finite positions and mismatched frames', () => {
    expect(() => assertNavigationLocation({
      frameId: 'world',
      position: { x: Number.NaN, y: 0, z: 0 },
    })).toThrowError('Navigation location position components must be finite.');

    expect(() => navigationDistanceSquared(
      { frameId: 'world', position: { x: 0, y: 0, z: 0 } },
      { frameId: 'other', position: { x: 1, y: 0, z: 0 } },
    )).toThrowError('Goal location belongs to frame "other", expected "world".');
  });

  it('calculates distance only within one coordinate frame', () => {
    expect(navigationDistanceSquared(
      { frameId: 'world', position: { x: 0, y: 0, z: 0 } },
      { frameId: 'world', position: { x: 2, y: 3, z: 6 } },
    )).toBe(49);
  });
});
