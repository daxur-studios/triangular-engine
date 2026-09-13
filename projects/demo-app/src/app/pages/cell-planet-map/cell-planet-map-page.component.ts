import { ChangeDetectionStrategy, Component, computed, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EngineModule, EngineService } from 'triangular-engine';
import { IVec3, WorldProfileKind } from 'triangular-engine/worldgen';
import {
  CellPlanetMapComponent,
  CellPlanetMapFillMode,
  CellPlanetMapUnitsComponent,
  ICellClickEvent,
  ICellPlanetMapUnitInstance,
  MAP_PROJECTION_KINDS,
  MAP_PROJECTION_LABELS,
  MapProjectionKind,
  Season,
} from 'triangular-engine/worldgen/render';

/** Half-extent (world units, = texture pixels at zoom 1) of `<cellPlanetMap>`'s fixed
 * `BASE_WIDTH`/`BASE_HEIGHT` map plane - must match the component's own internal constants (not
 * exported, since they're an implementation detail) so the ortho camera's frustum exactly frames
 * the map at zoom 1. */
const MAP_HALF_WIDTH = 1500;
const MAP_HALF_HEIGHT = 750;

const UNIT_COLORS = ['#ff6b6b', '#4dabf7', '#69db7c', '#ffd43b', '#da77f2', '#ff922b'];

/** Rejection-sampled uniform point on the unit sphere - demo-only, just to scatter spawned units
 * around; not part of any shared worldgen sampling utility. */
function randomSphereDirection(): IVec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  let lengthSq = 0;
  do {
    x = Math.random() * 2 - 1;
    y = Math.random() * 2 - 1;
    z = Math.random() * 2 - 1;
    lengthSq = x * x + y * y + z * z;
  } while (lengthSq === 0 || lengthSq > 1);
  const length = Math.sqrt(lengthSq);
  return { x: x / length, y: y / length, z: z / length };
}

/**
 * Thin wrapper around `<cellPlanetMap>` (`triangular-engine/worldgen/render`) - this page owns
 * only the UI chrome (sliders/buttons/stats) and forwards viewport pointer/wheel events to the
 * component's public interaction methods; all generation/rendering/pan-zoom/click-to-cell/
 * highlight logic lives in the component itself. Mirrors the position `cell-planet-lab` should
 * be in relative to `<planetView>` (see the component's own doc comment).
 */
@Component({
  selector: 'app-cell-planet-map-page',
  imports: [RouterLink, EngineModule, CellPlanetMapComponent, CellPlanetMapUnitsComponent],
  templateUrl: './cell-planet-map-page.component.html',
  styleUrl: './cell-planet-map-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({})],
  host: { class: 'flex-page' },
})
export class CellPlanetMapPageComponent {
  protected readonly mapHalfWidth = MAP_HALF_WIDTH;
  protected readonly mapHalfHeight = MAP_HALF_HEIGHT;

  readonly map = viewChild<CellPlanetMapComponent>('mapComp');

  readonly cellCount = signal(1500);
  readonly seed = signal(1);
  readonly worldProfileKind = signal<WorldProfileKind>('terran');
  readonly fillMode = signal<CellPlanetMapFillMode>('biome');
  readonly fillModes: CellPlanetMapFillMode[] = ['biome', 'elevation', 'plates', 'temperature', 'moisture', 'land'];
  readonly showIcons = signal(true);
  readonly showRivers = signal(true);
  readonly showRidges = signal(true);
  readonly showCellEdges = signal(false);
  readonly iconBudget = signal(1400);

  readonly climateExtreme = signal(0);
  readonly season = signal<Season>('summer');
  readonly seasons: Season[] = ['winter', 'spring', 'summer', 'autumn'];
  readonly waterLevel = signal(0);

  readonly worldProfileKinds: WorldProfileKind[] = ['terran', 'moon', 'volcanic', 'protoplanet'];

  readonly projectionType = signal<MapProjectionKind>('equirectangular');
  readonly projectionKinds = MAP_PROJECTION_KINDS;
  readonly projectionLabels = MAP_PROJECTION_LABELS;

  /** Demo of the component's click-to-cell + highlight capabilities together: clicking a cell
   * selects it, which highlights it via `[highlightedCellIds]`. */
  readonly selectedCellId = signal<number | null>(null);
  readonly highlightedCellIds = computed<number[]>(() => {
    const id = this.selectedCellId();
    return id === null ? [] : [id];
  });

  /** First-slice proof-out of `<cellPlanetMapUnits>`: "Spawn units" scatters a batch at random
   * sphere positions, then clicking any cell sends every current unit gliding toward it - reusing
   * the map's existing click-to-cell output, no new interaction plumbing needed. */
  readonly units = signal<ICellPlanetMapUnitInstance[]>([]);
  #nextUnitId = 0;

  randomizeSeed(): void {
    this.seed.set(Math.floor(Math.random() * 1_000_000));
  }

  onSeasonChange(season: Season): void {
    this.season.set(season);
  }

  onCellClick(event: ICellClickEvent): void {
    this.selectedCellId.set(event.cellId);
    this.units.update((current) => current.map((unit) => ({ ...unit, targetPosition: event.direction })));
  }

  spawnUnits(count = 50): void {
    const spawned: ICellPlanetMapUnitInstance[] = Array.from({ length: count }, () => ({
      id: `unit-${this.#nextUnitId++}`,
      position: randomSphereDirection(),
      color: UNIT_COLORS[Math.floor(Math.random() * UNIT_COLORS.length)],
    }));
    this.units.update((current) => [...current, ...spawned]);
  }

  clearUnits(): void {
    this.units.set([]);
  }

  resetView(): void {
    this.map()?.resetView();
  }

  resetProjectionCenter(): void {
    this.map()?.resetProjectionCenter();
  }
}
