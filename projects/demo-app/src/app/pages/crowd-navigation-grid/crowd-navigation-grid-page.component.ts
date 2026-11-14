import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DynamicDrawUsage,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  Raycaster,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  generateIslandHeightfield,
  NavAgentState,
  NavCrowd,
  NavFlag,
  NavGoalSet,
  NavGrid,
  NavSectorGraph,
  NavWorld,
  type NavEditResult,
  type NavRect,
  NAV_CLEARANCE_THRESHOLDS,
  type NavAbstractPath,
  type NavUnitClass,
} from 'triangular-engine/crowd-navigation';
import { fillOverlay, NAV_OVERLAYS, type NavOverlayId } from './nav-overlays';
import { buildFlowArrowVertices, drawFlowSectors } from './nav-flow-overlay';
import { drawSectorOverlay, NAV_CLASS_COLORS } from './nav-sector-overlay';

/** Villagers in the crowd scenario (Plan 086, phase sector-fields). */
const CROWD_SIZE = 1000;

/** Simulation speed multipliers offered by the crowd panel. */
const SIM_SPEEDS: readonly number[] = [1, 4, 16];

/** Edge length in cells of a building placed with the edit mode. */
const BUILDING_SIZE = 8;

/** What a click on the terrain does. */
export type CrowdEditMode = 'off' | 'place' | 'remove';

/** Cells along each side of the rendered demo island (1 m cells). */
const GRID_SIZE = 512;

/** The unit classes the sector overlay and corridor can be shown for. */
const UNIT_CLASSES: readonly NavUnitClass[] = ['villager', 'catapult', 'creature'];

/**
 * Plan 086, phases grid-layers, sectors-portals and sector-fields. Builds a {@link NavGrid} from a generated island, stamps a few
 * example buildings, a wall with a gap and a gate, a road and two territories, and draws any layer
 * as a data texture on the terrain mesh. The grid is 512 x 512 cells at 1 m (the 2,048 x 2,048
 * size is only built in the spec/benchmark). A wall runs across the whole island, so the 2-cell gap
 * (villagers only) and the 17-cell gate are its only crossings. The Sectors toggle draws the 64-cell
 * sector borders and the portals of the selected unit class; the corridor shows the abstract path
 * between two fixed points as highlighted sectors and rebuilds when the gate changes.
 *
 * Phase goals-edits adds the edit controls: a click places or removes an 8 x 8 building (a `NavWorld`
 * edit that rebuilds only the touched sectors and repairs cached fields lazily), the gate toggle goes
 * through the same API, and a goal preset sends the villagers to the nearest of four storehouses (a
 * multi-source `NavGoalSet`, removable one by one). The HUD shows the invalidations and rebuilds.
 *
 * The Crowd panel runs 1,000 villagers on the main thread (a worker comes in a later phase): the
 * `NavCrowd` simulation builds flow fields lazily in the corridor sectors only (tinted green), the
 * Flow arrows toggle draws the built field, and a double click on the terrain sets a new goal.
 */
