import { AnimalTime } from './animal-types';

export interface FixedStepResult {
  steps: number;
  alpha: number;
  time: AnimalTime;
}

export class FixedStepClock {
  private accumulator = 0;
  private currentTime = 0;

  constructor(public readonly stepSeconds = 1 / 20, public readonly maxStepsPerAdvance = 120) {}

  advance(deltaSeconds: number, speed = 1): FixedStepResult {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0) * Math.max(0, speed);
    this.accumulator += delta;
    const steps = Math.min(Math.floor(this.accumulator / this.stepSeconds), this.maxStepsPerAdvance);
    this.accumulator -= steps * this.stepSeconds;
    this.currentTime += steps * this.stepSeconds;
    return { steps, alpha: this.accumulator / this.stepSeconds, time: this.currentTime };
  }

  reset(time: AnimalTime = 0): void {
    this.accumulator = 0;
    this.currentTime = time;
  }
}
