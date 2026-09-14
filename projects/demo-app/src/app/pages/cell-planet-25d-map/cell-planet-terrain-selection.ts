import { signal, WritableSignal } from '@angular/core';
import {
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  RingGeometry,
  Vector2,
} from 'three';
import { EngineService } from 'triangular-engine';
import {
  findCellAt,
  IPlanetEcology,
  IPlanetGraphCore,
  IPlanetSurfaceBake,
  IPlanetTectonics,
  IVec3,
} from 'triangular-engine/worldgen';
import {
  IMapProjection,
  IPlanarHeightField,
  IPlanarMapBounds,
  intersectPlanarHeightField,
  mapPlanetDirectionToMapXZ,
  mapXZToPlanetDirection,
  samplePlanarHeight,
} from 'triangular-engine/worldgen/render';

/** Canonical per-cell data shown for the selected world cell. */
export interface ICellPlanetSelection {
  readonly cellId: number;
  readonly biome: string;
  readonly elevation: number;
  readonly temperature: number;
  readonly moisture: number;
  readonly isLand: boolean;
  readonly surfaceHeightM: number;
  readonly direction: IVec3;
}

/**
 * World snapshot + planar bake the picker resolves against. The graph/cell ids stay
 * authoritative; `generationKey` lets the controller drop a selection that points at a
 * different world after regeneration.
 */
export interface ICellPlanetSelectionContext {
  readonly graph: IPlanetGraphCore;
  readonly tectonics: IPlanetTectonics;
  readonly ecology: IPlanetEcology;
  readonly bake: IPlanetSurfaceBake;
  readonly projection: IMapProjection;
  readonly bounds: IPlanarMapBounds;
  readonly minHeightM: number;
  readonly maxHeightM: number;
  readonly generationKey: string;
}

export interface ICellPlanetSelectionOptions {
  /** Caller-provided signal that mirrors the current selection, or an independent host. */
  readonly onChange?: (selection: ICellPlanetSelection | null) => void;
  /** Screen-pixel drag distance beyond which a pointerup is a camera drag, not a click. */
  readonly dragThresholdPx?: number;
}

