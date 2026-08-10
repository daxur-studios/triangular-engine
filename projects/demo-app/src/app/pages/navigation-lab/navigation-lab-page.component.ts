import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  applyNavigationGridChangeSet,
  createNavigationHeightfieldGrid,
  findNavigationGridRoute,
  simplifyNavigationGridRoute,
  calculateNavigationAvoidanceVelocity,
  createNavigationSpatialIndex,
  type NavigationAvoidanceObstacle,
  type NavigationVector3,
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

interface DemoAvoidanceAgent {
  readonly id: string;
  position: NavigationVector3;
  preferredVelocity: NavigationVector3;
  readonly radius: number;
  readonly maxSpeed: number;
  waypointIndex: number;
  direction: 1 | -1;
}

@Component({
  selector: 'app-navigation-lab-page',
  imports: [RouterLink],
  templateUrl: './navigation-lab-page.component.html',
  styleUrl: './navigation-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavigationLabPageComponent implements AfterViewInit, OnDestroy {
  @ViewChild('map', { static: true }) private readonly map!: ElementRef<HTMLCanvasElement>;

  readonly seed = signal(1);
  readonly view = signal<'flat' | 'terrain'>('terrain');
  readonly editingObstacles = signal(false);
  readonly showDiagnostics = signal(false);
  readonly avoidanceEnabled = signal(false);
  readonly avoidanceStrength = signal(1.4);
  readonly avoidanceSteps = signal(0);
  readonly routeStatus = signal<NavigationGridRouteResult['status']>('complete');
  readonly routeLength = signal(0);
  readonly expandedNodes = signal(0);

  private grid!: NavigationHeightfieldGrid;
  private route!: NavigationGridRouteResult;
  private avoidanceAgents: DemoAvoidanceAgent[] = [];
  private avoidanceObstacles: NavigationAvoidanceObstacle[] = [];
  private avoidanceFrame?: number;
  private lastAvoidanceTimestamp = 0;

  ngAfterViewInit(): void {
    this.rebuild();
  }

  ngOnDestroy(): void {
    if (this.avoidanceFrame !== undefined) cancelAnimationFrame(this.avoidanceFrame);
  }

  setView(view: 'flat' | 'terrain'): void {
    this.view.set(view);
    this.draw();
  }

  toggleObstacleEditing(): void {
    this.editingObstacles.update((value) => !value);
  }

  toggleDiagnostics(): void {
    this.showDiagnostics.update((value) => !value);
    this.draw();
  }

  toggleAvoidance(): void {
    this.avoidanceEnabled.update((value) => !value);
    if (this.avoidanceEnabled()) {
      this.resetAvoidanceSimulation();
      this.scheduleAvoidanceFrame();
    } else if (this.avoidanceFrame !== undefined) {
      cancelAnimationFrame(this.avoidanceFrame);
      this.avoidanceFrame = undefined;
      this.draw();
    }
  }

  setAvoidanceStrength(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) this.avoidanceStrength.set(value);
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
    if (this.avoidanceEnabled()) this.resetAvoidanceSimulation();
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
        context.fillStyle = this.showDiagnostics()
          ? this.diagnosticColor(column, row)
          : (cell.walkable ? this.terrainColor(cell.elevation) : '#29313b');
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
    if (this.avoidanceEnabled()) this.drawAvoidanceAgents(context, cellWidth, cellHeight, terrain);
  }

  private resetAvoidanceSimulation(): void {
    this.avoidanceAgents = [];
    this.avoidanceObstacles = [];
    this.lastAvoidanceTimestamp = 0;
    if (this.route.cells.length < 2) return;
    for (let index = 0; index < 8; index += 1) {
      const movingForward = index < 4;
      const offset = index % 4;
      const waypointIndex = movingForward
        ? Math.min(this.route.cells.length - 1, Math.floor((offset * this.route.cells.length) / 8))
        : Math.max(0, this.route.cells.length - 1 - Math.floor((offset * this.route.cells.length) / 8));
      this.avoidanceAgents.push({
        id: `demo-agent-${index}`,
        position: this.avoidancePosition(this.route.cells[waypointIndex]),
        preferredVelocity: { x: 0, y: 0, z: 0 },
        radius: 0.55,
        maxSpeed: 5,
        waypointIndex,
        direction: movingForward ? 1 : -1,
      });
    }
    this.grid.cells.forEach((cell, index) => {
      if (!cell.walkable) {
        const column = index % COLUMNS;
        const row = Math.floor(index / COLUMNS);
        this.avoidanceObstacles.push({
          id: `demo-obstacle-${index}`,
          position: { x: (column + 0.5) * CELL_SIZE, y: cell.elevation, z: (row + 0.5) * CELL_SIZE },
          radius: CELL_SIZE * 0.45,
        });
      }
    });
    this.avoidanceSteps.set(0);
  }

  private scheduleAvoidanceFrame(): void {
    this.avoidanceFrame = requestAnimationFrame((timestamp) => {
      this.updateAvoidance(timestamp);
      this.scheduleAvoidanceFrame();
    });
  }

  private updateAvoidance(timestamp: number): void {
    if (!this.avoidanceAgents.length) {
      this.draw();
      return;
    }
    const deltaSeconds = Math.min(0.05, this.lastAvoidanceTimestamp === 0 ? 0.016 : (timestamp - this.lastAvoidanceTimestamp) / 1000);
    this.lastAvoidanceTimestamp = timestamp;
    const index = createNavigationSpatialIndex({
      cellSize: CELL_SIZE * 2,
      agents: this.avoidanceAgents,
      obstacles: this.avoidanceObstacles,
    });
    for (const agent of this.avoidanceAgents) {
      const target = this.avoidancePosition(this.route.cells[agent.waypointIndex]);
      const dx = target.x - agent.position.x;
      const dz = target.z - agent.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 1.2) {
        const next = agent.waypointIndex + agent.direction;
        if (next < 0 || next >= this.route.cells.length) {
          agent.direction = agent.direction === 1 ? -1 : 1;
        } else {
          agent.waypointIndex = next;
        }
      }
      const nextTarget = this.avoidancePosition(this.route.cells[agent.waypointIndex]);
      const nextDx = nextTarget.x - agent.position.x;
      const nextDz = nextTarget.z - agent.position.z;
      const nextLength = Math.hypot(nextDx, nextDz) || 1;
      const preferredVelocity = { x: (nextDx / nextLength) * agent.maxSpeed, y: 0, z: (nextDz / nextLength) * agent.maxSpeed };
      const velocity = calculateNavigationAvoidanceVelocity({
        agent: { ...agent, preferredVelocity },
        nearbyAgents: index.queryAgents(agent.position, CELL_SIZE * 2.5),
        nearbyObstacles: index.queryObstacles(agent.position, CELL_SIZE * 1.5),
        separationWeight: this.avoidanceStrength(),
        obstacleWeight: 0.8,
      });
      agent.preferredVelocity = preferredVelocity;
      agent.position = {
        x: agent.position.x + velocity.x * deltaSeconds,
        y: agent.position.y,
        z: agent.position.z + velocity.z * deltaSeconds,
      };
    }
    this.avoidanceSteps.update((value) => value + 1);
    this.draw();
  }

  private drawAvoidanceAgents(context: CanvasRenderingContext2D, cellWidth: number, cellHeight: number, terrain: boolean): void {
    for (const agent of this.avoidanceAgents) {
      const column = agent.position.x / CELL_SIZE;
      const row = agent.position.z / CELL_SIZE;
      const x = column * cellWidth;
      const y = row * cellHeight + (terrain ? agent.position.y * 0.42 : 0);
      context.fillStyle = agent.direction === 1 ? '#f78c6b' : '#c792ea';
      context.beginPath();
      context.arc(x, y, 7, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#ffffffcc';
      context.lineWidth = 1;
      context.stroke();
    }
  }

  private avoidancePosition(cell: { column: number; row: number }): NavigationVector3 {
    const elevation = this.grid.cells[cell.row * COLUMNS + cell.column].elevation;
    return { x: (cell.column + 0.5) * CELL_SIZE, y: elevation, z: (cell.row + 0.5) * CELL_SIZE };
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

  private diagnosticColor(column: number, row: number): string {
    const cell = this.grid.cells[row * COLUMNS + column];
    if (!cell.walkable) return '#b94a48';
    if (cell.clearance < PROFILE.radius * 2) return '#9b59b6';
    if (!this.hasSlopeValidNeighbor(column, row)) return '#d88932';
    return '#4eaa68';
  }

  private hasSlopeValidNeighbor(column: number, row: number): boolean {
    const cell = this.grid.cells[row * COLUMNS + column];
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        if (columnOffset === 0 && rowOffset === 0) continue;
        const neighborColumn = column + columnOffset;
        const neighborRow = row + rowOffset;
        if (neighborColumn < 0 || neighborColumn >= COLUMNS || neighborRow < 0 || neighborRow >= ROWS) continue;
        const neighbor = this.grid.cells[neighborRow * COLUMNS + neighborColumn];
        if (!neighbor.walkable || neighbor.clearance < PROFILE.radius * 2) continue;
        const slope = Math.atan2(Math.abs(cell.elevation - neighbor.elevation), CELL_SIZE);
        if (slope <= PROFILE.maxSlopeRadians) return true;
      }
    }
    return false;
  }
}
