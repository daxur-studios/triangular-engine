import { LifeSimulation } from './life-simulation';
import { alignment, cohesion, separation } from './life-behaviors';

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
});
