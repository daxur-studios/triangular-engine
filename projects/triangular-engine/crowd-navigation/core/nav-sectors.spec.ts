import { generateIslandHeightfield } from './island-heightfield';
import { NAV_UNIT_CLASSES, NavSectorGraph } from './nav-sectors';
import { NavGrid } from './nav-grid';
import type { NavUnitClass } from './nav-flags';
import type { NavHeightfield } from './nav-types';

function flatField(width: number, height: number): NavHeightfield {
  return { width, height, cellSize: 1, heights: new Float32Array(width * height).fill(5), waterLevel: 0 };
}

/** A flat grid with a one-cell wall at column `wallX` and open gaps (inclusive row ranges). */
function wallGrid(width: number, height: number, wallX: number, gaps: [number, number][], maxClearance?: number) {
  const grid = NavGrid.fromHeightfield(flatField(width, height), { maxClearance });
  grid.stampStructure({ x: wallX, y: 0, width: 1, height });
  for (const [a, b] of gaps) grid.clearStructure({ x: wallX, y: a, width: 1, height: b - a + 1 });
  return grid;
}

function signature(graph: NavSectorGraph, unitClass: NavUnitClass): string {
  const portals = graph
    .getPortals(unitClass)
    .map((p) => `${p.cellA}>${p.cellB}`)
    .sort();
  const links = graph
    .getLinks(unitClass)
    .map((l) => `${l.sector}:${l.fromCell}>${l.toCell}=${l.cost.toFixed(2)}`)
    .sort();
  return JSON.stringify({ portals, links });
}

function expectContiguous(graph: NavSectorGraph, sectors: readonly number[]): void {
  for (let i = 1; i < sectors.length; i++) {
    const a = sectors[i - 1];
    const b = sectors[i];
    const dx = Math.abs((a % graph.sectorsX) - (b % graph.sectorsX));
    const dy = Math.abs(Math.floor(a / graph.sectorsX) - Math.floor(b / graph.sectorsX));
    expect(dx + dy).withContext(`sectors ${a} and ${b} are neighbours`).toBe(1);
  }
}

describe('NavSectorGraph portal extraction', () => {
  it('gives one gap one portal at the centre of the run', () => {
    const grid = wallGrid(16, 8, 8, [[3, 4]]);
    const graph = NavSectorGraph.build(grid, { sectorSize: 8 });
    const portals = graph.getPortals('villager');
    expect(portals.length).toBe(1);
    expect(portals[0].ay).toBe(3);
    expect(portals[0].ax).toBe(7);
    expect(portals[0].bx).toBe(8);
    expect(portals[0].sectorA).toBe(0);
    expect(portals[0].sectorB).toBe(1);
  });

  it('gives a solid wall no portal', () => {
    const graph = NavSectorGraph.build(wallGrid(16, 8, 8, []), { sectorSize: 8 });
    for (const c of NAV_UNIT_CLASSES) expect(graph.portalCount(c)).withContext(c).toBe(0);
  });

  it('gives a 2-cell gap a villager portal but no catapult or creature portal', () => {
    const graph = NavSectorGraph.build(wallGrid(16, 8, 8, [[3, 4]]), { sectorSize: 8 });
    expect(graph.portalCount('villager')).toBe(1);
    expect(graph.portalCount('catapult')).toBe(0);
    expect(graph.portalCount('creature')).toBe(0);
  });

  it('gives an open edge a portal for every class and splits runs at blocked pairs', () => {
    const open = NavSectorGraph.build(NavGrid.fromHeightfield(flatField(64, 32)), { sectorSize: 32 });
    for (const c of NAV_UNIT_CLASSES) expect(open.portalCount(c)).withContext(c).toBe(1);
    const grid = wallGrid(64, 32, 32, [
      [2, 5],
      [10, 12],
    ]);
    const graph = NavSectorGraph.build(grid, { sectorSize: 32 });
    expect(graph.portalCount('villager')).toBe(2);
  });
});