export interface ICellPlanetSelectionController {
  readonly selection: WritableSignal<ICellPlanetSelection | null>;
  setContext(context: ICellPlanetSelectionContext): void;
  selectCell(cellId: number): void;
  clearSelection(): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

const DEFAULT_DRAG_THRESHOLD_PX = 4;
const SELECTION_COLOR = 0xffe066;

/**
 * Cell picking for the planar cell-planet map. It intersects the active camera's pointer ray
 * with the *sampled* baked surface (see `intersectPlanarHeightField`) rather than the
 * undisplaced clipmap lattice, then resolves the hit through the inverse map projection to the
 * canonical graph cell. A pointerdown/pointerup movement threshold separates orbit-camera drags
 * from deliberate clicks. The selection indicator is a flat ring plus a vertical pin anchored at
 * the cell centre's sampled surface height.
 */
export function createCellPlanetSelection(
  engine: EngineService,
  options: ICellPlanetSelectionOptions = {},
): ICellPlanetSelectionController {
  const canvas = engine.canvas;
  const dragThresholdPx = options.dragThresholdPx ?? DEFAULT_DRAG_THRESHOLD_PX;
  const raycaster = new Raycaster();
  const ndc = new Vector2();

  const selection = signal<ICellPlanetSelection | null>(null);
  let context: ICellPlanetSelectionContext | undefined;
  let field: IPlanarHeightField | undefined;
  let enabled = true;
  let pointerActive = false;
  let dragDistance = 0;
  let lastPointerX = 0;
  let lastPointerY = 0;

  const group = new Group();
  group.name = 'cell-planet-selection-indicator';
  const ringGeometry = new RingGeometry(0.62, 1, 48);
  ringGeometry.rotateX(-Math.PI / 2);
  const ringMaterial = new MeshBasicMaterial({
    color: SELECTION_COLOR,
    side: DoubleSide,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
  });
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.renderOrder = 999;
  const pinGeometry = new CylinderGeometry(0.04, 0.04, 1, 8);
  pinGeometry.translate(0, 0.5, 0);
  const pinMaterial = new MeshBasicMaterial({
    color: SELECTION_COLOR,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  });
  const pin = new Mesh(pinGeometry, pinMaterial);
  pin.renderOrder = 999;
  group.add(ring, pin);
  group.visible = false;
  engine.scene.add(group);

  function notify(): void {
    options.onChange?.(selection());
  }

  function hideIndicator(): void {
    group.visible = false;
  }

  function positionIndicator(cellId: number): void {
    const active = context;
    const activeField = field;
    if (!active || !activeField || cellId < 0 || cellId >= active.graph.cells.length) {
      hideIndicator();
      return;
    }
    const cell = active.graph.cells[cellId];
    const centre = mapPlanetDirectionToMapXZ(active.projection, activeField, cell.center);
    const surfaceHeightM = samplePlanarHeight(activeField, centre.x, centre.z);

    let radius = 2;
    const corner = cell.corners[0];
    if (corner) {
      const cornerPoint = mapPlanetDirectionToMapXZ(active.projection, activeField, corner);
      radius = Math.hypot(cornerPoint.x - centre.x, cornerPoint.z - centre.z);
    }
    radius = Math.min(30, Math.max(1, radius * 1.15));
    const pinHeight = Math.min(40, Math.max(3, radius * 3));

    ring.scale.set(radius, 1, radius);
    pin.scale.set(radius, pinHeight, radius);
    group.position.set(centre.x, surfaceHeightM, centre.z);
    group.visible = true;
  }

  function applyCell(cellId: number, shouldNotify: boolean): void {
    const active = context;
    if (!active || cellId < 0 || cellId >= active.graph.cells.length) {
      clearSelection();
      return;
    }
    const cell = active.graph.cells[cellId];
    const centre = mapPlanetDirectionToMapXZ(active.projection, field!, cell.center);
    const surfaceHeightM = samplePlanarHeight(field!, centre.x, centre.z);
    const next: ICellPlanetSelection = {
      cellId,
      biome: active.ecology.biome[cellId] ?? 'unknown',
      elevation: active.tectonics.elevation[cellId] ?? 0,
      temperature: active.ecology.temperature[cellId] ?? 0,
      moisture: active.ecology.moisture[cellId] ?? 0,
      isLand: active.tectonics.isLand[cellId] ?? false,
      surfaceHeightM,
      direction: cell.center,
    };
    selection.set(next);
    positionIndicator(cellId);
    if (shouldNotify) notify();
  }

  function clearSelection(): void {
    const hadSelection = selection() !== null;
    selection.set(null);
    hideIndicator();
    if (hadSelection) notify();
  }

  function onPointerDown(event: PointerEvent): void {
    if (!enabled || event.button !== 0) return;
    pointerActive = true;
    dragDistance = 0;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  }

  function onPointerMove(event: PointerEvent): void {
    if (!pointerActive) return;
    dragDistance += Math.hypot(event.clientX - lastPointerX, event.clientY - lastPointerY);
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  }

  function onPointerUp(event: PointerEvent): void {
    if (!pointerActive) return;
    pointerActive = false;
    if (!enabled || dragDistance > dragThresholdPx) return;
    pickAt(event.clientX, event.clientY);
  }

  function onPointerCancel(): void {
    pointerActive = false;
  }

  function pickAt(clientX: number, clientY: number): void {
    const active = context;
    const activeField = field;
    if (!active || !activeField) return;
    const camera = engine.camera$.value;
    if (!camera) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = intersectPlanarHeightField(activeField, {
      origin: raycaster.ray.origin,
      direction: raycaster.ray.direction,
    });
    if (!hit) return;
    const direction = mapXZToPlanetDirection(active.projection, activeField, hit.x, hit.z);
    if (!direction) return;
    applyCell(findCellAt(active.graph, direction).id, true);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);

  return {
    selection,
    setContext(next: ICellPlanetSelectionContext): void {
      const previousKey = context?.generationKey;
      context = next;
      field = {
        width: next.bake.width,
        height: next.bake.height,
        elevations: next.bake.elevations,
        bounds: next.bounds,
        minY: next.minHeightM,
        maxY: next.maxHeightM,
      };
      if (selection() === null) return;
      if (previousKey !== undefined && previousKey !== next.generationKey) {
        clearSelection();
        return;
      }
      // Same cell on a rebuilt snapshot: refresh its values and projected position without
      // dropping the selection (height scale, water level and projection can all change it).
      applyCell(selection()!.cellId, true);
    },
    selectCell(cellId: number): void {
      if (!context) return;
      applyCell(cellId, true);
    },
    clearSelection,
    setEnabled(next: boolean): void {
      enabled = next;
      if (!next) onPointerCancel();
    },
    dispose(): void {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      engine.scene.remove(group);
      ringGeometry.dispose();
      ringMaterial.dispose();
      pinGeometry.dispose();
      pinMaterial.dispose();
    },
  };
}
