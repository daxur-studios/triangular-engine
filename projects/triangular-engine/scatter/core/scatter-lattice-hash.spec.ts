import { hashScatterLattice01, hashScatterLatticeCell01 } from './scatter-lattice-hash';

describe('scatter lattice hashes', () => {
  it('are deterministic and spread over [0, 1)', () => {
    expect(hashScatterLattice01(3, -7, 12)).toBe(hashScatterLattice01(3, -7, 12));
    let min = 1;
    let max = 0;
    for (let i = -250; i < 250; i++) {
      for (const h of [hashScatterLattice01(i, i * 3, -i), hashScatterLatticeCell01(i, -i * 7, i * 13, 3)]) {
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(min).toBeLessThan(0.05);
    expect(max).toBeLessThan(1);
    expect(max).toBeGreaterThan(0.95);
  });

  it('gives every salt its own draw', () => {
    expect(hashScatterLatticeCell01(5, 6, 7, 8)).toBe(hashScatterLatticeCell01(5, 6, 7, 8));
    expect(hashScatterLatticeCell01(5, 6, 7, 8)).not.toBe(hashScatterLatticeCell01(5, 6, 7, 16));
  });
});
