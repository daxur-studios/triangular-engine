/** The page-owned game model. All movement/production uses fixed simulation steps. */
export type CatSource = 'catnip' | 'food' | 'nursery';
export type BoopScenario = 'garden' | 'feast' | 'kittens';
export type CatPlace = 'waiting' | 'carried' | 'stacked';
export interface BoopCat {
  id: number;
  source: CatSource;
  place: CatPlace;
}
export interface BoopState {
  scenario: BoopScenario;
  time: number;
  paused: boolean;
  auto: boolean;
  won: boolean;
  treats: number;
  shoes: number;
  basket: number;
  food: number;
  nursery: boolean;
  clocks: Record<CatSource, number>;
  cats: BoopCat[];
  nextId: number;
  collector: {
    x: number;
    z: number;
    phase: 'idle' | 'outbound' | 'loading' | 'returning' | 'unloading';
    source: CatSource;
    hold: number;
  };
  message: string;
}
export const MOON_GOAL = 18;
export const CAT_LIMIT = 30;
export const STEP_SECONDS = 0.05;
export const SOURCE_POSITION: Record<CatSource, readonly [number, number]> = {
  catnip: [-4, 0],
  food: [4, 0],
  nursery: [0, -4],
};
export const SOURCE_PERIOD: Record<CatSource, number> = {
  catnip: 7,
  food: 3,
  nursery: 24,
};
export const SCENARIOS: readonly {
  id: BoopScenario;
  label: string;
  description: string;
}[] = [
  {
    id: 'garden',
    label: 'Catnip garden',
    description: 'Three curious cats and treats for your first upgrade.',
  },
  {
    id: 'feast',
    label: 'Dinner rush',
    description: 'A full bowl brings quick arrivals. Keep it topped up.',
  },
  {
    id: 'kittens',
    label: 'Kitten surprise',
    description: 'The nursery is ready in 12 seconds. Prepare for six!',
  },
];

