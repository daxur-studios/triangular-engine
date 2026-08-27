import { IPlanetGraphCore } from './planet-graph';

export type WaterBodyKind = 'ocean' | 'lake';

export interface IPlanetWaterBodies {
  /** 'ocean' | 'lake' per water cell, null for land cells. */
  waterBodyKind: (WaterBodyKind | null)[];
}

/**
 * M2.5 water-body pass: splits `tectonics.isLand`'s water cells into ocean vs.
 * lake. `isLand` on its own has no notion of connectivity — a landlocked
 * water pocket and the open ocean are both just "not land" — so this
 * flood-fills connected water components and calls the single largest one the
 * ocean (real planets overwhelmingly have one dominant connected ocean); every
 * other component is a lake. See runbook 022.
 *
 * This only classifies water that already exists from the elevation/sea-level
 * pass — it does not create new lakes by filling interior elevation minima
 * that sit above sea level (a depression-filling pass, if ever wanted, is a
 * separate feature).
 */
export function classifyWaterBodies(graph: IPlanetGraphCore, isLand: boolean[]): IPlanetWaterBodies {
  const cellCount = graph.cells.length;
  const waterBodyKind: (WaterBodyKind | null)[] = new Array(cellCount).fill(null);
  const visited = new Array<boolean>(cellCount).fill(false);
  const components: number[][] = [];

  for (let start = 0; start < cellCount; start++) {
    if (isLand[start] || visited[start]) continue;

    const component: number[] = [];
    visited[start] = true;
    let frontier = [start];
    while (frontier.length > 0) {
      const next: number[] = [];
      for (const id of frontier) {
        component.push(id);
        for (const neighborId of graph.cells[id].neighbors) {
          if (isLand[neighborId] || visited[neighborId]) continue;
          visited[neighborId] = true;
          next.push(neighborId);
        }
      }
      frontier = next;
    }
    components.push(component);
  }

  if (components.length === 0) return { waterBodyKind };

  let oceanIndex = 0;
  for (let i = 1; i < components.length; i++) {
    if (components[i].length > components[oceanIndex].length) oceanIndex = i;
  }

  components.forEach((component, i) => {
    const kind: WaterBodyKind = i === oceanIndex ? 'ocean' : 'lake';
    for (const id of component) waterBodyKind[id] = kind;
  });

  return { waterBodyKind };
}
