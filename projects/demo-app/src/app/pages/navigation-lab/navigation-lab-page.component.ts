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
  calculateNavigationVelocityObstacleVelocity,
  classifyNavigationAvoidanceState,
  createNavigationSpatialIndex,
  createNavigationQueueYieldStrategy,
  createNavigationAvoidanceScenarioSimulation,
  type NavigationAvoidanceObstacle,
  type NavigationAvoidanceState,
  type NavigationVector3,
  type NavigationGridCell,
  type NavigationGridCellAddress,
  type NavigationHeightfieldGrid,
  type NavigationGridRouteResult,
  type NavigationRecoveryStrategy,
  type NavigationAvoidanceScenarioMode,
  type NavigationAvoidanceScenarioSimulation,
  type NavigationAvoidanceScenarioSnapshot,
  type NavigationAvoidanceTraffic,
} from 'triangular-engine/navigation';

const COLUMNS = 24;
const ROWS = 16;
const CELL_SIZE = 4;
const INITIAL_RETREAT_CELLS = 6;
const MAX_RETREAT_CELLS = 9;
const START = { column: 1, row: 13 };
const GOAL = { column: 22, row: 2 };
const TUNNEL_START = { column: 1, row: 8 };
const TUNNEL_GOAL = { column: 22, row: 8 };
const PROFILE = {
  id: 'demo-rover',
  domains: ['ground'],
  radius: 0.5,
  height: 1,
  maxSlopeRadians: 0.8,
} as const;

interface DemoAvoidanceAgent {
  readonly id: string;
  readonly priority: number;
  position: NavigationVector3;
  preferredVelocity: NavigationVector3;
  readonly radius: number;
  readonly maxSpeed: number;
  waypointIndex: number;
  /** Stable journey intent on the shared A-to-B route. */
  journeyDirection: 1 | -1;
  /** Traversal direction for the currently active route representation. */
  direction: 1 | -1;
  state: NavigationAvoidanceState;
  noProgressSeconds: number;
  blockedSeconds: number;
  recoverySeconds: number;
  recoveryDirection: 1 | -1;
  routeCells: readonly NavigationGridCellAddress[];
  recoveryTarget?: NavigationVector3;
  recoveryCooldownSeconds: number;
  recoveryAttempts: number;
  previousVelocityX: number;
  previousVelocityZ: number;
  velocityReversals: number;
  queued: boolean;
  queueRetrySeconds: number;
  queueHoldingTarget?: NavigationVector3;
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
  @ViewChild('scenarioMap', { static: true }) private readonly scenarioMap!: ElementRef<HTMLCanvasElement>;

  readonly seed = signal(1);
  readonly view = signal<'flat' | 'terrain'>('terrain');
  readonly editingObstacles = signal(false);
  readonly showDiagnostics = signal(false);
  readonly avoidanceEnabled = signal(false);
  readonly avoidanceStrength = signal(1.4);
  readonly avoidanceMode = signal<'separation' | 'velocity-obstacle'>('separation');
  readonly avoidanceStrategy = signal<'baseline' | 'queue-yield'>('queue-yield');
  readonly avoidanceScenario = signal<'route' | 'corridor' | 'tunnel'>('route');
  readonly tunnelSetup = signal<'15-vs-1' | '1-vs-1' | '15-vs-15'>('15-vs-1');
  readonly tunnelPolicy = signal<'forward-wins' | 'reverse-wins' | 'minority-wins' | 'stable-priority'>('minority-wins');
  readonly avoidanceAgentCount = signal(8);
  readonly avoidanceSpeed = signal(1);
  readonly avoidanceSteps = signal(0);
  readonly avoidanceStateSummary = signal('moving 0 · yielding 0 · stuck 0 · local 0 · global 0');
  readonly avoidanceReplans = signal(0);
  readonly avoidanceCompactReport = signal('ui=idle');
  readonly routeStatus = signal<NavigationGridRouteResult['status']>('complete');
  readonly routeLength = signal(0);
  readonly expandedNodes = signal(0);
  readonly sharedScenarioTraffic = signal<NavigationAvoidanceTraffic>('opposing-with-staging');
  readonly sharedScenarioMode = signal<NavigationAvoidanceScenarioMode>('priority-yield');
  readonly sharedScenarioSeed = signal(42);
  readonly sharedScenarioPlaying = signal(false);
  readonly sharedScenarioSpeed = signal(1);
  readonly sharedScenarioSnapshot = signal<NavigationAvoidanceScenarioSnapshot | undefined>(undefined);
  readonly sharedScenarioReport = signal('ready');

  private grid!: NavigationHeightfieldGrid;
  private route!: NavigationGridRouteResult;
  private avoidanceAgents: DemoAvoidanceAgent[] = [];
  private avoidanceObstacles: NavigationAvoidanceObstacle[] = [];
  private avoidanceFrame?: number;
  private lastAvoidanceTimestamp = 0;
  private sharedScenario?: NavigationAvoidanceScenarioSimulation;
  private sharedScenarioFrame?: number;
  private sharedScenarioLastTimestamp = 0;
  private sharedScenarioAccumulator = 0;
  private readonly queueYieldStrategy: NavigationRecoveryStrategy = createNavigationQueueYieldStrategy();

