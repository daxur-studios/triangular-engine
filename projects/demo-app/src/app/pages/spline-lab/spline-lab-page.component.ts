import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  SphereGeometry,
  Vector2,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  addVec3,
  getSplineArcLengthTable,
  scaleVec3,
  subVec3,
  validateSplineDefinition,
  type ISplineDefinition,
  type ISplinePoint,
  type SplineHandleMode,
  type SplineInterpolation,
  type SplineVector3,
} from 'triangular-engine/spline';

type EditMode = 'add' | 'edit';
/** What a raycast hit on a gizmo mesh identifies — stored in `mesh.userData`. */
type PickTarget =
  | { kind: 'point'; index: number }
  | { kind: 'handleOut'; index: number }
  | { kind: 'handleIn'; index: number };
type DragTarget =
  | {
      kind: 'point';
      index: number;
      /** Ground hit at drag start, so later moves can be expressed as a delta. */
      startHit: SplineVector3;
      /** Every selected point's starting position, so the whole group moves together. */
      startPositions: Map<number, SplineVector3>;
    }
  | { kind: 'handleOut'; index: number }
  | { kind: 'handleIn'; index: number };

/** Undo/redo unit — everything that defines the curve, but not transient UI state like selection. */
interface HistorySnapshot {
  points: ISplinePoint[];
  closed: boolean;
  interpolation: SplineInterpolation;
}

const GROUND_SIZE_M = 120;
const POINT_RADIUS_M = 0.9;
const HANDLE_RADIUS_M = 0.55;
/** Nudges every gizmo/curve line above the ground plane so it doesn't z-fight. */
const LIFT_M = 0.05;

let nextSplineLabId = 1;

/**
 * `triangular-engine/spline` Phase 0A POC (see docs/runbook/008 in
 * triangular-workspace): a hand-rolled Three.js editor exercising the core
 * package directly — click to place points, drag points/Bezier handles,
 * switch handle type per point. This deliberately bypasses the not-yet-built
 * `spline/three` and `spline/engine` layers; it's a spike to validate the
 * core API is enough to build a real editor on, not a preview of Phase 2/3.
 */
