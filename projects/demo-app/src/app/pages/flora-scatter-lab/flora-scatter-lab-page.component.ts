import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  JoltPhysicsComponent,
  JoltPhysicsModule,
  ScatterJoltColliderAdapter,
  TerrainJoltColliderAdapter,
  type IContactAddedEvent,
} from 'triangular-engine/jolt';
import {
  buildFloraMesh,
  deriveFloraSockets,
  deriveFloraTrunkCollider,
  FLORA_OAK_ARCHETYPE,
  FLORA_OAK_COLORS,
  generateFloraSkeleton,
  hashProceduralKey,
  transformProceduralSocket,
  type FloraSocketKind,
  type IFloraColliderDescriptor,
  type IFloraSocket,
  type IProceduralInstanceTransform,
} from 'triangular-engine/procedural';
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
  computeScatterInstanceMatrix,
  enableScatterWindSway,
  generateTerrainScatterInstances,
  pickScatterInstanceId,
  selectFixedLevelScatterCells,
  type IScatterWindHandle,
  type ITerrainScatterInstance,
  type ScatterInstanceId,
  type ScatterPlacementRules,
  type ScatterScaleRange,
  type ScatterSpeciesDefinition,
  type ScatterWindDefinition,
} from 'triangular-engine/scatter';

const PLANE_PATCH_SIZE_M = 26;
const GRID_RADIUS = 1;
const TERRAIN_RESOLUTION = 16;
const SCATTER_SELECT_RADIUS_M = 1_000_000;
const SCATTER_FIXED_LEVEL_DEPTH = 1;
const WORLD_SEED = 7_331;

const TREE_LAYER_ID = 'flora-trees';
/** Shared oak archetype from flora-species-catalog — see that page for M1/M2's socket-eligibility tuning notes. */
const DEMO_OAK_ARCHETYPE = FLORA_OAK_ARCHETYPE;
const TREE_SPECIES_ID = DEMO_OAK_ARCHETYPE.id;
const TREE_GENERATOR_VERSION = 1;
const TREE_CANDIDATE_POOL_SIZE = 12;
const TREE_DENSITY_01 = 0.45;
const TREE_RULES: ScatterPlacementRules = {
  alignment: 'align-to-surface-up',
  slopeMax01: 0.6,
};
const TREE_SCALE: ScatterScaleRange = { min: 0.85, max: 1.3 };
const TREE_WIND: ScatterWindDefinition = { strength: 0.05, frequency: 0.9 };

/** M4's "6-10 variants" — one skeleton+mesh generation per seed, scatter instances them normally (see docs/runbook/014). */
const VARIANT_COUNT = 6;
const FLORA_BASE_SEED = 1;

const TRUNK_COLOR = new Color(FLORA_OAK_COLORS.trunkHex);
const LEAF_COLOR = new Color(FLORA_OAK_COLORS.leafHex);

const SOCKET_GIZMO_RADIUS_M = 0.14;
const SOCKET_GIZMO_COLOR_BY_KIND: Record<FloraSocketKind, string> = {
  perch: '#f2b134',
  'nest-cavity': '#8859ff',
  'fruit-slot': '#ff5a5a',
  'flower-head': '#ff8fd6',
  'climb-path': '#4fd1c5',
  'root-base': '#9fb3c8',
};

const BALL_RADIUS_M = 0.35;
const BALL_SPAWN_HEIGHT_M = 9;
const MAX_CONCURRENT_BALLS = 6;

function gentleUndulationM(x: number, z: number): number {
  return Math.sin(x / 24) * 1.6 + Math.cos(z / 30) * 1.2;
}

