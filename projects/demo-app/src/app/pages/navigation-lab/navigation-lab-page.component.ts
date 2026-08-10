import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  applyNavigationGridChangeSet,
  createNavigationHeightfieldGrid,
  findNavigationGridRoute,
  simplifyNavigationGridRoute,
  type NavigationGridCell,
  type NavigationHeightfieldGrid,
  type NavigationGridRouteResult,
} from 'triangular-engine/navigation';

const COLUMNS = 24;
const ROWS = 16;
const CELL_SIZE = 4;
const START = { column: 1, row: 13 };
const GOAL = { column: 22, row: 2 };
const PROFILE = {
  id: 'demo-rover',
  domains: ['ground'],
  radius: 0.5,
  height: 1,
  maxSlopeRadians: 0.8,
} as const;

@Component({
  selector: 'app-navigation-lab-page',
  imports: [RouterLink],
  templateUrl: './navigation-lab-page.component.html',
  styleUrl: './navigation-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavigationLabPageComponent implements AfterViewInit {
  @ViewChild('map', { static: true }) private readonly map!: ElementRef<HTMLCanvasElement>;

  readonly seed = signal(1);
  readonly view = signal<'flat' | 'terrain'>('terrain');
  readonly editingObstacles = signal(false);
  readonly routeStatus = signal<NavigationGridRouteResult['status']>('complete');
  readonly routeLength = signal(0);
  readonly expandedNodes = signal(0);

  private grid!: NavigationHeightfieldGrid;
  private route!: NavigationGridRouteResult;

  ngAfterViewInit(): void {
    this.rebuild();
  }

  setView(view: 'flat' | 'terrain'): void {
    this.view.set(view);
    this.draw();
  }

  toggleObstacleEditing(): void {
    this.editingObstacles.update((value) => !value);
  }

  nextSeed(): void {
    this.seed.update((value) => value + 1);
    this.rebuild();
  }

  resetSeed(): void {
    this.seed.set(1);
    this.rebuild();
  }

  onMapClick(event: MouseEvent): void {
    if (!this.editingObstacles()) return;
    const canvas = this.map.nativeElement;
    const bounds = canvas.getBoundingClientRect();
    const column = Math.floor(((event.clientX - bounds.left) / bounds.width) * COLUMNS);
    const row = Math.floor(((event.clientY - bounds.top) / bounds.height) * ROWS);
    if (column < 0 || column >= COLUMNS || row < 0 || row >= ROWS || this.isEndpoint(column, row)) return;
    const index = row * COLUMNS + column;
    const cell = this.grid.cells[index];
    const walkable = !cell.walkable;
    this.grid = applyNavigationGridChangeSet(this.grid, {
      baseVersion: this.grid.version,
      nextVersion: this.grid.version + 1,
      cells: [{
        address: { column, row },
        cell: {
          ...cell,
          walkable,
          clearance: walkable ? 2 : 0,
        },
      }],
    });
    this.calculateRoute();
  }

  private rebuild(): void {
    const cells: NavigationGridCell[] = [];
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const elevation = this.heightAt(column, row);
        const blocked = this.obstacleAt(column, row);
        cells.push({ walkable: !blocked, elevation, clearance: blocked ? 0 : 2, cost: 1 + elevation / 20 });
      }
    }
    this.grid = createNavigationHeightfieldGrid({
      frameId: 'navigation-demo-plane',
      origin: { x: 0, y: 0, z: 0 },
      cellSize: CELL_SIZE,
      columns: COLUMNS,
      rows: ROWS,
      cells,
    });
    this.calculateRoute();
  }

  private calculateRoute(): void {
    this.route = simplifyNavigationGridRoute(findNavigationGridRoute({
      grid: this.grid,
      start: START,
      goal: GOAL,
      profile: PROFILE,
      allowPartial: true,
    }));
    this.routeStatus.set(this.route.status);
    this.routeLength.set(this.route.cells.length);
    this.expandedNodes.set(this.route.expandedNodes);
    this.draw();
  }

  private draw(): void {
    if (!this.grid || !this.map) return;
    const canvas = this.map.nativeElement;
    const context = canvas.getContext('2d');
    if (!context) return;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    const cellWidth = width / COLUMNS;
    const cellHeight = height / ROWS;
    const terrain = this.view() === 'terrain';
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const cell = this.grid.cells[row * COLUMNS + column];
        const x = column * cellWidth;
        const y = row * cellHeight;
        const lift = terrain ? cell.elevation * 0.42 : 0;
        context.fillStyle = cell.walkable ? this.terrainColor(cell.elevation) : '#29313b';
        context.beginPath();
        context.moveTo(x, y + lift);
        context.lineTo(x + cellWidth, y + lift);
        context.lineTo(x + cellWidth, y + cellHeight + lift);
        context.lineTo(x, y + cellHeight + lift);
        context.fill();
        context.strokeStyle = '#ffffff16';
        context.stroke();
      }
    }
    this.drawRoute(context, cellWidth, cellHeight, terrain);
    this.drawMarker(context, START, cellWidth, cellHeight, '#7ee787', terrain);
    this.drawMarker(context, GOAL, cellWidth, cellHeight, '#ffcf70', terrain);
  }

  private drawRoute(context: CanvasRenderingContext2D, cellWidth: number, cellHeight: number, terrain: boolean): void {
    if (!this.route?.cells.length) return;
    context.strokeStyle = '#67b7ff';
    context.lineWidth = 4;
    context.beginPath();
    this.route.cells.forEach((cell, index) => {
      const elevation = this.grid.cells[cell.row * COLUMNS + cell.column].elevation;
      const x = (cell.column + 0.5) * cellWidth;
      const y = (cell.row + 0.5) * cellHeight + (terrain ? elevation * 0.42 : 0);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
  }

  private drawMarker(context: CanvasRenderingContext2D, cell: { column: number; row: number }, cellWidth: number, cellHeight: number, color: string, terrain: boolean): void {
    const elevation = this.grid.cells[cell.row * COLUMNS + cell.column].elevation;
    const x = (cell.column + 0.5) * cellWidth;
    const y = (cell.row + 0.5) * cellHeight + (terrain ? elevation * 0.42 : 0);
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, 7, 0, Math.PI * 2);
    context.fill();
  }

  private heightAt(column: number, row: number): number {
    const seed = this.seed();
    return Math.round((Math.sin((column + seed) * 0.7) + Math.cos((row - seed) * 0.55) + Math.sin((column + row) * 0.3)) * 4);
  }

  private obstacleAt(column: number, row: number): boolean {
    if (this.isEndpoint(column, row)) return false;
    const value = (column * 17 + row * 31 + this.seed() * 13) % 23;
    return value < 3 || (column === 11 && row > 3 && row < 13);
  }

  private isEndpoint(column: number, row: number): boolean {
    return (column === START.column && row === START.row) || (column === GOAL.column && row === GOAL.row);
  }

  private terrainColor(elevation: number): string {
    if (elevation < -4) return '#315f78';
    if (elevation > 4) return '#806f5b';
    return '#5f9856';
  }
}
