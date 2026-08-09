import { AnimalTime } from './animal-types';

export interface FixedStepResult {
  steps: number;
  alpha: number;
  time: AnimalTime;
  skippedSeconds: number;
}

export class FixedStepClock {
  private accumulator = 0;
  private currentTime = 0;

  constructor(public readonly stepSeconds = 1 / 20, public readonly maxStepsPerAdvance = 120) {}

  advance(deltaSeconds: number, speed = 1): FixedStepResult {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0) * Math.max(0, speed);
    this.accumulator += delta;
    const steps = Math.min(Math.floor(this.accumulator / this.stepSeconds), this.maxStepsPerAdvance);
    const availableSteps = Math.floor(this.accumulator / this.stepSeconds);
    const skippedSeconds = Math.max(0, availableSteps - steps) * this.stepSeconds;
    this.accumulator -= (steps + Math.max(0, availableSteps - steps)) * this.stepSeconds;
    this.currentTime += steps * this.stepSeconds;
    return { steps, alpha: this.accumulator / this.stepSeconds, time: this.currentTime, skippedSeconds };
  }

  reset(time: AnimalTime = 0): void {
    this.accumulator = 0;
    this.currentTime = time;
  }
}
