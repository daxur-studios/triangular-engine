import type { NavUnitClass } from './nav-flags';
import { NavFlowCache, type NavFlowCacheOptions, type NavFlowDirection, type NavFlowField } from './nav-flow';
import { NAV_UNIT_CLASSES, type NavSectorGraph } from './nav-sectors';
import type { NavGrid } from './nav-grid';
import type { NavRect } from './nav-types';

/** Agent states stored in {@link NavCrowd.state}. */
export const NavAgentState = {
  /** Following the flow field. */
  Moving: 0,
  /** Within the arrival radius of the goal; frozen and left out of separation. */
  Arrived: 1,
  /** No direction yet: the field is being built or the agent has no usable cell. */
  Waiting: 2,
  /** The goal cannot be reached from the agent's cell. */
  Unreachable: 3,
} as const;

/** Options for {@link NavCrowd}. Distances are in grid cells, times in seconds. */
export interface NavCrowdOptions extends NavFlowCacheOptions {
  /** Most agents the crowd can hold (the typed arrays are allocated once). */
  readonly capacity: number;
  /** Integer seed of the spawn random generator. Default 1. */
  readonly seed?: number;
  /** Top speed in cells per second. Default 4. */
  readonly maxSpeed?: number;
  /** Largest velocity change in cells per second squared. Default 16. */
  readonly maxAccel?: number;
  /** Agents closer than this push each other apart. Default 1. */
  readonly separationRadius?: number;
  /** Separation weight as a share of `maxSpeed` (the push is capped at 1). Default 0.6. */
  readonly separationStrength?: number;
  /** An agent this close to the goal centre has arrived. Default 3. */
  readonly arrivalRadius?: number;
  /** Time step used by `step()` without an argument and by `advance`. Default 0.05. */
  readonly fixedDt?: number;
  /**
   * Most sector fields the crowd lets the cache build in one step; waiting agents are served in the
   * following steps. Default unlimited.
   */
  readonly maxBuildsPerStep?: number;
  /** Share an existing cache (and so its fields) with other crowds. */
  readonly cache?: NavFlowCache;
}

/** Counters of the last {@link NavCrowd.step}. */
export interface NavCrowdStats {
  /** Agents following the field. */
  moving: number;
  /** Agents that arrived. */
  arrived: number;
  /** Agents waiting for a field. */
  waiting: number;
  /** Agents that cannot reach the goal. */
  unreachable: number;
  /** Wall-clock time of the last step in milliseconds. */
  lastStepMs: number;
  /** Sector fields built during the last step. */
  lastStepBuilds: number;
  /** Steps run so far. */
  steps: number;
}

/** mulberry32: a small seeded generator, deterministic across platforms. */
class NavRng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/**
 * A crowd of agents that follow flow fields: a structure-of-arrays store (positions, velocities,
 * goal, class, state) and a fixed-step simulation.
 *
 * Positions are continuous grid coordinates in cells (cell `i` covers `[i, i + 1)`; multiply by
 * `grid.cellSize` for metres). Each step:
 *
 * 1. {@link NavFlowCache.sync} drops stale fields; agents without a direction ask the cache to
 *    build the missing sectors on their corridor (lazy, up to `maxBuildsPerStep` per step).
 * 2. A uniform spatial hash is rebuilt with a counting sort into typed arrays.
 * 3. Each moving agent samples its direction bilinearly, adds a soft separation push from agents
 *    closer than `separationRadius`, and changes velocity toward the result within `maxAccel`.
 * 4. Positions advance one axis at a time; a move into a cell the agent's class cannot stand in is
 *    cancelled on that axis (the agent slides along walls and never ends inside a blocked cell).
 * 5. Agents within `arrivalRadius` of the goal centre are marked arrived and frozen. Arrival uses the
 *    straight distance, so a goal behind a thin wall can be reached from the other side.
 *
 * Nothing allocates per agent and nothing uses `Math.random`: the same seed and step sequence give
 * the same positions. No Angular or three.js dependency, so it can run in a worker.
 */
export class NavCrowd {
  /** The grid agents walk on. */
  readonly grid: NavGrid;
  /** The sector graph the fields are built on. */
  readonly graph: NavSectorGraph;
  /** The flow field cache (shared when `options.cache` was given). */
  readonly cache: NavFlowCache;
  /** Most agents. */
  readonly capacity: number;
  /** Agents spawned so far; indices `0 .. count - 1` are valid. */
  count = 0;

