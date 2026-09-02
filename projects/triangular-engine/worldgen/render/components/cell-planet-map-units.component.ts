import { ChangeDetectionStrategy, Component, effect, inject, input, OnDestroy, signal, untracked, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, PlaneGeometry, Vector3 } from 'three';
import { Object3DComponent, provideObject3DComponent } from 'triangular-engine';
import {
  add,
  dot,
  findCellAt,
  findCellPath,
  IPlanetGraphCore,
  IVec3,
  normalize,
  scale as scaleVec3,
} from 'triangular-engine/worldgen';
import { CellPlanetMapComponent } from './cell-planet-map.component';

/** One unit/icon on the map - a bare rendering primitive for `<cellPlanetMapUnits>`, not a game
 * "unit" system: no kind taxonomy, no ownership, no stats. See the consuming app's own idea-capture
 * doc (docs/runbook/23, brunos-space-program) for the rest of the planned 2D strategy-layer feature
 * set this is the first slice of. */
export interface ICellPlanetMapUnitInstance {
  id: string;
  /** Current sphere direction (unit vector) - same convention as `ICellClickEvent.direction`. */
  position: IVec3;
  /** Sphere direction to glide toward. Omitted, or equal to `position`, means stationary. */
  targetPosition?: IVec3;
  /** Angular speed, radians/sec of great-circle travel toward `targetPosition`. */
  speed?: number;
  /** CSS/hex color. A real per-kind icon/texture system is future work - see the doc above. */
  color?: string;
}

const DEFAULT_SPEED = 0.6;
const ICON_SIZE = 60;
const UNITS_LOCAL_Z = 1;
const INITIAL_CAPACITY = 64;
const ANGLE_EPSILON = 1e-6;

interface ILiveUnit {
  current: IVec3;
  /** The raw target as last seen from input - compared by reference in `#syncUnits()` to detect a
   * real target change (vs. an unrelated `units` input update) without a deep-equal every sync. */
  rawTarget: IVec3;
  /** Cell-graph waypoints (intermediate cell centers, then the exact `rawTarget`) to glide through
   * in order; never empty - see `#computeWaypoints()`. */
  waypoints: IVec3[];
  waypointIndex: number;
  speed: number;
  color: Color;
}

/**
 * Dynamic, per-frame-movable icon layer for `<cellPlanetMap>`. Siblings the terrain plane inside
 * the same `Group` via the standard `Object3DComponent` parent-attach mechanism
 * (`#initAttachToParent()`), so this must be declared *inside* a `<cellPlanetMap>` element to pick
 * up the right parent and the right `CellPlanetMapComponent` to project through:
 *
 * ```html
 * <cellPlanetMap #mapComp ...>
 *   <cellPlanetMapUnits [units]="units()" />
 * </cellPlanetMap>
 * ```
 *
 * Positions are sphere directions (`IVec3`), converted to plane-local `{x,y}` every tick via the
 * parent's `projectDirectionToLocalPoint()` - never cached - so units stay correctly placed across
 * pan/zoom (inherited for free, same `Group`) and projection recenters, with no extra invalidation
 * wiring. Movement is a cheap lerp-then-renormalize back onto the unit sphere, not true slerp -
 * adequate at the small per-frame angular steps this produces.
 *
 * Movement follows the map's cell graph: on a new target, `#computeWaypoints()` resolves the start/
 * end cells (`findCellAt`) and runs A* (`findCellPath`) over `neighbors` adjacency, so units travel
 * cell-to-cell rather than in a straight line through the sphere interior. Still a first-slice
 * primitive otherwise - no click-to-select, no per-kind icon art. See the doc referenced on
 * `ICellPlanetMapUnitInstance` for the rest of the planned feature set.
 */
@Component({
  selector: 'cellPlanetMapUnits',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideObject3DComponent(CellPlanetMapUnitsComponent)],
})
export class CellPlanetMapUnitsComponent extends Object3DComponent implements OnDestroy {
  readonly #map = inject(CellPlanetMapComponent);

  readonly units = input<readonly ICellPlanetMapUnitInstance[]>([]);

  readonly #geometry = new PlaneGeometry(ICON_SIZE, ICON_SIZE);
  // No `vertexColors: true` here: that flag makes three.js read a per-vertex `color` geometry
  // attribute, which `PlaneGeometry` doesn't have - the unbound attribute defaults to (0,0,0),
  // zeroing every instance to black. Per-instance color via `setColorAt`/`instanceColor` is a
  // separate three.js pathway (`USE_INSTANCING_COLOR`) that applies automatically whenever
  // `instanceColor` exists, with no material flag needed.
  readonly #material = new MeshBasicMaterial();

  readonly #mesh = signal<InstancedMesh>(this.#createMesh(INITIAL_CAPACITY));
  override object3D: WritableSignal<Object3D> = this.#mesh;

  #capacity = INITIAL_CAPACITY;
  readonly #live = new Map<string, ILiveUnit>();

  // Scratch objects reused every tick so writing instance matrices for potentially hundreds of
  // units doesn't allocate a Matrix4/Vector3 per instance per frame.
  readonly #scratchMatrix = new Matrix4();
  readonly #scratchPosition = new Vector3();

