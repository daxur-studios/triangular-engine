import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BufferAttribute,
  BufferGeometry,
  BatchedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  QuaternionTuple,
  Sphere,
  Vector3,
  Vector3Tuple,
} from 'three';
import { EngineService } from 'triangular-engine';
import type { ITerrainField } from '../core/terrain-field';
import {
  registerTerrainBatchInstance,
  unregisterTerrainBatchInstance,
} from '../core/terrain-batched-mesh-instance-registry';
import type {
  TerrainPatchEdgeSegments,
  ITerrainPatchGeometry,
  ITerrainPatchMesh,
} from '../core/terrain-patch';
import type { TerrainVector3 } from '../core/terrain-math';
import type { IHierarchicalTerrainSurfaceDomain } from '../domains/terrain-surface-domain';
import { generateTerrainPatchMesh } from '../meshing/terrain-patch-mesher';
import { TerrainGenerationQueue } from '../streaming/terrain-generation-queue';
import { selectAdaptiveTerrainPatches } from '../streaming/terrain-patch-selection';
import { calculateTerrainPatchEdgeRefinementMasks } from '../streaming/terrain-patch-edge-masks';

export interface ITerrainSurfaceLodStats {
  readonly desired: number;
  readonly resident: number;
  readonly queued: number;
  /** One draw per resident surface, plus one when its visual skirt is present. */
  readonly drawCalls: number;
  /** Indexed surface triangles currently resident. */
  readonly triangles: number;
  /** CPU-side typed-array bytes currently referenced by resident geometries. */
  readonly geometryBytes: number;
  readonly levels: Readonly<Record<number, number>>;
}

export interface ITerrainSurfaceColorContext<TAddress> {
  readonly address: TAddress;
  readonly centerWorldM: TerrainVector3;
  readonly surface: ITerrainPatchGeometry;
  readonly skirt: boolean;
}

export interface ITerrainSurfaceGenerationRequest<TAddress> {
  readonly field: ITerrainField;
  readonly domain: IHierarchicalTerrainSurfaceDomain<TAddress>;
  readonly address: TAddress;
  /** Normal number of quads per patch axis before transition refinement. */
  readonly baseResolution: number;
  readonly resolution: number;
  /** Bit mask of coarse edges that use finer-neighbour sample spacing. */
  readonly edgeRefinementMask: number;
  /** Number of quadtree levels between this patch and its finest neighbour. */
  readonly edgeRefinementLevel: number;
  /** Per-edge level deltas in north, east, south, west order. */
  readonly edgeRefinementLevels: readonly [number, number, number, number];
  /** Refined sections for each edge in north, east, south, west order. */
  readonly edgeRefinementSegments: TerrainPatchEdgeSegments;
  readonly skirtDepthM: number;
}

export type {
  ITerrainSurfaceSelectionRequest,
  TerrainSurfacePatchSelector,
} from '../streaming/terrain-surface-patch-selector';
import type {
  ITerrainSurfaceSelectionRequest,
  TerrainSurfacePatchSelector,
} from '../streaming/terrain-surface-patch-selector';

export type TerrainSurfaceMeshGenerator<TAddress> = (
  request: ITerrainSurfaceGenerationRequest<TAddress>,
) => ITerrainPatchMesh<TAddress> | Promise<ITerrainPatchMesh<TAddress>>;

/**
 * How far the camera may get from the batch anchor before it moves. Patch
 * offsets stay within the camera's neighbourhood plus a patch's size, so
 * float32 keeps millimetres near the camera; re-anchoring rewrites every
 * batched instance matrix, so it shouldn't happen every frame.
 */
const BATCH_ANCHOR_REFOLLOW_DISTANCE_M = 500;

interface IResidentPatch<TAddress> {
  readonly address: TAddress;
  readonly object: Mesh | BatchedMesh;
  readonly material: Material;
  readonly batchGeometryId?: number;
  readonly batchInstanceId?: number;
  /** A batched patch's centre, kept to re-express its instance matrix when the batch anchor moves. */
  readonly centerWorldM?: TerrainVector3;
  readonly drawCalls: number;
  readonly geometryBytes: number;
  readonly triangles: number;
}

/**
 * Declarative, camera-following terrain LOD renderer.
 *
 * `field`, `domain`, and root patch addresses are the only required inputs.
 * By default the active engine camera drives LOD. Set `lodPosition` to follow
 * a character, vehicle, or another world-space observer instead.
 */
