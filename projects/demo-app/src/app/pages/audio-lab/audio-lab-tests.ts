import type { TestScenario, TestSuite } from 'triangular-engine/testing';

export interface AudioLabTestSettings {
  readonly farPosition: readonly [number, number, number];
  readonly nearPosition: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly durationMs: number;
}

export const AUDIO_LAB_TESTS: readonly TestSuite<AudioLabTestSettings>[] = [{
  id: 'audio-lab-proximity',
  version: 1,
  title: 'Positional audio · move closer and farther',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [{
    id: 'camera-proximity-sweep',
    label: 'Approach the beacon, listen, and move away',
    durationMs: 7000,
    warmupMs: 250,
    settings: {
      farPosition: [0, 5, 12],
      nearPosition: [0, 3.5, 2.8],
      target: [0, 1, 0],
      durationMs: 7000,
    },
  } satisfies TestScenario<AudioLabTestSettings>],
}];
