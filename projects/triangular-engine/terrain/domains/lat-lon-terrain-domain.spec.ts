import { LatLonTerrainDomain } from './lat-lon-terrain-domain';

describe('LatLonTerrainDomain', () => {
  it('initializes with default 4x2 root tiles', () => {
    const domain = new LatLonTerrainDomain(1_000);
    expect(domain.radiusM).toBe(1_000);
    expect(domain.rootTilesX).toBe(4);
    expect(domain.rootTilesY).toBe(2);

    const roots = domain.createLevelZeroRoots();
    expect(roots.length).toBe(8);
  });

  it('computes correct bounds at level 0 and level 1', () => {
    const domain = new LatLonTerrainDomain(1_000);

    // Root (0, 0, 0): bottom-left (South-West) tile: lon [-PI, -PI/2], lat [-PI/2, 0]
    const root0 = domain.getPatchBounds({ level: 0, x: 0, y: 0 });
    expect(root0.minU).toBeCloseTo(-Math.PI);
    expect(root0.maxU).toBeCloseTo(-Math.PI / 2);
    expect(root0.minV).toBeCloseTo(-Math.PI / 2);
    expect(root0.maxV).toBeCloseTo(0);

    // Root (0, 2, 1): lon [0, PI/2], lat [0, PI/2] (North-East from prime meridian)
    const rootEquator = domain.getPatchBounds({ level: 0, x: 2, y: 1 });
    expect(rootEquator.minU).toBeCloseTo(0);
    expect(rootEquator.maxU).toBeCloseTo(Math.PI / 2);
    expect(rootEquator.minV).toBeCloseTo(0);
    expect(rootEquator.maxV).toBeCloseTo(Math.PI / 2);

    // Child (level 1): subdivisions
    const children = domain.getChildren({ level: 0, x: 2, y: 1 });
    expect(children.length).toBe(4);
    expect(children[0]).toEqual({ level: 1, x: 4, y: 2 });
    expect(children[1]).toEqual({ level: 1, x: 5, y: 2 });
    expect(children[2]).toEqual({ level: 1, x: 4, y: 3 });
    expect(children[3]).toEqual({ level: 1, x: 5, y: 3 });

    const childBounds = domain.getPatchBounds(children[0]);
    expect(childBounds.minU).toBeCloseTo(0);
    expect(childBounds.maxU).toBeCloseTo(Math.PI / 4);
    expect(childBounds.minV).toBeCloseTo(0);
    expect(childBounds.maxV).toBeCloseTo(Math.PI / 4);
  });

  it('maps field positions correctly to sphere direction vectors', () => {
    const domain = new LatLonTerrainDomain(1_000);
    const address = { level: 0, x: 0, y: 0 };

    // Equator & Prime Meridian: lon=0, lat=0 -> +Z [0, 0, 1]
    const center = domain.getFieldPosition(address, 0, 0);
    expect(center[0]).toBeCloseTo(0);
    expect(center[1]).toBeCloseTo(0);
    expect(center[2]).toBeCloseTo(1);

    // North pole: lat = PI/2 -> +Y [0, 1, 0]
    const northPole = domain.getFieldPosition(address, 0, Math.PI / 2);
    expect(northPole[0]).toBeCloseTo(0);
    expect(northPole[1]).toBeCloseTo(1);
    expect(northPole[2]).toBeCloseTo(0);

    // East on equator: lon = PI/2, lat = 0 -> +X [1, 0, 0]
    const east = domain.getFieldPosition(address, Math.PI / 2, 0);
    expect(east[0]).toBeCloseTo(1);
    expect(east[1]).toBeCloseTo(0);
    expect(east[2]).toBeCloseTo(0);
  });

  it('wraps East-West across antimeridian seamlessly', () => {
    const domain = new LatLonTerrainDomain(1_000);

    // Level 0 has 4 tiles along X (0, 1, 2, 3)
    // Left neighbor of x=0 (at -PI) should wrap to x=3 (at +PI)
    const leftOfZero = domain.getPatchNeighbor({ level: 0, x: 0, y: 0 }, 'left');
    expect(leftOfZero).toEqual({ level: 0, x: 3, y: 0 });

    // Right neighbor of x=3 should wrap to x=0
    const rightOfThree = domain.getPatchNeighbor({ level: 0, x: 3, y: 0 }, 'right');
    expect(rightOfThree).toEqual({ level: 0, x: 0, y: 0 });
  });

  it('caps North-South neighbors at poles', () => {
    const domain = new LatLonTerrainDomain(1_000);

    // Bottom neighbor of y=0 stays y=0
    const bottomOfZero = domain.getPatchNeighbor({ level: 0, x: 1, y: 0 }, 'bottom');
    expect(bottomOfZero).toEqual({ level: 0, x: 1, y: 0 });

    // Top neighbor of y=1 (max at level 0) stays y=1
    const topOfMax = domain.getPatchNeighbor({ level: 0, x: 1, y: 1 }, 'top');
    expect(topOfMax).toEqual({ level: 0, x: 1, y: 1 });
  });
});
