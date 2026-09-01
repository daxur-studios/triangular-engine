import { ChangeDetectionStrategy, Component, computed, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EngineModule, EngineService } from 'triangular-engine';
import { WorldProfileKind } from 'triangular-engine/worldgen';
import { CellPlanetMapComponent, ICellClickEvent, Season } from 'triangular-engine/worldgen/render';

/** Half-extent (world units, = texture pixels at zoom 1) of `<cellPlanetMap>`'s fixed
 * `BASE_WIDTH`/`BASE_HEIGHT` map plane - must match the component's own internal constants (not
 * exported, since they're an implementation detail) so the ortho camera's frustum exactly frames
 * the map at zoom 1. */
const MAP_HALF_WIDTH = 1500;
const MAP_HALF_HEIGHT = 750;

/**
 * Thin wrapper around `<cellPlanetMap>` (`triangular-engine/worldgen/render`) - this page owns
 * only the UI chrome (sliders/buttons/stats) and forwards viewport pointer/wheel events to the
 * component's public interaction methods; all generation/rendering/pan-zoom/click-to-cell/
 * highlight logic lives in the component itself. Mirrors the position `cell-planet-lab` should
 * be in relative to `<planetView>` (see the component's own doc comment).
 */
@Component({
  selector: 'app-cell-planet-map-page',
  imports: [RouterLink, EngineModule, CellPlanetMapComponent],
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
  readonly showIcons = signal(true);
  readonly showRivers = signal(true);
  readonly showCellEdges = signal(false);
  readonly iconBudget = signal(1400);

  readonly climateExtreme = signal(0);
  readonly season = signal<Season>('summer');
  readonly seasons: Season[] = ['winter', 'spring', 'summer', 'autumn'];
  readonly waterLevel = signal(0);

  readonly worldProfileKinds: WorldProfileKind[] = ['terran', 'moon', 'volcanic', 'protoplanet'];

  /** Demo of the component's click-to-cell + highlight capabilities together: clicking a cell
   * selects it, which highlights it via `[highlightedCellIds]`. */
  readonly selectedCellId = signal<number | null>(null);
  readonly highlightedCellIds = computed<number[]>(() => {
    const id = this.selectedCellId();
    return id === null ? [] : [id];
  });

  randomizeSeed(): void {
    this.seed.set(Math.floor(Math.random() * 1_000_000));
  }

  onSeasonChange(season: Season): void {
    this.season.set(season);
  }

  onCellClick(event: ICellClickEvent): void {
    this.selectedCellId.set(event.cellId);
  }

  resetView(): void {
    this.map()?.resetView();
  }

  resetProjectionCenter(): void {
    this.map()?.resetProjectionCenter();
  }
}
