import { generateIslandHeightfield } from './island-heightfield';
import { NavAgentState, NavCrowd } from './nav-crowd';
import { NavFlag } from './nav-flags';
import { NavGrid } from './nav-grid';
import { NavSectorGraph } from './nav-sectors';
import type { NavHeightfield } from './nav-types';

function flatField(width: number, height: number): NavHeightfield {
  return { width, height, cellSize: 1, heights: new Float32Array(width * height).fill(5), waterLevel: 0 };
}

function openGrid(width: number, height: number): NavGrid {
  return NavGrid.fromHeightfield(flatField(width, height));
}

/** The nearest cell to (x, y) with at least `clearance` cells of room (square spiral). */
function nearestRoomy(grid: NavGrid, x: number, y: number, clearance: number): { x: number; y: number } {
  for (let r = 0; r < 120; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = x + dx;
        const cy = y + dy;
        if (grid.inBounds(cx, cy) && grid.isPassable(cx, cy, 'villager') && grid.clearance[cy * grid.width + cx] >= clearance) {
          return { x: cx, y: cy };
        }
      }
    }
  }
  throw new Error('no roomy cell found');
}

interface Scenario {
  readonly grid: NavGrid;
  readonly graph: NavSectorGraph;
  readonly spawn: { x: number; y: number };
  readonly goal: { x: number; y: number };
}

/**
 * The demo island (512 x 512, seed 7) with a two-cell-thick wall across the whole island and a
 * 9-cell opening, villagers spawning west of the wall and the goal east of it.
 */
function islandScenario(): Scenario {
  const heightfield = generateIslandHeightfield({ size: 512, maxHeight: 45, featureSize: 170, seed: 7 });
  const grid = NavGrid.fromHeightfield(heightfield);
  const wallX = 256;
  grid.stampStructure({ x: wallX, y: 0, width: 2, height: 512 });
  // Open the wall where there is open ground on both sides, near the middle.
  const ground = (x: number, y: number): boolean => (grid.flags[y * 512 + x] & (NavFlag.WATER | NavFlag.STEEP)) === 0;
  let gapY = -1;
  for (let k = 0; k < 120 && gapY < 0; k++) {
    const y = 256 + (k % 2 === 0 ? k / 2 : -(k + 1) / 2);
    let open = true;
    for (let dy = 0; dy < 9 && open; dy++) for (let x = wallX - 8; x <= wallX + 9 && open; x++) open = ground(x, y + dy);
    if (open) gapY = y;
  }
  expect(gapY).withContext('a land opening near the middle').toBeGreaterThan(0);
  grid.clearStructure({ x: wallX, y: gapY, width: 2, height: 9 });
  const graph = NavSectorGraph.build(grid);
  return {
    grid,
    graph,
    spawn: nearestRoomy(grid, 130, gapY + 4, 6),
    goal: nearestRoomy(grid, 390, gapY + 4, 6),
  };
}

function inBlockedCell(crowd: NavCrowd): number {
  const { grid, posX, posY } = crowd;
  for (let i = 0; i < crowd.count; i++) {
    const x = Math.floor(posX[i]);
    const y = Math.floor(posY[i]);
    if (!grid.inBounds(x, y) || (grid.flags[y * grid.width + x] & NavFlag.BLOCKED) !== 0) return i;
  }
  return -1;
}

