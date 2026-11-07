/** The page-owned game model. All movement/production uses fixed simulation steps. */
export type CatSource = 'catnip' | 'food' | 'nursery';
export type BoopScenario =
  | 'garden'
  | 'feast'
  | 'kittens'
  | 'petting'
  | 'departure'
  | 'treats';
export type CatPlace = 'waiting' | 'carried' | 'stacked' | 'departing';
export type BoopUpgrade = 'shoes' | 'basket' | 'food' | 'nursery' | 'gun';
export interface BoopCat {
  id: number;
  source: CatSource;
  place: CatPlace;
  caredAt: number;
  careBy: 'arrival' | 'human' | 'treat';
  careCount: number;
  departure?: { at: number; level: number };
}
export interface TreatShot {
  id: number;
  gun: number;
  catId: number;
  firedAt: number;
  arrivesAt: number;
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
  humanCare: boolean;
  requestedCat: number | null;
  careStreak: number;
  guns: number;
  nextFire: number[];
  shots: TreatShot[];
  nextShotId: number;
  pets: number;
  treatHits: number;
  departures: number;
  clocks: Record<CatSource, number>;
  cats: BoopCat[];
  nextId: number;
  collector: {
    x: number;
    z: number;
    y: number;
    phase:
      | 'idle'
      | 'outbound'
      | 'loading'
      | 'returning'
      | 'unloading'
      | 'approaching'
      | 'ascending'
      | 'petting'
      | 'descending';
    source: CatSource;
    hold: number;
    catId: number | null;
  };
  message: string;
}
export const MOON_GOAL = 18;
export const CAT_LIMIT = 30;
export const STEP_SECONDS = 0.05;
export const CARE_AFTER = 24;
export const LEAVE_AFTER = 42;
export const DEPARTURE_SECONDS = 3;
export const GUN_PERIOD = 2.5;
export const TREAT_FLIGHT = 0.8;
export const TOWER_STEP = 0.53;
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
  {
    id: 'petting',
    label: 'Petting practice',
    description: 'Six cats, one needs care. Send the human up the cat lift.',
  },
  {
    id: 'departure',
    label: 'Safe departure',
    description: 'A middle cat leaves in four seconds. Human care starts off.',
  },
  {
    id: 'treats',
    label: 'Treat-gun trial',
    description:
      'Eight needy cats, budget for two guns. Human care starts off.',
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
    const fixture = ['petting', 'departure', 'treats'].includes(scenario);
    const s: BoopState = {
      scenario,
      time: 0,
      paused: false,
      auto: false,
      won: false,
      treats: fixture ? 52 : scenario === 'garden' ? 12 : 8,
      shoes: 0,
      basket: 0,
      food: scenario === 'feast' ? 8 : 0,
      nursery: scenario === 'kittens',
      humanCare: !fixture,
      requestedCat: null,
      careStreak: 0,
      guns: 0,
      nextFire: [],
      shots: [],
      nextShotId: 1,
      pets: 0,
      treatHits: 0,
      departures: 0,
      clocks: { catnip: 0, food: 0, nursery: scenario === 'kittens' ? 12 : 0 },
      cats: Array.from({ length: 3 }, (_, i) => ({
        id: i + 1,
        source: scenario === 'feast' ? 'food' : 'catnip',
        place: 'waiting',
        caredAt: 0,
        careBy: 'arrival',
        careCount: 0,
      })),
      nextId: 4,
      collector: {
        x: 0,
        y: 0,
        z: 2.4,
        phase: 'idle',
        source: 'catnip',
        hold: 0,
        catId: null,
      },
      message: 'A small step for a cat. An unreasonable leap for catkind.',
    };
    if (fixture) {
      s.collector.x = 0.85;
      const count = scenario === 'treats' ? 8 : 6;
      s.cats = Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        source: 'catnip',
        place: 'stacked',
        caredAt:
          scenario === 'treats'
            ? -CARE_AFTER
            : i === 3
              ? -(scenario === 'departure' ? LEAVE_AFTER - 4 : CARE_AFTER + 2)
              : 0,
        careBy: 'arrival',
        careCount: 0,
      }));
      s.nextId = count + 1;
      s.message =
        scenario === 'departure'
          ? 'Cat 4 has booked a sofa break. No cats are harmed.'
          : scenario === 'treats'
            ? 'Eight snack requests. Buy one treat gun, then its twin.'
            : 'Cat 4 requests a head pat. The cat lift is ready.';
    }
    return s;
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
  cost(upgrade: BoopUpgrade): number {
    return upgrade === 'gun'
      ? this.state.guns === 0
        ? 20
        : 32
      : upgrade === 'shoes'
        ? 10 + this.state.shoes * 8
        : upgrade === 'basket'
          ? 14 + this.state.basket * 10
          : upgrade === 'food'
            ? 8
            : 24;
  }
  buy(upgrade: BoopUpgrade): boolean {
    const s = this.state;
    if (
      s.paused ||
      s.won ||
      s.treats < this.cost(upgrade) ||
      (upgrade === 'shoes' && s.shoes >= 3) ||
      (upgrade === 'basket' && s.basket >= 2) ||
      (upgrade === 'gun' && s.guns >= 2) ||
      (upgrade === 'nursery' && s.nursery) ||
      (upgrade === 'food' && s.food > 8)
    )
      return false;
    s.treats -= this.cost(upgrade);
    if (upgrade === 'shoes') s.shoes++;
    if (upgrade === 'basket') s.basket++;
    if (upgrade === 'food') s.food += 6;
    if (upgrade === 'nursery') s.nursery = true;
    if (upgrade === 'gun') {
      s.guns++;
      s.nextFire.push(s.time);
    }
    s.message = {
      shoes: 'Zoomies shoes fitted. Still exactly one human.',
      basket: 'A bigger cat basket. Occupational hazard: purring.',
      food: 'Dinner is served. Six portions of irresistible nonsense.',
      nursery: 'Kitten nursery open. Six tiny astronauts every 24 seconds.',
      gun:
        s.guns === 1
          ? 'Snack cannon online. Precision delivery of affection.'
          : 'Twin snack cannons. The purr pressure is under control.',
    }[upgrade];
    return true;
  }
  toggleAuto(): boolean {
    if (this.state.won || this.state.paused) return false;
    this.state.auto = !this.state.auto;
    return true;
  }
  toggleCare(): boolean {
    if (this.state.won || this.state.paused) return false;
    this.state.humanCare = !this.state.humanCare;
    return true;
  }
  needsCare(cat: BoopCat): boolean {
    return (
      cat.place === 'stacked' &&
      this.state.time - cat.caredAt + 1e-9 >= CARE_AFTER
    );
  }
  careRemaining(cat: BoopCat): number {
    return Math.max(0, LEAVE_AFTER - (this.state.time - cat.caredAt));
  }
  /** One pending request; an active trip always finishes before this request starts. */
  petCat(id?: number): boolean {
    const s = this.state;
    if (s.paused || s.won || s.requestedCat !== null) return false;
    const cat =
      id === undefined
        ? this.needyCats().find((c) => c.id !== s.collector.catId)
        : s.cats.find((c) => c.id === id && this.needsCare(c));
    if (!cat || cat.id === s.collector.catId) return false;
    s.requestedCat = cat.id;
    s.message = `Head pat booked for Cat ${cat.id}. One human, one trip at a time.`;
    return true;
  }
  private needyCats(): BoopCat[] {
    return this.state.cats
      .filter((c) => this.needsCare(c))
      .sort((a, b) => a.caredAt - b.caredAt || a.id - b.id);
  }
  private refresh(cat: BoopCat, by: 'human' | 'treat'): void {
    if (cat.place !== 'stacked') return;
    cat.caredAt = this.state.time;
    cat.careBy = by;
    cat.careCount++;
    if (by === 'human') this.state.pets++;
    else this.state.treatHits++;
    this.state.message = `Cat ${cat.id}: ${by === 'human' ? 'head pats received' : 'snack caught'}. Purrmission to continue!`;
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
    cat.caredAt = this.state.time;
    cat.careBy = 'arrival';
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
    // Deadlines win ties: a late shot cannot revive a cat already leaving.
    let level = 0;
    for (const cat of s.cats) {
      if (cat.place !== 'stacked') continue;
      const originalLevel = level++;
      if (this.careRemaining(cat) > 1e-9) continue;
      cat.place = 'departing';
      cat.departure = { at: s.time, level: originalLevel };
      s.departures++;
      if (s.requestedCat === cat.id) s.requestedCat = null;
      s.message = `Cat ${cat.id} is off for a sofa break. Gentle exit, tower settling.`;
    }
    s.cats = s.cats.filter(
      (c) =>
        c.place !== 'departing' ||
        s.time - c.departure!.at + 1e-9 < DEPARTURE_SECONDS,
    );
    for (const shot of s.shots) {
      if (shot.arrivesAt > s.time + 1e-9) continue;
      const cat = s.cats.find((c) => c.id === shot.catId);
      if (cat && this.needsCare(cat)) this.refresh(cat, 'treat');
    }
    s.shots = s.shots.filter(
      (shot) =>
        shot.arrivesAt > s.time + 1e-9 &&
        s.cats.some((c) => c.id === shot.catId && c.place === 'stacked'),
    );
    for (let gun = 0; gun < s.guns; gun++) {
      if (s.time + 1e-9 < s.nextFire[gun]) continue;
      const cat = this.needyCats().find(
        (c) =>
          c.id !== s.collector.catId &&
          !s.shots.some((shot) => shot.catId === c.id),
      );
      if (!cat) continue;
      s.shots.push({
        id: s.nextShotId++,
        gun,
        catId: cat.id,
        firedAt: s.time,
        arrivesAt: s.time + TREAT_FLIGHT,
      });
      s.nextFire[gun] = s.time + GUN_PERIOD;
    }
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
        s.cats.push({
          id: s.nextId++,
          source,
          place: 'waiting',
          caredAt: s.time,
          careBy: 'arrival',
          careCount: 0,
        });
      if (source === 'nursery')
        s.message = 'SIX KITTENS. Nobody checked the launch manifest.';
    }
    const c = s.collector;
    if (
      c.phase === 'approaching' ||
      c.phase === 'ascending' ||
      c.phase === 'petting'
    ) {
      const cat = s.cats.find(
        (cat) => cat.id === c.catId && cat.place === 'stacked',
      );
      if (!cat || !this.needsCare(cat)) {
        c.phase = 'descending';
        c.catId = null;
      }
    }
    // Switching automation off parks safely after delivering anything already carried.
    if (c.phase === 'idle') {
      const requested = s.cats.find(
        (cat) => cat.id === s.requestedCat && this.needsCare(cat),
      );
      s.requestedCat = null;
      const care =
        requested ??
        (s.humanCare && (s.careStreak < 2 || !s.auto || !this.waiting)
          ? this.needyCats().find(
              (cat) => !s.shots.some((shot) => shot.catId === cat.id),
            )
          : undefined);
      if (care) {
        c.catId = care.id;
        c.hold = 0;
        c.phase = 'approaching';
        s.careStreak++;
      }
    }
    if (
      c.phase === 'approaching' ||
      c.phase === 'ascending' ||
      c.phase === 'petting' ||
      c.phase === 'descending'
    ) {
      this.stepCare(dt);
      return;
    }
    if (c.phase === 'idle') {
      if (!s.auto || !this.waiting) return;
      s.careStreak = 0;
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
  private stepCare(dt: number): void {
    const s = this.state,
      c = s.collector;
    if (c.phase === 'approaching') {
      const dx = 0.85 - c.x,
        dz = 2.4 - c.z,
        distance = Math.hypot(dx, dz);
      if (distance > this.speed * dt) {
        c.x += (dx / distance) * this.speed * dt;
        c.z += (dz / distance) * this.speed * dt;
        return;
      }
      c.x = 0.85;
      c.z = 2.4;
      c.phase = 'ascending';
    }
    const cat = s.cats.find(
      (cat) => cat.id === c.catId && cat.place === 'stacked',
    );
    const level = s.cats
      .filter((cat) => cat.place === 'stacked')
      .findIndex((cat) => cat.id === c.catId);
    const height = Math.max(0, level * TOWER_STEP - 0.35);
    const move = (1.8 + s.shoes * 0.4) * dt;
    if (c.phase === 'ascending' || c.phase === 'petting') {
      // Follow the same ID if cats below depart and its level changes.
      const dy = height - c.y;
      c.y += Math.sign(dy) * Math.min(Math.abs(dy), move);
      if (Math.abs(height - c.y) > 1e-9) {
        c.phase = 'ascending';
        c.hold = 0;
        return;
      }
      c.phase = 'petting';
      c.hold += dt;
      if (c.hold + 1e-9 >= 1.2 && cat) {
        this.refresh(cat, 'human');
        c.phase = 'descending';
        c.catId = null;
        c.hold = 0;
      }
    } else if (c.phase === 'descending') {
      c.y = Math.max(0, c.y - move);
      if (c.y === 0) {
        c.phase = 'idle';
        c.catId = null;
        c.hold = 0;
      }
    }
  }
  private distance(target: readonly number[]): number {
    return Math.hypot(
      target[0] - this.state.collector.x,
      target[1] - this.state.collector.z,
    );
  }
}
