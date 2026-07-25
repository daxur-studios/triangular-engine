import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Raycaster,
  RingGeometry,
  Vector2,
  Vector3,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  estimateScatterImpactMomentumNs,
  Jolt,
  JoltPhysicsComponent,
  JoltPhysicsModule,
  JoltRigidBodyComponent,
  ScatterJoltColliderAdapter,
  TerrainJoltColliderAdapter,
  type IContactAddedEvent,
} from 'triangular-engine/jolt';
import {
  generateTerrainPatchMesh,
  PlaneTerrainDomain,
  type IPlaneTerrainPatchAddress,
  type ITerrainField,
  type ITerrainFieldSample,
  type ITerrainPatchMesh,
  type TerrainVector3,
} from 'triangular-engine/terrain';
import {
  buildScatterColliderDescriptors,
  buildScatterInstancedMesh,
  computeScatterPhysicsAnchor,
  createScatterRemovalOverlay,
  diffScatterPhysicsResidency,
  filterRemovedScatterInstances,
  generateTerrainScatterInstances,
  pickScatterInstanceId,
  selectFixedLevelScatterCells,
  withScatterInstanceRemoved,
  type IScatterRemovalOverlay,
  type IScatterResidencyCandidate,
  type ITerrainScatterInstance,
  type ScatterInstanceId,
  type ScatterPlacementRules,
  type ScatterScaleRange,
  type ScatterSpeciesDefinition,
} from 'triangular-engine/scatter';

const PLANE_PATCH_SIZE_M = 40;
const GRID_RADIUS = 2;
const TERRAIN_RESOLUTION = 18;
const SCATTER_SELECT_RADIUS_M = 1_000_000;
const SCATTER_FIXED_LEVEL_DEPTH = 1;
const WORLD_SEED = 4_242;

const TREE_LAYER_ID = 'trees';
const TREE_SPECIES_ID = 'physics-pine';
const TREE_GENERATOR_VERSION = 1;
const TREE_CANDIDATE_POOL_SIZE = 14;
const TREE_DENSITY_01 = 0.4;
const TREE_TRUNK_HALF_HEIGHT_M = 1.6;
const TREE_TRUNK_RADIUS_M = 0.35;
/**
 * Contact momentum (kg·m/s) above which a tree is felled — see
 * estimateScatterImpactMomentumNs. This is the base for the species'
 * collider.impactThresholdNs, which buildScatterColliderDescriptors then
 * scales per-instance by tree size, so bigger trees resist more.
 *
 * Tuned against rover mass/speed (650kg, 7 m/s walk / 12.6 m/s sprint):
 * walk momentum (~4550 Ns) fells smaller trees but not the largest, sprint
 * (~8190 Ns) fells reliably across the whole size range, and a max-dialed
 * thrown rock (80kg @ 45 m/s = 3600 Ns) can still fell the smallest trees.
 */
const TREE_IMPACT_THRESHOLD_NS = 4000;

const TREE_RULES: ScatterPlacementRules = {
  alignment: 'align-to-surface-up',
  slopeMax01: 0.6,
};
const TREE_SCALE: ScatterScaleRange = { min: 0.85, max: 1.35 };
const TREE_SPECIES: ScatterSpeciesDefinition = {
  id: TREE_SPECIES_ID,
  assetKey: 'physics-pine',
  placement: TREE_RULES,
  lods: [{ kind: 'mesh', maxDistanceM: Infinity, castShadow: true }],
  collider: {
    shape: 'cylinder',
    params: [TREE_TRUNK_HALF_HEIGHT_M, TREE_TRUNK_RADIUS_M],
    impactThresholdNs: TREE_IMPACT_THRESHOLD_NS,
  },
};

/**
 * Ring centre leads the rover by velocity (computeScatterPhysicsAnchor);
 * asymmetric add/remove radii give a hysteresis band so idling near the edge
 * doesn't churn colliders every frame (diffScatterPhysicsResidency).
 */