  /** X position per agent, in cells. */
  readonly posX: Float32Array;
  /** Y position per agent, in cells. */
  readonly posY: Float32Array;
  /** X velocity per agent, in cells per second. */
  readonly velX: Float32Array;
  /** Y velocity per agent, in cells per second. */
  readonly velY: Float32Array;
  /** Goal id per agent (see {@link NavCrowd.addGoal}). */
  readonly goalId: Int32Array;
  /** Unit class index per agent (index into `NAV_UNIT_CLASSES`). */
  readonly unitClass: Uint8Array;
  /** {@link NavAgentState} per agent. */
  readonly state: Uint8Array;

  /** Counters of the last step. */
  readonly stats: NavCrowdStats = {
    moving: 0,
    arrived: 0,
    waiting: 0,
    unreachable: 0,
    lastStepMs: 0,
    lastStepBuilds: 0,
    steps: 0,
  };

  /** The fixed time step in seconds. */
  readonly fixedDt: number;
  /** Top speed in cells per second. */
  readonly maxSpeed: number;

  private readonly maxAccel: number;
  private readonly sepRadius: number;
  private readonly sepStrength: number;
  private readonly arrivalR2: number;
  private readonly maxBuilds: number;
  private readonly rng: NavRng;
  private accumulator = 0;

  private readonly goals: { x: number; y: number }[] = [];
  private readonly fields: (NavFlowField | undefined)[] = [];
  private readonly activeFields = new Set<NavFlowField>();

  // Spatial hash (counting sort).
  private readonly hashSize: number;
  private readonly hashW: number;
  private readonly hashH: number;
  private readonly bucketStart: Int32Array;
  private readonly bucketCursor: Int32Array;
  private readonly bucketOf: Int32Array;
  private readonly sorted: Int32Array;

  private readonly dirOut: NavFlowDirection = { x: 0, y: 0 };
  // Per-agent sampled flow direction of the current step.
  private readonly dirX: Float32Array;
  private readonly dirY: Float32Array;

  constructor(graph: NavSectorGraph, options: NavCrowdOptions) {
    this.graph = graph;
    this.grid = graph.grid;
    this.capacity = Math.max(1, Math.floor(options.capacity));
    this.cache = options.cache ?? new NavFlowCache(graph, options);
    this.rng = new NavRng(options.seed ?? 1);
    this.maxSpeed = options.maxSpeed ?? 4;
    this.maxAccel = options.maxAccel ?? 16;
    this.sepRadius = options.separationRadius ?? 1;
    this.sepStrength = options.separationStrength ?? 0.6;
    const ar = options.arrivalRadius ?? 3;
    this.arrivalR2 = ar * ar;
    this.fixedDt = options.fixedDt ?? 0.05;
    this.maxBuilds = options.maxBuildsPerStep ?? Infinity;
    const n = this.capacity;
    this.posX = new Float32Array(n);
    this.posY = new Float32Array(n);
    this.velX = new Float32Array(n);
    this.velY = new Float32Array(n);
    this.goalId = new Int32Array(n);
    this.unitClass = new Uint8Array(n);
    this.state = new Uint8Array(n);
    this.hashSize = Math.max(4, Math.ceil(this.sepRadius));
    this.hashW = Math.ceil(this.grid.width / this.hashSize);
    this.hashH = Math.ceil(this.grid.height / this.hashSize);
    this.bucketStart = new Int32Array(this.hashW * this.hashH + 1);
    this.bucketCursor = new Int32Array(this.hashW * this.hashH);
    this.bucketOf = new Int32Array(n);
    this.sorted = new Int32Array(n);
    this.dirX = new Float32Array(n);
    this.dirY = new Float32Array(n);
  }

  /** Registers a goal cell and returns its id. The cell should be passable for the agents' class. */
  addGoal(x: number, y: number): number {
    this.goals.push({ x: Math.floor(x), y: Math.floor(y) });
    return this.goals.length - 1;
  }

  /** The cell of a goal id. */
  goalCell(id: number): { readonly x: number; readonly y: number } {
    return this.goals[id];
  }

  /** The flow field an agent of a class follows to a goal, creating the empty handle on first use. */
  fieldFor(goalId: number, unitClass: NavUnitClass): NavFlowField {
    const idx = goalId * 3 + NAV_UNIT_CLASSES.indexOf(unitClass);
    let f = this.fields[idx];
    if (!f) {
      const g = this.goals[goalId];
      f = this.cache.field(g.x, g.y, unitClass);
      this.fields[idx] = f;
    }
    return f;
  }