class FloraScatterLabTerrainField implements ITerrainField {
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

interface IFloraVariant {
  readonly geometry: BufferGeometry;
  readonly sockets: readonly IFloraSocket[];
  readonly collider?: IFloraColliderDescriptor;
}

interface IDroppedBall {
  readonly id: number;
  readonly spawnPositionM: Vector3Tuple;
}

interface ILastPhysicsContact {
  readonly instanceId: ScatterInstanceId;
  readonly variantIndex: number;
}

/**
 * M4 (scatter integration) slice: registers a flora-generated species with
 * scatter's existing placement/instancing/physics pipeline instead of
 * inventing a parallel one. See docs/runbook/014_procedural_sublibrary.md,
 * "Milestone 4: scatter integration".
 */
@Component({
  selector: 'app-flora-scatter-lab-page',
  imports: [RouterLink, EngineModule, JoltPhysicsModule],
  templateUrl: './flora-scatter-lab-page.component.html',
  styleUrl: './flora-scatter-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class FloraScatterLabPageComponent {
  readonly physicsDebug = signal(false);
  readonly balls = signal<readonly IDroppedBall[]>([]);
  readonly treeInstanceCount = signal(0);
  readonly cellCount = signal(0);
  readonly pickedInstanceId = signal<ScatterInstanceId | undefined>(undefined);
  readonly pickedVariantIndex = signal<number | undefined>(undefined);
  readonly pickedSocketCount = signal(0);
  readonly lastPhysicsContact = signal<ILastPhysicsContact | undefined>(undefined);

  readonly socketKinds = Object.keys(SOCKET_GIZMO_COLOR_BY_KIND) as FloraSocketKind[];
  readonly socketGizmoColorByKind = SOCKET_GIZMO_COLOR_BY_KIND;
  readonly variantCount = VARIANT_COUNT;
  readonly ballRadiusM = BALL_RADIUS_M;

  readonly initialCameraPosition = signal<Vector3Tuple>([0, 16, -34]);
  readonly initialTarget = signal<Vector3Tuple>([0, 2, 0]);

  private readonly engine = inject(EngineService);
  private readonly physicsComponent = viewChild(JoltPhysicsComponent);

  private readonly domain = new PlaneTerrainDomain(PLANE_PATCH_SIZE_M);
  private readonly field = new FloraScatterLabTerrainField();
  private readonly groundMaterial = new MeshStandardMaterial({
    color: '#4c5c3a',
    roughness: 0.95,
  });
  private readonly treeMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
  });
  private readonly pickRaycaster = new Raycaster();
  private readonly sceneryGroup = new Group();
  private readonly socketGizmoGeometry = new SphereGeometry(SOCKET_GIZMO_RADIUS_M, 8, 6);
  private readonly socketGizmoMaterialByKind = new Map(
    Object.entries(SOCKET_GIZMO_COLOR_BY_KIND).map(
      ([kind, color]) => [kind as FloraSocketKind, new MeshBasicMaterial({ color, depthTest: false })] as const,
    ),
  );
  private readonly socketGizmoGroup = new Group();

  private readonly variants: IFloraVariant[] = this.buildVariants();
  private readonly instanceById = new Map<ScatterInstanceId, ITerrainScatterInstance>();
  private readonly variantIndexByInstanceId = new Map<ScatterInstanceId, number>();
  private readonly groundPatches: ITerrainPatchMesh<IPlaneTerrainPatchAddress>[] = [];

  private treeWindHandle!: IScatterWindHandle;
  private pickableMeshes: InstancedMesh[] = [];
  private groundAdapter?: TerrainJoltColliderAdapter;
  private colliderAdapter?: ScatterJoltColliderAdapter;
  private worldBuilt = false;
  private nextBallId = 1;
  /** Set by buildWorld(), consumed once Jolt's world metadata is available — see ensurePhysicsBuilt. */
  private pendingColliderInstancesByVariant?: ITerrainScatterInstance[][];

  private readonly scratchPosition = new Vector3();
  private readonly scratchQuaternion = new Quaternion();
  private readonly scratchScale = new Vector3();

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#0b1208');

    this.treeWindHandle = enableScatterWindSway(this.treeMaterial, TREE_WIND, {
      useVertexWindWeight: true,
    });

    this.engine.scene.add(this.sceneryGroup, this.socketGizmoGroup);
    this.buildWorld();

    this.engine.elapsedTime$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((elapsedTimeS) => this.treeWindHandle.setTimeS(elapsedTimeS));

