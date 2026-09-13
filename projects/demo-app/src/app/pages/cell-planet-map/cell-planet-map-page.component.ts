import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { CellPlanetQuery, readCellPlanetQuery } from '../cell-planet-view-query';

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
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
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
  private readonly preservedQueryParams = signal<CellPlanetQuery>({});
  readonly comparisonQueryParams = computed(() => ({
    ...this.preservedQueryParams(),
    cellCount: this.cellCount(),
    seed: this.seed(),
    worldProfile: this.worldProfileKind(),
    projection: this.projectionType(),
    fillMode: this.fillMode(),
    climate: this.climateExtreme(),
    season: this.season(),
    waterLevel: this.waterLevel(),
    showIcons: this.showIcons(),
    showRivers: this.showRivers(),
    showRidges: this.showRidges(),
    showCellEdges: this.showCellEdges(),
    iconBudget: this.iconBudget(),
  }));

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

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const query = readCellPlanetQuery(params);
      this.preservedQueryParams.set(query);
      this.restoreQuery(query);
    });
  }

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

  private restoreQuery(query: CellPlanetQuery): void {
    const cellCount = this.numberQuery(query.cellCount);
    if (cellCount !== null) this.cellCount.set(Math.max(200, Math.min(6000, Math.round(cellCount))));
    const seed = this.numberQuery(query.seed);
    if (seed !== null) this.seed.set(Math.max(0, Math.min(999999, Math.round(seed))));
    if (query.worldProfile && this.worldProfileKinds.includes(query.worldProfile as WorldProfileKind)) {
      this.worldProfileKind.set(query.worldProfile as WorldProfileKind);
    }
    if (query.projection && this.projectionKinds.includes(query.projection as MapProjectionKind)) {
      this.projectionType.set(query.projection as MapProjectionKind);
    }
    if (query.fillMode && this.fillModes.includes(query.fillMode as CellPlanetMapFillMode)) {
      this.fillMode.set(query.fillMode as CellPlanetMapFillMode);
    }
    const climate = this.numberQuery(query.climate);
    if (climate !== null) this.climateExtreme.set(Math.max(-1, Math.min(1, climate)));
    if (query.season && this.seasons.includes(query.season as Season)) this.season.set(query.season as Season);
    const waterLevel = this.numberQuery(query.waterLevel);
    if (waterLevel !== null) this.waterLevel.set(Math.max(-1, Math.min(1, waterLevel)));
    this.showIcons.set(this.booleanQuery(query.showIcons, this.showIcons()));
    this.showRivers.set(this.booleanQuery(query.showRivers, this.showRivers()));
    this.showRidges.set(this.booleanQuery(query.showRidges, this.showRidges()));
    this.showCellEdges.set(this.booleanQuery(query.showCellEdges, this.showCellEdges()));
    const iconBudget = this.numberQuery(query.iconBudget);
    if (iconBudget !== null) this.iconBudget.set(Math.max(0, Math.min(4000, Math.round(iconBudget))));
  }

  private numberQuery(value: string | undefined): number | null {
    if (value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  private booleanQuery(value: string | undefined, fallback: boolean): boolean {
    return value === 'true' ? true : value === 'false' ? false : fallback;
  }
}