  ngAfterViewInit(): void {
    this.rebuild();
    this.resetSharedScenario();
  }

  ngOnDestroy(): void {
    if (this.avoidanceFrame !== undefined) cancelAnimationFrame(this.avoidanceFrame);
    if (this.sharedScenarioFrame !== undefined) cancelAnimationFrame(this.sharedScenarioFrame);
  }

  setSharedScenarioTraffic(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'same-direction' || value === 'opposing' || value === 'opposing-with-staging') {
      this.sharedScenarioTraffic.set(value);
      this.resetSharedScenario();
    }
  }

  setSharedScenarioMode(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'baseline' || value === 'priority-yield') {
      this.sharedScenarioMode.set(value);
      this.resetSharedScenario();
    }
  }

  setSharedScenarioSeed(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isSafeInteger(value)) {
      this.sharedScenarioSeed.set(value);
      this.resetSharedScenario();
    }
  }

  setSharedScenarioSpeed(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) this.sharedScenarioSpeed.set(Math.max(0.25, Math.min(8, value)));
  }

  toggleSharedScenario(): void {
    this.sharedScenarioPlaying.update(value => !value);
    this.sharedScenarioLastTimestamp = 0;
    if (this.sharedScenarioPlaying()) this.scheduleSharedScenarioFrame();
  }

  stepSharedScenario(): void {
    if (!this.sharedScenario) this.resetSharedScenario();
    this.showSharedScenarioSnapshot(this.sharedScenario!.step());
  }

  resetSharedScenario(): void {
    this.sharedScenarioPlaying.set(false);
    if (this.sharedScenarioFrame !== undefined) cancelAnimationFrame(this.sharedScenarioFrame);
    this.sharedScenarioFrame = undefined;
    this.sharedScenarioAccumulator = 0;
    this.sharedScenarioLastTimestamp = 0;
    this.sharedScenario = createNavigationAvoidanceScenarioSimulation({
      mode: this.sharedScenarioMode(),
      traffic: this.sharedScenarioTraffic(),
      agentCount: 2,
      seed: this.sharedScenarioSeed(),
    });
    this.showSharedScenarioSnapshot(this.sharedScenario.snapshot());
  }

  private scheduleSharedScenarioFrame(): void {
    if (this.sharedScenarioFrame !== undefined || !this.sharedScenarioPlaying()) return;
    this.sharedScenarioFrame = requestAnimationFrame(timestamp => {
      this.sharedScenarioFrame = undefined;
      if (!this.sharedScenarioPlaying() || !this.sharedScenario) return;
      const elapsed = this.sharedScenarioLastTimestamp === 0
        ? 0
        : Math.min(0.1, (timestamp - this.sharedScenarioLastTimestamp) / 1000);
      this.sharedScenarioLastTimestamp = timestamp;
      this.sharedScenarioAccumulator += elapsed * this.sharedScenarioSpeed();
      let snapshot = this.sharedScenario.snapshot();
      while (this.sharedScenarioAccumulator >= 0.05 && !snapshot.finished) {
        snapshot = this.sharedScenario.step();
        this.sharedScenarioAccumulator -= 0.05;
      }
      this.showSharedScenarioSnapshot(snapshot);
      if (snapshot.finished) this.sharedScenarioPlaying.set(false);
      else this.scheduleSharedScenarioFrame();
    });
  }

  private showSharedScenarioSnapshot(snapshot: NavigationAvoidanceScenarioSnapshot): void {
    this.sharedScenarioSnapshot.set(snapshot);
    this.sharedScenarioReport.set(snapshot.result?.compactReport ?? `steps=${snapshot.steps} running`);
    this.drawSharedScenario(snapshot);
  }

  private drawSharedScenario(snapshot: NavigationAvoidanceScenarioSnapshot): void {
    const canvas = this.scenarioMap.nativeElement;
    const context = canvas.getContext('2d');
    if (!context) return;
    const worldX = (x: number) => 36 + ((x + 12) / 24) * (canvas.width - 72);
    const worldZ = (z: number) => canvas.height / 2 + z * 38;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#0b1822';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#263a32';
    context.fillRect(worldX(-12), worldZ(-0.65), worldX(12) - worldX(-12), worldZ(0.65) - worldZ(-0.65));
    context.fillStyle = '#324e43';
    context.fillRect(worldX(7.8), worldZ(0.65), worldX(10.2) - worldX(7.8), worldZ(2.25) - worldZ(0.65));
    context.fillStyle = '#8cdda1';
    context.fillRect(worldX(-12) - 3, worldZ(0) - 14, 6, 28);
    context.fillStyle = '#f4dc88';
    context.fillRect(worldX(12) - 3, worldZ(0) - 14, 6, 28);
    for (const agent of snapshot.agents) {
      context.globalAlpha = agent.completed ? 0.35 : 1;
      context.fillStyle = agent.journeyDirection === 1 ? '#f78c6b' : '#c792ea';
      context.beginPath();
      context.arc(worldX(agent.position.x), worldZ(agent.position.z), 10, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = agent.holding ? '#f4dc88' : '#ffffffcc';
      context.lineWidth = agent.holding ? 3 : 1;
      context.stroke();
    }
    context.globalAlpha = 1;
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

  setAvoidanceMode(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'separation' || value === 'velocity-obstacle') this.avoidanceMode.set(value);
    this.resetAvoidanceSimulation();
  }

  setAvoidanceStrategy(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'baseline' || value === 'queue-yield') this.avoidanceStrategy.set(value);
    this.resetAvoidanceSimulation();
  }

  setAvoidanceScenario(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'route' || value === 'corridor' || value === 'tunnel') {
      this.avoidanceScenario.set(value);
      this.rebuild();
    }
  }

  setTunnelSetup(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === '15-vs-1' || value === '1-vs-1' || value === '15-vs-15') this.tunnelSetup.set(value);
    this.resetAvoidanceSimulation();
  }

  setTunnelPolicy(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'forward-wins' || value === 'reverse-wins' || value === 'minority-wins' || value === 'stable-priority') {
      this.tunnelPolicy.set(value);
    }
    this.resetAvoidanceSimulation();
  }

  setAvoidanceAgentCount(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) {
      this.avoidanceAgentCount.set(Math.max(2, Math.min(16, Math.round(value))));
      this.resetAvoidanceSimulation();
    }
  }

  setAvoidanceSpeed(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) this.avoidanceSpeed.set(Math.max(0.25, Math.min(4, value)));
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
    const tunnel = this.avoidanceScenario() === 'tunnel';
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const elevation = tunnel ? 0 : this.heightAt(column, row);
        const blocked = tunnel
          ? (row !== TUNNEL_START.row || column < TUNNEL_START.column || column > TUNNEL_GOAL.column)
          : this.obstacleAt(column, row);
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
      start: this.activeStart(),
      goal: this.activeGoal(),
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
    this.drawMarker(context, this.activeStart(), cellWidth, cellHeight, '#7ee787', terrain);
    this.drawMarker(context, this.activeGoal(), cellWidth, cellHeight, '#ffcf70', terrain);
    if (this.avoidanceEnabled()) {
      this.drawAvoidanceObstacles(context, cellWidth, cellHeight, terrain);
      this.drawAvoidanceAgents(context, cellWidth, cellHeight, terrain);
    }
  }

  private resetAvoidanceSimulation(): void {
    this.avoidanceAgents = [];
    this.avoidanceObstacles = [];
    this.lastAvoidanceTimestamp = 0;
    if (this.route.cells.length < 2) return;
    const tunnelCounts = this.tunnelAgentCounts();
    const agentCount = tunnelCounts ? tunnelCounts.forward + tunnelCounts.reverse : this.avoidanceAgentCount();
    const agentsPerDirection = tunnelCounts?.forward ?? Math.ceil(agentCount / 2);
    for (let index = 0; index < agentCount; index += 1) {
      const movingForward = index < agentsPerDirection;
      const offset = movingForward ? index : index - agentsPerDirection;
      const waypointIndex = movingForward
        ? Math.min(this.route.cells.length - 1, Math.floor((offset * this.route.cells.length) / 8))
        : Math.max(0, this.route.cells.length - 1 - Math.floor((offset * this.route.cells.length) / 8));
      const tunnelPlacement = tunnelCounts
        ? this.tunnelInitialPlacement(offset, movingForward, tunnelCounts)
        : undefined;
      this.avoidanceAgents.push({
        id: `demo-agent-${index}`,
        priority: this.tunnelPriority(index, movingForward, tunnelCounts),
        position: tunnelPlacement?.position ?? this.avoidancePosition(this.route.cells[waypointIndex]),
        preferredVelocity: { x: 0, y: 0, z: 0 },
        radius: 0.55,
        maxSpeed: 5,
        waypointIndex: tunnelPlacement?.waypointIndex ?? waypointIndex,
        journeyDirection: movingForward ? 1 : -1,
        direction: movingForward ? 1 : -1,
        state: 'moving',
        noProgressSeconds: 0,
        blockedSeconds: 0,
        recoverySeconds: 0,
        recoveryDirection: movingForward ? -1 : 1,
        routeCells: this.route.cells,
        recoveryCooldownSeconds: 0,
        recoveryAttempts: 0,
        previousVelocityX: 0,
        previousVelocityZ: 0,
        velocityReversals: 0,
        queued: false,
        queueRetrySeconds: 0,
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
    if (this.avoidanceScenario() === 'corridor') this.addCongestionCorridor();
    this.avoidanceSteps.set(0);
    this.avoidanceReplans.set(0);
    this.updateAvoidanceStateSummary();
    this.updateAvoidanceCompactReport();
  }

  private addCongestionCorridor(): void {
    const middle = Math.floor(this.route.cells.length / 2);
    const center = this.avoidancePosition(this.route.cells[middle]);
    const before = this.avoidancePosition(this.route.cells[Math.max(0, middle - 1)]);
    const after = this.avoidancePosition(this.route.cells[Math.min(this.route.cells.length - 1, middle + 1)]);
    const length = Math.hypot(after.x - before.x, after.z - before.z) || 1;
    const normal = { x: -(after.z - before.z) / length, z: (after.x - before.x) / length };
    for (const point of [-1, 0, 1]) {
      const along = {
        x: center.x + (after.x - before.x) * point * 0.45,
        y: center.y,
        z: center.z + (after.z - before.z) * point * 0.45,
      };
      for (const side of [-1, 1]) {
        this.avoidanceObstacles.push({
          id: `demo-congestion-${point}-${side}`,
          position: {
            // Agent diameter is 1.1. Offset 2.1 leaves about 1.9 units
            // between obstacle edges: valid single-file clearance with room
            // for the avoidance safety margin, but not two agents abreast.
            x: along.x + normal.x * side * 2.1,
            y: along.y,
            z: along.z + normal.z * side * 2.1,
          },
          radius: 1.15,
        });
      }
    }
  }

  private activeStart(): NavigationGridCellAddress {
    return this.avoidanceScenario() === 'tunnel' ? TUNNEL_START : START;
  }

  private activeGoal(): NavigationGridCellAddress {
    return this.avoidanceScenario() === 'tunnel' ? TUNNEL_GOAL : GOAL;
  }

  private tunnelAgentCounts(): { readonly forward: number; readonly reverse: number } | undefined {
    if (this.avoidanceScenario() !== 'tunnel') return undefined;
    if (this.tunnelSetup() === '15-vs-1') return { forward: 15, reverse: 1 };
    if (this.tunnelSetup() === '1-vs-1') return { forward: 1, reverse: 1 };
    return { forward: 15, reverse: 15 };
  }

  private tunnelPriority(
    index: number,
    movingForward: boolean,
    counts: { readonly forward: number; readonly reverse: number } | undefined,
  ): number {
    if (!counts || this.tunnelPolicy() === 'stable-priority') return index;
    const minorityIsForward = counts.forward < counts.reverse;
    const minorityWins = movingForward === minorityIsForward;
    const winnerIsForward = this.tunnelPolicy() === 'forward-wins'
      || (this.tunnelPolicy() === 'minority-wins' && minorityWins);
    const winnerIsReverse = this.tunnelPolicy() === 'reverse-wins'
      || (this.tunnelPolicy() === 'minority-wins' && !minorityWins);
    if ((winnerIsForward && movingForward) || (winnerIsReverse && !movingForward)) return 0;
    return index + 1;
  }

  private tunnelInitialPlacement(
    offset: number,
    movingForward: boolean,
    counts: { readonly forward: number; readonly reverse: number },
  ): { readonly position: NavigationVector3; readonly waypointIndex: number } {
    const middle = Math.floor(this.route.cells.length / 2);
    const sideCount = movingForward ? counts.forward : counts.reverse;
    const sideOffset = movingForward ? sideCount - 1 - offset : offset;
    const distance = 2.2 + sideOffset * 1.35;
    return this.routePointFromIndex(middle, movingForward ? -1 : 1, distance);
  }

  private routePointFromIndex(
    startIndex: number,
    direction: 1 | -1,
    distance: number,
  ): { readonly position: NavigationVector3; readonly waypointIndex: number } {
    let index = startIndex;
    let remaining = distance;
    while (remaining > 0 && index + direction >= 0 && index + direction < this.route.cells.length) {
      const current = this.avoidancePosition(this.route.cells[index]);
      const nextIndex = index + direction;
      const next = this.avoidancePosition(this.route.cells[nextIndex]);
      const segment = Math.hypot(next.x - current.x, next.z - current.z);
      if (segment >= remaining) {
        const ratio = remaining / (segment || 1);
        return {
          position: {
            x: current.x + (next.x - current.x) * ratio,
            y: current.y + (next.y - current.y) * ratio,
            z: current.z + (next.z - current.z) * ratio,
          },
          waypointIndex: index,
        };
      }
      remaining -= segment;
      index = nextIndex;
    }
    return { position: this.avoidancePosition(this.route.cells[index]), waypointIndex: index };
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
    const baseDeltaSeconds = this.lastAvoidanceTimestamp === 0 ? 0.016 : (timestamp - this.lastAvoidanceTimestamp) / 1000;
    const deltaSeconds = Math.min(0.2, baseDeltaSeconds * this.avoidanceSpeed());
    this.lastAvoidanceTimestamp = timestamp;
    const index = createNavigationSpatialIndex({
      cellSize: CELL_SIZE * 2,
      agents: this.avoidanceAgents,
      obstacles: this.avoidanceObstacles,
    });
    for (const agent of this.avoidanceAgents) {
      const wasRecovering = agent.recoverySeconds > 0;
      agent.recoverySeconds = Math.max(0, agent.recoverySeconds - deltaSeconds);
      agent.recoveryCooldownSeconds = Math.max(0, agent.recoveryCooldownSeconds - deltaSeconds);
      agent.queueRetrySeconds = Math.max(0, agent.queueRetrySeconds - deltaSeconds);
      if (wasRecovering && agent.recoverySeconds === 0) agent.recoveryTarget = undefined;
      const targetIndex = agent.recoverySeconds > 0
        ? Math.max(0, Math.min(agent.routeCells.length - 1, agent.waypointIndex + agent.recoveryDirection))
        : agent.waypointIndex;
      const target = agent.recoveryTarget ?? this.avoidancePosition(agent.routeCells[targetIndex]);
      const dx = target.x - agent.position.x;
      const dz = target.z - agent.position.z;
      const distance = Math.hypot(dx, dz);
      if (agent.recoverySeconds <= 0 && !agent.queued && distance < 1.2) {
        const next = agent.waypointIndex + agent.direction;
        if (next < 0 || next >= agent.routeCells.length) {
          if (agent.routeCells !== this.route.cells) {
            agent.routeCells = this.route.cells;
            agent.waypointIndex = this.closestRouteIndex(agent.position);
            agent.direction = agent.journeyDirection;
          } else {
            agent.journeyDirection = agent.journeyDirection === 1 ? -1 : 1;
            agent.direction = agent.journeyDirection;
          }
        } else {
          agent.waypointIndex = next;
        }
      }
      const nextTarget = this.avoidancePosition(
        agent.routeCells[agent.recoverySeconds > 0 ? targetIndex : agent.waypointIndex],
      );
      let steeringTarget = agent.recoveryTarget ?? nextTarget;
      let nextDx = steeringTarget.x - agent.position.x;
      let nextDz = steeringTarget.z - agent.position.z;
      let nextLength = Math.hypot(nextDx, nextDz) || 1;
      let preferredVelocity = { x: (nextDx / nextLength) * agent.maxSpeed, y: 0, z: (nextDz / nextLength) * agent.maxSpeed };
      const nearbyAgents = index.queryAgents(agent.position, CELL_SIZE * 2.5);
      const nearbyObstacles = index.queryObstacles(agent.position, CELL_SIZE * 1.5);
      const strategyDecision = this.avoidanceStrategy() === 'queue-yield'
        ? this.queueYieldStrategy.decide({
            agentId: agent.id,
            priority: agent.priority,
            routeStatus: this.route.status,
            progressDistance: 0,
            noProgressSeconds: agent.noProgressSeconds,
            blockedSeconds: agent.blockedSeconds,
            retryCount: agent.recoveryAttempts,
            hasBlockingAgent: this.hasBlockingAgent(agent, nearbyAgents),
            hasRightOfWay: !this.hasBlockingAgent(agent, nearbyAgents),
            canWait: true,
            canYield: true,
          })
        : undefined;
      const shouldQueue = agent.recoverySeconds <= 0 && (
        agent.queued && agent.queueRetrySeconds > 0
        || strategyDecision?.action === 'wait'
        || strategyDecision?.action === 'yield'
      );
      if (strategyDecision?.action === 'wait' || strategyDecision?.action === 'yield') {
        agent.queued = true;
        agent.queueRetrySeconds = Math.max(agent.queueRetrySeconds, strategyDecision.retryAfterSeconds ?? 0.5);
        agent.queueHoldingTarget ??= this.findQueueHoldingTarget(agent, nearbyAgents);
      } else if (strategyDecision?.action === 'continue') {
        agent.queued = false;
        agent.queueHoldingTarget = undefined;
      }
      if (agent.queued) {
        steeringTarget = agent.queueHoldingTarget ?? agent.position;
        nextDx = steeringTarget.x - agent.position.x;
        nextDz = steeringTarget.z - agent.position.z;
        nextLength = Math.hypot(nextDx, nextDz);
        preferredVelocity = nextLength > 0.8
          ? { x: (nextDx / nextLength) * agent.maxSpeed * 0.8, y: 0, z: (nextDz / nextLength) * agent.maxSpeed * 0.8 }
          : { x: 0, y: 0, z: 0 };
      }
      const shouldYield = shouldQueue || (this.avoidanceStrategy() === 'baseline'
        && agent.recoverySeconds <= 0
        && this.shouldYieldToPriority(agent, nearbyAgents));
      if (shouldYield && !agent.queued) preferredVelocity = { x: 0, y: 0, z: 0 };
      const avoidanceRequest = {
        agent: { ...agent, preferredVelocity },
        nearbyAgents,
        nearbyObstacles,
        separationWeight: this.avoidanceStrength(),
        obstacleWeight: 0.8,
      };
      const velocity = this.avoidanceMode() === 'velocity-obstacle'
        ? calculateNavigationVelocityObstacleVelocity({
            agent: avoidanceRequest.agent,
            nearbyAgents: avoidanceRequest.nearbyAgents,
            nearbyObstacles: avoidanceRequest.nearbyObstacles,
            horizonSeconds: 0.8,
            directionSamples: 16,
          })
        : calculateNavigationAvoidanceVelocity(avoidanceRequest);
      agent.preferredVelocity = preferredVelocity;
      const previousDistance = Math.hypot(
        steeringTarget.x - agent.position.x,
        steeringTarget.z - agent.position.z,
      );
      agent.position = {
        x: agent.position.x + velocity.x * deltaSeconds,
        y: agent.position.y,
        z: agent.position.z + velocity.z * deltaSeconds,
      };
      const currentDistance = Math.hypot(
        steeringTarget.x - agent.position.x,
        steeringTarget.z - agent.position.z,
      );
      const progressDistance = previousDistance - currentDistance;
      const actualSpeed = Math.hypot(velocity.x, velocity.z);
      if (actualSpeed > 0.05 && Math.hypot(agent.previousVelocityX, agent.previousVelocityZ) > 0.05
        && (velocity.x * agent.previousVelocityX + velocity.z * agent.previousVelocityZ) < 0) {
        agent.velocityReversals += 1;
      }
      agent.previousVelocityX = velocity.x;
      agent.previousVelocityZ = velocity.z;
      agent.noProgressSeconds = progressDistance > 0.01
        ? 0
        : agent.noProgressSeconds + deltaSeconds;
      agent.blockedSeconds = actualSpeed < agent.maxSpeed * 0.35
        ? agent.blockedSeconds + deltaSeconds
        : Math.max(0, agent.blockedSeconds - deltaSeconds * 2);
      agent.state = shouldYield ? 'yielding' : classifyNavigationAvoidanceState({
        preferredSpeed: Math.hypot(preferredVelocity.x, preferredVelocity.z),
        actualSpeed,
        progressDistance: Math.max(0, progressDistance),
        noProgressSeconds: agent.noProgressSeconds,
        blockedSeconds: agent.blockedSeconds,
      });
      if (agent.state === 'replan-local' && agent.recoveryCooldownSeconds === 0) {
        this.replanAvoidanceAgent(agent, false);
      } else if (agent.state === 'replan-global' && agent.recoveryCooldownSeconds === 0) {
        this.replanAvoidanceAgent(agent, true);
      }
    }
    this.avoidanceSteps.update((value) => value + 1);
    this.updateAvoidanceStateSummary();
    this.updateAvoidanceCompactReport();
    this.draw();
  }

  private replanAvoidanceAgent(agent: DemoAvoidanceAgent, global: boolean): void {
    agent.recoveryAttempts = Math.min(3, agent.recoveryAttempts + 1);
    agent.recoveryCooldownSeconds = Math.min(3, 0.75 * (2 ** (agent.recoveryAttempts - 1)));
    if (global) {
      agent.routeCells = this.route.cells;
      agent.recoveryTarget = undefined;
      let closestIndex = agent.waypointIndex;
      let closestDistance = Number.POSITIVE_INFINITY;
      this.route.cells.forEach((cell, index) => {
        const point = this.avoidancePosition(cell);
        const distance = Math.hypot(point.x - agent.position.x, point.z - agent.position.z);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });
      agent.waypointIndex = closestIndex;
    } else {
      const repairedRoute = this.createAvoidanceRepairRoute(agent);
      if (repairedRoute.length > 1) {
        agent.routeCells = repairedRoute;
        agent.waypointIndex = 0;
        agent.direction = 1;
        agent.recoveryTarget = undefined;
        agent.recoverySeconds = 0;
        agent.recoveryAttempts = 0;
      } else {
        // Escalate the escape radius on repeated failures. This may move
        // sideways into a free cell, rather than repeatedly reversing on the
        // same route segment.
        agent.routeCells = this.route.cells;
        agent.waypointIndex = this.closestRouteIndex(agent.position);
        agent.recoveryDirection = agent.direction === 1 ? -1 : 1;
        agent.recoveryTarget = this.findRecoveryEscapeTarget(agent);
        agent.recoverySeconds = agent.recoveryTarget ? 1.1 + agent.recoveryAttempts * 0.35 : 0;
      }
    }
    agent.noProgressSeconds = 0;
    agent.blockedSeconds = 0;
    agent.state = 'moving';
    this.avoidanceReplans.update((value) => value + 1);
  }

  private shouldYieldToPriority(
    agent: DemoAvoidanceAgent,
    nearbyAgents: readonly { readonly id: string; readonly position: NavigationVector3 }[],
  ): boolean {
    return nearbyAgents.some((other) => {
      const candidate = this.avoidanceAgents.find((item) => item.id === other.id);
      return candidate !== undefined
        && candidate.id !== agent.id
        && candidate.priority < agent.priority
        && Math.hypot(other.position.x - agent.position.x, other.position.z - agent.position.z) < CELL_SIZE * 1.8
        && (candidate.noProgressSeconds > 0.2 || agent.recoveryAttempts > 0);
    });
  }

  private hasBlockingAgent(
    agent: DemoAvoidanceAgent,
    nearbyAgents: readonly { readonly id: string; readonly position: NavigationVector3 }[],
  ): boolean {
    return nearbyAgents.some((other) => {
      const candidate = this.avoidanceAgents.find((item) => item.id === other.id);
      return candidate !== undefined
        && candidate.id !== agent.id
        && candidate.priority < agent.priority
        && Math.hypot(other.position.x - agent.position.x, other.position.z - agent.position.z) < CELL_SIZE * 1.8
        && (candidate.journeyDirection !== agent.journeyDirection || candidate.noProgressSeconds > 0.2);
    });
  }

  private findQueueHoldingTarget(
    agent: DemoAvoidanceAgent,
    nearbyAgents: readonly { readonly id: string; readonly position: NavigationVector3 }[],
  ): NavigationVector3 | undefined {
    const blocker = nearbyAgents
      .map((other) => this.avoidanceAgents.find((candidate) => candidate.id === other.id))
      .filter((candidate): candidate is DemoAvoidanceAgent => candidate !== undefined)
      .filter((candidate) => candidate.id !== agent.id && candidate.priority < agent.priority)
      .sort((left, right) => left.priority - right.priority)[0];
    if (!blocker) return undefined;
    const blockerIndex = this.closestRouteIndex(blocker.position);
    const offset = Math.min(
      MAX_RETREAT_CELLS,
      INITIAL_RETREAT_CELLS + agent.recoveryAttempts,
    );
    const step = agent.journeyDirection === 1 ? -1 : 1;
    for (let distance = offset; distance <= offset + 5; distance += 1) {
      const targetIndex = blockerIndex + step * distance;
      if (targetIndex < 0 || targetIndex >= agent.routeCells.length) continue;
      const point = this.avoidancePosition(agent.routeCells[targetIndex]);
      if (!this.isAvoidanceCellOccupied(point, agent)) return point;
    }
    // A short/simplified route may not contain enough cells behind the
    // blocker. Never turn a yield into a permanent zero-velocity state:
    // retreat in world space, away from the blocker, and take the farthest
    // free point that the local corridor allows.
    const awayX = agent.position.x - blocker.position.x;
    const awayZ = agent.position.z - blocker.position.z;
    const awayLength = Math.hypot(awayX, awayZ) || 1;
    for (let distance = MAX_RETREAT_CELLS; distance >= 1; distance -= 1) {
      const point = {
        x: agent.position.x + (awayX / awayLength) * CELL_SIZE * distance,
        y: agent.position.y,
        z: agent.position.z + (awayZ / awayLength) * CELL_SIZE * distance,
      };
      if (point.x < 0 || point.x > COLUMNS * CELL_SIZE || point.z < 0 || point.z > ROWS * CELL_SIZE) continue;
      if (!this.isAvoidanceCellOccupied(point, agent)) return point;
    }
    return undefined;
  }

  private findRecoveryEscapeTarget(agent: DemoAvoidanceAgent): NavigationVector3 | undefined {
    const origin = this.cellAddressAt(agent.position);
    const radius = Math.min(MAX_RETREAT_CELLS, INITIAL_RETREAT_CELLS + agent.recoveryAttempts);
    let best: NavigationVector3 | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let row = Math.max(0, origin.row - radius); row <= Math.min(ROWS - 1, origin.row + radius); row += 1) {
      for (let column = Math.max(0, origin.column - radius); column <= Math.min(COLUMNS - 1, origin.column + radius); column += 1) {
        const cell = this.grid.cells[row * COLUMNS + column];
        if (!cell.walkable || (column === origin.column && row === origin.row)) continue;
        const point = this.avoidancePosition({ column, row });
        if (this.isAvoidanceCellOccupied(point, agent)) continue;
        const distance = Math.hypot(point.x - agent.position.x, point.z - agent.position.z);
        const clearance = Math.min(
          ...this.avoidanceObstacles.map((obstacle) => Math.hypot(point.x - obstacle.position.x, point.z - obstacle.position.z) - obstacle.radius),
          ...this.avoidanceAgents.filter((other) => other.id !== agent.id)
            .map((other) => Math.hypot(point.x - other.position.x, point.z - other.position.z) - other.radius),
          CELL_SIZE * 2,
        );
        const score = clearance + distance * 0.2;
        if (score > bestScore) {
          best = point;
          bestScore = score;
        }
      }
    }
    return best;
  }

  private isAvoidanceCellOccupied(point: NavigationVector3, agent: DemoAvoidanceAgent): boolean {
    return this.avoidanceObstacles.some((obstacle) => {
      return Math.hypot(point.x - obstacle.position.x, point.z - obstacle.position.z) < obstacle.radius + agent.radius + 0.2;
    }) || this.avoidanceAgents.some((other) => other.id !== agent.id && Math.hypot(
      point.x - other.position.x, point.z - other.position.z,
    ) < agent.radius + other.radius + 0.2);
  }

  private createAvoidanceRepairRoute(agent: DemoAvoidanceAgent): readonly NavigationGridCellAddress[] {
    const start = this.cellAddressAt(agent.position);
    const goal = agent.journeyDirection === 1
      ? this.route.cells[this.route.cells.length - 1]
      : this.route.cells[0];
    const cells = this.grid.cells.map((cell, index) => {
      const column = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      const address = { column, row };
      if (!cell.walkable || (column === start.column && row === start.row)
        || (column === goal.column && row === goal.row)) return cell;
      const point = this.avoidancePosition(address);
      const occupied = this.avoidanceObstacles.some((obstacle) => {
        return Math.hypot(point.x - obstacle.position.x, point.z - obstacle.position.z)
          < obstacle.radius + agent.radius;
      }) || this.avoidanceAgents.some((other) => other.id !== agent.id && Math.hypot(
        point.x - other.position.x, point.z - other.position.z,
      ) < agent.radius + other.radius);
      return occupied ? { ...cell, walkable: false, clearance: 0 } : cell;
    });
    const repairGrid = createNavigationHeightfieldGrid({
      frameId: `${this.grid.frameId}-avoidance-repair`,
      version: this.grid.version + 1,
      origin: this.grid.origin,
      cellSize: this.grid.cellSize,
      columns: this.grid.columns,
      rows: this.grid.rows,
      cells,
    });
    const result = findNavigationGridRoute({
      grid: repairGrid,
      start,
      goal,
      profile: PROFILE,
      maximumExpandedNodes: 160,
      allowPartial: false,
    });
    return result.status === 'complete' ? simplifyNavigationGridRoute(result).cells : [];
  }

  private closestRouteIndex(position: NavigationVector3): number {
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    this.route.cells.forEach((cell, index) => {
      const point = this.avoidancePosition(cell);
      const distance = Math.hypot(point.x - position.x, point.z - position.z);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    return closestIndex;
  }

  private cellAddressAt(position: NavigationVector3): NavigationGridCellAddress {
    return {
      column: Math.max(0, Math.min(COLUMNS - 1, Math.floor(position.x / CELL_SIZE))),
      row: Math.max(0, Math.min(ROWS - 1, Math.floor(position.z / CELL_SIZE))),
    };
  }

  private updateAvoidanceStateSummary(): void {
    const counts: Record<NavigationAvoidanceState, number> = {
      moving: 0,
      yielding: 0,
      stuck: 0,
      'replan-local': 0,
      'replan-global': 0,
    };
    let queued = 0;
    for (const agent of this.avoidanceAgents) {
      counts[agent.state] += 1;
      if (agent.queued) queued += 1;
    }
    this.avoidanceStateSummary.set(
      `moving ${counts.moving} · yielding ${counts.yielding} · queued ${queued} · stuck ${counts.stuck} · local ${counts['replan-local']} · global ${counts['replan-global']}`,
    );
  }

  private updateAvoidanceCompactReport(): void {
    if (!this.avoidanceAgents.length) {
      this.avoidanceCompactReport.set('ui=idle');
      return;
    }
    const stationary = this.avoidanceAgents.filter((agent) => {
      return Math.hypot(agent.preferredVelocity.x, agent.preferredVelocity.z) < 0.05;
    }).length;
    const moving = this.avoidanceAgents.length - stationary;
    const blocked = this.avoidanceAgents.filter((agent) => agent.blockedSeconds >= 6).length;
    const maxOverlap = this.measureAvoidanceOverlap();
    const reversals = this.avoidanceAgents.reduce((total, agent) => total + agent.velocityReversals, 0);
    const failures = [
      ...(stationary === this.avoidanceAgents.length ? ['all-stationary'] : []),
      ...(blocked > 0 ? ['blocked'] : []),
      ...(maxOverlap > 0.01 ? ['overlap'] : []),
    ];
    this.avoidanceCompactReport.set(
      `ui=${this.avoidanceStrategy()} seed=${this.seed()} agents=${this.avoidanceAgents.length} steps=${this.avoidanceSteps()} completed=na blocked=${blocked} stationary=${stationary} moving=${moving} overlap=${maxOverlap.toFixed(2)} reversals=${reversals} failures=${failures.join(',') || 'none'}`,
    );
  }

  private measureAvoidanceOverlap(): number {
    let maximum = 0;
    for (let left = 0; left < this.avoidanceAgents.length; left += 1) {
      for (let right = left + 1; right < this.avoidanceAgents.length; right += 1) {
        const first = this.avoidanceAgents[left];
        const second = this.avoidanceAgents[right];
        const distance = Math.hypot(first.position.x - second.position.x, first.position.z - second.position.z);
        maximum = Math.max(maximum, first.radius + second.radius - distance);
      }
    }
    return maximum;
  }

  private drawAvoidanceAgents(context: CanvasRenderingContext2D, cellWidth: number, cellHeight: number, terrain: boolean): void {
    for (const agent of this.avoidanceAgents) {
      const column = agent.position.x / CELL_SIZE;
      const row = agent.position.z / CELL_SIZE;
      const x = column * cellWidth;
      const y = row * cellHeight + (terrain ? agent.position.y * 0.42 : 0);
      context.fillStyle = agent.journeyDirection === 1 ? '#f78c6b' : '#c792ea';
      context.beginPath();
      context.arc(x, y, 7, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#ffffffcc';
      context.lineWidth = 1;
      context.stroke();
    }
  }

  private drawAvoidanceObstacles(context: CanvasRenderingContext2D, cellWidth: number, cellHeight: number, terrain: boolean): void {
    for (const obstacle of this.avoidanceObstacles) {
      if (!obstacle.id.startsWith('demo-congestion-')) continue;
      const x = (obstacle.position.x / CELL_SIZE) * cellWidth;
      const y = (obstacle.position.z / CELL_SIZE) * cellHeight
        + (terrain ? obstacle.position.y * 0.42 : 0);
      const radius = (obstacle.radius / CELL_SIZE) * Math.min(cellWidth, cellHeight);
      context.fillStyle = '#e5a642aa';
      context.strokeStyle = '#ffd166';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
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
    const start = this.activeStart();
    const goal = this.activeGoal();
    return (column === start.column && row === start.row) || (column === goal.column && row === goal.row);
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