  constructor() {
    super();

    effect(() => {
      const units = this.units();
      untracked(() => this.#syncUnits(units));
    });

    this.engineService.tick$.pipe(takeUntilDestroyed()).subscribe((deltaSeconds) => this.#advance(deltaSeconds));
  }

  override ngOnDestroy(): void {
    this.#mesh().dispose();
    this.#geometry.dispose();
    this.#material.dispose();
    super.ngOnDestroy();
  }

  #createMesh(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.#geometry, this.#material, capacity);
    // An InstancedMesh culls by one aggregate bounding sphere around the whole instance set, which
    // is wrong once units spread across the map - same rationale the `scatter` sublibrary's
    // instancing adapters use for this exact flag.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.position.z = UNITS_LOCAL_Z;
    return mesh;
  }

  /** Grows the `InstancedMesh` (dispose + recreate at a larger capacity, geometry/material reused)
   * only when the live unit count exceeds what's already allocated; shrinking just lowers
   * `mesh.count` - same policy as `InstancedRigidBodyComponent`'s max-count handling, avoiding a
   * GPU buffer reallocation on every small count change. */
  #ensureCapacity(required: number): InstancedMesh {
    let mesh = this.#mesh();
    if (required > this.#capacity) {
      this.#capacity = Math.max(required, this.#capacity * 2);
      mesh.dispose();
      mesh.removeFromParent();
      mesh = this.#createMesh(this.#capacity);
      this.#mesh.set(mesh);
    }
    mesh.count = required;
    return mesh;
  }

  /** Adds/updates/removes live entries by stable `id` without resetting a unit's own in-flight
   * `current` position - only a genuine target change (or a new unit) triggers a path recompute;
   * `speed`/`color` are always refreshed from the latest input. */
  #syncUnits(units: readonly ICellPlanetMapUnitInstance[]): void {
    const graph = this.#map.graph();
    // Per-sync cache: a single click typically retargets every unit to the same cell, so units
    // sharing a (start cell, target cell) pair reuse one A* result instead of each re-running it.
    const pathCache = new Map<string, IVec3[]>();

    const seen = new Set<string>();
    for (const unit of units) {
      seen.add(unit.id);
      const target = unit.targetPosition ?? unit.position;
      const speed = unit.speed ?? DEFAULT_SPEED;
      const color = new Color(unit.color ?? '#ffffff');
      const existing = this.#live.get(unit.id);
      if (existing) {
        if (existing.rawTarget !== target) {
          existing.rawTarget = target;
          existing.waypoints = this.#computeWaypoints(existing.current, target, graph, pathCache);
          existing.waypointIndex = 0;
        }
        existing.speed = speed;
        existing.color = color;
      } else {
        this.#live.set(unit.id, {
          current: unit.position,
          rawTarget: target,
          waypoints: this.#computeWaypoints(unit.position, target, graph, pathCache),
          waypointIndex: 0,
          speed,
          color,
        });
      }
    }
    for (const id of [...this.#live.keys()]) {
      if (!seen.has(id)) this.#live.delete(id);
    }
  }

  /** Resolves `from`/`to` to graph cells and A*-paths between them, returning the intermediate
   * cells' centers followed by the exact `to` direction (not the target cell's center, so a unit
   * still arrives precisely at a clicked point, not just "somewhere in that cell"). Falls back to a
   * direct one-waypoint hop (old straight-line behavior) if the graph isn't built yet or no path is
   * found - a disconnected planet graph shouldn't happen, but this doesn't assume it does. */
  #computeWaypoints(
    from: IVec3,
    to: IVec3,
    graph: IPlanetGraphCore | null,
    pathCache: Map<string, IVec3[]>,
  ): IVec3[] {
    if (!graph) return [to];

    const fromCellId = findCellAt(graph, from).id;
    const toCellId = findCellAt(graph, to).id;
    const key = `${fromCellId}:${toCellId}`;
    let intermediate = pathCache.get(key);
    if (!intermediate) {
      const cellPath = findCellPath(graph, fromCellId, toCellId);
      intermediate = cellPath ? cellPath.slice(1, -1).map((id) => graph.cells[id].center) : [];
      pathCache.set(key, intermediate);
    }
    return [...intermediate, to];
  }

  #advance(deltaSeconds: number): void {
    const mesh = this.#ensureCapacity(this.#live.size);

    let index = 0;
    for (const unit of this.#live.values()) {
      let target = unit.waypoints[unit.waypointIndex];
      while (target) {
        const angle = Math.acos(Math.max(-1, Math.min(1, dot(unit.current, target))));
        if (angle <= ANGLE_EPSILON) {
          // Reached this waypoint - snap onto it and move on to the next one within the same tick,
          // so a unit doesn't stall for a frame at every intermediate cell center.
          unit.current = target;
          unit.waypointIndex++;
          target = unit.waypoints[unit.waypointIndex];
          continue;
        }
        const t = Math.min(1, (unit.speed * deltaSeconds) / angle);
        const delta = add(target, scaleVec3(unit.current, -1));
        unit.current = normalize(add(unit.current, scaleVec3(delta, t)));
        break;
      }

      const local = this.#map.projectDirectionToLocalPoint(unit.current);
      this.#scratchPosition.set(local.x, local.y, 0);
      this.#scratchMatrix.identity();
      this.#scratchMatrix.setPosition(this.#scratchPosition);
      mesh.setMatrixAt(index, this.#scratchMatrix);
      mesh.setColorAt(index, unit.color);
      index++;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
