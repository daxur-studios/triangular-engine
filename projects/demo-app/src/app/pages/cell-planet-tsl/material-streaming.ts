import { Vector2, type Camera } from 'three';
import {
  LatLonTerrainDomain,
  TerrainMaterialTileRuntime,
  type ITerrainMaterialTileAddress,
  type ITerrainMaterialTilePayload,
} from 'triangular-engine/terrain';
import {
  selectCellPlanetMaterialTiles,
  type MapProjectionKind,
} from 'triangular-engine/worldgen/render';
import type { WorldProfileKind } from 'triangular-engine/worldgen';
import type {
  CellPlanetMorphCellGridPayload,
  CellPlanetMorphCellGridRequest,
  CellPlanetMorphCellLookupRequest,
  CellPlanetMorphMaterialTilePayload,
  CellPlanetMorphMaterialTileRequest,
} from '../cell-planet-morph-streaming/cell-planet-morph-streaming.worker';
import type { ICellLookupPayload } from 'triangular-engine/planet-material';

/** Camera and morph state the tile selection reads each frame. */
export interface IMaterialStreamingView {
  readonly camera: Camera;
  readonly viewport: Vector2;
  readonly morphProgress: number;
  readonly projectionKind: MapProjectionKind;
}

export interface IMaterialStreamingOptions {
  readonly radiusM: number;
  readonly heightScaleM: number;
  readonly seed: number;
  readonly worldProfile: WorldProfileKind;
  /** Worker pool size for tile bakes (default 2). */
  readonly workers?: number;
  /** Texels per screen pixel target; 256 is the GLSL demo's default (4 texels per pixel). */
  readonly tileResolution?: number;
}

/**
 * Drives `TerrainMaterialTileRuntime` for the TSL demo: a small worker pool bakes material tiles, a throttled
 * selection picks which tiles the camera wants, and `runtime.gpu` is what `streamedMaterialLayer` reads.
 * Same flow as the GLSL streaming page, minus its UI.
 */
export class MaterialStreaming {
  readonly runtime: TerrainMaterialTileRuntime;
  private readonly workers: Worker[];
  private readonly load: number[];
  private readonly pending = new Map<number, {
    resolve: (payload: ITerrainMaterialTilePayload) => void;
    reject: (error: Error) => void;
    worker: number;
  }>();
  private readonly lookupPending = new Map<number, (payload: ICellLookupPayload) => void>();
  private readonly gridPending = new Map<number, (payload: CellPlanetMorphCellGridPayload) => void>();
  private readonly elevations = new Map<string, number>();
  private readonly domain: LatLonTerrainDomain;
  private refined: ReadonlySet<string> = new Set();
  private viewKey = '';
  private selectedAt = 0;
  private nextId = 1_000_000;
  private readonly viewport = new Vector2();

  constructor(private readonly options: IMaterialStreamingOptions) {
    this.domain = new LatLonTerrainDomain(options.radiusM, 4, 2);
    const count = options.workers ?? 2;
    this.workers = Array.from(
      { length: count },
      () => new Worker(
        new URL('../cell-planet-morph-streaming/cell-planet-morph-streaming.worker', import.meta.url),
        { type: 'module' },
      ),
    );
    this.load = this.workers.map(() => 0);
    for (const worker of this.workers) worker.onmessage = (event) => this.onMessage(event.data);
    this.runtime = new TerrainMaterialTileRuntime({
      request: (address) => this.requestTile(address),
      maxInFlight: count,
      onPublish: (payload, resident) => {
        for (const key of this.elevations.keys()) if (!resident.has(key)) this.elevations.delete(key);
        const a = payload.identity.address;
        this.elevations.set(`${a.level}/${a.x}/${a.y}`, (payload as CellPlanetMorphMaterialTilePayload).centerElevation);
        this.viewKey = '';
      },
    });
  }

  get gpu() {
    return this.runtime.gpu;
  }

