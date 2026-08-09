import { LifeSimulation } from './life-simulation';
import { alignment, cohesion, followLifeRoute, keepWithinBounds, separation } from './life-behaviors';

describe('LifeSimulation', () => {
  it('keeps agents within their speed limit while stepping', () => {
    const simulation = new LifeSimulation({ fixedStepSeconds: 1 / 60 });
    simulation.behaviors.push(cohesion(20), alignment(20), separation(20));
    simulation.addAgent({
      id: 1,
      position: { x: 0, y: 5, z: 0 },
      velocity: { x: 20, y: 0, z: 0 },
      maxSpeed: 4,
    });
    simulation.addAgent({
      id: 2,
      position: { x: 1, y: 5, z: 0 },
      maxSpeed: 4,
    });

    simulation.step(1 / 30);

    for (const agent of simulation.agents) {
      expect(Math.hypot(agent.velocity.x, agent.velocity.y, agent.velocity.z)).toBeLessThanOrEqual(4 + 1e-8);
    }
  });

  it('is repeatable for the same initial state', () => {
    const create = () => {
      const simulation = new LifeSimulation();
      simulation.behaviors.push(separation(), alignment(), cohesion());
      simulation.addAgent({ id: 1, position: { x: 0, y: 5, z: 0 }, velocity: { x: 1, y: 0, z: 0 } });
      simulation.addAgent({ id: 2, position: { x: 2, y: 5, z: 1 }, velocity: { x: 0, y: 0, z: 1 } });
      return simulation;
    };
    const first = create();
    const second = create();
    first.step(0.5);
    second.step(0.5);

    expect(second.agents).toEqual(first.agents);
  });

  it('steers agents back into a bounded habitat', () => {
    const simulation = new LifeSimulation();
    simulation.behaviors.push(keepWithinBounds({ x: -10, y: 0, z: -10 }, { x: 10, y: 20, z: 10 }, 10));
    const agent = simulation.addAgent({
      id: 1,
      position: { x: 11, y: 21, z: 0 },
      maxAcceleration: 100,
      maxSpeed: 100,
    });

    simulation.step(1 / 60);

    expect(agent.velocity.x).toBeLessThan(0);
    expect(agent.velocity.y).toBeLessThan(0);
  });

  it('rejects a proposed step into a disallowed habitat', () => {
    const simulation = new LifeSimulation({
      fixedStepSeconds: 1,
      habitatQuery: {
        sampleHabitat: ({ x }) => ({ kind: x > 0 ? 'water' : 'land', surfaceY: 0, suitability01: 1 }),
      },
      allowedHabitatKinds: ['land'],
    });
    simulation.addAgent({ id: 1, position: { x: -1, y: 0, z: 0 }, velocity: { x: 4, y: 0, z: 0 }, maxSpeed: 10 });
    simulation.step(1);
    expect(simulation.agents[0].position.x).toBe(-1);
  });

  it('steers a nearby agent toward a deterministic route state', () => {
    const simulation = new LifeSimulation({ fixedStepSeconds: 1 / 60 });
    simulation.behaviors.push(followLifeRoute({
      segments: [{ from: { x: 0, y: 0, z: 0 }, to: { x: 20, y: 0, z: 0 }, durationSeconds: 20 }],
    }, 10));
    const agent = simulation.addAgent({ id: 1, position: { x: -5, y: 0, z: 0 }, maxSpeed: 4, maxAcceleration: 20 });
    simulation.step(1);
    expect(agent.position.x).toBeGreaterThan(-5);
  });
});
