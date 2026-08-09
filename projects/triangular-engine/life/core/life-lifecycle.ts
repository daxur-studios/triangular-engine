export type LifeLifecyclePhase = 'not-born' | 'juvenile' | 'adult' | 'dead';

export interface LifeLifecycleDefinition {
  readonly birthTimeSeconds: number;
  readonly juvenileDurationSeconds: number;
  readonly lifespanSeconds: number;
}

export interface LifeLifecycleSample {
  readonly phase: LifeLifecyclePhase;
  readonly alive: boolean;
  readonly ageSeconds: number;
  /** 0 before birth, rising through juvenile, 1 at adulthood/death. */
  readonly growth01: number;
}

export interface LifeCohortDefinition extends LifeLifecycleDefinition {
  readonly count: number;
  readonly seed: number;
  /** Deterministic birth-time spread across the cohort. */
  readonly birthSpreadSeconds?: number;
}

export interface LifeCohortSample {
  readonly total: number;
  readonly notBorn: number;
  readonly juvenile: number;
  readonly adult: number;
  readonly dead: number;
}

export function sampleLifeLifecycleAtTime(
  definition: LifeLifecycleDefinition,
  universalTimeSeconds: number,
): LifeLifecycleSample {
  const juvenileDuration = Math.max(0, definition.juvenileDurationSeconds);
  const lifespan = Math.max(juvenileDuration, definition.lifespanSeconds);
  const ageSeconds = universalTimeSeconds - definition.birthTimeSeconds;
  if (ageSeconds < 0) return { phase: 'not-born', alive: false, ageSeconds, growth01: 0 };
  if (ageSeconds >= lifespan) return { phase: 'dead', alive: false, ageSeconds, growth01: 1 };
  if (ageSeconds < juvenileDuration) {
    return {
      phase: 'juvenile',
      alive: true,
      ageSeconds,
      growth01: juvenileDuration > 0 ? Math.max(0, Math.min(1, ageSeconds / juvenileDuration)) : 1,
    };
  }
  return { phase: 'adult', alive: true, ageSeconds, growth01: 1 };
}

export function sampleLifeCohortAtTime(
  definition: LifeCohortDefinition,
  universalTimeSeconds: number,
): LifeCohortSample {
  const total = Math.max(0, Math.floor(definition.count));
  const spread = Math.max(0, definition.birthSpreadSeconds ?? 0);
  const counts = { notBorn: 0, juvenile: 0, adult: 0, dead: 0 };
  for (let index = 0; index < total; index++) {
    const birthOffset = spread * stableUnit(definition.seed, index);
    const sample = sampleLifeLifecycleAtTime({
      birthTimeSeconds: definition.birthTimeSeconds + birthOffset,
      juvenileDurationSeconds: definition.juvenileDurationSeconds,
      lifespanSeconds: definition.lifespanSeconds,
    }, universalTimeSeconds);
    if (sample.phase === 'not-born') counts.notBorn++;
    else if (sample.phase === 'juvenile') counts.juvenile++;
    else if (sample.phase === 'adult') counts.adult++;
    else counts.dead++;
  }
  return { total, ...counts };
}

function stableUnit(seed: number, index: number): number {
  const value = Math.sin((seed + 1) * 12.9898 + (index + 1) * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