@Component({
  selector: 'app-spline-lab-page',
  imports: [RouterLink, EngineModule, DecimalPipe],
  templateUrl: './spline-lab-page.component.html',
  styleUrl: './spline-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class SplineLabPageComponent {
  readonly mode = signal<EditMode>('add');
  readonly interpolation = signal<SplineInterpolation>('bezier');
  readonly closed = signal(false);
  readonly selectedIndices = signal<ReadonlySet<number>>(new Set());
  readonly pointCount = signal(0);
  readonly lengthM = signal(0);
  readonly validationError = signal<string | undefined>(undefined);
  readonly isOrbitActive = signal(true);

  readonly hasSelection = computed(() => this.selectedIndices().size > 0);
  readonly selectedCount = computed(() => this.selectedIndices().size);

  private readonly undoStack = signal<HistorySnapshot[]>([]);
  private readonly redoStack = signal<HistorySnapshot[]>([]);
  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);

  /** `undefined` when nothing is selected, or when the selection has mixed handle modes. */
  readonly selectedHandleMode = computed<SplineHandleMode | undefined>(() => {
    const indices = this.selectedIndices();
    if (indices.size === 0) return undefined;
    const points = this.pointsSignal();
    let mode: SplineHandleMode | undefined;
    for (const index of indices) {
      const pointMode = points[index]?.handleMode ?? 'auto';
      if (mode === undefined) mode = pointMode;
      else if (mode !== pointMode) return undefined;
    }
    return mode;
  });

  private readonly engine = inject(EngineService);
  private readonly raycaster = new Raycaster();
  private readonly group = new Group();
  private readonly id = `spline-lab-${nextSplineLabId++}`;

  /**
   * Backing store for `points`. Plain-field mutation doesn't invalidate
   * `computed()`s (e.g. `selectedHandleMode`), so state lives in a signal;
   * the `points` get/set accessor below keeps every other call site (which
   * reads/writes it like a plain array) unchanged.
   */
  private readonly pointsSignal = signal<ISplinePoint[]>([]);
  private get points(): ISplinePoint[] {
    return this.pointsSignal();
  }
  private set points(value: ISplinePoint[]) {
    this.pointsSignal.set(value);
  }
  private drag?: DragTarget;
  /** Pre-drag snapshot, pushed to the undo stack lazily on the drag's first actual move. */
  private dragStartSnapshot?: HistorySnapshot;

  private readonly groundGeometry: PlaneGeometry;
  private readonly groundMaterial = new MeshBasicMaterial({
    color: '#233026',
    side: DoubleSide,
  });
  private readonly groundMesh: Mesh;

  private readonly pointGeometry = new SphereGeometry(POINT_RADIUS_M, 12, 8);
  private readonly handleGeometry = new SphereGeometry(HANDLE_RADIUS_M, 10, 6);
  private readonly pointMaterial = new MeshBasicMaterial({ color: '#f4d35e' });
  private readonly selectedPointMaterial = new MeshBasicMaterial({ color: '#ff5d5d' });
  private readonly handleOutMaterial = new MeshBasicMaterial({ color: '#4ec9ff' });
  private readonly handleInMaterial = new MeshBasicMaterial({ color: '#c792ea' });
  private readonly curveMaterial = new LineBasicMaterial({ color: '#8ee08e' });
  private readonly handleLineMaterial = new LineBasicMaterial({ color: '#6b6b6b' });

  private pointMeshes: Mesh[] = [];
  private handleMeshes: Mesh[] = [];
  private handleLines: Line[] = [];
  private curveLine?: Line;

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.engine.scene.add(this.group);

    this.groundGeometry = new PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M);
    this.groundGeometry.rotateX(-Math.PI / 2);
    this.groundMesh = new Mesh(this.groundGeometry, this.groundMaterial);
    this.group.add(this.groundMesh);

    this.engine.mousedown$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((event) => this.onMouseDown(event));
    this.engine.mousemove$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((event) => this.onMouseMove(event));
    this.engine.mouseup$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => this.onMouseUp());

    destroyRef.onDestroy(() => {
      this.group.removeFromParent();
      this.disposeAll();
    });
  }

  setMode(mode: EditMode): void {
    this.mode.set(mode);
  }

  setInterpolation(interpolation: SplineInterpolation): void {
    if (interpolation === this.interpolation()) return;
    this.pushHistory(this.snapshot());
    this.interpolation.set(interpolation);
    this.rebuildScene();
  }

  toggleClosed(): void {
    if (!this.closed() && this.points.length < 3) return;
    this.pushHistory(this.snapshot());
    this.closed.update((value) => !value);
    this.rebuildScene();
  }

  undo(): void {
    const stack = this.undoStack();
    if (stack.length === 0) return;
    const previous = stack[stack.length - 1];
    this.undoStack.set(stack.slice(0, -1));
    this.redoStack.update((s) => [...s, this.snapshot()]);
    this.applySnapshot(previous);
  }

  redo(): void {
    const stack = this.redoStack();
    if (stack.length === 0) return;
    const next = stack[stack.length - 1];
    this.redoStack.set(stack.slice(0, -1));
    this.undoStack.update((s) => [...s, this.snapshot()]);
    this.applySnapshot(next);
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKeyDown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.undo();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      this.redo();
    }
  }

  private snapshot(): HistorySnapshot {
    return { points: this.points, closed: this.closed(), interpolation: this.interpolation() };
  }

  /** Records `snapshot` (the state *before* an edit) as an undo step, and invalidates any redo history. */
  private pushHistory(snapshot: HistorySnapshot): void {
    this.undoStack.update((stack) => [...stack, snapshot]);
    this.redoStack.set([]);
  }

  private applySnapshot(snapshot: HistorySnapshot): void {
    this.points = snapshot.points;
    this.closed.set(snapshot.closed);
    this.interpolation.set(snapshot.interpolation);
    // Selection isn't part of history — indices may no longer point at the same points.
    this.selectedIndices.set(new Set());
    this.rebuildScene();
  }

  setSelectedHandleMode(handleMode: SplineHandleMode): void {
    const indices = this.selectedIndices();
    if (indices.size === 0) return;
    const original = this.points;
    this.pushHistory(this.snapshot());

    this.points = original.map((point, index) => {
      if (!indices.has(index)) return point;
      const showOut = this.closed() || index < original.length - 1;
      const showIn = this.closed() || index > 0;
      let handleOut = point.handleOut;
      let handleIn = point.handleIn;

      if (handleMode === 'linear') {
        handleOut = [0, 0, 0];
        handleIn = [0, 0, 0];
      } else if (handleMode === 'auto') {
        handleOut = undefined;
        handleIn = undefined;
      } else if (handleMode === 'mirrored') {
        // Enforce the mirror constraint right away (instead of waiting for a
        // drag) so switching to mirrored is visible immediately.
        const source =
          handleOut ??
          (handleIn ? scaleVec3(handleIn, -1) : subVec3(this.resolveHandle(index, 'out'), point.position));
        handleOut = source;
        handleIn = scaleVec3(source, -1);
      } else {
        // broken: independent handles; seed any still-undefined side from its
        // current auto-resolved position so the point doesn't visually jump.
        if (!handleOut && showOut) handleOut = subVec3(this.resolveHandle(index, 'out'), point.position);
        if (!handleIn && showIn) handleIn = subVec3(this.resolveHandle(index, 'in'), point.position);
      }

      return { ...point, handleMode, handleOut, handleIn };
    });
    this.rebuildScene();
  }

  deleteSelected(): void {
    const indices = this.selectedIndices();
    if (indices.size === 0) return;
    this.pushHistory(this.snapshot());
    this.points = this.points.filter((_, i) => !indices.has(i));
    this.selectedIndices.set(new Set());
    if (this.closed() && this.points.length < 3) this.closed.set(false);
    this.rebuildScene();
  }

  clearAll(): void {
    if (this.points.length === 0 && !this.closed()) return;
    this.pushHistory(this.snapshot());
    this.points = [];
    this.selectedIndices.set(new Set());
    this.closed.set(false);
    this.rebuildScene();
  }

  selectAll(): void {
    if (this.points.length === 0) return;
    this.selectedIndices.set(new Set(this.points.map((_, i) => i)));
    this.rebuildScene();
  }

  private onMouseDown(event: MouseEvent | null): void {
    if (!event || event.button !== 0) return;

    if (this.mode() === 'add') {
      if (this.closed()) return;
      const hit = this.raycastGround(event);
      if (!hit) return;
      this.pushHistory(this.snapshot());
      this.points = [...this.points, { position: hit, handleMode: 'auto' }];
      this.selectedIndices.set(new Set([this.points.length - 1]));
      this.rebuildScene();
      return;
    }

    const target = this.pickTarget(event);
    if (!target) {
      // Shift-click on empty space preserves the current selection, matching
      // the additive-only convention shift-click uses on point gizmos.
      if (!event.shiftKey) this.selectedIndices.set(new Set());
      this.rebuildScene();
      return;
    }

    if (target.kind === 'point') {
      const current = this.selectedIndices();
      if (event.shiftKey) {
        const next = new Set(current);
        if (next.has(target.index)) next.delete(target.index);
        else next.add(target.index);
        this.selectedIndices.set(next);
      } else if (!current.has(target.index)) {
        // Replace the selection, unless the clicked point is already part of
        // it — in which case keep the whole group selected so it can be
        // dragged together.
        this.selectedIndices.set(new Set([target.index]));
      }

      if (!this.selectedIndices().has(target.index)) {
        // Just deselected via shift-click; nothing to drag.
        this.rebuildScene();
        return;
      }

      const hit = this.raycastGround(event);
      if (hit) {
        const indices = this.selectedIndices();
        this.drag = {
          kind: 'point',
          index: target.index,
          startHit: hit,
          startPositions: new Map(Array.from(indices, (i) => [i, this.points[i].position] as const)),
        };
        this.dragStartSnapshot = this.snapshot();
      }
    } else {
      this.drag = target;
      this.dragStartSnapshot = this.snapshot();
    }

    this.isOrbitActive.set(false);
    this.rebuildScene();
  }

  private onMouseMove(event: MouseEvent | null): void {
    if (!event || !this.drag) return;
    const hit = this.raycastGround(event);
    if (!hit) return;

    if (this.dragStartSnapshot) {
      // First move of this drag — record the pre-drag state as a single undo step.
      this.pushHistory(this.dragStartSnapshot);
      this.dragStartSnapshot = undefined;
    }

    if (this.drag.kind === 'point') {
      const { startHit, startPositions } = this.drag;
      const delta = subVec3(hit, startHit);
      this.points = this.points.map((existing, i) => {
        const start = startPositions.get(i);
        return start ? { ...existing, position: addVec3(start, delta) } : existing;
      });
      this.rebuildScene();
      return;
    }

    const { index, kind } = this.drag;
    const point = this.points[index];
    const relative = subVec3(hit, point.position);
    const currentMode = point.handleMode ?? 'auto';
    const mirrors = currentMode === 'mirrored' || currentMode === 'auto';
    const nextMode: SplineHandleMode = currentMode === 'auto' ? 'mirrored' : currentMode;

    let handleOut = point.handleOut;
    let handleIn = point.handleIn;
    if (kind === 'handleOut') {
      handleOut = relative;
      if (mirrors) handleIn = scaleVec3(relative, -1);
    } else {
      handleIn = relative;
      if (mirrors) handleOut = scaleVec3(relative, -1);
    }

    this.points = this.points.map((existing, i) =>
      i === index ? { ...existing, handleMode: nextMode, handleOut, handleIn } : existing,
    );
    this.rebuildScene();
  }

  private onMouseUp(): void {
    if (!this.drag) return;
    this.drag = undefined;
    this.dragStartSnapshot = undefined;
    this.isOrbitActive.set(true);
  }

  private pickTarget(event: MouseEvent): PickTarget | undefined {
    this.updateRaycasterFromEvent(event);
    const [handleHit] = this.raycaster.intersectObjects(this.handleMeshes, false);
    if (handleHit) return handleHit.object.userData['dragTarget'] as PickTarget;
    const [pointHit] = this.raycaster.intersectObjects(this.pointMeshes, false);
    if (pointHit) return pointHit.object.userData['dragTarget'] as PickTarget;
    return undefined;
  }

  private raycastGround(event: MouseEvent): SplineVector3 | undefined {
    this.updateRaycasterFromEvent(event);
    const [hit] = this.raycaster.intersectObject(this.groundMesh, false);
    if (!hit) return undefined;
    return [hit.point.x, 0, hit.point.z];
  }

  private updateRaycasterFromEvent(event: MouseEvent): void {
    const resolution = this.engine.resolution$.value;
    const ndc = new Vector2(
      (event.offsetX / resolution.width) * 2 - 1,
      -(event.offsetY / resolution.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.engine.camera);
  }

  private rebuildScene(): void {
    this.pointCount.set(this.points.length);
    this.rebuildPointMeshes();
    this.rebuildHandles();
    this.rebuildCurveLine();
  }

  private rebuildPointMeshes(): void {
    for (const mesh of this.pointMeshes) this.group.remove(mesh);
    const selected = this.selectedIndices();
    this.pointMeshes = this.points.map((point, index) => {
      const mesh = new Mesh(
        this.pointGeometry,
        selected.has(index) ? this.selectedPointMaterial : this.pointMaterial,
      );
      mesh.position.set(point.position[0], point.position[1] + LIFT_M, point.position[2]);
      mesh.userData['dragTarget'] = { kind: 'point', index } satisfies PickTarget;
      this.group.add(mesh);
      return mesh;
    });
  }

  private rebuildHandles(): void {
    for (const mesh of this.handleMeshes) this.group.remove(mesh);
    this.handleMeshes = [];
    for (const line of this.handleLines) {
      this.group.remove(line);
      line.geometry.dispose();
    }
    this.handleLines = [];

    if (this.interpolation() !== 'bezier' || this.points.length < 2) return;

    for (const index of this.selectedIndices()) {
      const point = this.points[index];
      const showOut = this.closed() || index < this.points.length - 1;
      const showIn = this.closed() || index > 0;

      if (showOut) {
        this.addHandleGizmo(point, index, 'handleOut', this.resolveHandle(index, 'out'), this.handleOutMaterial);
      }
      if (showIn) {
        this.addHandleGizmo(point, index, 'handleIn', this.resolveHandle(index, 'in'), this.handleInMaterial);
      }
    }
  }

  private addHandleGizmo(
    point: ISplinePoint,
    index: number,
    kind: 'handleOut' | 'handleIn',
    absolute: SplineVector3,
    material: MeshBasicMaterial,
  ): void {
    const mesh = new Mesh(this.handleGeometry, material);
    mesh.position.set(absolute[0], absolute[1] + LIFT_M, absolute[2]);
    mesh.userData['dragTarget'] = { kind, index } satisfies PickTarget;
    this.group.add(mesh);
    this.handleMeshes.push(mesh);

    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([
          point.position[0],
          point.position[1] + LIFT_M,
          point.position[2],
          absolute[0],
          absolute[1] + LIFT_M,
          absolute[2],
        ]),
        3,
      ),
    );
    const line = new Line(geometry, this.handleLineMaterial);
    this.group.add(line);
    this.handleLines.push(line);
  }

  /** Mirrors `resolveHandleOut`/`resolveHandleIn` in `spline/core/spline-evaluate.ts` for gizmo placement. */
  private resolveHandle(index: number, direction: 'out' | 'in'): SplineVector3 {
    const point = this.points[index];
    const explicit = direction === 'out' ? point.handleOut : point.handleIn;
    if (explicit) return addVec3(point.position, explicit);
    const n = this.points.length;
    const neighborIndex = direction === 'out' ? index + 1 : index - 1;
    const neighbor = this.points[((neighborIndex % n) + n) % n];
    return addVec3(point.position, scaleVec3(subVec3(neighbor.position, point.position), 1 / 3));
  }

  private rebuildCurveLine(): void {
    if (this.curveLine) {
      this.group.remove(this.curveLine);
      this.curveLine.geometry.dispose();
      this.curveLine = undefined;
    }

    const minPoints = this.closed() ? 3 : 2;
    if (this.points.length < minPoints) {
      this.lengthM.set(0);
      this.validationError.set(undefined);
      return;
    }

    const definition = this.buildDefinition();
    try {
      validateSplineDefinition(definition);
      this.validationError.set(undefined);
    } catch (err) {
      this.validationError.set(err instanceof Error ? err.message : 'Invalid spline.');
      this.lengthM.set(0);
      return;
    }

    const table = getSplineArcLengthTable(definition);
    this.lengthM.set(table.totalLength);

    const positions = new Float32Array(table.entries.length * 3);
    table.entries.forEach((entry, i) => {
      positions[i * 3] = entry.position[0];
      positions[i * 3 + 1] = entry.position[1] + LIFT_M;
      positions[i * 3 + 2] = entry.position[2];
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.curveLine = new Line(geometry, this.curveMaterial);
    this.group.add(this.curveLine);
  }

  private buildDefinition(): ISplineDefinition {
    return {
      schemaVersion: 1,
      id: this.id,
      interpolation: this.interpolation(),
      closed: this.closed(),
      points: this.points,
    };
  }

  private disposeAll(): void {
    for (const mesh of this.pointMeshes) this.group.remove(mesh);
    for (const mesh of this.handleMeshes) this.group.remove(mesh);
    for (const line of this.handleLines) {
      this.group.remove(line);
      line.geometry.dispose();
    }
    if (this.curveLine) {
      this.group.remove(this.curveLine);
      this.curveLine.geometry.dispose();
    }
    this.groundGeometry.dispose();
    this.groundMaterial.dispose();
    this.pointGeometry.dispose();
    this.handleGeometry.dispose();
    this.pointMaterial.dispose();
    this.selectedPointMaterial.dispose();
    this.handleOutMaterial.dispose();
    this.handleInMaterial.dispose();
    this.curveMaterial.dispose();
    this.handleLineMaterial.dispose();
  }
}
