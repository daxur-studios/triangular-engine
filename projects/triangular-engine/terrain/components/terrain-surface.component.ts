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
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { EngineService } from 'triangular-engine';
import type { ITerrainField } from '../core/terrain-field';
import type {
  ITerrainPatchGeometry,
  ITerrainPatchMesh,
} from '../core/terrain-patch';
import type { TerrainVector3 } from '../core/terrain-math';
import type { IHierarchicalTerrainSurfaceDomain } from '../domains/terrain-surface-domain';
import { generateTerrainPatchMesh } from '../meshing/terrain-patch-mesher';
import { TerrainGenerationQueue } from '../streaming/terrain-generation-queue';
import { selectAdaptiveTerrainPatches } from '../streaming/terrain-patch-selection';

export interface ITerrainSurfaceLodStats {
  readonly desired: number;
  readonly resident: number;
  readonly queued: number;
  /** One draw per resident surface, plus one when its visual skirt is present. */
  readonly drawCalls: number;
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
  readonly resolution: number;
  readonly skirtDepthM: number;
}

/** Context supplied to an optional terrain-surface patch selector. */
export interface ITerrainSurfaceSelectionRequest<TAddress> {
  readonly domain: IHierarchicalTerrainSurfaceDomain<TAddress>;
  readonly roots: readonly TAddress[];
  readonly cameraWorldM: TerrainVector3;
  readonly getLevel: (address: TAddress) => number;
  readonly getKey: (address: TAddress) => string;
  readonly maxLevel: number;
  readonly refinementDistanceM: number;
  readonly hysteresis: number;
  /** Whether the default selector refined this address on its previous update. */
  readonly wasRefined: (address: TAddress) => boolean;
}

/**
 * Optional LOD strategy for a terrain surface. Returning leaf patches keeps
 * meshing, nearby-first generation, retention, and render diagnostics shared.
 */
export type TerrainSurfacePatchSelector<TAddress> = (
  request: ITerrainSurfaceSelectionRequest<TAddress>,
) => readonly TAddress[];

export type TerrainSurfaceMeshGenerator<TAddress> = (
  request: ITerrainSurfaceGenerationRequest<TAddress>,
) => ITerrainPatchMesh<TAddress> | Promise<ITerrainPatchMesh<TAddress>>;

interface IResidentPatch {
  readonly object: Mesh;
  readonly material: Material;
  readonly drawCalls: number;
  readonly geometryBytes: number;
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
  private readonly residents = new Map<string, IResidentPatch>();
  private readonly queue = new TerrainGenerationQueue<TAddress>();
  private selectionSignature = '';
  private refinedKeys = new Set<string>();
  private generationEpoch = 0;
  private readonly generating = new Set<string>();
  private selectedLevels: Record<number, number> = {};
  private desiredPatchCount = 0;
  private statsSignature = '';

  readonly field = input.required<ITerrainField>();
  readonly domain =
    input.required<IHierarchicalTerrainSurfaceDomain<TAddress>>();
  readonly roots = input.required<readonly TAddress[]>();

  /** Defaults to the active engine camera when omitted. */
  readonly lodPosition = input<TerrainVector3 | undefined>(undefined);
  readonly maxLod = input(3);
  readonly refinementDistance = input<number | undefined>(undefined);
  readonly resolution = input(48);
  readonly skirtDepth = input(5);
  readonly generationBudget = input(4);
  /** Prevents LOD oscillation near a refinement boundary. */
  readonly lodHysteresis = input(0.15);
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
  readonly lodChange = output<ITerrainSurfaceLodStats>();