/** Immutable snapshots are also used by the test adapter to restore interrupted rounds. */
export class MoonBoopGame {
  state: BoopState;
  private remainder = 0;
  constructor(scenario: BoopScenario = 'garden') {
    this.state = this.initial(scenario);
  }
  private initial(scenario: BoopScenario): BoopState {
    return {
      scenario,
      time: 0,
      paused: false,
      auto: false,
      won: false,
      treats: scenario === 'garden' ? 12 : 8,
      shoes: 0,
      basket: 0,
      food: scenario === 'feast' ? 8 : 0,
      nursery: scenario === 'kittens',
      clocks: { catnip: 0, food: 0, nursery: scenario === 'kittens' ? 12 : 0 },
      cats: Array.from({ length: 3 }, (_, i) => ({
        id: i + 1,
        source: scenario === 'feast' ? 'food' : 'catnip',
        place: 'waiting',
      })),
      nextId: 4,
      collector: { x: 0, z: 2.4, phase: 'idle', source: 'catnip', hold: 0 },
      message: 'A small step for a cat. An unreasonable leap for catkind.',
    };
  }
  snapshot(): { state: BoopState; remainder: number } {
    return structuredClone({ state: this.state, remainder: this.remainder });
  }
  restore(snapshot: ReturnType<MoonBoopGame['snapshot']>): void {
    this.state = structuredClone(snapshot.state);
    this.remainder = snapshot.remainder;
  }
  reset(scenario: BoopScenario = this.state.scenario): void {
    this.state = this.initial(scenario);
    this.remainder = 0;
  }
  get stacked(): number {
    return this.state.cats.filter((c) => c.place === 'stacked').length;
  }
  get waiting(): number {
    return this.state.cats.filter((c) => c.place === 'waiting').length;
  }
  get capacity(): number {
    return 1 + this.state.basket;
  }
  get speed(): number {
    return 1.6 + this.state.shoes * 0.9;
  }
  cost(upgrade: 'shoes' | 'basket' | 'food' | 'nursery'): number {
    return upgrade === 'shoes'
      ? 10 + this.state.shoes * 8
      : upgrade === 'basket'
        ? 14 + this.state.basket * 10
        : upgrade === 'food'
          ? 8
          : 24;
  }
  buy(upgrade: 'shoes' | 'basket' | 'food' | 'nursery'): boolean {
    const s = this.state;
    if (
      s.paused ||
      s.won ||
      s.treats < this.cost(upgrade) ||
      (upgrade === 'shoes' && s.shoes >= 3) ||
      (upgrade === 'basket' && s.basket >= 2) ||
      (upgrade === 'nursery' && s.nursery) ||
      (upgrade === 'food' && s.food > 8)
    )
      return false;
    s.treats -= this.cost(upgrade);
    if (upgrade === 'shoes') s.shoes++;
    if (upgrade === 'basket') s.basket++;
    if (upgrade === 'food') s.food += 6;
    if (upgrade === 'nursery') s.nursery = true;
    s.message = {
      shoes: 'Zoomies shoes fitted. Still exactly one human.',
      basket: 'A bigger cat basket. Occupational hazard: purring.',
      food: 'Dinner is served. Six portions of irresistible nonsense.',
      nursery: 'Kitten nursery open. Six tiny astronauts every 24 seconds.',
    }[upgrade];
    return true;
  }
  toggleAuto(): void {
    if (!this.state.won && !this.state.paused)
      this.state.auto = !this.state.auto;
  }
  /** Manual clicks and scene picking use the same accounting path. */
  stackCat(id?: number): boolean {
    if (this.state.paused || this.state.won) return false;
    const cat = this.state.cats.find(
      (c) => c.place === 'waiting' && (id === undefined || c.id === id),
    );
    if (!cat) return false;
    this.deposit(cat);
    return true;
  }
  private deposit(cat: BoopCat): void {
    cat.place = 'stacked';
    this.state.treats += 4;
    this.state.message = `${this.stacked} / ${MOON_GOAL} cats. The Moon looks increasingly concerned.`;
    if (this.stacked >= MOON_GOAL) {
      this.state.won = true;
      this.state.auto = false;
      this.state.message =
        'MOON BOOPED! The space agency has several questions.';
    }
  }
  advance(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1200)
      throw new Error('Advance must be finite and between 0 and 1200 seconds');
    if (this.state.paused || this.state.won) return;
    this.remainder += seconds;
    while (this.remainder + 1e-9 >= STEP_SECONDS && !this.state.won) {
      this.remainder -= STEP_SECONDS;
      this.step(STEP_SECONDS);
    }
  }
  private step(dt: number): void {
    const s = this.state;
    s.time += dt;
    for (const source of ['catnip', 'food', 'nursery'] as const) {
      if (
        (source === 'food' && s.food <= 0) ||
        (source === 'nursery' && !s.nursery)
      )
        continue;
      s.clocks[source] += dt;
      if (s.clocks[source] + 1e-9 < SOURCE_PERIOD[source]) continue;
      // Full waiting areas stop production; the nursery retains its whole batch.
      const batch = source === 'nursery' ? 6 : 1;
      if (s.cats.length + batch > CAT_LIMIT) {
        s.clocks[source] = SOURCE_PERIOD[source];
        continue;
      }
      s.clocks[source] -= SOURCE_PERIOD[source];
      if (source === 'food') s.food--;
      for (let i = 0; i < batch; i++)
        s.cats.push({ id: s.nextId++, source, place: 'waiting' });
      if (source === 'nursery')
        s.message = 'SIX KITTENS. Nobody checked the launch manifest.';
    }
    const c = s.collector;
    // Switching automation off parks safely after delivering anything already carried.
    if (c.phase === 'idle') {
      if (!s.auto || !this.waiting) return;
      const sources = (Object.keys(SOURCE_POSITION) as CatSource[]).filter(
        (source) =>
          s.cats.some(
            (cat) => cat.source === source && cat.place === 'waiting',
          ),
      );
      sources.sort(
        (a, b) =>
          this.distance(SOURCE_POSITION[a]) - this.distance(SOURCE_POSITION[b]),
      );
      c.source = sources[0];
      c.phase = 'outbound';
    }
    if (c.phase === 'outbound' || c.phase === 'returning') {
      const target =
        c.phase === 'outbound' ? SOURCE_POSITION[c.source] : [0, 2.4];
      const dx = target[0] - c.x,
        dz = target[1] - c.z,
        distance = Math.hypot(dx, dz),
        move = this.speed * dt;
      if (distance > move) {
        c.x += (dx / distance) * move;
        c.z += (dz / distance) * move;
        return;
      }
      c.x = target[0];
      c.z = target[1];
      c.hold = 0;
      c.phase = c.phase === 'outbound' ? 'loading' : 'unloading';
    }
    c.hold += dt;
    if (c.phase === 'loading' && c.hold >= 0.6) {
      s.cats
        .filter((cat) => cat.source === c.source && cat.place === 'waiting')
        .slice(0, this.capacity)
        .forEach((cat) => (cat.place = 'carried'));
      c.phase = 'returning';
      c.hold = 0;
    } else if (c.phase === 'unloading' && c.hold >= 0.5) {
      for (const cat of s.cats.filter((cat) => cat.place === 'carried')) {
        if (!s.won) this.deposit(cat);
      }
      c.phase = 'idle';
      c.hold = 0;
    }
  }
  private distance(target: readonly number[]): number {
    return Math.hypot(
      target[0] - this.state.collector.x,
      target[1] - this.state.collector.z,
    );
  }
}
