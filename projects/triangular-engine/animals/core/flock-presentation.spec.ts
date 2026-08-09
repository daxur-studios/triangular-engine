import { presentInterpolatedFlock } from './flock-presentation';

describe('presentInterpolatedFlock', () => {
  const previous = [{ id: 'bird', position: { x: 0, y: 2, z: 0 }, velocity: { x: 0, y: 0, z: 2 }, activity: 'travel' as const, visible: true }];
  const current = [{ id: 'bird', position: { x: 4, y: 6, z: 8 }, velocity: { x: 2, y: 0, z: 0 }, activity: 'flee' as const, visible: true }];

  it('interpolates presentation only between fixed snapshots', () => {
    expect(presentInterpolatedFlock(previous, current, 0)[0].position).toEqual(previous[0].position);
    expect(presentInterpolatedFlock(previous, current, 1)[0].position).toEqual(current[0].position);
    expect(presentInterpolatedFlock(previous, current, 0.5)[0].position).toEqual({ x: 2, y: 4, z: 4 });
    expect(previous[0].position).toEqual({ x: 0, y: 2, z: 0 });
  });

  it('derives a finite bounded bank hint from a heading change', () => {
    const presentation = presentInterpolatedFlock(previous, current, 0.5)[0];
    expect(Number.isFinite(presentation.bank)).toBeTrue();
    expect(Math.abs(presentation.bank)).toBeLessThanOrEqual(0.55);
  });
});