describe('NavCrowd', () => {
  it('walks one agent around a building to the goal', () => {
    const grid = openGrid(48, 32);
    grid.stampStructure({ x: 20, y: 6, width: 4, height: 20 });
    const graph = NavSectorGraph.build(grid, { sectorSize: 16 });
    const crowd = new NavCrowd(graph, { capacity: 4 });
    const goal = crowd.addGoal(40, 16);
    expect(crowd.spawn(4.5, 16.5, goal)).toBe(0);
    let steps = 0;
    while (crowd.state[0] !== NavAgentState.Arrived && steps++ < 1500) {
      crowd.step();
      expect(inBlockedCell(crowd)).toBe(-1);
    }
    expect(crowd.state[0]).toBe(NavAgentState.Arrived);
    expect(crowd.stats.arrived).toBe(1);
    expect(Math.hypot(crowd.posX[0] - 40.5, crowd.posY[0] - 16.5)).toBeLessThanOrEqual(3.01);
  });

  it('refuses to spawn in a blocked cell or beyond capacity', () => {
    const grid = openGrid(32, 32);
    grid.stampStructure({ x: 10, y: 10, width: 4, height: 4 });
    const crowd = new NavCrowd(NavSectorGraph.build(grid, { sectorSize: 16 }), { capacity: 2 });
    const goal = crowd.addGoal(30, 30);
    expect(crowd.spawn(11.5, 11.5, goal)).toBe(-1);
    expect(crowd.spawn(2.5, 2.5, goal)).toBe(0);
    expect(crowd.spawn(3.5, 2.5, goal)).toBe(1);
    expect(crowd.spawn(4.5, 2.5, goal)).toBe(-1);
    expect(crowd.count).toBe(2);
  });

  it('pushes overlapping agents apart', () => {
    const graph = NavSectorGraph.build(openGrid(32, 32), { sectorSize: 16 });
    const crowd = new NavCrowd(graph, { capacity: 3 });
    const goal = crowd.addGoal(30, 16);
    crowd.spawn(10.5, 16.5, goal);
    crowd.spawn(10.5, 16.5, goal);
    crowd.spawn(10.6, 16.5, goal);
    for (let i = 0; i < 20; i++) crowd.step();
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      const d = Math.hypot(crowd.posX[a] - crowd.posX[b], crowd.posY[a] - crowd.posY[b]);
      expect(d).withContext(`agents ${a},${b}`).toBeGreaterThan(0.2);
    }
  });

  it('marks agents that cannot reach the goal, and moves them once a way opens', () => {
    const grid = openGrid(48, 16);
    grid.stampStructure({ x: 24, y: 0, width: 2, height: 16 });
    const graph = NavSectorGraph.build(grid, { sectorSize: 16 });
    const crowd = new NavCrowd(graph, { capacity: 2 });
    const goal = crowd.addGoal(44, 8);
    crowd.spawn(4.5, 8.5, goal);
    for (let i = 0; i < 3; i++) crowd.step();
    expect(crowd.state[0]).toBe(NavAgentState.Unreachable);
    expect(crowd.stats.unreachable).toBe(1);
    expect(crowd.posX[0]).toBeCloseTo(4.5, 1);

    // Open a gap: the crowd's cache notices the new sector versions and builds the route.
    graph.rebuildSectors(grid.clearStructure({ x: 24, y: 7, width: 2, height: 3 }));
    let steps = 0;
    while (crowd.state[0] !== NavAgentState.Arrived && steps++ < 1500) {
      crowd.step();
      expect(inBlockedCell(crowd)).toBe(-1);
    }
    expect(crowd.state[0]).toBe(NavAgentState.Arrived);
  });

  it('is deterministic for a seed and step sequence', () => {
    const { graph, spawn, goal } = islandScenario();
    const area = { x: spawn.x - 10, y: spawn.y - 10, width: 20, height: 20 };
    const run = (seed: number): NavCrowd => {
      const crowd = new NavCrowd(graph, { capacity: 300, seed });
      crowd.spawnRandom(300, area, crowd.addGoal(goal.x, goal.y));
      for (let i = 0; i < 400; i++) crowd.step();
      return crowd;
    };
    const a = run(42);
    const b = run(42);
    expect(a.count).toBe(300);
    expect(b.posX).toEqual(a.posX);
    expect(b.posY).toEqual(a.posY);
    expect(b.velX).toEqual(a.velX);
    expect(b.velY).toEqual(a.velY);
    expect(b.state).toEqual(a.state);
    expect(a.stats.moving + a.stats.arrived).toBeGreaterThan(0);
    expect(run(43).posX).not.toEqual(a.posX);
  });

  it('moves 1,000 villagers to one goal across the island, through the wall opening', () => {
    const { graph, spawn, goal } = islandScenario();
    const abstract = graph.findAbstractPath(spawn.x, spawn.y, goal.x, goal.y, 'villager');
    expect(abstract.found).withContext('spawn and goal are connected').toBeTrue();

    const crowd = new NavCrowd(graph, { capacity: 1000, seed: 7 });
    const id = crowd.addGoal(goal.x, goal.y);
    const spawned = crowd.spawnRandom(1000, { x: spawn.x - 14, y: spawn.y - 14, width: 28, height: 28 }, id);
    expect(spawned).toBe(1000);

    const budget = 6000;
    let steps = 0;
    let totalStepMs = 0;
    let maxStepMs = 0;
    while (crowd.stats.arrived < 1000 && steps < budget) {
      crowd.step();
      steps++;
      totalStepMs += crowd.stats.lastStepMs;
      maxStepMs = Math.max(maxStepMs, crowd.stats.lastStepMs);
      if (steps % 10 === 0 || crowd.stats.arrived === 1000) {
        const bad = inBlockedCell(crowd);
        if (bad >= 0) fail(`agent ${bad} is in a blocked cell at step ${steps}`);
      }
    }
    const cache = crowd.cache;
    const field = crowd.fieldFor(id, 'villager');
    const builds = cache.recentBuilds;
    const perSector = builds.map((b) => b.ms);
    const sorted = [...perSector].sort((x, y) => x - y);
    console.log(
      `[crowd-nav] 1000 villagers: ${crowd.stats.arrived} arrived in ${steps} steps (${(steps * crowd.fixedDt).toFixed(0)} s simulated), ` +
        `step ${(totalStepMs / steps).toFixed(3)} ms mean / ${maxStepMs.toFixed(2)} ms max; ` +
        `fields: ${cache.stats.builds} sector fields (${field.builtSectors} cached) in ${cache.stats.totalBuildMs.toFixed(1)} ms, ` +
        `per sector min ${sorted[0].toFixed(2)} / median ${sorted[sorted.length >> 1].toFixed(2)} / max ${cache.stats.maxBuildMs.toFixed(2)} ms; ` +
        `corridor ${abstract.sectors.length} sectors`,
    );
    expect(crowd.stats.arrived).toBe(1000);
    expect(inBlockedCell(crowd)).toBe(-1);
    expect(cache.stats.builds).toBeGreaterThan(0);
    expect(perSector.length).toBe(cache.stats.builds);
    expect(perSector.every((ms) => ms >= 0)).toBeTrue();
    expect(cache.stats.totalBuildMs).toBeGreaterThan(0);
    // Only sectors near the route are built, not the whole island.
    expect(cache.stats.builds).toBeLessThan(graph.sectorCount / 2);
  });

  it('builds fields lazily within the per-step budget', () => {
    const { graph, spawn, goal } = islandScenario();
    const crowd = new NavCrowd(graph, { capacity: 50, seed: 3, maxBuildsPerStep: 2 });
    const id = crowd.addGoal(goal.x, goal.y);
    crowd.spawnRandom(50, { x: spawn.x - 6, y: spawn.y - 6, width: 12, height: 12 }, id);
    crowd.step();
    expect(crowd.stats.lastStepBuilds).toBeLessThanOrEqual(2);
    expect(crowd.stats.waiting).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) crowd.step();
    expect(crowd.stats.moving).toBeGreaterThan(0);
  });
});
