import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
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
  stepArrival,
  type ArrivalDefinition,
  type ArrivalState,
} from 'triangular-engine/animals';
import {
  buildFloraMesh,
  deriveFloraSockets,
  generateFloraSkeleton,
  hashProceduralKey,
  transformProceduralSocket,
  type FloraSocketKind,
  type IFloraArchetype,
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
  type ScatterWindDefinition,
} from 'triangular-engine/scatter';

const PLANE_PATCH_SIZE_M = 26;
const GRID_RADIUS = 1;
const TERRAIN_RESOLUTION = 16;
const SCATTER_SELECT_RADIUS_M = 1_000_000;
const SCATTER_FIXED_LEVEL_DEPTH = 1;
const WORLD_SEED = 7_331;

const TREE_LAYER_ID = 'flora-trees';
const TREE_SPECIES_ID = 'demo-oak';
const TREE_GENERATOR_VERSION = 1;
const TREE_CANDIDATE_POOL_SIZE = 12;
const TREE_DENSITY_01 = 0.45;
const TREE_RULES: ScatterPlacementRules = {
  alignment: 'align-to-surface-up',
  slopeMax01: 0.6,
};
const TREE_SCALE: ScatterScaleRange = { min: 0.85, max: 1.3 };
const TREE_WIND: ScatterWindDefinition = { strength: 0.05, frequency: 0.9 };

/** Same shape family as flora-lab / flora-scatter-lab's demo archetype. */
const DEMO_OAK_ARCHETYPE: IFloraArchetype = {
  schemaVersion: 1,
  id: TREE_SPECIES_ID,
  name: 'Demo oak',
  kind: 'tree',
  trunk: { heightM: [3.5, 5], radiusM: [0.28, 0.4], taper01: 0.45 },
  branching: {
    maxDepth: 3,
    childrenPerNode: [2, 3],
    spreadAngleRad: [0.6, 1.3],
    lengthFalloff01: 0.68,
  },
  foliage: { style: 'cluster-sphere', sizeM: [0.9, 1.5] },
  sockets: { perchesPerBranchDepth: { 1: 3, 2: 2 }, nestCavityChance01: 0.5, fruitSlotsMax: 4, flowerHeads: false },
  collider: { trunk: 'capsule' },
};
const VARIANT_COUNT = 6;
const FLORA_BASE_SEED = 1;

const TRUNK_COLOR = new Color('#6b4a2f');
const LEAF_COLOR = new Color('#4f8a3d');

const SOCKET_GIZMO_RADIUS_M = 0.14;
const SOCKET_GIZMO_COLOR_BY_KIND: Record<FloraSocketKind, string> = {
  perch: '#f2b134',
  'nest-cavity': '#8859ff',
  'fruit-slot': '#ff5a5a',
  'flower-head': '#ff8fd6',
  'climb-path': '#4fd1c5',
  'root-base': '#9fb3c8',
};
const OCCUPIED_GIZMO_COLOR = '#5a6b57';

const BIRD_SPAWN_POSITION_M: Vector3Tuple = [0, 14, -20];
const BIRD_ARRIVAL_DEFINITION: ArrivalDefinition = {
  speed: 6,
  steeringAcceleration: 10,
  turnRate: 3,
  arrivalRadiusM: 5,
  landingDistanceM: 0.2,
};
const UP_AXIS = new Vector3(0, 1, 0);

function gentleUndulationM(x: number, z: number): number {
  return Math.sin(x / 24) * 1.6 + Math.cos(z / 30) * 1.2;
}

class FloraAffordanceLabTerrainField implements ITerrainField {
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
}

type SocketOccupancy = 'perch-occupied' | 'fruit-picked';

/**
 * M5 (first affordance consumer) slice: one abstract bird flies to and lands
 * on a queried `perch` socket using triangular-engine/animals' minimal
 * seek-and-land primitive (`stepArrival`), and fruit-slot sockets can be
 * clicked to detach. A socket-ID-keyed occupancy map proves the Known-gap-#3
 * state contract without building BSP's real save-backed version. See
 * docs/runbook/014_procedural_sublibrary.md, "Milestone 5".
 */
