# Life

`triangular-engine/life` provides framework-free simulation primitives for
autonomous actors: fixed-step movement, flocking behaviours, local influences,
and world-obstacle queries.

The core intentionally does not own hunger, combat, reproduction, animation,
physics, or long-term decision-making. Games can provide those systems and
feed movement intents into the same agent simulation.

```ts
import {
  LifeSimulation,
  alignment,
  cohesion,
  fleeInfluences,
  separation,
} from 'triangular-engine/life';

const flock = new LifeSimulation();
flock.behaviors.push(separation(), alignment(), cohesion(), fleeInfluences());
flock.addAgent({ id: 1, position: { x: 0, y: 8, z: 0 } });
flock.step(deltaSeconds);
```

See the demo app's `/life-lab` route for the first bird-and-canopy vertical
slice and `docs/runbook/009_life_sublibrary.md` for the implementation plan.
