import {
  createTrailRibbonGeometry,
  type ITrailRibbonPoint,
} from './trail-ribbon-geometry';

function point(
  positionM: [number, number, number],
  widthM = 1,
  alpha01 = 1,
): ITrailRibbonPoint {
  return { positionM, widthM, alpha01 };
}

describe('createTrailRibbonGeometry', () => {
  it('throws with fewer than 2 points', () => {
    expect(() => createTrailRibbonGeometry([point([0, 0, 0])])).toThrow();
  });

  it('emits 2 vertices per point and 2 triangles per segment', () => {
    const points = [point([0, 0, 0]), point([1, 0, 0]), point([2, 0, 0])];
    const geometry = createTrailRibbonGeometry(points);
    expect(geometry.getAttribute('position').count).toBe(points.length * 2);
    expect(geometry.getIndex()?.count).toBe((points.length - 1) * 6);
  });

  it('spans UV.v from 0 at the first point to 1 at the last', () => {
    const points = [point([0, 0, 0]), point([1, 0, 0]), point([2, 0, 0])];
    const geometry = createTrailRibbonGeometry(points);
    const uv = geometry.getAttribute('uv');
    expect(uv.getY(0)).toBeCloseTo(0);
    expect(uv.getY(uv.count - 1)).toBeCloseTo(1);
  });

  it('carries each point alpha01 onto both of its vertices', () => {
    const points = [
      point([0, 0, 0], 1, 0.2),
      point([1, 0, 0], 1, 0.8),
    ];
    const geometry = createTrailRibbonGeometry(points);
    const alpha = geometry.getAttribute('alpha');
    expect(alpha.getX(0)).toBeCloseTo(0.2);
    expect(alpha.getX(1)).toBeCloseTo(0.2);
    expect(alpha.getX(2)).toBeCloseTo(0.8);
    expect(alpha.getX(3)).toBeCloseTo(0.8);
  });

  it('spreads left/right vertices apart by widthM at a straight segment', () => {
    const points = [point([0, 0, 0], 4), point([1, 0, 0], 4)];
    const geometry = createTrailRibbonGeometry(points, { normalOffsetM: 0 });
    const position = geometry.getAttribute('position');
    const dz = position.getZ(0) - position.getZ(1);
    expect(Math.abs(dz)).toBeCloseTo(4);
  });

  it('lifts vertices along the normal by normalOffsetM', () => {
    const points = [point([0, 0, 0]), point([1, 0, 0])];
    const geometry = createTrailRibbonGeometry(points, { normalOffsetM: 0.5 });
    const position = geometry.getAttribute('position');
    expect(position.getY(0)).toBeCloseTo(0.5);
  });

  it('reprojects points via projectToSurface before offsetting', () => {
    const points = [point([0, 0, 0]), point([1, 0, 0])];
    const geometry = createTrailRibbonGeometry(points, {
      normalOffsetM: 0,
      projectToSurface: ([x, _y, z]) => [x, 10, z],
    });
    const position = geometry.getAttribute('position');
    expect(position.getY(0)).toBeCloseTo(10);
    expect(position.getY(1)).toBeCloseTo(10);
  });
});