@Component({
  selector: 'app-flora-affordance-lab-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './flora-affordance-lab-page.component.html',
  styleUrl: './flora-affordance-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class FloraAffordanceLabPageComponent {
  readonly treeInstanceCount = signal(0);
  readonly cellCount = signal(0);
  readonly pickedInstanceId = signal<ScatterInstanceId | undefined>(undefined);
  readonly pickedVariantIndex = signal<number | undefined>(undefined);
  readonly pickedSocketCount = signal(0);
  readonly availablePerchCount = signal(0);
  readonly socketState = signal<ReadonlyMap<string, SocketOccupancy>>(new Map());
  readonly birdActivity = signal<'idle' | 'seeking' | 'landed'>('idle');
  readonly birdTargetSocketId = signal<string | undefined>(undefined);

  readonly socketKinds = Object.keys(SOCKET_GIZMO_COLOR_BY_KIND) as FloraSocketKind[];
  readonly socketGizmoColorByKind = SOCKET_GIZMO_COLOR_BY_KIND;

  readonly initialCameraPosition = signal<Vector3Tuple>([0, 16, -34]);
  readonly initialTarget = signal<Vector3Tuple>([0, 2, 0]);

  private readonly engine = inject(EngineService);

  private readonly domain = new PlaneTerrainDomain(PLANE_PATCH_SIZE_M);
  private readonly field = new FloraAffordanceLabTerrainField();
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
  private readonly occupiedGizmoMaterial = new MeshBasicMaterial({
    color: OCCUPIED_GIZMO_COLOR,
    depthTest: false,
    transparent: true,
    opacity: 0.55,
  });
  private readonly socketGizmoGroup = new Group();

  private readonly birdGeometry = new ConeGeometry(0.35, 1.1, 8);
  private readonly birdMaterial = new MeshStandardMaterial({ color: '#ffcf4d', roughness: 0.5 });
  private readonly birdMesh = new Mesh(this.birdGeometry, this.birdMaterial);

  private readonly variants: IFloraVariant[] = this.buildVariants();
  private readonly instanceById = new Map<ScatterInstanceId, ITerrainScatterInstance>();
  private readonly variantIndexByInstanceId = new Map<ScatterInstanceId, number>();

  private treeWindHandle!: IScatterWindHandle;
  private pickableMeshes: InstancedMesh[] = [];
  private pickedSockets: readonly IFloraSocket[] = [];

  private birdState?: ArrivalState;
  private birdTargetPosition?: { x: number; y: number; z: number };

  private readonly scratchPosition = new Vector3();
  private readonly scratchQuaternion = new Quaternion();
  private readonly scratchScale = new Vector3();
  private readonly scratchHeading = new Vector3();

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#0b1208');

    this.treeWindHandle = enableScatterWindSway(this.treeMaterial, TREE_WIND, {
      useVertexWindWeight: true,
    });

    this.birdMesh.visible = false;
    this.birdMesh.position.set(...BIRD_SPAWN_POSITION_M);
    this.sceneryGroup.add(this.birdMesh);

    this.engine.scene.add(this.sceneryGroup, this.socketGizmoGroup);
    this.buildWorld();

    this.engine.elapsedTime$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((elapsedTimeS) => this.treeWindHandle.setTimeS(elapsedTimeS));

    this.engine.click$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((event) => this.onClick(event));

    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((dt) => this.onTick(dt));

    destroyRef.onDestroy(() => {
      this.disposeScenery();
      this.groundMaterial.dispose();
      this.treeMaterial.dispose();
      this.socketGizmoGeometry.dispose();
      this.occupiedGizmoMaterial.dispose();
      this.birdGeometry.dispose();
      this.birdMaterial.dispose();
      for (const material of this.socketGizmoMaterialByKind.values()) material.dispose();
      for (const variant of this.variants) variant.geometry.dispose();
      this.engine.scene.background = previousBackground;
    });
  }

  /** Sends the bird toward the nearest unoccupied perch socket of the currently picked tree. */
  sendBirdToPerch(): void {
    const candidate = this.pickedSockets.find(
      (socket) => socket.kind === 'perch' && !this.socketState().has(socket.id),
    );
    if (!candidate) return;

    const spawn = this.birdState?.position ?? {
      x: BIRD_SPAWN_POSITION_M[0],
      y: BIRD_SPAWN_POSITION_M[1],
      z: BIRD_SPAWN_POSITION_M[2],
    };
    this.birdState = {
      id: 'bird-1',
      position: spawn,
      velocity: { x: 0, y: 0, z: 0 },
      activity: 'seek',
    };
    this.birdTargetPosition = {
      x: candidate.positionM[0],
      y: candidate.positionM[1],
      z: candidate.positionM[2],
    };
    this.birdTargetSocketId.set(candidate.id);
    this.birdActivity.set('seeking');
    this.birdMesh.visible = true;
  }

  private onTick(dt: number): void {
    if (!this.birdState || this.birdState.activity !== 'seek' || !this.birdTargetPosition) return;
    const next = stepArrival(this.birdState, this.birdTargetPosition, dt, BIRD_ARRIVAL_DEFINITION);
    this.birdState = next;
    this.updateBirdMesh(next);

    if (next.activity === 'landed') {
      const socketId = this.birdTargetSocketId();
      if (socketId) this.markSocketOccupied(socketId, 'perch-occupied');
      this.birdActivity.set('landed');
    }
  }

  private updateBirdMesh(state: ArrivalState): void {
    this.birdMesh.position.set(state.position.x, state.position.y, state.position.z);
    const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
    if (speed <= 1e-3) return;
    this.scratchHeading.set(state.velocity.x / speed, state.velocity.y / speed, state.velocity.z / speed);
    this.birdMesh.quaternion.setFromUnitVectors(UP_AXIS, this.scratchHeading);
  }

  private markSocketOccupied(socketId: string, occupancy: SocketOccupancy): void {
    this.socketState.update((current) => {
      const next = new Map(current);
      next.set(socketId, occupancy);
      return next;
    });
    this.refreshAvailablePerchCount();
    this.rebuildSocketGizmos();
  }

  private refreshAvailablePerchCount(): void {
    const state = this.socketState();
    const count = this.pickedSockets.filter((s) => s.kind === 'perch' && !state.has(s.id)).length;
    this.availablePerchCount.set(count);
  }

  /** Generates the species' seeded variants once — mesh + sockets per seed. */
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
  }

  /** Fruit-slot gizmos are tried first (detach on click); otherwise falls through to picking a tree instance. */
  private onClick(event: MouseEvent | null): void {
    if (!event) return;
    const resolution = this.engine.resolution$.value;
    const mouseNdc = new Vector2(
      (event.offsetX / resolution.width) * 2 - 1,
      -(event.offsetY / resolution.height) * 2 + 1,
    );
    this.pickRaycaster.setFromCamera(mouseNdc, this.engine.camera);

    if (this.tryPickFruitSlot()) return;
    this.pickInstanceAt();
  }

  private tryPickFruitSlot(): boolean {
    const hits = this.pickRaycaster.intersectObjects(this.socketGizmoGroup.children, false);
    const hit = hits.find((h) => {
      const data = h.object.userData as { socketId?: string; kind?: FloraSocketKind };
      return data.kind === 'fruit-slot' && data.socketId !== undefined && !this.socketState().has(data.socketId);
    });
    if (!hit) return false;
    const socketId = (hit.object.userData as { socketId: string }).socketId;
    this.markSocketOccupied(socketId, 'fruit-picked');
    return true;
  }

  /** Resolves a click into a stable instance id, then the M4 "instance transform × variant sockets" query. */
  private pickInstanceAt(): void {
    if (this.pickableMeshes.length === 0) return;
    const intersections = this.pickRaycaster.intersectObjects(this.pickableMeshes, false);

    if (intersections.length === 0) {
      this.pickedInstanceId.set(undefined);
      this.pickedVariantIndex.set(undefined);
      this.pickedSocketCount.set(0);
      this.pickedSockets = [];
      this.availablePerchCount.set(0);
      this.rebuildSocketGizmos();
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

    this.pickedSockets = this.variants[variantIndex].sockets.map((socket) =>
      transformProceduralSocket(socket, transform),
    );
    this.pickedSocketCount.set(this.pickedSockets.length);
    this.refreshAvailablePerchCount();
    this.rebuildSocketGizmos();
  }

  private rebuildSocketGizmos(): void {
    this.socketGizmoGroup.clear();
    for (const socket of this.pickedSockets) this.addSocketGizmo(socket);
  }

  private addSocketGizmo(socket: IFloraSocket): void {
    const occupancy = this.socketState().get(socket.id);
    if (occupancy === 'fruit-picked') return;
    const material = occupancy === 'perch-occupied'
      ? this.occupiedGizmoMaterial
      : this.socketGizmoMaterialByKind.get(socket.kind);
    if (!material) return;
    const gizmo = new Mesh(this.socketGizmoGeometry, material);
    gizmo.position.set(socket.positionM[0], socket.positionM[1], socket.positionM[2]);
    gizmo.renderOrder = 1;
    gizmo.userData = { socketId: socket.id, kind: socket.kind };
    this.socketGizmoGroup.add(gizmo);
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
      if (
        object instanceof Mesh &&
        object !== this.birdMesh &&
        !this.variants.some((v) => v.geometry === object.geometry)
      ) {
        object.geometry.dispose();
      }
    });
    this.sceneryGroup.removeFromParent();
    this.socketGizmoGroup.removeFromParent();
  }
}