describe('NavSectorGraph abstract query', () => {
  // Wall at x = 32 with a 2-cell gap (rows 14-15) and a wide opening at the bottom (rows 22-31).
  const wallWithBoth = () =>
    wallGrid(64, 32, 32, [
      [14, 15],
      [22, 31],
    ]);

  it('routes villagers through a gap that creatures cannot pass', () => {
    const grid = wallGrid(64, 32, 32, [[14, 15]]);
    const graph = NavSectorGraph.build(grid, { sectorSize: 32 });
    const villager = graph.findAbstractPath(20, 16, 44, 16, 'villager');
    expect(villager.found).toBeTrue();
    expect(villager.sectors).toEqual([0, 1]);
    expect(villager.portals.length).toBe(1);
    for (const c of ['catapult', 'creature'] as const) {
      const r = graph.findAbstractPath(20, 16, 44, 16, c);
      expect(r.found).withContext(c).toBeFalse();
      expect(r.sectors.length).toBe(0);
    }
  });

  it('sends creatures the long way round when a wide route exists', () => {
    const graph = NavSectorGraph.build(wallWithBoth(), { sectorSize: 32 });
    const villager = graph.findAbstractPath(20, 16, 44, 16, 'villager');
    const creature = graph.findAbstractPath(20, 16, 44, 16, 'creature');
    expect(villager.found).toBeTrue();
    expect(creature.found).toBeTrue();
    expect(creature.cost).toBeGreaterThan(villager.cost);
    expect(creature.portals[0].ay).toBeGreaterThan(24);
    expect(villager.portals[0].ay).toBe(14);
  });

  it('finds a villager route cost close to the straight line', () => {
    const graph = NavSectorGraph.build(NavGrid.fromHeightfield(flatField(64, 32)), { sectorSize: 32 });
    const r = graph.findAbstractPath(2, 16, 61, 16, 'villager');
    expect(r.found).toBeTrue();
    // 59 orthogonal steps at 16 each; the portal sits on the same row here.
    expect(r.cost).toBeGreaterThanOrEqual(59 * 16 - 1);
    expect(r.cost).toBeLessThan(59 * 16 * 1.05);
  });

  it('answers within one sector without portals', () => {
    const graph = NavSectorGraph.build(NavGrid.fromHeightfield(flatField(20, 20)), { sectorSize: 64 });
    expect(graph.sectorCount).toBe(1);
    const r = graph.findAbstractPath(1, 1, 18, 18, 'villager');
    expect(r.found).toBeTrue();
    expect(r.sectors).toEqual([0]);
    expect(r.portals.length).toBe(0);
  });

  it('reports blocked endpoints and disconnected goals', () => {
    const grid = wallGrid(64, 32, 32, []);
    const graph = NavSectorGraph.build(grid, { sectorSize: 32 });
    expect(graph.findAbstractPath(32, 5, 44, 16, 'villager').failure).toBe('start-blocked');
    expect(graph.findAbstractPath(20, 16, 32, 5, 'villager').failure).toBe('goal-blocked');
    expect(graph.findAbstractPath(20, 16, 44, 16, 'villager').failure).toBe('disconnected');
  });

  it('handles partial edge sectors', () => {
    const grid = NavGrid.fromHeightfield(flatField(70, 50));
    const graph = NavSectorGraph.build(grid, { sectorSize: 32 });
    expect(graph.sectorsX).toBe(3);
    expect(graph.sectorsY).toBe(2);
    expect(graph.sectorRect(2)).toEqual({ x: 64, y: 0, width: 6, height: 32 });
    expect(graph.sectorRect(5)).toEqual({ x: 64, y: 32, width: 6, height: 18 });
    const r = graph.findAbstractPath(2, 2, 68, 48, 'villager');
    expect(r.found).toBeTrue();
    expect(r.sectors[0]).toBe(0);
    expect(r.sectors[r.sectors.length - 1]).toBe(5);
    expectContiguous(graph, r.sectors);
    // Edge portals exist between a full sector and the 6-cell wide one, and below the short row.
    expect(graph.getEdgePortals('villager', 1, 'east').length).toBe(1);
    expect(graph.getEdgePortals('villager', 2, 'south')[0].by).toBe(32);
  });

  it('finds a corridor between two land cells on a 2,048 x 2,048 island', () => {
    const t0 = performance.now();
    const grid = NavGrid.fromHeightfield(
      generateIslandHeightfield({ size: 2048, seed: 7, maxHeight: 45, featureSize: 170 }),
    );
    const t1 = performance.now();
    const graph = NavSectorGraph.build(grid);
    const t2 = performance.now();
    const counts = NAV_UNIT_CLASSES.map((c) => `${c} ${graph.portalCount(c)}`).join(', ');
    console.log(
      `2048^2 grid ${Math.round(t1 - t0)} ms, sector graph build ${Math.round(t2 - t1)} ms ` +
        `(${graph.sectorCount} sectors; portals: ${counts})`,
    );

    // Pick land cells deterministically and query pairs until one connects.
    let seed = 12345;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const land = (): [number, number] => {
      for (;;) {
        const x = 300 + Math.floor(rnd() * 1450);
        const y = 300 + Math.floor(rnd() * 1450);
        if (grid.isPassable(x, y, 'villager')) return [x, y];
      }
    };
    let found = false;
    for (let attempt = 0; attempt < 30 && !found; attempt++) {
      const [sx, sy] = land();
      const [gx, gy] = land();
      const q0 = performance.now();
      const r = graph.findAbstractPath(sx, sy, gx, gy, 'villager');
      const q1 = performance.now();
      if (!r.found) continue;
      found = true;
      console.log(
        `abstract query (${sx},${sy}) -> (${gx},${gy}): ${(q1 - q0).toFixed(2)} ms, ` +
          `corridor ${r.sectors.length} sectors, ${r.portals.length} portals, cost ${r.cost.toFixed(0)}`,
      );
      expect(r.sectors.length).toBeGreaterThan(0);
      expect(r.sectors[0]).toBe(graph.sectorOf(sx, sy));
      expect(r.sectors[r.sectors.length - 1]).toBe(graph.sectorOf(gx, gy));
      expectContiguous(graph, r.sectors);
      const w0 = performance.now();
      graph.findAbstractPath(sx, sy, gx, gy, 'villager');
      console.log(`warm query ${(performance.now() - w0).toFixed(2)} ms`);
    }
    expect(found).toBeTrue();
  }, 120000);
});