  constructor() {
    this.engine.scene.add(this.group);
    effect(() => {
      const wireframe = this.wireframe();
      for (const { material } of this.residents.values()) {
        if ('wireframe' in material) {
          (material as MeshStandardMaterial).wireframe = wireframe;
        }
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
      this.patchSelector();
      this.meshGenerator();
      this.getLevel();
      this.getKey();
      this.createMaterial();
      this.createColors();
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
    const selected = patchSelector
      ? this.selectCustomPatches(patchSelector, {
          domain,
          roots,
          cameraWorldM: position,
          getLevel,
          getKey,
          maxLevel,
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
          refinementDistanceM,
          hysteresis,
        });
    const entries = selected.map((address) => ({
      address,
      key: getKey(address),
    }));
    this.desiredPatchCount = entries.length;
    this.selectedLevels = {};
    for (const address of selected) {
      const level = getLevel(address);
      this.selectedLevels[level] = (this.selectedLevels[level] ?? 0) + 1;
    }
    const signature = entries.map(({ key }) => key).join('|');
    if (signature !== this.selectionSignature) {
      this.selectionSignature = signature;
      this.queue.reconcile(
        entries.map(({ address, key }) => ({
          key,
          value: address,
          priority: patchDistance(domain, address, position),
        })),
        new Set([...this.residents.keys(), ...this.generating]),
      );
    }

    const generationBudget = Math.max(0, Math.floor(this.generationBudget()));
    const availableGenerationSlots = this.meshGenerator()
      ? Math.max(0, generationBudget - this.generating.size)
      : generationBudget;
    this.queue.drain(availableGenerationSlots, ({ key, value }) =>
      this.generatePatch(key, value),
    );
    if (this.queue.pendingCount === 0 && this.generating.size === 0) {
      for (const [key, patch] of this.residents) {
        if (!this.queue.desired.has(key)) this.removePatch(key, patch);
      }
    }
    this.emitStats();
  }

  private generatePatch(key: string, address: TAddress): void {
    const request: ITerrainSurfaceGenerationRequest<TAddress> = {
      field: this.field(),
      domain: this.domain(),
      address,
      resolution: Math.max(2, Math.floor(this.resolution())),
      skirtDepthM: Math.max(0, this.skirtDepth()),
    };
    const generator =
      this.meshGenerator() ??
      ((value: ITerrainSurfaceGenerationRequest<TAddress>) =>
        generateTerrainPatchMesh(value.field, value.domain, value));
    const epoch = this.generationEpoch;
    const result = generator(request);
    if (!(result instanceof Promise)) {
      this.installPatch(key, address, result);
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
          this.installPatch(key, address, patch);
        }
      })
      .catch((error: unknown) => {
        // Keep rendering the current coarser patch. Surface the worker error
        // without taking down the render loop.
        console.error('Terrain patch generation failed.', error);
      })
      .finally(() => this.generating.delete(key));
  }

  private selectCustomPatches(
    selector: TerrainSurfacePatchSelector<TAddress>,
    request: ITerrainSurfaceSelectionRequest<TAddress>,
  ): readonly TAddress[] {
    this.refinedKeys.clear();
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
    let drawCalls = 1;
    let geometryBytes = geometryByteCount(surfaceGeometry);
    if (patch.skirt) {
      const skirtGeometry = this.createGeometry(
        patch,
        address,
        patch.skirt,
        true,
      );
      mesh.add(new Mesh(skirtGeometry, material));
      drawCalls += 1;
      geometryBytes += geometryByteCount(skirtGeometry);
    }
    mesh.position.fromArray(patch.centerWorldM);
    this.group.add(mesh);
    this.residents.set(key, {
      object: mesh,
      material,
      drawCalls,
      geometryBytes,
    });
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
    const colors = this.createColors()?.({
      address,
      centerWorldM: patch.centerWorldM,
      surface,
      skirt,
    });
    if (colors) geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setIndex(new BufferAttribute(surface.indices, 1));
    return geometry;
  }

  private removePatch(key: string, patch: IResidentPatch): void {
    patch.object.removeFromParent();
    patch.object.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    patch.material.dispose();
    this.residents.delete(key);
  }

  private disposeResidents(): void {
    for (const [key, patch] of this.residents) this.removePatch(key, patch);
  }

  private resetSelection(): void {
    this.selectionSignature = '';
    this.refinedKeys.clear();
    this.statsSignature = '';
    this.generationEpoch++;
    this.generating.clear();
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
    for (const patch of this.residents.values()) {
      drawCalls += patch.drawCalls;
      geometryBytes += patch.geometryBytes;
    }
    const signature = `${this.desiredPatchCount}:${this.residents.size}:${queued}:${drawCalls}:${geometryBytes}:${JSON.stringify(this.selectedLevels)}`;
    if (signature === this.statsSignature) return;
    this.statsSignature = signature;
    this.lodChange.emit({
      desired: this.desiredPatchCount,
      resident: this.residents.size,
      queued,
      drawCalls,
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