  /**
   * Adds an agent at a position in cells. Returns its index, or -1 when the crowd is full or the
   * cell is not passable for the class.
   */
  spawn(x: number, y: number, goalId: number, unitClass: NavUnitClass = 'villager'): number {
    if (this.count >= this.capacity || !this.grid.isPassable(Math.floor(x), Math.floor(y), unitClass)) return -1;
    const i = this.count++;
    this.posX[i] = x;
    this.posY[i] = y;
    this.velX[i] = 0;
    this.velY[i] = 0;
    this.goalId[i] = goalId;
    this.unitClass[i] = NAV_UNIT_CLASSES.indexOf(unitClass);
    this.state[i] = NavAgentState.Waiting;
    return i;
  }

  /**
   * Spawns up to `count` agents at seeded random positions inside a rectangle (cells the class can
   * stand in only). Returns the number spawned.
   */
  spawnRandom(count: number, rect: NavRect, goalId: number, unitClass: NavUnitClass = 'villager'): number {
    let spawned = 0;
    for (let attempts = 0; spawned < count && attempts < count * 30; attempts++) {
      const x = rect.x + this.rng.next() * rect.width;
      const y = rect.y + this.rng.next() * rect.height;
      if (this.spawn(x, y, goalId, unitClass) >= 0) spawned++;
      else if (this.count >= this.capacity) break;
    }
    return spawned;
  }

  /** Sends every agent (arrived ones included) to another goal id; they wait for its field. */
  retarget(goalId: number): void {
    this.goalId.fill(goalId, 0, this.count);
    this.state.fill(NavAgentState.Waiting, 0, this.count);
    this.velX.fill(0, 0, this.count);
    this.velY.fill(0, 0, this.count);
  }

  /** Removes every agent (goals, fields and the cache are kept). */
  clear(): void {
    this.count = 0;
    this.accumulator = 0;
    this.activeFields.clear();
    this.stats.moving = this.stats.arrived = this.stats.waiting = this.stats.unreachable = 0;
  }

  /**
   * Runs as many fixed steps as `seconds` allows (carrying the remainder), at most `maxSteps`.
   * Returns the number of steps run.
   */
  advance(seconds: number, maxSteps = 8): number {
    this.accumulator += seconds;
    let n = 0;
    while (this.accumulator >= this.fixedDt && n < maxSteps) {
      this.step(this.fixedDt);
      this.accumulator -= this.fixedDt;
      n++;
    }
    if (this.accumulator > this.fixedDt) this.accumulator = this.fixedDt;
    return n;
  }

  /** One simulation step of `dt` seconds (default `fixedDt`). Keep `maxSpeed * dt` below one cell. */
  step(dt: number = this.fixedDt): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const { grid, cache } = this;
    const n = this.count;
    const { posX, posY, velX, velY, state, goalId, unitClass } = this;
    const stats = this.stats;
    const buildsBefore = cache.stats.builds;
    cache.sync();
    let buildsLeft = this.maxBuilds;

    // Arrival, fields and the hash membership.
    let arrived = 0;
    let waiting = 0;
    let unreachable = 0;
    let moving = 0;
    this.activeFields.clear();
    const dir = this.dirOut;
    const { dirX, dirY } = this;
    for (let i = 0; i < n; i++) {
      if (state[i] === NavAgentState.Arrived) {
        arrived++;
        this.bucketOf[i] = -1;
        continue;
      }
      const g = this.goals[goalId[i]];
      const dx = posX[i] - (g.x + 0.5);
      const dy = posY[i] - (g.y + 0.5);
      if (dx * dx + dy * dy <= this.arrivalR2) {
        state[i] = NavAgentState.Arrived;
        velX[i] = 0;
        velY[i] = 0;
        arrived++;
        this.bucketOf[i] = -1;
        continue;
      }
      const cls = NAV_UNIT_CLASSES[unitClass[i]];
      const field = this.fieldFor(goalId[i], cls);
      this.activeFields.add(field);
      let ok = field.sample(posX[i], posY[i], dir);
      if (!ok && buildsLeft > 0) {
        const cx = Math.floor(posX[i]);
        const cy = Math.floor(posY[i]);
        if (grid.inBounds(cx, cy)) {
          const res = cache.ensure(field, cx, cy, buildsLeft);
          buildsLeft -= res.built;
          if (res.status === 'unreachable') {
            state[i] = NavAgentState.Unreachable;
          } else if (res.built > 0 || res.status === 'ready') {
            ok = field.sample(posX[i], posY[i], dir);
          }
        }
      }
      if (ok) {
        dirX[i] = dir.x;
        dirY[i] = dir.y;
        state[i] = NavAgentState.Moving;
        moving++;
      } else {
        dirX[i] = 0;
        dirY[i] = 0;
        if (state[i] !== NavAgentState.Unreachable) state[i] = NavAgentState.Waiting;
        if (state[i] === NavAgentState.Unreachable) unreachable++;
        else waiting++;
      }
      this.bucketOf[i] = -2; // in the hash, assigned below
    }
    for (const f of this.activeFields) cache.touch(f);

