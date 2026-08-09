import { applyLifeGroupObstacleAvoidance, applyLifeGroupSeparation, sampleLifeGroupAtTime } from './life-group';

describe('sampleLifeGroupAtTime', () => {
  const definition = {
    seed: 42,
    count: 4,
    route: {
      segments: [{ from: { x: 0, y: 2, z: 0 }, to: { x: 20, y: 4, z: 0 }, durationSeconds: 20 }],
    },
  };

  it('reconstructs identical members after arbitrary time access', () => {
    const first = sampleLifeGroupAtTime(definition, 7);
    sampleLifeGroupAtTime(definition, 1000);
    expect(sampleLifeGroupAtTime(definition, 7)).toEqual(first);
  });

  it('keeps members around the moving anchor and preserves heading', () => {
    const sample = sampleLifeGroupAtTime({ ...definition, spread: 5 }, 10);
    expect(sample.members).toHaveSize(4);
    for (const member of sample.members) {
      expect(member.position.x).toBeGreaterThan(sample.anchor.position.x - 8);
      expect(member.position.x).toBeLessThan(sample.anchor.position.x + 8);
      expect(member.heading).toEqual(sample.anchor.heading);
    }
  });

  it('layers a temporary disturbance over the baseline and recovers afterward', () => {
    const baseline = sampleLifeGroupAtTime(definition, 20);
    const disturbed = sampleLifeGroupAtTime({
      ...definition,
      disturbances: [{
        center: { x: 10, y: 2, z: 0 },
        startTimeSeconds: 0,
        durationSeconds: 10,
        radius: 20,
        strength: 4,
      }],
    }, 5);
    expect(disturbed.members.some((member) => member.disturbed01 > 0)).toBe(true);
    expect(sampleLifeGroupAtTime({ ...definition, disturbances: [{
      center: { x: 10, y: 2, z: 0 }, startTimeSeconds: 0, durationSeconds: 10, radius: 20, strength: 4,
    }] }, 20)).toEqual(baseline);
  });

  it('can spread members along a route with stable per-member lag', () => {
    const sample = sampleLifeGroupAtTime({ ...definition, routeLagSeconds: 2 }, 10);
    expect(sample.members[0].position.x).not.toBe(sample.members[6 % sample.members.length].position.x);
    expect(sampleLifeGroupAtTime({ ...definition, routeLagSeconds: 2 }, 10))
      .toEqual(sample);
  });

  it('applies local obstacle avoidance as a pure materialization pass', () => {
    const baseline = sampleLifeGroupAtTime({ ...definition, spread: 0 }, 10);
    const avoided = applyLifeGroupObstacleAvoidance(baseline, [{
      position: baseline.members[0].position,
      radius: 2,
    }]);
    expect(avoided.members[0].position).not.toEqual(baseline.members[0].position);
    expect(applyLifeGroupObstacleAvoidance(baseline, [{
      position: baseline.members[0].position,
      radius: 2,
    }])).toEqual(avoided);
  });

  it('applies local separation without changing the route anchor', () => {
    const baseline = sampleLifeGroupAtTime({ ...definition, spread: 0 }, 10);
    const separated = applyLifeGroupSeparation(baseline, 4, 1);
    expect(separated.anchor).toEqual(baseline.anchor);
    expect(separated.members[0].position).not.toEqual(baseline.members[0].position);
    expect(applyLifeGroupSeparation(baseline, 4, 1)).toEqual(separated);
  });

  it('attaches deterministic lifecycle samples when requested', () => {
    const sample = sampleLifeGroupAtTime({
      ...definition,
      lifecycle: { birthTimeSeconds: 0, birthSpreadSeconds: 4, juvenileDurationSeconds: 5, lifespanSeconds: 20 },
    }, 3);
    expect(sample.members.every((member) => member.lifecycle !== undefined)).toBe(true);
    expect(sample.members.some((member) => member.lifecycle?.phase === 'juvenile')).toBe(true);
    expect(sampleLifeGroupAtTime({
      ...definition,
      lifecycle: { birthTimeSeconds: 0, birthSpreadSeconds: 4, juvenileDurationSeconds: 5, lifespanSeconds: 20 },
    }, 3)).toEqual(sample);
  });
});