  /** Call once per frame; selection re-runs at most every 150 ms and only when the view changed. */
  update(view: IMaterialStreamingView, drawingBuffer: Vector2): void {
    const now = performance.now();
    if (now - this.selectedAt < 150) return;
    this.selectedAt = now;
    view.camera.updateMatrixWorld();
    this.viewport.copy(drawingBuffer);
    const key = [
      ...view.camera.matrixWorld.elements,
      ...(view.camera as { projectionMatrix?: { elements: number[] } }).projectionMatrix?.elements ?? [],
      this.viewport.x, this.viewport.y, view.morphProgress, view.projectionKind,
    ].join(',');
    if (key === this.viewKey) return;
    this.viewKey = key;
    const selection = selectCellPlanetMaterialTiles({
      domain: this.domain,
      radiusM: this.options.radiusM,
      camera: view.camera,
      viewportWidthPixels: this.viewport.x,
      viewportHeightPixels: this.viewport.y,
      morphProgress: view.morphProgress,
      projectionKind: view.projectionKind,
      heightScaleM: this.options.heightScaleM,
      targetTilePixels: (this.runtime.gpu.interiorSize * 1024) / (this.options.tileResolution ?? 256),
      previousRefined: this.refined,
      maxTiles: 96,
      maxLevel: 10,
      elevationAt: (address) => this.elevations.get(`${address.level}/${address.x}/${address.y}`),
    });
    this.refined = selection.refined;
    this.runtime.update(selection.addresses);
  }

  /** Requests the per-cell colour atlas (the faction/territory overlay data) from a worker. */
  requestCellLookup(colorMode: CellPlanetMorphCellLookupRequest['colorMode'] = 'material'): Promise<ICellLookupPayload> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.lookupPending.set(id, resolve);
      const request: CellPlanetMorphCellLookupRequest = {
        kind: 'cellLookup',
        id,
        colorMode,
        worldProfile: this.options.worldProfile,
        seed: this.options.seed,
      };
      this.workers[0].postMessage(request);
    });
  }

  /** Requests the cell-grid line geometry (attribute arrays) for a projection from a worker. */
  requestCellGrid(projectionKind: MapProjectionKind): Promise<CellPlanetMorphCellGridPayload> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.gridPending.set(id, resolve);
      const request: CellPlanetMorphCellGridRequest = {
        kind: 'cellGrid',
        id,
        radius: this.options.radiusM,
        heightScaleM: this.options.heightScaleM,
        projectionKind,
        colorMode: 'natural',
        worldProfile: this.options.worldProfile,
        seed: this.options.seed,
      };
      this.workers[0].postMessage(request);
    });
  }

  dispose(): void {
    this.runtime.dispose();
    for (const worker of this.workers) worker.terminate();
  }

  private requestTile(address: ITerrainMaterialTileAddress): Promise<ITerrainMaterialTilePayload> {
    const id = this.nextId++;
    let index = 0;
    for (let i = 1; i < this.workers.length; i += 1) if (this.load[i] < this.load[index]) index = i;
    this.load[index] += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, worker: index });
      const request: CellPlanetMorphMaterialTileRequest = {
        kind: 'materialTile',
        id,
        radius: this.options.radiusM,
        colorMode: 'material',
        materialTileResolution: this.runtime.gpu.interiorSize,
        materialTileX: address.x,
        materialTileY: address.y,
        materialTileGrid: [2 ** address.level, 2 ** address.level],
        heightScaleM: this.options.heightScaleM,
        cliffStrength: 0,
        worldProfile: this.options.worldProfile,
        seed: this.options.seed,
      };
      this.workers[index].postMessage(request);
    });
  }

  private onMessage(data: {
    id: number;
    materialTile?: ITerrainMaterialTilePayload;
    cellLookup?: ICellLookupPayload;
    cellGrid?: CellPlanetMorphCellGridPayload;
    error?: string;
  }): void {
    const grid = this.gridPending.get(data.id);
    if (grid) {
      this.gridPending.delete(data.id);
      if (data.cellGrid) grid(data.cellGrid);
      return;
    }
    const lookup = this.lookupPending.get(data.id);
    if (lookup) {
      this.lookupPending.delete(data.id);
      if (data.cellLookup) lookup(data.cellLookup);
      return;
    }
    const entry = this.pending.get(data.id);
    if (!entry) return;
    this.pending.delete(data.id);
    this.load[entry.worker] = Math.max(0, this.load[entry.worker] - 1);
    if (data.error || !data.materialTile) entry.reject(new Error(data.error ?? 'Worker returned no tile.'));
    else entry.resolve(data.materialTile);
  }
}
