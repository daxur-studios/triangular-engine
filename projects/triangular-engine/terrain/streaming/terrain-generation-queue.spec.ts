import { TerrainGenerationQueue } from './terrain-generation-queue';

describe('TerrainGenerationQueue', () => {
  it('drains nearest work first within the frame budget', () => {
    const queue = new TerrainGenerationQueue<number>();
    queue.reconcile(
      [
        { key: 'far', value: 3, priority: 30 },
        { key: 'near', value: 1, priority: 10 },
        { key: 'middle', value: 2, priority: 20 },
      ],
      new Set(),
    );
    const generated: number[] = [];
    expect(queue.drain(2, ({ value }) => generated.push(value))).toBe(2);
    expect(generated).toEqual([1, 2]);
    expect(queue.pendingCount).toBe(1);
  });

  it('cancels superseded work and skips resident patches', () => {
    const queue = new TerrainGenerationQueue<number>();
    queue.reconcile(
      [
        { key: 'old', value: 1, priority: 1 },
        { key: 'resident', value: 2, priority: 2 },
      ],
      new Set(['resident']),
    );
    queue.reconcile([{ key: 'new', value: 3, priority: 1 }], new Set());
    const generated: number[] = [];
    queue.drain(5, ({ value }) => generated.push(value));
    expect(generated).toEqual([3]);
  });

  it('validates the drain budget', () => {
    const queue = new TerrainGenerationQueue<number>();
    expect(() => queue.drain(-1, () => undefined)).toThrowError(RangeError);
  });
});