describe('NavSectorGraph incremental rebuild', () => {
  it('rebuilds only the touched sector for an interior edit and equals a full rebuild', () => {
    const grid = NavGrid.fromHeightfield(flatField(128, 128), { maxClearance: 8 });
    const graph = NavSectorGraph.build(grid, { sectorSize: 32 });
    expect(Array.from(graph.versions).every((v) => v === 1)).toBeTrue();
    const dirty = grid.stampStructure({ x: 46, y: 46, width: 4, height: 4 });
    const rebuilt = graph.rebuildSectors(dirty);
    expect(rebuilt).toEqual([5]);
    expect(graph.versions[5]).toBe(2);
    for (let s = 0; s < graph.sectorCount; s++) if (s !== 5) expect(graph.versions[s]).toBe(1);
    const fresh = NavSectorGraph.build(grid, { sectorSize: 32 });
    for (const c of NAV_UNIT_CLASSES) expect(signature(graph, c)).withContext(c).toBe(signature(fresh, c));
  });

  it('bumps neighbours only when their shared portals change, and equals a full rebuild', () => {
    const grid = wallGrid(128, 128, 64, [[60, 70]], 8);
    const graph = NavSectorGraph.build(grid, { sectorSize: 32 });
    expect(graph.getEdgePortals('villager', 5, 'east').length).toBe(1);
    // Close the gap: the edit lies on the sector border, so both neighbours change.
    const dirty = grid.stampStructure({ x: 64, y: 60, width: 1, height: 11 });
    const rebuilt = graph.rebuildSectors(dirty);
    expect(rebuilt.length).toBeGreaterThan(0);
    expect(rebuilt.length).toBeLessThan(graph.sectorCount);
    for (let s = 0; s < graph.sectorCount; s++) {
      expect(graph.versions[s]).withContext(`sector ${s}`).toBe(rebuilt.includes(s) ? 2 : 1);
    }
    expect(graph.getEdgePortals('villager', 5, 'east').length).toBe(0);
    const fresh = NavSectorGraph.build(grid, { sectorSize: 32 });
    for (const c of NAV_UNIT_CLASSES) expect(signature(graph, c)).withContext(c).toBe(signature(fresh, c));
  });

  it('keeps matching a full rebuild over random structure edits, and queries agree', () => {
    const grid = NavGrid.fromHeightfield(flatField(96, 80));
    const graph = NavSectorGraph.build(grid, { sectorSize: 16 });
    let seed = 7;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor((seed / 4294967296) * n);
    };
    for (let step = 0; step < 25; step++) {
      const rect = { x: rnd(90), y: rnd(70), width: 1 + rnd(14), height: 1 + rnd(14) };
      const dirty = step % 3 === 2 ? grid.clearStructure(rect) : grid.stampStructure(rect);
      graph.rebuildSectors(dirty);
    }
    const fresh = NavSectorGraph.build(grid, { sectorSize: 16 });
    for (const c of NAV_UNIT_CLASSES) expect(signature(graph, c)).withContext(c).toBe(signature(fresh, c));
    for (let k = 0; k < 20; k++) {
      const a = [rnd(96), rnd(80)];
      const b = [rnd(96), rnd(80)];
      const r1 = graph.findAbstractPath(a[0], a[1], b[0], b[1], 'villager');
      const r2 = fresh.findAbstractPath(a[0], a[1], b[0], b[1], 'villager');
      expect(r1.found).toBe(r2.found);
      if (r1.found) expect(r1.cost).toBeCloseTo(r2.cost, 2);
    }
  });

  it('makes a creature route appear and disappear with a gate', () => {
    const grid = NavGrid.fromHeightfield(flatField(64, 32));
    grid.stampStructure({ x: 32, y: 0, width: 1, height: 32 });
    const gate = { x: 32, y: 8, width: 1, height: 16 };
    grid.stampGate(gate, false);
    const graph = NavSectorGraph.build(grid, { sectorSize: 32 });
    expect(graph.findAbstractPath(20, 16, 44, 16, 'creature').found).toBeFalse();
    graph.rebuildSectors(grid.setGateOpen(gate, true));
    expect(graph.findAbstractPath(20, 16, 44, 16, 'creature').found).toBeTrue();
    graph.rebuildSectors(grid.setGateOpen(gate, false));
    expect(graph.findAbstractPath(20, 16, 44, 16, 'creature').found).toBeFalse();
  });
});
