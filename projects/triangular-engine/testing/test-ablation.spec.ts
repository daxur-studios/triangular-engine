import { compareAblation, type AblationArm, type AblationRound } from './test-ablation';

/** A round whose median is `center` and whose slowest frame is `tail` (default: a little above the median). */
function round(arm: AblationArm, center: number, tail = center * 1.1): AblationRound {
  return { arm, samples: [center * 0.95, center, center, center, tail] };
}

function abab(a: readonly number[], b: readonly number[]): AblationRound[] {
  return a.flatMap((value, i) => [round('A', value), round('B', b[i])]);
}

describe('compareAblation', () => {
  it('calls a steady, clearly higher B slower and reports the difference with its noise band', () => {
    const result = compareAblation(abab([0.100, 0.102, 0.099, 0.101], [0.130, 0.131, 0.129, 0.132]));
    expect(result.verdict).toBe('slower');
    expect(result.reasons).toEqual([]);
    expect(result.a.rounds).toEqual([0.100, 0.102, 0.099, 0.101]);
    expect(result.a.value).toBeCloseTo(0.100, 9);
    expect(result.b.value).toBeCloseTo(0.130, 9);
    expect(result.difference).toBeCloseTo(0.030, 9);
    expect(result.relative).toBeCloseTo(0.30, 6);
    expect(result.a.halfRange).toBeCloseTo(0.0015, 9);
    expect(result.b.halfRange).toBeCloseTo(0.0015, 9);
    expect(result.noiseBand).toBeCloseTo(Math.hypot(0.0015, 0.0015), 9);
    expect(result.a.spread).toBeCloseTo(0.003 / 0.100, 6);
  });

  it('calls a clearly lower B faster', () => {
    const result = compareAblation(abab([0.130, 0.131], [0.100, 0.101]));
    expect(result.verdict).toBe('faster');
    expect(result.difference).toBeLessThan(0);
    expect(result.relative).toBeLessThan(0);
  });

  it('reports no difference when the gap is inside the round-to-round noise', () => {
    // Rounds drift by 10 % of the value (under the 15 % limit); the A/B gap is smaller than that drift.
    const result = compareAblation(abab([0.100, 0.108, 0.100, 0.108], [0.103, 0.111, 0.103, 0.111]));
    expect(result.verdict).toBe('no-difference');
    expect(Math.abs(result.difference)).toBeLessThan(result.noiseBand);
    expect(result.reasons).toEqual([]);
  });

  it('with perfectly steady rounds any difference counts and identical arms are no difference', () => {
    const result = compareAblation([round('A', 1), round('B', 2), round('A', 1), round('B', 2)], { maxSpread: 1 });
    expect(result.noiseBand).toBe(0);
    expect(result.difference).toBe(1);
    expect(result.verdict).toBe('slower');
    const same = compareAblation([round('A', 1), round('B', 1), round('A', 1), round('B', 1)]);
    expect(same.noiseBand).toBe(0);
    expect(same.verdict).toBe('no-difference');
  });

  it('rejects the run when one arm drifts more than 15 % between its rounds', () => {
    // A: 0.100 .. 0.120 around median 0.100 (nearest rank) is a 20 % spread.
    const result = compareAblation(abab([0.100, 0.120, 0.100, 0.110], [0.200, 0.200, 0.200, 0.200]));
    expect(result.verdict).toBe('rejected');
    expect(result.a.spread).toBeGreaterThan(0.15);
    expect(result.b.spread).toBe(0);
    expect(result.reasons.length).toBe(1);
    expect(result.reasons[0]).toContain('Arm A');
    // The numbers are still reported so a reader can see how bad it was.
    expect(result.difference).toBeGreaterThan(0);
  });

  it('honours a custom maxSpread', () => {
    const rounds = abab([0.100, 0.108, 0.100, 0.108], [0.130, 0.138, 0.130, 0.138]);
    expect(compareAblation(rounds).verdict).toBe('slower');
    expect(compareAblation(rounds, { maxSpread: 0.05 }).verdict).toBe('rejected');
  });

  it('is invalid when rounds do not alternate', () => {
    const result = compareAblation([round('A', 1), round('A', 1), round('B', 2), round('B', 2)]);
    expect(result.verdict).toBe('invalid');
    expect(result.reasons.some((reason) => reason.includes('must alternate'))).toBeTrue();
    expect(Number.isNaN(result.difference)).toBeTrue();
  });

  it('is invalid with fewer than two rounds per arm', () => {
    const result = compareAblation([round('A', 1), round('B', 2)]);
    expect(result.verdict).toBe('invalid');
    expect(result.reasons.length).toBe(2);
    expect(result.reasons[0]).toContain('Arm A has 1 round');
    expect(compareAblation([]).verdict).toBe('invalid');
    expect(compareAblation([round('A', 1), round('B', 2), round('A', 1)]).reasons.join()).toContain('Arm B has 1 round');
  });

  it('is invalid when a round has no samples or non-finite samples', () => {
    const empty = compareAblation([round('A', 1), round('B', 2), { arm: 'A', samples: [] }, round('B', 2)]);
    expect(empty.verdict).toBe('invalid');
    expect(empty.reasons.some((reason) => reason.includes('Round 3') && reason.includes('no finite samples'))).toBeTrue();

    const bad = compareAblation([round('A', 1), round('B', 2), { arm: 'A', samples: [1, Number.NaN, 1] }, round('B', 2)]);
    expect(bad.verdict).toBe('invalid');
    expect(bad.reasons.some((reason) => reason.includes('non-finite'))).toBeTrue();
  });

  it('is invalid for an unusable maxSpread', () => {
    const rounds = abab([1, 1], [2, 2]);
    expect(compareAblation(rounds, { maxSpread: -1 }).verdict).toBe('invalid');
    expect(compareAblation(rounds, { maxSpread: Number.NaN }).verdict).toBe('invalid');
  });

  it('compares the slow tail with the p95 option', () => {
    // Same medians; B only differs in its slowest frame.
    const rounds: AblationRound[] = [];
    for (let i = 0; i < 4; i++) {
      rounds.push({ arm: 'A', samples: [1, 1, 1, 1, 1.1] }, { arm: 'B', samples: [1, 1, 1, 1, 2] });
    }
    const byMedian = compareAblation(rounds);
    expect(byMedian.statistic).toBe('median');
    expect(byMedian.verdict).toBe('no-difference');
    const byTail = compareAblation(rounds, { statistic: 'p95' });
    expect(byTail.statistic).toBe('p95');
    expect(byTail.a.rounds).toEqual([1.1, 1.1, 1.1, 1.1]);
    expect(byTail.b.rounds).toEqual([2, 2, 2, 2]);
    expect(byTail.verdict).toBe('slower');
    expect(byTail.relative).toBeCloseTo(0.9 / 1.1, 6);
  });

  it('accepts rounds that start with B as long as they alternate', () => {
    const result = compareAblation([round('B', 0.13), round('A', 0.10), round('B', 0.131), round('A', 0.101)]);
    expect(result.verdict).toBe('slower');
  });

  it('handles an all-zero baseline without dividing by zero', () => {
    const result = compareAblation([round('A', 0), round('B', 0), round('A', 0), round('B', 0)]);
    expect(result.a.spread).toBe(0);
    expect(Number.isNaN(result.relative)).toBeTrue();
    expect(result.verdict).toBe('no-difference');
  });
});