    this.buildHash(n);

    // Velocity pass (reads positions only), then the integration pass.
    const r = this.sepRadius;
    const r2 = r * r;
    const hs = this.hashSize;
    const maxSpeed = this.maxSpeed;
    const maxDv = this.maxAccel * dt;
    const strength = this.sepStrength;
    const { bucketStart, sorted } = this;
    for (let i = 0; i < n; i++) {
      const b = this.bucketOf[i];
      if (b < 0) continue;
      const px = posX[i];
      const py = posY[i];
      let sx = 0;
      let sy = 0;
      const bx = Math.floor(px / hs);
      const by = Math.floor(py / hs);
      for (let oy = by - 1; oy <= by + 1; oy++) {
        if (oy < 0 || oy >= this.hashH) continue;
        for (let ox = bx - 1; ox <= bx + 1; ox++) {
          if (ox < 0 || ox >= this.hashW) continue;
          const bi = oy * this.hashW + ox;
          for (let k = bucketStart[bi]; k < bucketStart[bi + 1]; k++) {
            const j = sorted[k];
            if (j === i) continue;
            let dx = px - posX[j];
            let dy = py - posY[j];
            let d2 = dx * dx + dy * dy;
            if (d2 >= r2) continue;
            if (d2 < 1e-8) {
              dx = i < j ? 1e-3 : -1e-3;
              dy = (i + j) & 1 ? 1e-3 : -1e-3;
              d2 = dx * dx + dy * dy;
            }
            const d = Math.sqrt(d2);
            const f = (1 - d / r) / d;
            sx += dx * f;
            sy += dy * f;
          }
        }
      }
      const sl = Math.sqrt(sx * sx + sy * sy);
      if (sl > 1) {
        sx /= sl;
        sy /= sl;
      }
      let tx = dirX[i] * maxSpeed + sx * strength * maxSpeed;
      let ty = dirY[i] * maxSpeed + sy * strength * maxSpeed;
      const tl = Math.sqrt(tx * tx + ty * ty);
      if (tl > maxSpeed) {
        tx *= maxSpeed / tl;
        ty *= maxSpeed / tl;
      }
      let dvx = tx - velX[i];
      let dvy = ty - velY[i];
      const dl = Math.sqrt(dvx * dvx + dvy * dvy);
      if (dl > maxDv) {
        dvx *= maxDv / dl;
        dvy *= maxDv / dl;
      }
      velX[i] += dvx;
      velY[i] += dvy;
    }

    for (let i = 0; i < n; i++) {
      if (this.bucketOf[i] < 0) continue;
      let mx = velX[i] * dt;
      let my = velY[i] * dt;
      const ml = Math.sqrt(mx * mx + my * my);
      if (ml > 0.9) {
        mx *= 0.9 / ml;
        my *= 0.9 / ml;
      }
      const cls = NAV_UNIT_CLASSES[unitClass[i]];
      const nx = posX[i] + mx;
      if (grid.isPassable(Math.floor(nx), Math.floor(posY[i]), cls)) posX[i] = nx;
      else velX[i] = 0;
      const ny = posY[i] + my;
      if (grid.isPassable(Math.floor(posX[i]), Math.floor(ny), cls)) posY[i] = ny;
      else velY[i] = 0;
    }

    stats.moving = moving;
    stats.arrived = arrived;
    stats.waiting = waiting;
    stats.unreachable = unreachable;
    stats.steps++;
    stats.lastStepBuilds = cache.stats.builds - buildsBefore;
    stats.lastStepMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  }

  /** Counting sort of the agents that are in the hash (`bucketOf` is -2) into `sorted`. */
  private buildHash(n: number): void {
    const start = this.bucketStart;
    const cursor = this.bucketCursor;
    const hs = this.hashSize;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      if (this.bucketOf[i] !== -2) continue;
      const b = Math.floor(this.posY[i] / hs) * this.hashW + Math.floor(this.posX[i] / hs);
      this.bucketOf[i] = b;
      start[b + 1]++;
    }
    for (let b = 0; b < cursor.length; b++) start[b + 1] += start[b];
    cursor.set(start.subarray(0, cursor.length));
    for (let i = 0; i < n; i++) {
      const b = this.bucketOf[i];
      if (b >= 0) this.sorted[cursor[b]++] = i;
    }
  }
}