@Component({
  standalone: true,
  selector: 'terrainSurface',
  template: '',
})
export class TerrainSurfaceComponent<TAddress = unknown>
  implements OnInit, OnDestroy
{
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly group = new Object3D();
  private batchedRender?: { readonly object: BatchedMesh; readonly material: Material };
  /**
   * Where the `BatchedMesh` sits in the patch group, kept near the camera.
   * Its instance matrices are float32 on the GPU, so each holds a patch's
   * offset from this anchor rather than its full `centerWorldM`: on a
   * planet-sized domain that is millions of metres, which float32 rounds to
   * about half a metre and which shakes as the camera moves.
   */
  private readonly batchAnchorM = new Vector3();
  private readonly cameraInGroupM = new Vector3();
  private readonly residents = new Map<string, IResidentPatch<TAddress>>();
  private readonly queue = new TerrainGenerationQueue<TAddress>();
  private readonly completed = new Map<
    string,
    { readonly address: TAddress; readonly patch: ITerrainPatchMesh<TAddress> }
  >();
  private desiredPriorities = new Map<string, number>();
  private desiredAddresses = new Map<string, TAddress>();
  private desiredEdgeMasks = new Map<
    string,
    {
      readonly mask: number;
      readonly levelDelta: number;
      readonly edgeLevelDeltas: readonly [number, number, number, number];
      readonly edgeSegments: TerrainPatchEdgeSegments;
    }
  >();
  private selectionSignature = '';
  private refinedKeys = new Set<string>();
  private generationEpoch = 0;
  private readonly generating = new Set<string>();
  private selectedLevels: Record<number, number> = {};
  private desiredPatchCount = 0;
  private statsSignature = '';
  private lastSelectionInputSignature = '';
  private edgeMaskSelectionSignature = '';
  private cachedEdgeMasks: readonly ReturnType<
    typeof calculateTerrainPatchEdgeRefinementMasks
  >[number][] = [];

  readonly field = input.required<ITerrainField>();
  readonly domain =
    input.required<IHierarchicalTerrainSurfaceDomain<TAddress>>();
  readonly roots = input.required<readonly TAddress[]>();

  /** Defaults to the active engine camera when omitted. */
  readonly lodPosition = input<TerrainVector3 | undefined>(undefined);
  readonly maxLod = input(3);
  readonly refinementDistance = input<number | undefined>(undefined);
  readonly resolution = input(48);
  /** Optional visual gap cover. Keep disabled unless a consumer explicitly requests skirts. */
  readonly skirtDepth = input(0);
  readonly generationBudget = input(4);
  /** Optional selector hint used to cap selected patches for bounded work. */
  readonly maxPatches = input<number | undefined>(undefined);
  /** Combines same-material resident patches into one multi-draw batch. */
  readonly batching = input(false);
  /** Prevents LOD oscillation near a refinement boundary. */
  readonly lodHysteresis = input(0.15);
  /** Keeps the current selected cut while allowing the camera to move. */
  readonly freezeLod = input(false);
  /** Uses the built-in adaptive distance selector when omitted. */
  readonly patchSelector = input<
    TerrainSurfacePatchSelector<TAddress> | undefined
  >(undefined);
  /**
   * Optional asynchronous mesh generator. Supply a worker-backed function to
   * move field sampling and typed-array construction off the main thread.
   */
  readonly meshGenerator = input<
    TerrainSurfaceMeshGenerator<TAddress> | undefined
  >(undefined);
  readonly wireframe = input(false);
  readonly frustumCulled = input(true);
  /**
   * Scene-space transform applied to the renderer's patch group. Patch
   * `centerWorldM` values are interpreted relative to it, so a parent can own
   * the recentering scheme — e.g. a celestial body group offset from the scene
   * origin by the floating origin. Defaults to identity, which keeps the
   * historical behaviour where `centerWorldM` is already scene-relative.
   */
  readonly renderOriginM = input<Vector3Tuple>([0, 0, 0]);
  readonly renderQuaternion = input<QuaternionTuple>([0, 0, 0, 1]);
  /** Hides the whole surface without dropping resident patches, e.g. while a map view shares the scene. */
  readonly visible = input(true);
  readonly getLevel = input<(address: TAddress) => number>(defaultAddressLevel);
  readonly getKey = input<(address: TAddress) => string>(defaultAddressKey);
  readonly createMaterial = input<() => Material>(
    () =>
      new MeshStandardMaterial({
        color: '#71805a',
        roughness: 0.92,
      }),
  );
  readonly createColors = input<
    | ((context: ITerrainSurfaceColorContext<TAddress>) => Float32Array)
    | undefined
  >(undefined);
  /** Increment to rebuild resident geometry when a colour mode changes. */
  readonly colorRevision = input(0);
  readonly lodChange = output<ITerrainSurfaceLodStats>();

  constructor() {
    this.engine.scene.add(this.group);
    effect(() => {
      const [x, y, z] = this.renderOriginM();
      this.group.position.set(x, y, z);
      const [qx, qy, qz, qw] = this.renderQuaternion();
      this.group.quaternion.set(qx, qy, qz, qw);
    });
    effect(() => {
      this.group.visible = this.visible();
    });
    effect(() => {
      const wireframe = this.wireframe();
      for (const { material } of this.residents.values()) {
        if ('wireframe' in material) {
          (material as MeshStandardMaterial).wireframe = wireframe;
        }
      }
    });
    effect(() => {
      const culled = this.frustumCulled();
      for (const { object } of this.residents.values()) {
        object.frustumCulled = culled;
        object.traverse((child) => {
          child.frustumCulled = culled;
        });
      }
      if (this.batchedRender) {
        this.batchedRender.object.frustumCulled = culled;
      }
    });
    effect(() => {
      this.field();
      this.domain();
      this.roots();
      this.maxLod();
      this.refinementDistance();
      this.resolution();
      this.skirtDepth();
      this.lodHysteresis();
      this.maxPatches();
      this.batching();
      this.patchSelector();
      this.meshGenerator();
      this.getLevel();
      this.getKey();
      this.createMaterial();
      this.createColors();
      this.colorRevision();
      this.resetSelection();
    });
  }

  ngOnInit(): void {
    this.engine.beforeRender$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.update());
  }

  ngOnDestroy(): void {
    this.group.removeFromParent();
    this.disposeResidents();
    this.queue.clear();
  }

  private update(): void {
    this.followCameraWithBatchAnchor();
    if (this.freezeLod() && this.selectionSignature !== '') {
      this.processGenerationQueue();
      return;
    }
    const domain = this.domain();
    const roots = this.roots();
    const position = this.lodPosition() ?? this.cameraPosition();
    const getLevel = this.getLevel();
    const getKey = this.getKey();
    const maxLevel = Math.max(0, Math.floor(this.maxLod()));
    const refinementDistanceM =
      this.refinementDistance() ?? estimateRefinementDistance(domain, roots);
    const hysteresis = Math.min(0.95, Math.max(0, this.lodHysteresis()));
    const patchSelector = this.patchSelector();
    const selectionInputSignature = `${position.join(',')}|${maxLevel}|${refinementDistanceM}|${hysteresis}|${this.residents.size === 0}`;
    if (selectionInputSignature === this.lastSelectionInputSignature) {
      this.processGenerationQueue();
      return;
    }
    this.lastSelectionInputSignature = selectionInputSignature;
    // Establish a complete coarse cover before asking for a refined cut. This
    // gives the renderer a parent fallback during the first asynchronous build
    // and prevents the initial view from refining into an empty scene.
    const selected = this.residents.size === 0
      ? roots
      : patchSelector
        ? this.selectCustomPatches(patchSelector, {
            domain,
            roots,
            cameraWorldM: position,
            getLevel,
            getKey,
            maxLevel,
            maxPatches: this.maxPatches(),
            refinementDistanceM,
            hysteresis,
            wasRefined: (address) => this.refinedKeys.has(getKey(address)),
          })
        : this.selectDefaultPatches({
            domain,
            roots,
            cameraWorldM: position,
            getLevel,
            getKey,
            maxLevel,
            maxPatches: this.maxPatches(),
            refinementDistanceM,
            hysteresis,
          });
    const selectedSignature = selected.map(getKey).join('|');
    if (selectedSignature !== this.edgeMaskSelectionSignature) {
      this.cachedEdgeMasks = calculateTerrainPatchEdgeRefinementMasks(
        domain,
        selected,
        getLevel,
      );
      this.edgeMaskSelectionSignature = selectedSignature;
    }
    const edgeMasks = this.cachedEdgeMasks;
    const entries = selected.map((address, index) => {
      const baseKey = getKey(address);
      const edgeRefinement = edgeMasks[index] ?? {
        mask: 0,
        levelDelta: 0,
        edgeLevelDeltas: [0, 0, 0, 0] as const,
        edgeSegments: [[], [], [], []] as const,
      };
      const edgeMask = edgeRefinement.mask;
      const edgeLevelDelta = edgeRefinement.levelDelta;
      return {
        address,
        baseKey,
        edgeMask,
        edgeLevelDelta,
        edgeLevelDeltas: edgeRefinement.edgeLevelDeltas,
        edgeSegments: edgeRefinement.edgeSegments,
        key: `${baseKey}|edge:${JSON.stringify(edgeRefinement.edgeSegments)}`,
      };
    });
    this.desiredPriorities = new Map(
      entries.map(({ address, key }) => [
        key,
        patchDistance(domain, address, position),
      ]),
    );
    this.desiredAddresses = new Map(entries.map(({ address, key }) => [key, address]));
    this.desiredEdgeMasks = new Map(
      entries.map(({ key, edgeMask, edgeLevelDelta, edgeLevelDeltas, edgeSegments }) => [
        key,
        {
          mask: edgeMask,
          levelDelta: edgeLevelDelta,
          edgeLevelDeltas,
          edgeSegments,
        },
      ]),
    );
    this.desiredPatchCount = entries.length;
    this.selectedLevels = {};
    for (const address of selected) {
      const level = getLevel(address);
      this.selectedLevels[level] = (this.selectedLevels[level] ?? 0) + 1;
    }
    const signature = entries.map(({ key }) => key).join('|');
    this.selectionSignature = signature;
    // Reconcile on every camera update. The selected cut may be unchanged,
    // but distances can change while orbiting; the queue must see those new
    // priorities so a patch that remains under the view can finish refining.
    this.queue.reconcile(
      entries.map(({ address, key }) => ({
        key,
        value: address,
        priority: this.desiredPriorities.get(key) ?? 0,
      })),
      new Set([
        ...this.residents.keys(),
        ...this.generating,
        ...this.completed.keys(),
      ]),
    );

    this.processGenerationQueue();
  }

  private processGenerationQueue(): void {
    const generationBudget = Math.max(0, Math.floor(this.generationBudget()));
    const availableGenerationSlots = this.meshGenerator()
      ? Math.max(0, generationBudget - this.generating.size)
      : generationBudget;
    this.queue.drain(availableGenerationSlots, ({ key, value }) =>
      this.generatePatch(key, value),
    );
    this.installCompletedPatches();
    this.emitStats();
  }

  private generatePatch(key: string, address: TAddress): void {
    const edgeRefinement = this.desiredEdgeMasks.get(key) ?? {
      mask: 0,
      levelDelta: 0,
      edgeLevelDeltas: [0, 0, 0, 0] as const,
      edgeSegments: [[], [], [], []] as const,
    };
    const edgeRefinementMask = edgeRefinement.mask;
    const edgeRefinementLevel = edgeRefinement.levelDelta;
    const baseResolution = Math.max(2, Math.floor(this.resolution()));
    const request: ITerrainSurfaceGenerationRequest<TAddress> = {
      field: this.field(),
      domain: this.domain(),
      address,
      baseResolution,
      // A uniform doubled grid is the first shared transition topology: it
      // gives a coarse edge the same sample spacing as adjacent fine patches.
      // The simplifier can still remove interior vertices independently.
      resolution:
        baseResolution * 2 ** edgeRefinementLevel,
      edgeRefinementMask,
      edgeRefinementLevel,
      edgeRefinementLevels: edgeRefinement.edgeLevelDeltas,
      edgeRefinementSegments: edgeRefinement.edgeSegments,
      skirtDepthM: Math.max(0, this.skirtDepth()),
    };
    const generator =
      this.meshGenerator() ??
      ((value: ITerrainSurfaceGenerationRequest<TAddress>) =>
        generateTerrainPatchMesh(value.field, value.domain, value));
    const epoch = this.generationEpoch;
    const result = generator(request);
    if (!(result instanceof Promise)) {
      this.completed.set(key, { address, patch: result });
      return;
    }
    this.generating.add(key);
    void result
      .then((patch) => {
        if (
          epoch === this.generationEpoch &&
          this.queue.desired.has(key) &&
          !this.residents.has(key)
        ) {
          this.completed.set(key, { address, patch });
        }
      })
      .catch((error: unknown) => {
        // Keep rendering the current coarser patch. Surface the worker error
        // without taking down the render loop.
        console.error('Terrain patch generation failed.', error);
      })
      .finally(() => this.generating.delete(key));
  }

  private installCompletedPatches(): void {
    if (this.completed.size === 0) return;

    // A whole cut no longer has to wait for its slowest patch. Each group is
    // committed when it has complete coverage for one old patch: all four
    // children replace a resident parent together, or a ready parent replaces
    // all of its resident children. This keeps the surface covered while
    // allowing nearby completed worker results to become visible during motion.
    const groups = this.completedReplacementGroups();
    this.pruneCoveredStaleResidents();
    for (const group of groups) {
      if (!group.every((key) => this.residents.has(key) || this.completed.has(key)))
        continue;

      const groupKeys = new Set(group);
      let replacedResidents = [...this.residents].filter(
        ([key, resident]) =>
          groupKeys.has(key) || this.replacedByGroup(key, group),
      );
      const installingKeys = group.filter(
        (key) =>
          !this.residents.has(key) &&
          this.completed.has(key) &&
          this.queue.desired.has(key),
      );

      // Camera movement can leave patches from an older cut resident while a
      // new cut is being assembled. Release any such patch only after the
      // current resident cut fully covers its footprint, then admit a group
      // only when the batch has room for its complete replacement.
      if (
        this.batching() &&
        installingKeys.some((key) => !this.completed.get(key)?.patch.skirt)
      ) {
        const batchInstallCount = installingKeys.filter(
          (key) => !this.completed.get(key)?.patch.skirt,
        ).length;
        const wouldExceedCapacity = (): boolean => {
          const removedBatchResidents = replacedResidents.filter(
            ([, resident]) => resident.batchInstanceId !== undefined,
          ).length;
          return (
            this.batchedResidentCount() - removedBatchResidents + batchInstallCount >
            this.batchedInstanceCapacity()
          );
        };
        if (wouldExceedCapacity()) {
          this.pruneCoveredStaleResidents();
          replacedResidents = [...this.residents].filter(
            ([key]) =>
              groupKeys.has(key) || this.replacedByGroup(key, group),
          );
          if (wouldExceedCapacity()) continue;
        }
      }

      for (const [key, resident] of replacedResidents) {
        this.removePatch(key, resident);
      }
      if (
        replacedResidents.some(([, resident]) => resident.batchGeometryId !== undefined)
      ) {
        this.batchedRender?.object.optimize();
      }
      for (const key of group) {
        const completed = this.completed.get(key);
        if (!completed || !this.queue.desired.has(key)) continue;
        this.installPatch(key, completed.address, completed.patch);
        this.completed.delete(key);
      }
      this.pruneCoveredStaleResidents();
    }

    // Dispose completed results that are no longer part of the desired cut.
    // Their typed arrays are then eligible for collection instead of building
    // up while the camera is moving.
    for (const key of this.completed.keys()) {
      if (!this.queue.desired.has(key)) this.completed.delete(key);
    }
    this.pruneCoveredStaleResidents();
  }

  private completedReplacementGroups(): string[][] {
    const groups: string[][] = [];
    const grouped = new Set<string>();
    const desiredKeys = [...this.queue.desired];

    // A resident parent must be replaced by all of its desired children in
    // one operation. Conversely, a desired parent can replace all of its
    // resident children once that parent is ready. Include unfinished members
    // in the group so one completed child cannot expose a hole.
    for (const [, resident] of this.residents) {
      const group = desiredKeys.filter((key) => {
        if (grouped.has(key) || this.residents.has(key)) return false;
        const completed = this.completed.get(key);
        const address = completed?.address ?? this.addressForDesiredKey(key);
        return address !== undefined &&
          (this.patchContains(resident.address, address) ||
            this.patchContains(address, resident.address));
      });
      if (group.length === 0) continue;
      for (const key of group) grouped.add(key);
      groups.push(group);
    }
    for (const key of desiredKeys) {
      if (grouped.has(key) || !this.completed.has(key)) continue;
      grouped.add(key);
      groups.push([key]);
    }
    return groups;
  }

  private addressForDesiredKey(key: string): TAddress | undefined {
    return this.completed.get(key)?.address ?? this.desiredAddresses.get(key);
  }

  private replacedByGroup(residentKey: string, group: readonly string[]): boolean {
    const resident = this.residents.get(residentKey);
    if (!resident) return false;
    return group.some((key) => {
      const completed = this.completed.get(key);
      return completed !== undefined &&
        (this.patchContains(resident.address, completed.address) ||
          this.patchContains(completed.address, resident.address));
    });
  }

  private patchContains(outer: TAddress, inner: TAddress): boolean {
    const outerFace = (outer as { face?: unknown })?.face;
    const innerFace = (inner as { face?: unknown })?.face;
    // Cube sphere faces reuse the same UV bounds, so bounds alone must not
    // treat patches on different faces as parent/child replacements.
    if (outerFace !== undefined && innerFace !== undefined && outerFace !== innerFace)
      return false;
    const outerBounds = this.domain().getPatchBounds(outer);
    const innerBounds = this.domain().getPatchBounds(inner);
    const tolerance = 1e-7 * Math.max(
      1,
      Math.abs(outerBounds.maxU - outerBounds.minU),
      Math.abs(outerBounds.maxV - outerBounds.minV),
    );
    return (
      innerBounds.minU >= outerBounds.minU - tolerance &&
      innerBounds.maxU <= outerBounds.maxU + tolerance &&
      innerBounds.minV >= outerBounds.minV - tolerance &&
      innerBounds.maxV <= outerBounds.maxV + tolerance
    );
  }

  private desiredPatchesAreResident(): boolean {
    for (const key of this.queue.desired) {
      if (!this.residents.has(key)) return false;
    }
    return true;
  }

  private batchedResidentCount(): number {
    let count = 0;
    for (const resident of this.residents.values()) {
      if (resident.batchInstanceId !== undefined) count += 1;
    }
    return count;
  }

  private batchedInstanceCapacity(): number {
    return (
      this.batchedRender?.object.maxInstanceCount ??
      Math.max(256, Math.floor(this.maxPatches() ?? 1024))
    );
  }

  /** Remove an obsolete patch only after resident desired patches cover it. */
  private pruneCoveredStaleResidents(): boolean {
    const desired = [...this.queue.desired].flatMap((key) => {
      const address = this.desiredAddresses.get(key);
      return address === undefined ? [] : [{ key, address }];
    });
    if (desired.length === 0) return false;

    let removed = false;
    for (const [key, resident] of this.residents) {
      if (this.queue.desired.has(key)) continue;
      if (!this.isAddressCoveredByDesiredResidents(resident.address, desired)) continue;
      this.removePatch(key, resident);
      removed = true;
    }
    if (removed) this.batchedRender?.object.optimize();
    return removed;
  }

  private isAddressCoveredByDesiredResidents(
    address: TAddress,
    desired: readonly { readonly key: string; readonly address: TAddress }[],
  ): boolean {
    const visit = (candidate: TAddress): boolean => {
      for (const patch of desired) {
        if (
          this.residents.has(patch.key) &&
          this.patchContains(patch.address, candidate)
        ) {
          return true;
        }
      }

      // A desired patch below this address means its siblings must also be
      // resident before this coarser patch can be released.
      const descendants = desired.filter((patch) =>
        this.patchContains(candidate, patch.address),
      );
      if (descendants.length === 0) return false;
      const exactPatch = descendants.some((patch) =>
        this.patchContains(patch.address, candidate),
      );
      if (exactPatch) return false;

      const children = this.domain().getChildren(candidate);
      return children.length > 0 && children.every(visit);
    };

    return visit(address);
  }

  private selectCustomPatches(
    selector: TerrainSurfacePatchSelector<TAddress>,
    request: ITerrainSurfaceSelectionRequest<TAddress>,
  ): readonly TAddress[] {
    return selector(request);
  }

  private selectDefaultPatches(
    request: Omit<ITerrainSurfaceSelectionRequest<TAddress>, 'wasRefined'>,
  ): readonly TAddress[] {
    const nextRefinedKeys = new Set<string>();
    const selected = selectAdaptiveTerrainPatches(request.domain, {
      roots: request.roots,
      cameraWorldM: request.cameraWorldM,
      getLevel: request.getLevel,
      maxLevel: request.maxLevel,
      refinementDistanceM: request.refinementDistanceM,
      hysteresis: request.hysteresis,
      wasRefined: (address) => this.refinedKeys.has(request.getKey(address)),
      onRefinement: (address, refined) => {
        if (refined) nextRefinedKeys.add(request.getKey(address));
      },
    });
    this.refinedKeys = nextRefinedKeys;
    return selected;
  }

  private installPatch(
    key: string,
    address: TAddress,
    patch: ITerrainPatchMesh<TAddress>,
  ): void {
    if (this.batching() && !patch.skirt) {
      this.installBatchedPatch(key, address, patch);
      return;
    }
    const material = this.createMaterial()();
    if ('wireframe' in material) {
      (material as MeshStandardMaterial).wireframe = this.wireframe();
    }
    const surfaceGeometry = this.createGeometry(
      patch,
      address,
      patch.surface,
      false,
    );
    const mesh = new Mesh(surfaceGeometry, material);
    mesh.frustumCulled = this.frustumCulled();
    let drawCalls = 1;
    let geometryBytes = geometryByteCount(surfaceGeometry);
    let triangles = (surfaceGeometry.index?.count ?? 0) / 3;
    if (patch.skirt) {
      const skirtGeometry = this.createGeometry(
        patch,
        address,
        patch.skirt,
        true,
      );
      const skirtMesh = new Mesh(skirtGeometry, material);
      skirtMesh.frustumCulled = this.frustumCulled();
      mesh.add(skirtMesh);
      drawCalls += 1;
      geometryBytes += geometryByteCount(skirtGeometry);
      triangles += (skirtGeometry.index?.count ?? 0) / 3;
    }
    mesh.position.fromArray(patch.centerWorldM);
    this.group.add(mesh);
    this.residents.set(key, {
      address,
      object: mesh,
      material,
      drawCalls,
      geometryBytes,
      triangles,
    });
  }

  private installBatchedPatch(
    key: string,
    address: TAddress,
    patch: ITerrainPatchMesh<TAddress>,
  ): void {
    const batch = this.getBatchedRender();
    const geometry = this.createGeometry(patch, address, patch.surface, false);
    let geometryId: number | undefined;
    let instanceId: number | undefined;
    try {
      geometryId = batch.object.addGeometry(geometry);
      instanceId = batch.object.addInstance(geometryId);
      registerTerrainBatchInstance(batch.object, instanceId);
      this.setBatchInstanceMatrix(batch.object, instanceId, patch.centerWorldM);
      this.residents.set(key, {
        address,
        object: batch.object,
        material: batch.material,
        batchGeometryId: geometryId,
        batchInstanceId: instanceId,
        centerWorldM: patch.centerWorldM,
        drawCalls: 0,
        geometryBytes: geometryByteCount(geometry),
        triangles: patch.surface.indices.length / 3,
      });
    } catch (error) {
      if (instanceId !== undefined) {
        unregisterTerrainBatchInstance(batch.object, instanceId);
        batch.object.deleteInstance(instanceId);
      }
      if (geometryId !== undefined) batch.object.deleteGeometry(geometryId);
      throw error;
    } finally {
      geometry.dispose();
    }
  }

  private setBatchInstanceMatrix(
    object: BatchedMesh,
    instanceId: number,
    centerWorldM: TerrainVector3,
  ): void {
    const anchor = this.batchAnchorM;
    this.batchMatrixScratch.makeTranslation(
      centerWorldM[0] - anchor.x,
      centerWorldM[1] - anchor.y,
      centerWorldM[2] - anchor.z,
    );
    object.setMatrixAt(instanceId, this.batchMatrixScratch);
  }

  /**
   * Moves the batch anchor to the camera (in the patch group's frame) once
   * the camera is `BATCH_ANCHOR_REFOLLOW_DISTANCE_M` from it, and re-expresses
   * every batched patch against the new anchor. Nothing moves on screen: the
   * anchor's offset and each patch's offset still add up to its centre.
   */
  private followCameraWithBatchAnchor(): void {
    const batch = this.batchedRender;
    if (!batch) return;
    this.group.updateWorldMatrix(true, false);
    this.engine.camera
      .getWorldPosition(this.cameraInGroupM)
      .applyMatrix4(this.groupInverseScratch.copy(this.group.matrixWorld).invert());
    if (
      this.cameraInGroupM.distanceTo(this.batchAnchorM) <
      BATCH_ANCHOR_REFOLLOW_DISTANCE_M
    ) {
      return;
    }
    this.batchAnchorM.copy(this.cameraInGroupM);
    batch.object.position.copy(this.batchAnchorM);
    for (const resident of this.residents.values()) {
      if (resident.batchInstanceId === undefined || !resident.centerWorldM) {
        continue;
      }
      this.setBatchInstanceMatrix(
        batch.object,
        resident.batchInstanceId,
        resident.centerWorldM,
      );
    }
  }

  private readonly batchMatrixScratch = new Matrix4();
  private readonly groupInverseScratch = new Matrix4();

  private getBatchedRender(): { readonly object: BatchedMesh; readonly material: Material } {
    if (this.batchedRender) return this.batchedRender;
    const material = this.createMaterial()();
    if ('wireframe' in material) {
      (material as MeshStandardMaterial).wireframe = this.wireframe();
    }
    const maxInstances = Math.max(256, Math.floor(this.maxPatches() ?? 1024));
    const transitionResolution = Math.max(2, Math.floor(this.resolution())) * 2;
    const verticesPerPatch = (transitionResolution + 1) ** 2;
    const indicesPerPatch = transitionResolution ** 2 * 6;
    const object = new BatchedMesh(
      maxInstances,
      maxInstances * verticesPerPatch,
      maxInstances * indicesPerPatch,
      material,
    );
    object.position.copy(this.batchAnchorM);
    this.group.add(object);
    this.batchedRender = { object, material };
    return this.batchedRender;
  }

  private createGeometry(
    patch: ITerrainPatchMesh<TAddress>,
    address: TAddress,
    surface: ITerrainPatchGeometry,
    skirt: boolean,
  ): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(surface.positions, 3),
    );
    geometry.setAttribute('normal', new BufferAttribute(surface.normals, 3));
    geometry.setAttribute('uv', new BufferAttribute(surface.uvs, 2));
    const colors =
      this.createColors()?.({
        address,
        centerWorldM: patch.centerWorldM,
        surface,
        skirt,
      }) ?? surface.colors;
    if (colors) geometry.setAttribute('color', new BufferAttribute(colors, 3));
    if (surface.attributes) {
      for (const [name, attr] of Object.entries(surface.attributes)) {
        if (attr instanceof Float32Array) {
          geometry.setAttribute(name, new BufferAttribute(attr, 3));
        } else if (attr && typeof attr === 'object' && 'array' in attr) {
          geometry.setAttribute(name, new BufferAttribute(attr.array, attr.itemSize));
        }
      }
    }
    geometry.setIndex(new BufferAttribute(surface.indices, 1));
    if (!this.frustumCulled()) {
      geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity);
    }
    return geometry;
  }

  private removePatch(key: string, patch: IResidentPatch<TAddress>): void {
    if (
      patch.batchGeometryId !== undefined &&
      patch.batchInstanceId !== undefined &&
      this.batchedRender
    ) {
      unregisterTerrainBatchInstance(
        this.batchedRender.object,
        patch.batchInstanceId,
      );
      this.batchedRender.object.deleteInstance(patch.batchInstanceId);
      this.batchedRender.object.deleteGeometry(patch.batchGeometryId);
    } else {
      patch.object.removeFromParent();
      patch.object.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
      patch.material.dispose();
    }
    this.residents.delete(key);
  }

  private disposeResidents(): void {
    for (const [key, patch] of this.residents) this.removePatch(key, patch);
    if (this.batchedRender) {
      this.batchedRender.object.removeFromParent();
      this.batchedRender.object.dispose();
      this.batchedRender.material.dispose();
      this.batchedRender = undefined;
    }
  }

  private resetSelection(): void {
    this.selectionSignature = '';
    this.refinedKeys.clear();
    this.statsSignature = '';
    this.lastSelectionInputSignature = '';
    this.edgeMaskSelectionSignature = '';
    this.cachedEdgeMasks = [];
    this.generationEpoch++;
    this.generating.clear();
    this.completed.clear();
    this.desiredPriorities.clear();
    this.desiredAddresses.clear();
    this.desiredEdgeMasks.clear();
    this.queue.clear();
    this.disposeResidents();
  }

  private cameraPosition(): TerrainVector3 {
    const { x, y, z } = this.engine.camera.position;
    return [x, y, z];
  }

  private emitStats(): void {
    const queued = this.queue.pendingCount + this.generating.size;
    let drawCalls = 0;
    let geometryBytes = 0;
    let triangles = 0;
    for (const patch of this.residents.values()) {
      drawCalls += patch.drawCalls;
      geometryBytes += patch.geometryBytes;
      triangles += patch.triangles;
    }
    if (this.batchedRender && this.batchedRender.object.instanceCount > 0)
      drawCalls += 1;
    const signature = `${this.desiredPatchCount}:${this.residents.size}:${queued}:${drawCalls}:${triangles}:${geometryBytes}:${JSON.stringify(this.selectedLevels)}`;
    if (signature === this.statsSignature) return;
    this.statsSignature = signature;
    this.lodChange.emit({
      desired: this.desiredPatchCount,
      resident: this.residents.size,
      queued,
      drawCalls,
      triangles,
      geometryBytes,
      levels: this.selectedLevels,
    });
  }
}