@Component({
  selector: 'app-crowd-navigation-grid-page',
  imports: [EngineModule, RouterLink, DecimalPipe],
  templateUrl: './crowd-navigation-grid-page.component.html',
  styleUrl: './crowd-navigation-grid-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CrowdNavigationGridPageComponent {
  private readonly engine = inject(EngineService);

  readonly overlays = NAV_OVERLAYS;
  readonly overlay = signal<NavOverlayId>('terrain');
  readonly legend = computed(() => NAV_OVERLAYS.find((o) => o.id === this.overlay())?.legend ?? []);
  readonly gateOpen = signal(false);
  readonly unitClasses = UNIT_CLASSES;
  readonly unitClass = signal<NavUnitClass>('villager');
  readonly showSectors = signal(true);
  readonly showCorridor = signal(true);
  readonly sectorBuildMs = signal(0);
  readonly rebuildInfo = signal('');
  readonly portalCounts = signal<Record<NavUnitClass, number>>({ villager: 0, catapult: 0, creature: 0 });
  readonly corridorText = signal('');
  readonly classColors = NAV_CLASS_COLORS;
  readonly gridSize = GRID_SIZE;
  readonly buildMs = signal(0);
  readonly editMs = signal(0);
  readonly passable = signal<Record<NavUnitClass, number>>({ villager: 0, catapult: 0, creature: 0 });

  readonly crowdSize = CROWD_SIZE;
  readonly simSpeeds = SIM_SPEEDS;
  readonly simSpeed = signal(4);
  readonly crowdRunning = signal(false);
  readonly showFlow = signal(true);
  readonly goalPresets = signal<{ id: string; label: string }[]>([]);
  readonly editMode = signal<CrowdEditMode>('off');
  readonly editInfo = signal('');
  readonly multiGoal = signal(false);
  readonly storehouses = signal(0);
  readonly sourceArrivals = signal<number[]>([]);
  readonly editModes: readonly { id: CrowdEditMode; label: string }[] = [
    { id: 'off', label: 'Edit off' },
    { id: 'place', label: 'Place building' },
    { id: 'remove', label: 'Remove building' },
  ];
  readonly goalLabel = signal('');
  readonly crowdHud = signal({
    arrived: 0,
    moving: 0,
    waiting: 0,
    unreachable: 0,
    stepMs: 0,
    cachedFields: 0,
    invalidations: 0,
    displaced: 0,
    sectorsRebuilt: 0,
    edits: 0,
    builds: 0,
    lastBuildMs: 0,
    totalBuildMs: 0,
    simSeconds: 0,
  });

  private readonly grid: NavGrid;
  private sectors!: NavSectorGraph;
  private world!: NavWorld;
  private storehouseSet!: NavGoalSet;
  private storehouseCells: number[] = [];
  private readonly placed: { rect: NavRect; mesh: Mesh }[] = [];
  private readonly buildingGeometry = new BoxGeometry(BUILDING_SIZE, 5, BUILDING_SIZE);
  private readonly buildingMaterial = new MeshLambertMaterial({ color: '#c9a36b' });
  /** Nominal demo endpoints west and east of the wall (set by `stampExamples`). */
  private nominal = { start: { x: 0, y: 0 }, goal: { x: 0, y: 0 } };
  private readonly pixels = new Uint8Array(GRID_SIZE * GRID_SIZE * 4);
  private readonly texture: DataTexture;
  private readonly gate = { x: 0, y: 0, width: 2, height: 3 };

  private readonly crowd: NavCrowd;
  private crowdMesh!: InstancedMesh;
  private goalMarkers: Mesh[] = [];
  private terrainMesh!: Mesh;
  private flowLines: LineSegments | undefined;
  private flowKey = '';
  private spawnPoint = { x: 0, y: 0 };
  private readonly goalPoints = new Map<string, { x: number; y: number }>();
  private crowdGoalId = -1;
  private simSeconds = 0;
  private frameCount = 0;
  private readonly dummy = new Object3D();
  private readonly lastColored = new Uint8Array(CROWD_SIZE).fill(255);
  private readonly raycaster = new Raycaster();
  private readonly pointerNdc = new Vector2();
  private readonly pointerDown = new Vector2();
  private pointerWasDown = false;
  private lastClickAt = 0;
  private readonly colors = {
    moving: new Color('#ffb347'),
    arrived: new Color('#52e08a'),
    waiting: new Color('#c8d4e2'),
    stuck: new Color('#ff5d5d'),
  };

  constructor() {
    this.engine.scene.background = new Color('#0e1620');

    const t0 = performance.now();
    const heightfield = generateIslandHeightfield({
      size: GRID_SIZE,
      maxHeight: 45,
      featureSize: 170,
      seed: 7,
    });
    this.grid = NavGrid.fromHeightfield(heightfield);
    this.buildMs.set(Math.round(performance.now() - t0));
    this.stampExamples();
    const t1 = performance.now();
    this.sectors = NavSectorGraph.build(this.grid);
    this.sectorBuildMs.set(Math.round(performance.now() - t1));
    this.updatePortalCounts();
    this.world = new NavWorld(this.sectors);
    this.storehouseSet = new NavGoalSet(this.sectors);
    this.crowd = new NavCrowd(this.sectors, {
      capacity: CROWD_SIZE,
      seed: 11,
      maxBuildsPerStep: 6,
      maxSectorFields: 256,
    });

    this.texture = new DataTexture(this.pixels, GRID_SIZE, GRID_SIZE, RGBAFormat, UnsignedByteType);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.redraw();

    const mesh = new Mesh(
      this.createTerrainGeometry(),
      new MeshLambertMaterial({ map: this.texture }),
    );
    this.terrainMesh = mesh;
    this.engine.scene.add(mesh);
    this.createCrowdView();
    this.setupGoalPresets();
    this.resetCrowd();

    const destroyRef = inject(DestroyRef);
    this.engine.tick$.pipe(takeUntilDestroyed(destroyRef)).subscribe((dt) => this.update(dt));
    this.engine.mousedown$.pipe(takeUntilDestroyed(destroyRef)).subscribe((event) => {
      if (!event || event.button !== 0) return;
      this.pointerDown.set(event.clientX, event.clientY);
      this.pointerWasDown = true;
    });
    this.engine.mouseup$.pipe(takeUntilDestroyed(destroyRef)).subscribe((event) => {
      if (!event || event.button !== 0 || !this.pointerWasDown) return;
      this.pointerWasDown = false;
      if (Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y) > 5) return;
      // Two clicks within 350 ms set the goal; single clicks and drags orbit as usual.
      const t = performance.now();
      if (this.editMode() !== 'off') {
        this.editFromClick(event);
        return;
      }
      const double = t - this.lastClickAt < 350;
      this.lastClickAt = double ? 0 : t;
      if (double) this.setGoalFromClick(event);
    });
    destroyRef.onDestroy(() => {
      this.engine.scene.remove(mesh, this.crowdMesh, ...this.goalMarkers, ...this.placed.map((b) => b.mesh));
      this.buildingGeometry.dispose();
      this.buildingMaterial.dispose();
      if (this.flowLines) {
        this.engine.scene.remove(this.flowLines);
        this.flowLines.geometry.dispose();
        (this.flowLines.material as LineBasicMaterial).dispose();
      }
      mesh.geometry.dispose();
      (mesh.material as MeshLambertMaterial).dispose();
      this.crowdMesh.geometry.dispose();
      (this.crowdMesh.material as MeshLambertMaterial).dispose();
      this.crowdMesh.dispose();
      for (const m of this.goalMarkers) {
        m.geometry.dispose();
        (m.material as MeshBasicMaterial).dispose();
      }
      this.texture.dispose();
    });
  }

  toggleCrowdRunning(): void {
    this.crowdRunning.update((v) => !v);
  }

  setSimSpeed(speed: number): void {
    this.simSpeed.set(speed);
  }

  toggleFlow(): void {
    this.showFlow.update((v) => !v);
    this.flowKey = '';
    this.refreshFlow();
  }

  /** Respawns the villagers at the spawn area, stopped, heading for the current goal. */
  resetCrowd(): void {
    const crowd = this.crowd;
    crowd.clear();
    this.simSeconds = 0;
    if (this.crowdGoalId < 0) this.setGoal(this.goalPoints.get('east') ?? this.spawnPoint, 'East of the wall (via the gap)');
    else crowd.retarget(this.crowdGoalId);
    const sp = this.spawnPoint;
    crowd.spawnRandom(CROWD_SIZE, { x: sp.x - 16, y: sp.y - 16, width: 32, height: 32 }, this.crowdGoalId);
    this.lastColored.fill(255);
    this.crowdRunning.set(false);
    this.refreshFlow();
    this.updateCrowdView();
    this.publishHud();
  }

  selectGoal(id: string): void {
    if (id === 'storehouses') {
      this.selectStorehouses();
      return;
    }
    const p = this.goalPoints.get(id);
    if (!p) return;
    this.setGoal(p, this.goalPresets().find((g) => g.id === id)?.label ?? id);
  }

  setEditMode(mode: CrowdEditMode): void {
    this.editMode.set(mode);
  }

  /** Removes the first remaining storehouse (the last one stays). Only fields near it are rebuilt. */
  removeStorehouse(): void {
    const cells = this.storehouseCells.filter((c) => this.storehouseSet.hasCell(c));
    if (cells.length <= 1) return;
    const inv = this.crowd.cache.stats.invalidations;
    const w = this.grid.width;
    this.storehouseSet.removeCell(cells[0]);
    this.crowd.cache.sync();
    this.storehouses.set(this.storehouseSet.size);
    this.editInfo.set(
      `Storehouse (${cells[0] % w}, ${Math.floor(cells[0] / w)}) removed: ${this.crowd.cache.stats.invalidations - inv} cached sector fields invalidated`,
    );
    this.refreshMarkersAndFlow();
  }

  /** Puts every storehouse back. */
  restoreStorehouses(): void {
    for (const c of this.storehouseCells) this.storehouseSet.addCell(c);
    this.crowd.cache.sync();
    this.storehouses.set(this.storehouseSet.size);
    this.editInfo.set(`Storehouses restored (${this.storehouseSet.size})`);
    this.refreshMarkersAndFlow();
  }

  private selectStorehouses(): void {
    this.crowdGoalId = this.crowd.addGoalSet(this.storehouseSet);
    this.crowd.retarget(this.crowdGoalId);
    this.lastColored.fill(255);
    this.goalLabel.set('Nearest of 4 storehouses');
    this.multiGoal.set(true);
    this.storehouses.set(this.storehouseSet.size);
    this.flowKey = '';
    this.refreshMarkersAndFlow();
  }

  private refreshMarkersAndFlow(): void {
    const w = this.grid.width;
    const pts: { x: number; y: number }[] = [];
    this.storehouseSet.forEachCell((c) => pts.push({ x: c % w, y: Math.floor(c / w) }));
    this.placeGoalMarkers(pts);
    this.flowKey = '';
    this.refreshFlow();
  }

  private setGoal(p: { x: number; y: number }, label: string): void {
    this.crowdGoalId = this.crowd.addGoal(p.x, p.y);
    this.crowd.retarget(this.crowdGoalId);
    this.lastColored.fill(255);
    this.goalLabel.set(label);
    this.multiGoal.set(false);
    this.placeGoalMarkers([p]);
    this.flowKey = '';
    if (this.crowd.count > 0) this.refreshFlow();
  }

  private setupGoalPresets(): void {
    const s = this.nearestPassable(this.nominal.start.x, this.nominal.start.y, 'villager');
    this.spawnPoint = this.nearestRoomy(s.x, s.y);
    const sp = this.spawnPoint;
    this.goalPoints.set('east', this.nearestRoomy(this.nominal.goal.x, this.nominal.goal.y));
    this.goalPoints.set('north', this.nearestRoomy(sp.x + 40, sp.y - 110));
    this.goalPoints.set('south', this.nearestRoomy(sp.x + 50, sp.y + 120));
    // Four storehouses around the spawn area, on the spawn side of the wall.
    const w = this.grid.width;
    this.storehouseCells = [
      this.nearestRoomy(sp.x + 40, sp.y - 55),
      this.nearestRoomy(sp.x + 45, sp.y + 55),
      this.nearestRoomy(sp.x + 80, sp.y - 5),
      this.nearestRoomy(sp.x + 10, sp.y - 100),
    ].map((p) => p.y * w + p.x);
    for (const c of this.storehouseCells) this.storehouseSet.addCell(c);
    this.goalPresets.set([
      { id: 'east', label: 'East of the wall (via the gap)' },
      { id: 'north', label: 'North, same side' },
      { id: 'south', label: 'South, same side' },
      { id: 'storehouses', label: 'Nearest of 4 storehouses' },
    ]);
  }

  /** The nearest cell with 4 cells of clearance (a spot where a crowd can stand). */
  private nearestRoomy(x: number, y: number): { x: number; y: number } {
    const g = this.grid;
    for (let r = 0; r < 128; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = x + dx;
          const cy = y + dy;
          if (g.inBounds(cx, cy) && g.isPassable(cx, cy, 'villager') && g.clearance[cy * g.width + cx] >= 4) {
            return { x: cx, y: cy };
          }
        }
      }
    }
    return { x, y };
  }

  private createCrowdView(): void {
    this.crowdMesh = new InstancedMesh(
      new CapsuleGeometry(0.35, 0.9, 2, 6),
      new MeshLambertMaterial({ color: '#ffffff' }),
      CROWD_SIZE,
    );
    this.crowdMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.crowdMesh.frustumCulled = false;
    this.crowdMesh.count = 0;
    this.engine.scene.add(this.crowdMesh);
    const geometry = new CylinderGeometry(3, 3, 14, 20, 1, true);
    for (let k = 0; k < 4; k++) {
      const marker = new Mesh(
        geometry.clone(),
        new MeshBasicMaterial({ color: '#ff3cdc', transparent: true, opacity: 0.45, depthWrite: false }),
      );
      marker.visible = false;
      this.goalMarkers.push(marker);
      this.engine.scene.add(marker);
    }
    geometry.dispose();
  }

  /** Shows one marker per goal point (at most four). */
  private placeGoalMarkers(points: { x: number; y: number }[]): void {
    const n = GRID_SIZE;
    this.goalMarkers.forEach((marker, k) => {
      const p = points[k];
      marker.visible = !!p;
      if (!p) return;
      marker.position.set(
        (p.x - n / 2) * this.grid.cellSize,
        Math.max(this.grid.heights[p.y * n + p.x], 0) + 7,
        (p.y - n / 2) * this.grid.cellSize,
      );
    });
  }

  private update(dt: number): void {
    const crowd = this.crowd;
    if (this.crowdRunning()) {
      const steps = crowd.advance(Math.min(dt, 0.1) * this.simSpeed(), 48);
      this.simSeconds += steps * crowd.fixedDt;
    }
    this.refreshFlow();
    this.updateCrowdView();
    if (++this.frameCount % 6 === 0) this.publishHud();
  }

  private updateCrowdView(): void {
    const { crowd, dummy, crowdMesh, grid, colors } = this;
    const n = GRID_SIZE;
    const cs = grid.cellSize;
    crowdMesh.count = crowd.count;
    for (let i = 0; i < crowd.count; i++) {
      const px = crowd.posX[i];
      const py = crowd.posY[i];
      const h = Math.max(grid.heights[Math.floor(py) * n + Math.floor(px)], 0);
      dummy.position.set((px - 0.5 - n / 2) * cs, h + 0.8, (py - 0.5 - n / 2) * cs);
      dummy.updateMatrix();
      crowdMesh.setMatrixAt(i, dummy.matrix);
      const st = crowd.state[i];
      if (this.lastColored[i] !== st) {
        this.lastColored[i] = st;
        crowdMesh.setColorAt(
          i,
          st === NavAgentState.Arrived
            ? colors.arrived
            : st === NavAgentState.Moving
              ? colors.moving
              : st === NavAgentState.Unreachable
                ? colors.stuck
                : colors.waiting,
        );
        if (crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate = true;
      }
    }
    crowdMesh.instanceMatrix.needsUpdate = true;
  }

  /** Rebuilds the arrow lines and the built-sector tint when the cached sector fields changed. */
  private refreshFlow(): void {
    if (this.crowdGoalId < 0) return;
    const stats = this.crowd.cache.stats;
    const key = `${this.crowdGoalId}:${stats.builds}:${stats.invalidations}:${stats.evictions}:${this.showFlow()}`;
    if (key === this.flowKey) return;
    this.flowKey = key;
    const field = this.crowd.fieldFor(this.crowdGoalId, 'villager');
    if (!this.flowLines) {
      this.flowLines = new LineSegments(
        new BufferGeometry(),
        new LineBasicMaterial({ color: '#7df9ff', depthTest: false, transparent: true, opacity: 0.9 }),
      );
      this.flowLines.renderOrder = 10;
      this.flowLines.frustumCulled = false;
      this.engine.scene.add(this.flowLines);
    }
    this.flowLines.geometry.dispose();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(buildFlowArrowVertices(field, this.grid), 3));
    this.flowLines.geometry = geometry;
    this.flowLines.visible = this.showFlow();
    this.redraw();
  }

  private publishHud(): void {
    const { crowd } = this;
    const cs = crowd.cache.stats;
    this.crowdHud.set({
      arrived: crowd.stats.arrived,
      moving: crowd.stats.moving,
      waiting: crowd.stats.waiting,
      unreachable: crowd.stats.unreachable,
      stepMs: crowd.stats.lastStepMs,
      cachedFields: cs.sectorFields,
      invalidations: cs.invalidations,
      displaced: crowd.stats.displaced,
      sectorsRebuilt: this.world.stats.sectorsRebuilt,
      edits: this.world.stats.edits,
      builds: cs.builds,
      lastBuildMs: cs.lastBuildMs,
      totalBuildMs: cs.totalBuildMs,
      simSeconds: this.simSeconds,
    });
    if (this.multiGoal()) {
      const counts = this.storehouseCells.map(() => 0);
      for (let i = 0; i < crowd.count; i++) {
        const k = this.storehouseCells.indexOf(crowd.arrivedCell[i]);
        if (k >= 0) counts[k]++;
      }
      this.sourceArrivals.set(counts);
    }
  }

  /** The grid cell under a mouse event, or undefined when the ray misses the terrain. */
  private cellFromEvent(event: MouseEvent): { x: number; y: number } | undefined {
    const camera = this.engine.camera;
    if (!camera) return undefined;
    const resolution = this.engine.resolution$.value;
    this.pointerNdc.set(
      (event.offsetX / resolution.width) * 2 - 1,
      -(event.offsetY / resolution.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNdc, camera);
    const hit = this.raycaster.intersectObject(this.terrainMesh, false)[0];
    if (!hit) return undefined;
    const n = GRID_SIZE;
    return {
      x: Math.round(hit.point.x / this.grid.cellSize + n / 2),
      y: Math.round(hit.point.z / this.grid.cellSize + n / 2),
    };
  }

  private setGoalFromClick(event: MouseEvent): void {
    const cell = this.cellFromEvent(event);
    if (!cell) return;
    const goal = this.nearestPassable(cell.x, cell.y, 'villager');
    if (!this.grid.isPassable(goal.x, goal.y, 'villager')) return;
    this.setGoal(goal, `clicked cell ${goal.x}, ${goal.y}`);
  }

  /** Place or remove a building at the clicked cell (edit mode). */
  private editFromClick(event: MouseEvent): void {
    const cell = this.cellFromEvent(event);
    if (!cell) return;
    if (this.editMode() === 'place') {
      const rect: NavRect = {
        x: cell.x - BUILDING_SIZE / 2,
        y: cell.y - BUILDING_SIZE / 2,
        width: BUILDING_SIZE,
        height: BUILDING_SIZE,
      };
      if (!this.canBuild(rect)) {
        this.editInfo.set('Cannot build there: water, steep ground, another structure or a goal.');
        return;
      }
      const result = this.runEdit(() => this.world.placeBuilding(rect), 'Building placed');
      this.addBuildingMesh(rect);
      void result;
    } else {
      const k = this.placed.findIndex(
        (b) => cell.x >= b.rect.x && cell.y >= b.rect.y && cell.x < b.rect.x + b.rect.width && cell.y < b.rect.y + b.rect.height,
      );
      if (k < 0) {
        this.editInfo.set('No placed building under the cursor (only buildings you placed can be removed).');
        return;
      }
      const [b] = this.placed.splice(k, 1);
      this.engine.scene.remove(b.mesh);
      this.runEdit(() => this.world.removeBuilding(b.rect), 'Building removed');
    }
  }

  private canBuild(rect: NavRect): boolean {
    const g = this.grid;
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        if (!g.inBounds(x, y) || g.flags[y * g.width + x] & (NavFlag.WATER | NavFlag.STEEP | NavFlag.STRUCTURE)) {
          return false;
        }
        const c = y * g.width + x;
        if (this.storehouseSet.hasCell(c)) return false;
        const goal = this.crowd.goalCell(this.crowdGoalId);
        if (goal && goal.x === x && goal.y === y) return false;
      }
    }
    return true;
  }

  private addBuildingMesh(rect: NavRect): void {
    const n = GRID_SIZE;
    const g = this.grid;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const mesh = new Mesh(this.buildingGeometry, this.buildingMaterial);
    mesh.position.set(
      (cx - 0.5 - n / 2) * g.cellSize,
      Math.max(g.heights[Math.floor(cy) * n + Math.floor(cx)], 0) + 2.5,
      (cy - 0.5 - n / 2) * g.cellSize,
    );
    this.engine.scene.add(mesh);
    this.placed.push({ rect, mesh });
  }

  /**
   * Applies a world edit and publishes what it touched: the sectors rebuilt, the sector fields the
   * crowd's cache invalidated and the agents moved out of blocked cells.
   */
  private runEdit(edit: () => NavEditResult, label: string): NavEditResult {
    const cache = this.crowd.cache;
    const inv = cache.stats.invalidations;
    const displaced = this.crowd.stats.displaced;
    const result = edit();
    this.updatePortalCounts();
    this.crowd.displaceBlocked();
    cache.sync();
    this.editMs.set(result.gridMs);
    this.editInfo.set(
      `${label}: ${result.sectors.length} of ${this.sectors.sectorCount} sectors rebuilt in ${result.sectorMs.toFixed(1)} ms · ` +
        `${cache.stats.invalidations - inv} sector fields invalidated · ${this.crowd.stats.displaced - displaced} agents moved out`,
    );
    this.flowKey = '';
    this.refreshFlow();
    this.redraw();
    return result;
  }

  selectOverlay(id: NavOverlayId): void {
    this.overlay.set(id);
    this.redraw();
  }

  toggleGate(): void {
    const open = !this.gateOpen();
    this.gateOpen.set(open);
    const result = this.runEdit(() => this.world.setGateOpen(this.gate, open), open ? 'Gate opened' : 'Gate closed');
    this.rebuildInfo.set(`${result.sectors.length} of ${this.sectors.sectorCount} sectors rebuilt in ${result.sectorMs.toFixed(1)} ms`);
  }

  selectClass(c: NavUnitClass): void {
    this.unitClass.set(c);
    this.redraw();
  }

  toggleSectors(): void {
    this.showSectors.update((v) => !v);
    this.redraw();
  }

  toggleCorridor(): void {
    this.showCorridor.update((v) => !v);
    this.redraw();
  }

  private updatePortalCounts(): void {
    this.portalCounts.set({
      villager: this.sectors.portalCount('villager'),
      catapult: this.sectors.portalCount('catapult'),
      creature: this.sectors.portalCount('creature'),
    });
  }

  /** The nearest cell to a nominal point that the class can stand in (square spiral search). */
  private nearestPassable(x: number, y: number, c: NavUnitClass): { x: number; y: number } {
    for (let r = 0; r < 64; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.grid.isPassable(x + dx, y + dy, c)) return { x: x + dx, y: y + dy };
        }
      }
    }
    return { x, y };
  }

  private redraw(): void {
    fillOverlay(this.grid, this.overlay(), this.pixels);
    const c = this.unitClass();
    const start = this.nearestPassable(this.nominal.start.x, this.nominal.start.y, c);
    const goal = this.nearestPassable(this.nominal.goal.x, this.nominal.goal.y, c);
    let path: NavAbstractPath | undefined;
    if (this.showCorridor()) {
      const t0 = performance.now();
      path = this.sectors.findAbstractPath(start.x, start.y, goal.x, goal.y, c);
      const ms = performance.now() - t0;
      this.corridorText.set(
        path.found
          ? `${c}: corridor of ${path.sectors.length} sectors, ${path.portals.length} portals, cost ${Math.round(path.cost)} (${ms.toFixed(2)} ms)`
          : `${c}: no route between the points (${ms.toFixed(2)} ms)`,
      );
    } else {
      this.corridorText.set('');
    }
    drawSectorOverlay(this.sectors, this.grid, this.pixels, {
      unitClass: c,
      showSectors: this.showSectors(),
      path,
      start: this.showCorridor() ? start : undefined,
      goal: this.showCorridor() ? goal : undefined,
    });
    if (this.crowdGoalId >= 0) {
      drawFlowSectors(this.crowd.fieldFor(this.crowdGoalId, 'villager'), this.pixels, GRID_SIZE, GRID_SIZE);
    }
    this.texture.needsUpdate = true;
    const counts: Record<NavUnitClass, number> = { villager: 0, catapult: 0, creature: 0 };
    const { flags, clearance } = this.grid;
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] & NavFlag.BLOCKED) continue;
      for (const c of ['villager', 'catapult', 'creature'] as const) {
        if (clearance[i] >= NAV_CLEARANCE_THRESHOLDS[c]) counts[c]++;
      }
    }
    this.passable.set(counts);
  }

  /** Finds a flat walkable site nearest the island centre and stamps example content on it. */
  private stampExamples(): void {
    const w = 80;
    const h = 56;
    const c = GRID_SIZE / 2;
    let site = { x: c - w / 2, y: c - h / 2 };
    search: for (let r = 0; r < 200; r += 6) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(c + r * Math.cos((a / 16) * Math.PI * 2) - w / 2);
        const y = Math.round(c + r * Math.sin((a / 16) * Math.PI * 2) - h / 2);
        if (this.siteIsFlat(x, y, w, h)) {
          site = { x, y };
          break search;
        }
      }
    }
    const g = this.grid;
    const at = (x: number, y: number, width: number, height: number) => ({
      x: site.x + x,
      y: site.y + y,
      width,
      height,
    });
    // Two houses west of a wall, one barn east of it.
    g.stampStructure(at(4, 4, 12, 8));
    g.stampStructure(at(4, 36, 14, 9));
    g.stampStructure(at(58, 6, 10, 10));
    // A wall across the whole island with a 2-cell gap (villagers only) and a 17-cell gate (closed;
    // wide enough for catapults and creatures once opened).
    g.stampStructure({ x: site.x + 36, y: 0, width: 2, height: GRID_SIZE });
    g.clearStructure(at(36, 22, 2, 2));
    Object.assign(this.gate, at(36, 30, 2, 17));
    g.stampGate(this.gate, false);
    this.nominal = {
      start: { x: site.x - 70, y: site.y + 6 },
      goal: { x: site.x + 108, y: site.y + 46 },
    };
    // A road from the west house through the gap to the barn.
    g.paintRoadLine(site.x + 10, site.y + 13, site.x + 35, site.y + 23, 1);
    g.paintRoadLine(site.x + 35, site.y + 23, site.x + 38, site.y + 23, 1);
    g.paintRoadLine(site.x + 38, site.y + 23, site.x + 62, site.y + 17, 1);
    // Territory: west half faction 1, a patch east faction 2.
    g.paintTerritory(at(0, 0, 36, h), 1);
    g.paintTerritory(at(50, 0, 30, h), 2);
  }

  private siteIsFlat(x: number, y: number, w: number, h: number): boolean {
    if (x < 8 || y < 8 || x + w > GRID_SIZE - 8 || y + h > GRID_SIZE - 8) return false;
    for (let yy = y; yy < y + h; yy += 2) {
      for (let xx = x; xx < x + w; xx += 2) {
        const i = yy * GRID_SIZE + xx;
        if (this.grid.flags[i] & NavFlag.BLOCKED || this.grid.terrain[i] > 40) return false;
      }
    }
    return true;
  }

  /** One vertex per cell centre, X/Z in metres centred on the island, Y from the heightfield. */
  private createTerrainGeometry(): BufferGeometry {
    const n = GRID_SIZE;
    const g = this.grid;
    const positions = new Float32Array(n * n * 3);
    const uvs = new Float32Array(n * n * 2);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        positions[i * 3] = (x - n / 2) * g.cellSize;
        positions[i * 3 + 1] = Math.max(g.heights[i], 0);
        positions[i * 3 + 2] = (y - n / 2) * g.cellSize;
        uvs[i * 2] = (x + 0.5) / n;
        uvs[i * 2 + 1] = (y + 0.5) / n;
      }
    }
    const index = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const a = y * n + x;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        index[k++] = a;
        index[k++] = c;
        index[k++] = b;
        index[k++] = b;
        index[k++] = c;
        index[k++] = d;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    return geometry;
  }
}
