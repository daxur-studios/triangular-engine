import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferGeometry,
  CameraHelper,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Frustum,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  QuaternionTuple,
  SphereGeometry,
  Vector3,
  Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { JoltPhysicsModule } from 'triangular-engine/jolt';
import {
  buildStructureMesh,
  COLONY_COMM_TOWER_ARCHETYPE,
  COLONY_FUEL_TANK_ARCHETYPE,
  COLONY_HAB_MODULE_ARCHETYPE,
  COLONY_SOLAR_PANEL_ARCHETYPE,
  createChopstickTowerArchetype,
  createLaunchpadArchetype,
  createRunwayArchetype,
  deriveStructureColliders,
  deriveStructureFootprint2D,
  deriveStructureSockets,
  extractCameraFrustum,
  generateStructureSkeleton,
  poseStructureVariant,
  StructureBatchManager,
  StructureSpatialGrid,
  type IStructureArchetype,
  type IStructureFootprint2D,
  type IStructureInstanceTransform,
  type IStructureVariant,
  type StructureSocketKind,
} from 'triangular-engine/procedural';

interface IStructureDisplayItem {
  readonly archetype: IStructureArchetype;
  readonly baseOffsetM: readonly [number, number, number];
  baseVariant: IStructureVariant;
  posedVariant: IStructureVariant;
  itemGroup: Group;
  meshGroup: Group;
  socketGroup: Group;
  footprintGroup: Group;
}

interface IActiveColliderItem {
  readonly key: string;
  readonly position: Vector3Tuple;
  readonly quaternion: QuaternionTuple;
  readonly isSphere: boolean;
  readonly radius: number;
  readonly boxSize: [number, number, number];
}

interface IDroppedBall {
  readonly id: number;
  readonly position: Vector3Tuple;
  readonly color: string;
  readonly radius: number;
}

const SOCKET_GIZMO_COLOR_BY_KIND: Record<StructureSocketKind, string> = {
  'spawn-point': '#4caf50', // green
  'touchdown-zone': '#2196f3', // blue
  'catch-zone': '#e91e63', // pink
  'cable-anchor': '#9c27b0', // purple
  'refuel-dock': '#ff9800', // orange
  'power-in': '#ffeb3b', // yellow
  'corridor-node': '#00bcd4', // cyan
  perch: '#8bc34a', // light green
  custom: '#9e9e9e', // grey
};