const PHYSICS_ADD_RADIUS_M = 55;
const PHYSICS_REMOVE_RADIUS_M = 85;
const PHYSICS_LOOK_AHEAD_S = 1.2;
const PHYSICS_MAX_LOOK_AHEAD_M = 30;

const ROVER_MASS_KG = 650;
const ROVER_SPEED_MPS = 7;
const ROVER_SPRINT_MULTIPLIER = 1.8;
const ROVER_SIZE: Vector3Tuple = [2.2, 1.1, 3.6];
const ROVER_SPAWN_POSITION: Vector3Tuple = [0, 3, -24];

/**
 * Granite-ish density so the "mass" slider also drives the thrown rock's
 * actual Jolt-simulated mass via its radius, not just the momentum formula.
 */
const PROJECTILE_DENSITY_KG_M3 = 2600;
const PROJECTILE_MASS_MIN_KG = 2;
const PROJECTILE_MASS_MAX_KG = 80;
const PROJECTILE_MASS_DEFAULT_KG = 25;
const PROJECTILE_SPEED_MIN_MPS = 5;
const PROJECTILE_SPEED_MAX_MPS = 45;
const PROJECTILE_SPEED_DEFAULT_MPS = 22;
const MAX_CONCURRENT_PROJECTILES = 10;

const UP_AXIS = new Vector3(0, 1, 0);

function gentleUndulationM(x: number, z: number): number {
  return Math.sin(x / 70) * 1.4 + Math.cos(z / 85) * 1.1;
}

class PhysicsLabTerrainField implements ITerrainField {
  readonly minElevationM = -4;
  readonly maxElevationM = 4;

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    return { elevationM: gentleUndulationM(x, z) };
  }

  sampleBatch(
    positions: Float64Array,
    out = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let i = 0; i < out.length; i++) {
      out[i] = gentleUndulationM(positions[i * 3], positions[i * 3 + 2]);
    }
    return out;
  }
}

interface IPhysicsCell {
  readonly anchorWorldM: TerrainVector3;
  readonly instances: readonly ITerrainScatterInstance[];
}

interface IProjectile {
  readonly id: number;
  readonly spawnPositionM: Vector3Tuple;
  readonly velocityMps: Vector3Tuple;
  readonly radiusM: number;
  readonly massKg: number;
}

interface ILastImpact {
  readonly momentumNs: number;
  readonly felled: boolean;
  readonly source: 'rover' | 'projectile';
}

/**
 * Phase 3 proof-of-concept: a driveable rover + throwable rocks exercising
 * ScatterJoltColliderAdapter, the physics residency ring, the removal
 * overlay, and impact-momentum felling against real Jolt bodies. See
 * docs/runbook/005a_scatter_phase3_plan.md step 6.
 */
