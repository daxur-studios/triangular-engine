/** Absolute seconds since game epoch. Neither the map nor orbital records store "time until". */
export type UniversalTime = number;

export const GAME_EPOCH_UT_S: UniversalTime = 0;

/**
 * Advances exactly once per fixed physics substep — never per render frame —
 * so `ut` stays deterministic under any frame rate or debug speedup
 * (map-view-mvp.md §3). Deliberately not wall-clock-driven.
 */
export class UniversalClock {
  #utS: UniversalTime;

  constructor(initialUtS: UniversalTime = GAME_EPOCH_UT_S) {
    this.#utS = initialUtS;
  }

  get nowUt(): UniversalTime {
    return this.#utS;
  }

  advance(fixedStepS: number): UniversalTime {
    this.#utS += fixedStepS;
    return this.#utS;
  }
}