@Component({
  selector: 'app-structures-lab-page',
  imports: [RouterLink, EngineModule, JoltPhysicsModule],
  templateUrl: './structures-lab-page.component.html',
  styleUrl: './structures-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class StructuresLabPageComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly seed = signal<number>(42);
  readonly wireframe = signal<boolean>(false);
  readonly showSockets = signal<boolean>(true);
  readonly showFootprints = signal<boolean>(true);

  // Scaling / Benchmark Mode
  readonly benchmarkMode = signal<boolean>(false);
  readonly benchmarkBuildingCount = signal<number>(1200);
  readonly selectedLodMode = signal<'auto' | 0 | 1 | 2 | 3>('auto');
  readonly lodDistanceScale = signal<number>(2.2);
  readonly enableCulling = signal<boolean>(true);
  readonly freezeCulling = signal<boolean>(false);

  readonly visibleBuildingCount = signal<number>(1200);
  readonly culledPercent = computed(() => {
    const total = this.benchmarkBuildingCount();
    const vis = this.visibleBuildingCount();
    if (total <= 0) return 0;
    return Math.max(0, Math.round(((total - vis) / total) * 100));
  });

  readonly activeDrawCalls = signal<number>(3);
  readonly totalTriangles = signal<number>(5550);
  readonly lodBreakdown = signal<string>('');

  // Parametric Dimensions (Single-facility inspection mode)
  readonly runwayLengthM = signal<number>(400);
  readonly runwayWidthM = signal<number>(40);
  readonly launchpadRadiusM = signal<number>(30);
  readonly towerHeightM = signal<number>(80);

  // Tower Joint Sliders
  readonly towerCarriageElevationM = signal<number>(35);
  readonly maxTowerCarriageElevationM = computed(() => Math.max(10, this.towerHeightM() - 15));
  readonly towerChopstickAngleRad = signal<number>(0);

  readonly activeStaticColliders = signal<readonly IActiveColliderItem[]>([]);
  readonly droppedBalls = signal<readonly IDroppedBall[]>([]);

  private readonly rootGroup = new Group();
  private readonly batchManager = new StructureBatchManager();
  private displayItems: IStructureDisplayItem[] = [];
  private ballCounter = 0;
  private lastCameraPosition = new Vector3(Infinity, Infinity, Infinity);

  // Frozen frustum debug state
  private frozenFrustum: Frustum | null = null;
  private frozenFocusPos: [number, number, number] = [0, 0, 0];
  private frozenCameraHelper: CameraHelper | null = null;

  // Spatial grids for fast hierarchical chunk culling
  private readonly gridSolar = new StructureSpatialGrid(80);
  private readonly gridFuel = new StructureSpatialGrid(80);
  private readonly gridHab = new StructureSpatialGrid(80);
  private readonly gridComm = new StructureSpatialGrid(80);

  // Cached benchmark transforms
  private cachedSolarTransforms: IStructureInstanceTransform[] = [];
  private cachedFuelTransforms: IStructureInstanceTransform[] = [];
  private cachedHabTransforms: IStructureInstanceTransform[] = [];
  private cachedCommTransforms: IStructureInstanceTransform[] = [];

  constructor() {
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#0d1527');

    const grid = new GridHelper(1200, 120, 0x475569, 0x1e293b);
    grid.position.y = 0.01;
    this.rootGroup.add(grid);

    this.engine.scene.add(this.rootGroup);

    this.rebuildAllStructures();

    // Hook live camera movement for real-time Dynamic Distance Auto-LOD and Frustum Culling
    this.engine.beforeRender$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (!this.benchmarkMode() || this.freezeCulling()) return;

      const cam = this.engine.camera;
      if (!cam) return;
      if (cam.position.distanceToSquared(this.lastCameraPosition) > 36) { // update when camera moves > 6m
        this.lastCameraPosition.copy(cam.position);
        this.updateDynamicCameraLod([cam.position.x, cam.position.y, cam.position.z]);
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.frozenCameraHelper) {
        this.rootGroup.remove(this.frozenCameraHelper);
        this.frozenCameraHelper.dispose();
      }
      this.batchManager.clear();
      this.engine.scene.remove(this.rootGroup);
      this.engine.scene.background = previousBackground;
    });
  }

  onSeedChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!isNaN(val)) {
      this.seed.set(val);
      this.rebuildAllStructures();
    }
  }

  onRandomSeed(): void {
    const nextSeed = Math.floor(Math.random() * 90000) + 1000;
    this.seed.set(nextSeed);
    this.rebuildAllStructures();
  }

  toggleBenchmarkMode(): void {
    this.benchmarkMode.update((v) => !v);
    this.clearFrozenFrustum();
    this.lastCameraPosition.set(Infinity, Infinity, Infinity);
    this.rebuildAllStructures();
  }

  toggleCulling(): void {
    this.enableCulling.update((v) => !v);
    this.clearFrozenFrustum();
    this.lastCameraPosition.set(Infinity, Infinity, Infinity);
    const camPos = this.engine.camera?.position ?? new Vector3(0, 220, 380);
    this.updateDynamicCameraLod([camPos.x, camPos.y, camPos.z]);
  }

  toggleFreezeCulling(): void {
    if (!this.benchmarkMode()) return;
    const nextVal = !this.freezeCulling();
    this.freezeCulling.set(nextVal);

    if (this.frozenCameraHelper) {
      this.rootGroup.remove(this.frozenCameraHelper);
      this.frozenCameraHelper.dispose();
      this.frozenCameraHelper = null;
    }

    if (nextVal && this.engine.camera) {
      // Freeze the frustum at the current camera pose
      this.frozenFrustum = extractCameraFrustum(this.engine.camera);
      const camPos = this.engine.camera.position;
      this.frozenFocusPos = [camPos.x, camPos.y, camPos.z];

      // Clone camera to create a persistent frustum visual helper
      const helperCam = this.engine.camera.clone() as PerspectiveCamera;
      helperCam.updateMatrixWorld(true);
      this.frozenCameraHelper = new CameraHelper(helperCam);
      this.rootGroup.add(this.frozenCameraHelper);

      this.updateDynamicCameraLod(this.frozenFocusPos);
    } else {
      this.frozenFrustum = null;
      const camPos = this.engine.camera?.position ?? new Vector3(0, 220, 380);
      this.lastCameraPosition.copy(camPos);
      this.updateDynamicCameraLod([camPos.x, camPos.y, camPos.z]);
    }
  }

  private clearFrozenFrustum(): void {
    this.freezeCulling.set(false);
    this.frozenFrustum = null;
    if (this.frozenCameraHelper) {
      this.rootGroup.remove(this.frozenCameraHelper);
      this.frozenCameraHelper.dispose();
      this.frozenCameraHelper = null;
    }
  }

  setLodMode(mode: 'auto' | 0 | 1 | 2 | 3): void {
    this.selectedLodMode.set(mode);
    if (this.benchmarkMode()) {
      this.rebuildAllStructures();
    }
  }

  onBenchmarkCountChange(event: Event): void {
    const val = parseInt((event.target as HTMLInputElement).value, 10);
    this.benchmarkBuildingCount.set(val);
    if (this.benchmarkMode()) {
      this.rebuildAllStructures();
    }
  }

  onLodDistanceScaleChange(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.lodDistanceScale.set(val);
    if (this.benchmarkMode() && this.selectedLodMode() === 'auto') {
      const focus = this.freezeCulling()
        ? this.frozenFocusPos
        : ((this.engine.camera?.position.toArray() as [number, number, number]) ?? [0, 220, 380]);
      this.updateDynamicCameraLod(focus);
    }
  }

  toggleWireframe(): void {
    this.wireframe.update((v) => !v);
    this.updateMaterialWireframe();
  }

  toggleSockets(): void {
    this.showSockets.update((v) => !v);
    for (const item of this.displayItems) {
      item.socketGroup.visible = this.showSockets();
    }
  }

  toggleFootprints(): void {
    this.showFootprints.update((v) => !v);
    for (const item of this.displayItems) {
      item.footprintGroup.visible = this.showFootprints();
    }
  }

  onRunwayLengthChange(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.runwayLengthM.set(val);
    this.rebuildAllStructures();
  }

  onRunwayWidthChange(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.runwayWidthM.set(val);
    this.rebuildAllStructures();
  }

  onLaunchpadRadiusChange(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.launchpadRadiusM.set(val);
    this.rebuildAllStructures();
  }

  onTowerHeightChange(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.towerHeightM.set(val);
    const maxElev = Math.max(10, val - 15);
    if (this.towerCarriageElevationM() > maxElev) {
      this.towerCarriageElevationM.set(maxElev);
    }
    this.rebuildAllStructures();
  }

  onCarriageElevationChange(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.towerCarriageElevationM.set(val);
    this.applyJointPoses();
  }

  onChopstickAngleChange(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.towerChopstickAngleRad.set(val);
    this.applyJointPoses();
  }

  dropBall(x: number, y: number, z: number): void {
    this.ballCounter++;
    const colors = ['#f43f5e', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'];
    const newBall: IDroppedBall = {
      id: this.ballCounter,
      position: [x, y, z],
      color: colors[this.ballCounter % colors.length],
      radius: 1.5,
    };
    this.droppedBalls.update((b) => [...b.slice(-15), newBall]);
  }

  clearBalls(): void {
    this.droppedBalls.set([]);
  }

  private rebuildAllStructures(): void {
    // 1. Clear previous items
    for (const item of this.displayItems) {
      this.rootGroup.remove(item.itemGroup);
      item.meshGroup.clear();
      item.socketGroup.clear();
      item.footprintGroup.clear();
    }
    this.displayItems = [];
    this.batchManager.clear();
    this.rootGroup.remove(this.batchManager.group);

    const currentSeed = this.seed();

    // 2. Branch: Benchmark Mega-Base Mode (1,000+ Buildings)
    if (this.benchmarkMode()) {
      this.buildMegaBaseBenchmark(currentSeed);
      return;
    }

    // 3. Single-Facility Inspection Mode
    this.buildInspectionFacilities(currentSeed);
  }

  private buildMegaBaseBenchmark(currentSeed: number): void {
    const total = this.benchmarkBuildingCount();
    const quarter = Math.floor(total / 4);

    // Generate instance transforms for all 4 base sectors
    this.cachedSolarTransforms = [];
    this.gridSolar.clear();
    const solarCols = Math.ceil(Math.sqrt(quarter));
    for (let i = 0; i < quarter; i++) {
      const row = Math.floor(i / solarCols);
      const col = i % solarCols;
      const t: IStructureInstanceTransform = { position: [-300 + col * 16, 0, -200 + row * 16] };
      this.cachedSolarTransforms.push(t);
      this.gridSolar.insert(t, 8);
    }

    this.cachedFuelTransforms = [];
    this.gridFuel.clear();
    const fuelCols = Math.ceil(Math.sqrt(quarter));
    for (let i = 0; i < quarter; i++) {
      const row = Math.floor(i / fuelCols);
      const col = i % fuelCols;
      const t: IStructureInstanceTransform = { position: [50 + col * 18, 0, -200 + row * 18] };
      this.cachedFuelTransforms.push(t);
      this.gridFuel.insert(t, 12);
    }

    this.cachedHabTransforms = [];
    this.gridHab.clear();
    const habCols = Math.ceil(Math.sqrt(quarter));
    for (let i = 0; i < quarter; i++) {
      const row = Math.floor(i / habCols);
      const col = i % habCols;
      const t: IStructureInstanceTransform = { position: [-300 + col * 26, 0, 50 + row * 26] };
      this.cachedHabTransforms.push(t);
      this.gridHab.insert(t, 14);
    }

    this.cachedCommTransforms = [];
    this.gridComm.clear();
    const commCount = total - quarter * 3;
    const commCols = Math.ceil(Math.sqrt(commCount));
    for (let i = 0; i < commCount; i++) {
      const row = Math.floor(i / commCols);
      const col = i % commCols;
      const t: IStructureInstanceTransform = { position: [50 + col * 22, 0, 50 + row * 22] };
      this.cachedCommTransforms.push(t);
      this.gridComm.insert(t, 10);
    }

    const camPos = this.engine.camera?.position ?? new Vector3(0, 220, 380);
    this.lastCameraPosition.copy(camPos);
    this.updateDynamicCameraLod([camPos.x, camPos.y, camPos.z]);
  }

  private updateDynamicCameraLod(cameraPosition: [number, number, number]): void {
    const currentSeed = this.seed();
    const total = this.benchmarkBuildingCount();
    const mode = this.selectedLodMode();
    this.batchManager.clear();

    const scale = this.lodDistanceScale();
    const thresholds = {
      lod1DistanceM: 140 * scale,
      lod2DistanceM: 280 * scale,
      lod3DistanceM: 480 * scale,
    };

    // 1. Frustum Culling Filter
    let solar: IStructureInstanceTransform[];
    let fuel: IStructureInstanceTransform[];
    let hab: IStructureInstanceTransform[];
    let comm: IStructureInstanceTransform[];

    if (this.enableCulling() && (this.frozenFrustum || this.engine.camera)) {
      const frustum = this.frozenFrustum ?? extractCameraFrustum(this.engine.camera!);
      solar = this.gridSolar.queryFrustum(frustum);
      fuel = this.gridFuel.queryFrustum(frustum);
      hab = this.gridHab.queryFrustum(frustum);
      comm = this.gridComm.queryFrustum(frustum);
    } else {
      solar = this.cachedSolarTransforms;
      fuel = this.cachedFuelTransforms;
      hab = this.cachedHabTransforms;
      comm = this.cachedCommTransforms;
    }

    const visibleTotal = solar.length + fuel.length + hab.length + comm.length;
    this.visibleBuildingCount.set(visibleTotal);

    // 2. Batch Registration
    if (mode === 'auto') {
      this.batchManager.addInstancesWithDistanceLod(
        COLONY_SOLAR_PANEL_ARCHETYPE,
        solar,
        cameraPosition,
        currentSeed,
        thresholds,
      );
      this.batchManager.addInstancesWithDistanceLod(
        COLONY_FUEL_TANK_ARCHETYPE,
        fuel,
        cameraPosition,
        currentSeed,
        thresholds,
      );
      this.batchManager.addInstancesWithDistanceLod(
        COLONY_HAB_MODULE_ARCHETYPE,
        hab,
        cameraPosition,
        currentSeed,
        thresholds,
      );
      this.batchManager.addInstancesWithDistanceLod(
        COLONY_COMM_TOWER_ARCHETYPE,
        comm,
        cameraPosition,
        currentSeed,
        thresholds,
      );
    } else {
      const lod = mode as number;
      this.batchManager.addInstances(COLONY_SOLAR_PANEL_ARCHETYPE, solar, currentSeed, lod);
      this.batchManager.addInstances(COLONY_FUEL_TANK_ARCHETYPE, fuel, currentSeed, lod);
      this.batchManager.addInstances(COLONY_HAB_MODULE_ARCHETYPE, hab, currentSeed, lod);
      this.batchManager.addInstances(COLONY_COMM_TOWER_ARCHETYPE, comm, currentSeed, lod);
    }

    const batchGroup = this.batchManager.build({
      overrideLod: mode === 'auto' ? undefined : (mode as number),
      material: new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.65,
        metalness: 0.25,
        wireframe: this.wireframe(),
        side: DoubleSide,
      }),
    });

    this.rootGroup.add(batchGroup);
    this.activeDrawCalls.set(this.batchManager.drawCallCount);
    this.activeStaticColliders.set([]);

    const counts = this.batchManager.getLodCounts();
    if (mode === 'auto') {
      this.lodBreakdown.set(`${counts[0]}@L0 · ${counts[1]}@L1 · ${counts[2]}@L2 · ${counts[3]}@L3`);
      const sumTriangles = counts[0] * 1850 + counts[1] * 450 + counts[2] * 110 + counts[3] * 2;
      this.totalTriangles.set(sumTriangles);
    } else {
      this.lodBreakdown.set(`All ${visibleTotal} at LOD ${mode}`);
      const perBuilding = mode === 0 ? 1850 : mode === 1 ? 450 : mode === 2 ? 110 : 2;
      this.totalTriangles.set(visibleTotal * perBuilding);
    }
  }

  private buildInspectionFacilities(currentSeed: number): void {
    const offsets: readonly [number, number, number][] = [
      [-90, 0, 0], // Runway
      [0, 0, 0],   // Launchpad
      [75, 0, 0],  // Tower
    ];

    const archetypes: IStructureArchetype[] = [
      createRunwayArchetype({ lengthM: this.runwayLengthM(), widthM: this.runwayWidthM() }),
      createLaunchpadArchetype({ radiusM: this.launchpadRadiusM() }),
      createChopstickTowerArchetype({ heightM: this.towerHeightM() }),
    ];

    archetypes.forEach((archetype, idx) => {
      const offset = offsets[idx] ?? [idx * 75, 0, 0];
      const solids = generateStructureSkeleton(archetype, currentSeed);
      const sockets = deriveStructureSockets(solids, archetype, currentSeed);
      const colliders = deriveStructureColliders(solids, archetype);
      const footprint = deriveStructureFootprint2D(archetype, currentSeed);

      const baseVariant: IStructureVariant = {
        archetypeId: archetype.id,
        seed: currentSeed,
        solids,
        sockets,
        colliders,
        footprint,
        joints: archetype.joints,
      };

      const itemGroup = new Group();
      itemGroup.name = `structure-${archetype.id}-root`;
      itemGroup.position.set(...offset);

      const meshGroup = new Group();
      meshGroup.name = `structure-${archetype.id}-meshes`;

      const socketGroup = new Group();
      socketGroup.name = `structure-${archetype.id}-sockets`;
      socketGroup.visible = this.showSockets();

      const footprintGroup = this.buildFootprintVisual(footprint);
      footprintGroup.visible = this.showFootprints();

      itemGroup.add(meshGroup, socketGroup, footprintGroup);
      this.rootGroup.add(itemGroup);

      this.displayItems.push({
        archetype,
        baseOffsetM: offset,
        baseVariant,
        posedVariant: baseVariant,
        itemGroup,
        meshGroup,
        socketGroup,
        footprintGroup,
      });
    });

    this.activeDrawCalls.set(3);
    this.totalTriangles.set(1850 * 3);
    this.visibleBuildingCount.set(3);
    this.lodBreakdown.set('Inspection Facilities (LOD 0)');
    this.applyJointPoses();
  }

  private applyJointPoses(): void {
    if (this.benchmarkMode()) return;

    const collidersList: IActiveColliderItem[] = [];

    for (const item of this.displayItems) {
      if (item.archetype.id.includes('tower') || item.archetype.id.includes('chopstick')) {
        item.posedVariant = poseStructureVariant(item.baseVariant, {
          'carriage-lift': this.towerCarriageElevationM(),
          'chopstick-left-hinge': this.towerChopstickAngleRad(),
          'chopstick-right-hinge': -this.towerChopstickAngleRad(),
        });
      } else {
        item.posedVariant = item.baseVariant;
      }

      this.rebuildDisplayMeshes(item);
      this.rebuildDisplaySockets(item);

      // Collect Jolt static colliders
      for (let i = 0; i < item.posedVariant.colliders.length; i++) {
        const col = item.posedVariant.colliders[i];
        const [ox, oy, oz] = item.baseOffsetM;
        const [px, py, pz] = col.anchorRelativePositionM;
        const worldPos: Vector3Tuple = [ox + px, oy + py, oz + pz];

        const isSphere = col.shape === 'sphere';
        const radius = col.shape === 'sphere' ? col.params[0] : col.shape === 'cylinder' || col.shape === 'capsule' ? col.params[1] : 1;
        const boxSize: [number, number, number] =
          col.shape === 'box'
            ? [col.params[0], col.params[1], col.params[2]]
            : [radius * 2, (col.params[0] ?? 1) * 2, radius * 2];

        collidersList.push({
          key: `${item.archetype.id}-col-${i}`,
          position: worldPos,
          quaternion: col.rotation as QuaternionTuple,
          isSphere,
          radius,
          boxSize,
        });
      }
    }

    this.activeStaticColliders.set(collidersList);
  }

  private rebuildDisplayMeshes(item: IStructureDisplayItem): void {
    while (item.meshGroup.children.length > 0) {
      const child = item.meshGroup.children[0] as Mesh;
      item.meshGroup.remove(child);
      child.geometry?.dispose();
    }

    const res = buildStructureMesh(item.posedVariant.solids, item.archetype);
    const mat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      metalness: 0.25,
      wireframe: this.wireframe(),
      side: DoubleSide,
    });

    const mesh = new Mesh(res.geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    item.meshGroup.add(mesh);
  }

  private rebuildDisplaySockets(item: IStructureDisplayItem): void {
    while (item.socketGroup.children.length > 0) {
      const child = item.socketGroup.children[0] as Mesh;
      item.socketGroup.remove(child);
      child.geometry?.dispose();
    }

    for (const socket of item.posedVariant.sockets) {
      const colorHex = SOCKET_GIZMO_COLOR_BY_KIND[socket.kind] ?? '#ffffff';
      const geom = new SphereGeometry(socket.clearanceRadiusM * 0.15, 12, 8);
      const mat = new MeshBasicMaterial({ color: colorHex, wireframe: true });
      const gizmo = new Mesh(geom, mat);
      gizmo.position.set(...socket.positionM);
      item.socketGroup.add(gizmo);
    }
  }

  private buildFootprintVisual(footprint: IStructureFootprint2D): Group {
    const group = new Group();
    const lineMat = new LineBasicMaterial({ color: '#38bdf8' });

    if (footprint.kind === 'rect') {
      const hw = footprint.dimensionsM[0];
      const hl = footprint.dimensionsM[1];
      const points = [
        -hw, 0.05, -hl,  hw, 0.05, -hl,
         hw, 0.05, -hl,  hw, 0.05,  hl,
         hw, 0.05,  hl, -hw, 0.05,  hl,
        -hw, 0.05,  hl, -hw, 0.05, -hl,
      ];
      const geom = new BufferGeometry();
      geom.setAttribute('position', new Float32BufferAttribute(points, 3));
      group.add(new LineSegments(geom, lineMat));
    } else if (footprint.kind === 'circle') {
      const r = footprint.dimensionsM[0];
      const segs = 32;
      const points: number[] = [];
      for (let i = 0; i < segs; i++) {
        const a1 = (i / segs) * Math.PI * 2;
        const a2 = ((i + 1) / segs) * Math.PI * 2;
        points.push(Math.cos(a1) * r, 0.05, Math.sin(a1) * r);
        points.push(Math.cos(a2) * r, 0.05, Math.sin(a2) * r);
      }
      const geom = new BufferGeometry();
      geom.setAttribute('position', new Float32BufferAttribute(points, 3));
      group.add(new LineSegments(geom, lineMat));
    }

    return group;
  }

  private updateMaterialWireframe(): void {
    if (this.benchmarkMode()) {
      this.rebuildAllStructures();
      return;
    }
    for (const item of this.displayItems) {
      for (const child of item.meshGroup.children) {
        if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
          child.material.wireframe = this.wireframe();
        }
      }
    }
  }
}