function geometryByteCount(geometry: BufferGeometry): number {
  let byteCount = geometry.index?.array.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes)) {
    byteCount += attribute.array.byteLength;
  }
  return byteCount;
}

function defaultAddressLevel(address: unknown): number {
  const level = (address as { level?: unknown })?.level;
  if (!Number.isInteger(level)) {
    throw new TypeError('Terrain addresses require an integer level.');
  }
  return level as number;
}

function defaultAddressKey(address: unknown): string {
  return JSON.stringify(address);
}

function patchDistance<TAddress>(
  domain: IHierarchicalTerrainSurfaceDomain<TAddress>,
  address: TAddress,
  position: TerrainVector3,
): number {
  const bounds = domain.getPatchBounds(address);
  const center = domain.getSurfacePosition(
    address,
    (bounds.minU + bounds.maxU) / 2,
    (bounds.minV + bounds.maxV) / 2,
    0,
  );
  return Math.hypot(
    center[0] - position[0],
    center[1] - position[1],
    center[2] - position[2],
  );
}

function estimateRefinementDistance<TAddress>(
  domain: IHierarchicalTerrainSurfaceDomain<TAddress>,
  roots: readonly TAddress[],
): number {
  let maximum = 0;
  for (const root of roots) {
    const bounds = domain.getPatchBounds(root);
    const a = domain.getSurfacePosition(root, bounds.minU, bounds.minV, 0);
    const b = domain.getSurfacePosition(root, bounds.maxU, bounds.maxV, 0);
    maximum = Math.max(
      maximum,
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    );
  }
  return Math.max(1, maximum * 2);
}