    this.engine.click$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((event) => this.pickInstanceAt(event));

    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => this.ensurePhysicsBuilt());

    destroyRef.onDestroy(() => {
      this.groundAdapter?.dispose();
      this.colliderAdapter?.dispose();
      this.disposeScenery();
      this.groundMaterial.dispose();
      this.treeMaterial.dispose();
      this.socketGizmoGeometry.dispose();
      for (const material of this.socketGizmoMaterialByKind.values()) material.dispose();
      for (const variant of this.variants) variant.geometry.dispose();
      this.engine.scene.background = previousBackground;
    });
  }

  togglePhysicsDebug(): void {
    this.physicsDebug.update((enabled) => !enabled);
  }

  /** Drops a dynamic sphere from above the view — proves a real Jolt body collides with a flora trunk collider, not just the debug wireframe lining up visually. */
  dropBall(): void {
    const camera = this.engine.camera;
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const spawnPosition = camera.position
      .clone()
      .addScaledVector(forward, 10);
    spawnPosition.y = BALL_SPAWN_HEIGHT_M;

    const ball: IDroppedBall = {
      id: this.nextBallId++,
      spawnPositionM: [spawnPosition.x, spawnPosition.y, spawnPosition.z],
    };
    this.balls.update((current) => {
      const next = [...current, ball];
      return next.length > MAX_CONCURRENT_BALLS
        ? next.slice(next.length - MAX_CONCURRENT_BALLS)
        : next;
    });
  }

  protected onBallContact(event: IContactAddedEvent): void {
    if (!this.colliderAdapter) return;
    const instanceId = this.colliderAdapter.resolveInstanceId(
      event.otherBody,
      event.otherSubShapeId,
    );
    if (instanceId === undefined) return;
    const variantIndex = this.variantIndexByInstanceId.get(instanceId);
    if (variantIndex === undefined) return;
    this.lastPhysicsContact.set({ instanceId, variantIndex });
  }

  /** Generates the species' seeded variants once — mesh + sockets + trunk collider per seed, per docs/runbook/014's "6-10 variants" scope. */
  private buildVariants(): IFloraVariant[] {
    const variants: IFloraVariant[] = [];
    for (let i = 0; i < VARIANT_COUNT; i++) {
      const seed = FLORA_BASE_SEED + i;
      const skeleton = generateFloraSkeleton(DEMO_OAK_ARCHETYPE, seed);
      const { geometry } = buildFloraMesh(skeleton, DEMO_OAK_ARCHETYPE);
      this.colorizeByWindWeight(geometry);
      variants.push({
        geometry,
        sockets: deriveFloraSockets(skeleton, DEMO_OAK_ARCHETYPE, seed),
        collider: deriveFloraTrunkCollider(skeleton, DEMO_OAK_ARCHETYPE),
      });
    }
    return variants;
  }

  private colorizeByWindWeight(geometry: BufferGeometry): void {
    const windWeight = geometry.getAttribute('windWeight');
    const colors = new Float32Array(windWeight.count * 3);
    const blended = new Color();
    for (let i = 0; i < windWeight.count; i++) {
      blended.copy(TRUNK_COLOR).lerp(LEAF_COLOR, windWeight.getX(i));
      colors[i * 3] = blended.r;
      colors[i * 3 + 1] = blended.g;
      colors[i * 3 + 2] = blended.b;
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  }

  /** Deterministic per-instance variant pick — scatter has no per-instance mesh-variant primitive yet, so this demo buckets instances into one InstancedMesh per variant instead (see the lab page blurb / runbook M4 notes). */
  private variantIndexForInstance(instanceId: ScatterInstanceId): number {
    return hashProceduralKey(instanceId) % VARIANT_COUNT;
  }

  private buildWorld(): void {
    const roots: IPlaneTerrainPatchAddress[] = [];
    for (let z = -GRID_RADIUS; z <= GRID_RADIUS; z++) {
      for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x++) {
        roots.push({ level: 0, x, z });
      }
    }

    const instancesByVariant: ITerrainScatterInstance[][] = Array.from(
      { length: VARIANT_COUNT },
      () => [],
    );
    let cellCount = 0;

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
      cellCount += cellAddresses.length;

      for (const cellAddress of cellAddresses) {
        const cellKey = `plane:${cellAddress.level}:${cellAddress.x}:${cellAddress.z}`;
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

        for (const instance of instances) {
          this.instanceById.set(instance.instanceId, instance);
          const variantIndex = this.variantIndexForInstance(instance.instanceId);
          this.variantIndexByInstanceId.set(instance.instanceId, variantIndex);
          instancesByVariant[variantIndex].push(instance);
        }
      }
    }

    const treeMeshes: InstancedMesh[] = [];
    for (let i = 0; i < VARIANT_COUNT; i++) {
      const instances = instancesByVariant[i];
      if (instances.length === 0) continue;
      const mesh = buildScatterInstancedMesh({
        instances,
        geometry: this.variants[i].geometry,
        material: this.treeMaterial,
        rules: TREE_RULES,
        scale: TREE_SCALE,
        anchorWorldM: [0, 0, 0],
        castShadow: true,
      });
      this.sceneryGroup.add(mesh);
      treeMeshes.push(mesh);
    }
    this.pickableMeshes = treeMeshes;
    this.treeInstanceCount.set(this.instanceById.size);
    this.cellCount.set(cellCount);

    // Physics colliders need Jolt's world metadata, only available once
    // <joltPhysics> has finished loading — built lazily from the tick loop
    // (see ensurePhysicsBuilt) once, since this field never streams/changes.
    this.pendingColliderInstancesByVariant = instancesByVariant;
  }

  private ensurePhysicsBuilt(): void {
    if (this.worldBuilt) return;
    const metadata = this.physicsComponent()?.physicsService.metaData$.value;
    if (!metadata) return;

    this.groundAdapter = new TerrainJoltColliderAdapter(metadata);
    this.groundPatches.forEach((patch, index) => {
      this.groundAdapter!.add({ key: `ground:${index}`, mesh: patch });
    });

    this.colliderAdapter = new ScatterJoltColliderAdapter(metadata);
    const instancesByVariant = this.pendingColliderInstancesByVariant ?? [];
    for (let i = 0; i < VARIANT_COUNT; i++) {
      const variant = this.variants[i];
      const instances = instancesByVariant[i] ?? [];
      if (!variant.collider || instances.length === 0) continue;

      const species: ScatterSpeciesDefinition = {
        id: `${TREE_SPECIES_ID}-v${i}`,
        assetKey: `${TREE_SPECIES_ID}-v${i}`,
        placement: TREE_RULES,
        lods: [{ kind: 'mesh', maxDistanceM: Infinity, castShadow: true }],
        collider: variant.collider,
      };
      const descriptors = buildScatterColliderDescriptors({
        cellKey: `variant:${i}`,
        anchorWorldM: [0, 0, 0],
        instances,
        species,
        scale: TREE_SCALE,
      });
      this.colliderAdapter.add(descriptors);
    }

    this.pendingColliderInstancesByVariant = undefined;
    this.worldBuilt = true;
  }

  /** Resolves a click into a stable instance id, then the M4 "instance transform × variant sockets" query — see transformProceduralSocket in triangular-engine/procedural. */
  private pickInstanceAt(event: MouseEvent | null): void {
    if (!event || this.pickableMeshes.length === 0) return;
    const resolution = this.engine.resolution$.value;
    const mouseNdc = new Vector2(
      (event.offsetX / resolution.width) * 2 - 1,
      -(event.offsetY / resolution.height) * 2 + 1,
    );
    this.pickRaycaster.setFromCamera(mouseNdc, this.engine.camera);
    const intersections = this.pickRaycaster.intersectObjects(this.pickableMeshes, false);
    this.clearSocketGizmos();

    if (intersections.length === 0) {
      this.pickedInstanceId.set(undefined);
      this.pickedVariantIndex.set(undefined);
      this.pickedSocketCount.set(0);
      return;
    }

    const instanceId = pickScatterInstanceId(intersections[0]);
    const instance = instanceId ? this.instanceById.get(instanceId) : undefined;
    const variantIndex = instanceId ? this.variantIndexByInstanceId.get(instanceId) : undefined;
    if (!instanceId || !instance || variantIndex === undefined) return;

    this.pickedInstanceId.set(instanceId);
    this.pickedVariantIndex.set(variantIndex);

    const matrix = computeScatterInstanceMatrix(instance, TREE_RULES, TREE_SCALE, [0, 0, 0]);
    matrix.decompose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
    const transform: IProceduralInstanceTransform = {
      positionM: [this.scratchPosition.x, this.scratchPosition.y, this.scratchPosition.z],
      quaternion: [
        this.scratchQuaternion.x,
        this.scratchQuaternion.y,
        this.scratchQuaternion.z,
        this.scratchQuaternion.w,
      ],
      scale: this.scratchScale.x,
    };

    const worldSockets = this.variants[variantIndex].sockets.map((socket) =>
      transformProceduralSocket(socket, transform),
    );
    this.pickedSocketCount.set(worldSockets.length);
    for (const socket of worldSockets) this.addSocketGizmo(socket);
  }

  private addSocketGizmo(socket: IFloraSocket): void {
    const material = this.socketGizmoMaterialByKind.get(socket.kind);
    if (!material) return;
    const gizmo = new Mesh(this.socketGizmoGeometry, material);
    gizmo.position.set(socket.positionM[0], socket.positionM[1], socket.positionM[2]);
    gizmo.renderOrder = 1;
    this.socketGizmoGroup.add(gizmo);
  }

  private clearSocketGizmos(): void {
    this.socketGizmoGroup.clear();
  }

  private buildGroundMesh(patch: ITerrainPatchMesh<IPlaneTerrainPatchAddress>): Mesh {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(patch.surface.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(patch.surface.normals, 3));
    geometry.setIndex(new BufferAttribute(patch.surface.indices, 1));
    const mesh = new Mesh(geometry, this.groundMaterial);
    mesh.receiveShadow = true;
    mesh.position.set(patch.centerWorldM[0], patch.centerWorldM[1], patch.centerWorldM[2]);
    return mesh;
  }

  private disposeScenery(): void {
    this.sceneryGroup.traverse((object) => {
      if (object instanceof Mesh && !this.variants.some((v) => v.geometry === object.geometry)) {
        object.geometry.dispose();
      }
    });
    this.sceneryGroup.removeFromParent();
    this.socketGizmoGroup.removeFromParent();
  }
}
