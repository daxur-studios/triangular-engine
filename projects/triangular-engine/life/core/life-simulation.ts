import {
  addLifeVector3,
  clampLifeVector3Length,
  lifeVector3,
  scaleLifeVector3,
  type LifeVector3,
} from './life-vector';
import { createLifeAgent, type LifeAgentState, type LifeInfluence, type LifeObstacle } from './life-agent';
import type { LifeBehavior, LifeBehaviorContext } from './life-behaviors';

export interface LifeSimulationOptions {
  readonly seed?: number;
  readonly neighborRadius?: number;
  readonly fixedStepSeconds?: number;
}

export class LifeSimulation {
  readonly agents: LifeAgentState[] = [];
  readonly behaviors: LifeBehavior[] = [];
  readonly obstacles: LifeObstacle[] = [];
  readonly influences: LifeInfluence[] = [];
  readonly fixedStepSeconds: number;
  timeSeconds = 0;
  private readonly neighborRadius: number;
  private readonly acceleration = lifeVector3();

  constructor(options: LifeSimulationOptions = {}) {
    this.fixedStepSeconds = options.fixedStepSeconds ?? 1 / 60;
    this.neighborRadius = options.neighborRadius ?? 12;
  }

  addAgent(options: Parameters<typeof createLifeAgent>[0]): LifeAgentState {
    const agent = createLifeAgent(options);
    this.agents.push(agent);
    return agent;
  }

  step(deltaSeconds: number): void {
    let remaining = Math.min(deltaSeconds, 0.25);
    while (remaining > 1e-8) {
      const step = Math.min(remaining, this.fixedStepSeconds);
      this.stepFixed(step);
      remaining -= step;
    }
  }

  private stepFixed(deltaSeconds: number): void {
    this.timeSeconds += deltaSeconds;
    for (const agent of this.agents) {
      this.acceleration.x = 0;
      this.acceleration.y = 0;
      this.acceleration.z = 0;
      const context: LifeBehaviorContext = {
        agent,
        neighbors: this.neighborsOf(agent),
        obstacles: this.obstacles,
        influences: this.influences,
        timeSeconds: this.timeSeconds,
      };
      for (const behavior of this.behaviors) behavior(context, this.acceleration);
      clampLifeVector3Length(this.acceleration, agent.maxAcceleration);
      addLifeVector3(agent.velocity, scaleLifeVector3(this.acceleration, deltaSeconds));
      clampLifeVector3Length(agent.velocity, agent.maxSpeed);
      addLifeVector3(agent.position, scaleLifeVector3({ ...agent.velocity }, deltaSeconds));
    }
  }

  private neighborsOf(agent: LifeAgentState): LifeAgentState[] {
    const result: LifeAgentState[] = [];
    const radiusSquared = this.neighborRadius * this.neighborRadius;
    for (const other of this.agents) {
      if (other.id === agent.id) continue;
      const dx = other.position.x - agent.position.x;
      const dy = other.position.y - agent.position.y;
      const dz = other.position.z - agent.position.z;
      if (dx * dx + dy * dy + dz * dz <= radiusSquared) result.push(other);
    }
    return result;
  }
}