@Component({
  selector: 'app-scatter-physics-lab-page',
  imports: [RouterLink, EngineModule, JoltPhysicsModule, DecimalPipe],
  templateUrl: './scatter-physics-lab-page.component.html',
  styleUrl: './scatter-physics-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      webGLRendererParameters: { logarithmicDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class ScatterPhysicsLabPageComponent {
  protected readonly roverSpawnPositionM = ROVER_SPAWN_POSITION;
  protected readonly roverBoxParams = ROVER_SIZE;

  readonly physicsDebug = signal(false);
  readonly projectileMassKg = signal(PROJECTILE_MASS_DEFAULT_KG);
  readonly projectileSpeedMps = signal(PROJECTILE_SPEED_DEFAULT_MPS);
  readonly projectiles = signal<readonly IProjectile[]>([]);
  readonly overlay = signal<IScatterRemovalOverlay>(
    createScatterRemovalOverlay(),
  );
  readonly pickedInstanceId = signal<ScatterInstanceId | undefined>(
    undefined,
  );
  readonly felledCount = signal(0);
  readonly lastImpact = signal<ILastImpact | undefined>(undefined);
  readonly residentCellCount = signal(0);
  readonly residentInstanceCount = signal(0);
  readonly treeTotalCount = signal(0);
  readonly removedCount = computed(() => this.overlay().removedIds.size);

  readonly initialCameraPosition = signal<Vector3Tuple>([0, 24, -58]);
  readonly initialTarget = signal<Vector3Tuple>([0, 3, 0]);

  private readonly engine = inject(EngineService);
  private readonly physicsComponent = viewChild(JoltPhysicsComponent);
  private readonly roverRigidBody =
    viewChild<JoltRigidBodyComponent>('rover');

  private readonly domain = new PlaneTerrainDomain(PLANE_PATCH_SIZE_M);
  private readonly field = new PhysicsLabTerrainField();
  private readonly groundMaterial = new MeshStandardMaterial({
    color: '#5c744a',
    roughness: 0.95,
  });
  private readonly treeGeometry = new ConeGeometry(0.9, 3.2, 7);
  private readonly treeMaterial = new MeshStandardMaterial({
    color: '#3f8f4c',
    roughness: 0.85,
  });
  private readonly pickRaycaster = new Raycaster();
  private readonly sceneryGroup = new Group();
  private readonly debugRingAdd = new Mesh(
    new RingGeometry(PHYSICS_ADD_RADIUS_M - 0.4, PHYSICS_ADD_RADIUS_M, 64),
    new MeshBasicMaterial({
      color: '#65e08a',
      side: DoubleSide,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  private readonly debugRingRemove = new Mesh(
    new RingGeometry(
      PHYSICS_REMOVE_RADIUS_M - 0.4,
      PHYSICS_REMOVE_RADIUS_M,
      64,
    ),
    new MeshBasicMaterial({
      color: '#f2a154',
      side: DoubleSide,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    }),
  );

  private readonly cellsByKey = new Map<string, IPhysicsCell>();
  private readonly residencyCandidates: IScatterResidencyCandidate[] = [];
  private readonly groundPatches: ITerrainPatchMesh<IPlaneTerrainPatchAddress>[] =
    [];
  private allTreeInstances: readonly ITerrainScatterInstance[] = [];
  private treeMesh?: InstancedMesh;

  private groundAdapter?: TerrainJoltColliderAdapter;
  private colliderAdapter?: ScatterJoltColliderAdapter;
  private groundBuilt = false;
  private residentCellKeys: ReadonlySet<string> = new Set();
  private loggedDiagnostics = false;
  private readonly pendingFelledInstanceIds = new Set<ScatterInstanceId>();

  private readonly pressedKeys = new Set<string>();
  private nextProjectileId = 1;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#071018');

    this.debugRingAdd.rotation.x = -Math.PI / 2;
    this.debugRingRemove.rotation.x = -Math.PI / 2;
    this.debugRingAdd.visible = false;
    this.debugRingRemove.visible = false;

    this.buildTerrainAndScatter();
    this.engine.scene.add(
      this.sceneryGroup,
      this.debugRingAdd,
      this.debugRingRemove,
    );

    effect(() => this.rebuildTreeMesh(this.overlay()));

    const onKeyDown = (event: KeyboardEvent) =>
      this.pressedKeys.add(event.code);
    const onKeyUp = (event: KeyboardEvent) =>
      this.pressedKeys.delete(event.code);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    this.engine.click$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((event) => this.pickAndCutTree(event));

    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => {
        this.driveRover();
        this.updatePhysicsWorld();
      });

    destroyRef.onDestroy(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      this.groundAdapter?.dispose();
      this.colliderAdapter?.dispose();
      this.disposeScenery();
      this.groundMaterial.dispose();
      this.treeGeometry.dispose();
      this.treeMaterial.dispose();
      this.debugRingAdd.geometry.dispose();
      (this.debugRingAdd.material as MeshBasicMaterial).dispose();
      this.debugRingRemove.geometry.dispose();
      (this.debugRingRemove.material as MeshBasicMaterial).dispose();
      this.engine.scene.background = previousBackground;
    });
  }

  togglePhysicsDebug(): void {
    this.physicsDebug.update((enabled) => !enabled);
  }

  setProjectileMass(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.projectileMassKg.set(
      Math.max(
        PROJECTILE_MASS_MIN_KG,
        Math.min(PROJECTILE_MASS_MAX_KG, value),
      ),
    );
  }

  setProjectileSpeed(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.projectileSpeedMps.set(
      Math.max(
        PROJECTILE_SPEED_MIN_MPS,
        Math.min(PROJECTILE_SPEED_MAX_MPS, value),
      ),
    );
  }

  /** Spawns a rock from the camera along its look direction — "aim" is orbiting the camera, "fire" is this button. */
  throwProjectile(): void {
    const camera = this.engine.camera;
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const spawnPosition = camera.position.clone().addScaledVector(forward, 2.5);
    const massKg = this.projectileMassKg();
    const speedMps = this.projectileSpeedMps();
    const radiusM = Math.cbrt(
      (3 * massKg) / (4 * Math.PI * PROJECTILE_DENSITY_KG_M3),
    );
    const velocity = forward.clone().multiplyScalar(speedMps);

    const projectile: IProjectile = {
      id: this.nextProjectileId++,
      spawnPositionM: [spawnPosition.x, spawnPosition.y, spawnPosition.z],
      velocityMps: [velocity.x, velocity.y, velocity.z],
      radiusM,
      massKg,
    };

    this.projectiles.update((current) => {
      const next = [...current, projectile];
      return next.length > MAX_CONCURRENT_PROJECTILES
        ? next.slice(next.length - MAX_CONCURRENT_PROJECTILES)
        : next;
    });
  }

  protected onRoverContact(event: IContactAddedEvent): void {
    const velocity = this.roverRigidBody()?.body()?.GetLinearVelocity();
    if (!velocity) return;
    this.handleImpact(
      event,
      ROVER_MASS_KG,
      [velocity.GetX(), velocity.GetY(), velocity.GetZ()],
      'rover',
    );
  }

  protected onProjectileContact(
    event: IContactAddedEvent,
    projectile: IProjectile,
    projectileBody: JoltRigidBodyComponent,
  ): void {
    const velocity = projectileBody.body()?.GetLinearVelocity();
    if (!velocity) return;
    this.handleImpact(
      event,
      projectile.massKg,
      [velocity.GetX(), velocity.GetY(), velocity.GetZ()],
      'projectile',
    );
  }

  /**
   * Shared felling path for both the rover and thrown rocks — mirrors the
   * plan's step 5: resolve the hit instance via the adapter, estimate contact
   * momentum (no solved impulse exists yet at OnContactAdded time), and remove
   * from the same overlay the render batch reads.
   */
  private handleImpact(
    event: IContactAddedEvent,
    massKg: number,
    velocityMps: readonly [number, number, number],
    source: 'rover' | 'projectile',
  ): void {
    if (!this.colliderAdapter) return;
    const manifold = event.manifold;
    const instanceId = this.colliderAdapter.resolveInstanceId(
      event.otherBody,
      event.otherSubShapeId,
    );
    if (instanceId === undefined) return;

    const normal = manifold.mWorldSpaceNormal;
    const momentumNs = estimateScatterImpactMomentumNs({
      otherBodyMassKg: massKg,
      otherBodyVelocityMps: velocityMps,
      contactNormal: [normal.GetX(), normal.GetY(), normal.GetZ()],
    });
    const thresholdNs =
      this.colliderAdapter.resolveImpactThresholdNs(instanceId) ?? TREE_IMPACT_THRESHOLD_NS;
    const felled = momentumNs >= thresholdNs;
    this.lastImpact.set({ momentumNs, felled, source });
    if (!felled) return;

    if (this.pendingFelledInstanceIds.has(instanceId)) return;
    this.pendingFelledInstanceIds.add(instanceId);

    // Contact callbacks run inside Jolt's physics update. Removing and
    // rebuilding the contacted compound body from here can lock the update.
    // Defer all world mutation until the WASM Step call has returned.
    queueMicrotask(() => {
      this.pendingFelledInstanceIds.delete(instanceId);
      const colliderAdapter = this.colliderAdapter;
      if (!colliderAdapter) return;

      this.overlay.update((current) =>
        withScatterInstanceRemoved(current, instanceId),
      );
      colliderAdapter.removeInstance(instanceId);
      this.felledCount.update((count) => count + 1);
    });
  }

  private pickAndCutTree(event: MouseEvent | null): void {
    if (!event || !this.treeMesh) return;
    const resolution = this.engine.resolution$.value;
    const mouseNdc = new Vector2(
      (event.offsetX / resolution.width) * 2 - 1,
      -(event.offsetY / resolution.height) * 2 + 1,
    );
    this.pickRaycaster.setFromCamera(mouseNdc, this.engine.camera);
    const intersections = this.pickRaycaster.intersectObject(
      this.treeMesh,
      false,
    );
    if (intersections.length === 0) return;
    const instanceId = pickScatterInstanceId(intersections[0]);
    if (instanceId === undefined) return;

    this.pickedInstanceId.set(instanceId);
    this.overlay.update((current) =>
      withScatterInstanceRemoved(current, instanceId),
    );
    this.colliderAdapter?.removeInstance(instanceId);
  }

  /** Camera-forward-relative WASD, mirroring the terrain-lab character controller — imperative velocity control, gravity's Y component is read back and preserved each tick. */
  private driveRover(): void {
    const metadata = this.physicsComponent()?.physicsService.metaData$.value;
    const body = this.roverRigidBody()?.body();
    if (!metadata || !body) return;

    const cameraForward = new Vector3();
    this.engine.camera.getWorldDirection(cameraForward);
    cameraForward.y = 0;
    if (cameraForward.lengthSq() < 0.0001) cameraForward.set(0, 0, -1);
    cameraForward.normalize();
    const right = new Vector3()
      .crossVectors(cameraForward, UP_AXIS)
      .normalize();

    const movement = new Vector3();
    if (this.pressedKeys.has('KeyW')) movement.add(cameraForward);
    if (this.pressedKeys.has('KeyS')) movement.sub(cameraForward);
    if (this.pressedKeys.has('KeyD')) movement.add(right);
    if (this.pressedKeys.has('KeyA')) movement.sub(right);

    let targetX = 0;
    let targetZ = 0;
    if (movement.lengthSq() > 0) {
      const speed =
        ROVER_SPEED_MPS *
        (this.pressedKeys.has('ShiftLeft') ||
        this.pressedKeys.has('ShiftRight')
          ? ROVER_SPRINT_MULTIPLIER
          : 1);
      movement.normalize().multiplyScalar(speed);
      targetX = movement.x;
      targetZ = movement.z;

      const heading = Math.atan2(movement.x, movement.z);
      const rotation = new Jolt.Quat(
        0,
        Math.sin(heading / 2),
        0,
        Math.cos(heading / 2),
      );
      metadata.bodyInterface.SetRotation(
        body.GetID(),
        rotation,
        Jolt.EActivation_Activate,
      );
      Jolt.destroy(rotation);
    }

    const currentVelocity = body.GetLinearVelocity();
    const joltVelocity = new Jolt.Vec3(
      targetX,
      currentVelocity.GetY(),
      targetZ,
    );
    metadata.bodyInterface.SetLinearVelocity(body.GetID(), joltVelocity);
    Jolt.destroy(joltVelocity);
  }

  /**
   * Lazily builds the static ground colliders once, then each frame:
   * derives the physics anchor from the rover's own position + velocity
   * (never the camera), diffs residency against the precomputed cell
   * candidates, and reconciles ScatterJoltColliderAdapter — the exact path
   * 005a_scatter_phase3_plan.md step 6 asks this demo to prove.
   */
  private updatePhysicsWorld(): void {
    const metadata = this.physicsComponent()?.physicsService.metaData$.value;
    if (!metadata) return;

    const groundAdapter = (this.groundAdapter ??= new TerrainJoltColliderAdapter(
      metadata,
    ));
    const colliderAdapter = (this.colliderAdapter ??=
      new ScatterJoltColliderAdapter(metadata));

    if (!this.groundBuilt) {
      this.groundPatches.forEach((patch, index) => {
        groundAdapter.add({ key: `ground:${index}`, mesh: patch });
      });
      this.groundBuilt = true;
    }

    const roverBody = this.roverRigidBody()?.body();
    if (!roverBody) return;

    const position = roverBody.GetPosition();
    const velocity = roverBody.GetLinearVelocity();
    const anchorWorldM = computeScatterPhysicsAnchor({
      positionM: [position.GetX(), position.GetY(), position.GetZ()],
      velocityMps: [velocity.GetX(), velocity.GetY(), velocity.GetZ()],
      lookAheadSeconds: PHYSICS_LOOK_AHEAD_S,
      maxLookAheadM: PHYSICS_MAX_LOOK_AHEAD_M,
    });

    this.debugRingAdd.position.set(anchorWorldM[0], 0.06, anchorWorldM[2]);
    this.debugRingRemove.position.set(anchorWorldM[0], 0.05, anchorWorldM[2]);
    this.debugRingAdd.visible = this.physicsDebug();
    this.debugRingRemove.visible = this.physicsDebug();

    const diff = diffScatterPhysicsResidency({
      residentKeys: this.residentCellKeys,
      candidates: this.residencyCandidates,
      anchorWorldM,
      addRadiusM: PHYSICS_ADD_RADIUS_M,
      removeRadiusM: PHYSICS_REMOVE_RADIUS_M,
    });
    this.residentCellKeys = diff.residentKeys;

    if (!this.loggedDiagnostics && this.residencyCandidates.length > 0) {
      this.loggedDiagnostics = true;
      let nearest = Infinity;
      for (const c of this.residencyCandidates) {
        const d = Math.hypot(
          c.centreWorldM[0] - anchorWorldM[0],
          c.centreWorldM[1] - anchorWorldM[1],
          c.centreWorldM[2] - anchorWorldM[2],
        );
        if (d < nearest) nearest = d;
      }
      console.warn('[scatter-physics-lab] diag', {
        anchorWorldM,
        candidateCount: this.residencyCandidates.length,
        nearestCandidateDistanceM: nearest,
        addRadiusM: PHYSICS_ADD_RADIUS_M,
        toAddLength: diff.toAdd.length,
        sampleCandidate: this.residencyCandidates[0],
      });
    }

    if (diff.toAdd.length > 0) {
      const overlay = this.overlay();
      for (const cellKey of diff.toAdd) {
        const cell = this.cellsByKey.get(cellKey);
        if (!cell) continue;
        const descriptors = buildScatterColliderDescriptors({
          cellKey,
          anchorWorldM: cell.anchorWorldM,
          instances: cell.instances,
          species: TREE_SPECIES,
          scale: TREE_SCALE,
          overlay,
        });
        colliderAdapter.add(descriptors);
        console.warn('[scatter-physics-lab] add cell', {
          cellKey,
          instanceCount: cell.instances.length,
          descriptorCount: descriptors.descriptors.length,
          residentCellCountAfter: colliderAdapter.residentCellCount,
        });
      }
    }
    colliderAdapter.reconcile(diff.residentKeys);
    this.residentCellCount.set(colliderAdapter.residentCellCount);
    this.residentInstanceCount.set(colliderAdapter.residentInstanceCount);
  }

  /** Rebuilds the single tree InstancedMesh whenever the overlay changes — the same overlay collider reconciliation reads, so a felled/cut tree disappears from both at once. */
  private rebuildTreeMesh(overlay: IScatterRemovalOverlay): void {
    const visibleInstances = filterRemovedScatterInstances(
      this.allTreeInstances,
      overlay,
    );
    if (this.treeMesh) this.treeMesh.removeFromParent();
    const mesh = buildScatterInstancedMesh({
      instances: visibleInstances,
      geometry: this.treeGeometry,
      material: this.treeMaterial,
      rules: TREE_RULES,
      scale: TREE_SCALE,
      anchorWorldM: [0, 0, 0],
      castShadow: true,
    });
    this.sceneryGroup.add(mesh);
    this.treeMesh = mesh;
  }

  private buildTerrainAndScatter(): void {
    const roots: IPlaneTerrainPatchAddress[] = [];
    for (let z = -GRID_RADIUS; z <= GRID_RADIUS; z++) {
      for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x++) {
        roots.push({ level: 0, x, z });
      }
    }

    const allInstances: ITerrainScatterInstance[] = [];
    for (const address of roots) {
      const patch = generateTerrainPatchMesh(this.field, this.domain, {
        address,
        resolution: TERRAIN_RESOLUTION,
      });
      this.groundPatches.push(patch);
      this.sceneryGroup.add(this.buildGroundMesh(patch));

      const cellAddresses = selectFixedLevelScatterCells(this.domain, {
        roots: [address],
        anchorWorldM: [0, 0, 0],
        radiusM: SCATTER_SELECT_RADIUS_M,
        fixedLevel: address.level + SCATTER_FIXED_LEVEL_DEPTH,
        getLevel: (a) => a.level,
      });

      for (const cellAddress of cellAddresses) {
        const cellKey = `plane:${cellAddress.level}:${cellAddress.x}:${cellAddress.z}`;
        const bounds = this.domain.getPatchBounds(cellAddress);
        const anchorWorldM = this.domain.getSurfacePosition(
          cellAddress,
          (bounds.minU + bounds.maxU) / 2,
          (bounds.minV + bounds.maxV) / 2,
          0,
        );
        const instances = generateTerrainScatterInstances({
          field: this.field,
          domain: this.domain,
          cellAddress,
          cellKey,
          identity: {
            worldSeed: WORLD_SEED,
            layerId: TREE_LAYER_ID,
            speciesId: TREE_SPECIES_ID,
            generatorVersion: TREE_GENERATOR_VERSION,
          },
          candidatePoolSize: TREE_CANDIDATE_POOL_SIZE,
          rules: TREE_RULES,
          baseDensity01: TREE_DENSITY_01,
        });
        this.cellsByKey.set(cellKey, { anchorWorldM, instances });
        this.residencyCandidates.push({ key: cellKey, centreWorldM: anchorWorldM });
        allInstances.push(...instances);
      }
    }

    this.allTreeInstances = allInstances;
    this.treeTotalCount.set(allInstances.length);
  }

  private buildGroundMesh(
    patch: ITerrainPatchMesh<IPlaneTerrainPatchAddress>,
  ): Mesh {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(patch.surface.positions, 3),
    );
    geometry.setAttribute(
      'normal',
      new BufferAttribute(patch.surface.normals, 3),
    );
    geometry.setIndex(new BufferAttribute(patch.surface.indices, 1));
    const mesh = new Mesh(geometry, this.groundMaterial);
    mesh.receiveShadow = true;
    mesh.position.set(
      patch.centerWorldM[0],
      patch.centerWorldM[1],
      patch.centerWorldM[2],
    );
    return mesh;
  }

  private disposeScenery(): void {
    this.sceneryGroup.traverse((object) => {
      if (object instanceof Mesh && object.geometry !== this.treeGeometry) {
        object.geometry.dispose();
      }
    });
    this.sceneryGroup.removeFromParent();
  }
}
