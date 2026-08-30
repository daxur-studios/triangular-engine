import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Raycaster,
  Vector2,
  Vector3,
  Vector3Tuple,
} from 'three';
import {
  EngineModule,
  EngineService,
  RaycastFocusContext,
  RaycastFocusResolver,
} from 'triangular-engine';
import { JoltPhysicsModule } from 'triangular-engine/jolt';
import {
  buildChunkMeshData,
  buildColliderPatch,
  buildPlanetChunks,
  buildPlanetGraphCore,
  buildPlanetTectonics,
  colliderPatchIndices,
  IPlanetGraphCore,
  IPlanetTectonics,
  IVec3,
  sampleElevation,
} from 'triangular-engine/worldgen';
import {
  elevationColor,
  formatDistanceM,
  WORLD_SIZE_TIER_RADIUS_M,
  WorldSizeTier,
} from 'triangular-engine/worldgen/render';

/** A test ball's size shouldn't change with the planet — unlike everything else in this lab
 * (terrain, camera framing, the collider patch itself), which scales with `planetRadiusM()`,
 * this stays a fixed real-world constant. */
const PHYSICS_BALL_RADIUS_M = 1;
const PHYSICS_DROP_HEIGHT_M = 5;
/** How far back `focusCameraOnPatch()` parks the camera — a fixed multiple of the ball's own
 * radius, deliberately independent of `colliderPatchAngularDeg()`. The patch width slider can
 * make the sampled patch kilometers wide (that independence from camera/render scale is the
 * whole M4d claim); framing the view to fit the *patch* would leave a 1 m ball just as
 * invisible as the original whole-planet framing did, only at a smaller wrong distance. */
const CAMERA_FOCUS_DISTANCE_M = PHYSICS_BALL_RADIUS_M * 25;

/** Per-mesh cache stashed on `Mesh.userData` — undisplaced unit direction + raw elevation per
 * vertex, so the elevation-scale slider can re-displace one mesh's positions in O(itsVertices)
 * without resampling. Same convention `cell-planet-lab`'s `IChunkMeshUserData` uses, trimmed
 * to what this lab actually needs (no chunk id/LOD — see the class doc comment). */
interface IPreviewMeshUserData {
  directions: Float32Array;
  elevations: Float32Array;
}

/**
 * Runbook 022 M4d, split out of `/cell-planet-lab` (2026-08-29 follow-up): a dedicated lab for
 * real-scale Jolt physics, separate from that page's terrain/rendering/M4e-editing scope. See
 * that page's own M4d doc comment and this repo's runbook for the full "why split" reasoning.
 *
 * Deliberately smaller than `cell-planet-lab`: no chunk LOD/culling, no map canvas, no terrain
 * editing — generate a planet, pick a world-size tier, `buildColliderPatch()` places a physics
 * test automatically (`regenerate()`, at a fixed default direction) with the camera snapped to
 * a close view of it (`focusCameraOnPatch()`), and a ball drops on it. `root` carries a real
 * `planetRadiusM()` scale (same rescale `effect()` pattern as `cell-planet-lab`), but the Jolt
 * bodies below are declared as siblings of `root` (not children of it, since Angular's
 * `<joltRigidBody>` has no notion of a parent `Object3D`'s transform) — so their own geometry
 * and `[position]` are built directly in real meters (`planetRadiusM() * ...`) rather than
 * relying on any inherited scale. Those real, large-magnitude `[position]` tuples are ordinary
 * JS numbers (already full double precision) fed straight into `Jolt.RVec3` by
 * `JoltRigidBodyComponent` — see `jolt-rigid-body.component.ts` — so this lab is the actual
 * test of whether that double-precision path holds up under a real planetary offset: watch the
 * ball settle without jitter, sinking, or tunneling, especially at the "extra-large" tier.
 *
 * 2026-08-29, second follow-up (same day): the first cut of this lab kept `cell-planet-lab`'s
 * fixed whole-planet camera framing and required an explicit "place test" click before anything
 * existed to look at — at real scale that meant a 1 m ball rendered thousands of kilometers from
 * the camera, effectively invisible, with no debug visualization of the (also invisible) Jolt
 * collider to fall back on. Fixed by auto-placing a test on generate, snapping the camera close
 * to whatever patch is active (`focusCameraOnPatch()`), and rendering the patch geometry itself
 * as a visible wireframe (`rebuildColliderPatchDebugMesh()`) alongside the invisible Jolt shape
 * that reuses the same `BufferGeometry`. The dropped ball's spawn point is also nudged off the
 * patch's exact center (`buildPhysicsTestAt()`) so it has a real chance of landing on a slope
 * and rolling, rather than settling dead-center where the gravity vector (aimed straight at that
 * center) gives it nothing to roll toward.
 *
 * This does **not** implement Krakensbane-style origin rebasing for multi-body long-range
 * interaction (`docs/PLANETARY-SCALE-PHYSICS.md`/`krakensbane-check.md`) — unbuilt, and not
 * needed here: one patch, one ball, both close together, just far from the world origin.
 */
@Component({
  selector: 'app-planet-physics-lab-page',
  imports: [RouterLink, EngineModule, JoltPhysicsModule],
  templateUrl: './planet-physics-lab-page.component.html',
  styleUrl: './planet-physics-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class PlanetPhysicsLabPageComponent implements AfterViewInit {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly cellCount = signal(300);
  readonly seed = signal(42);
  readonly relax = signal(2);
  readonly jitter = signal(15);
  readonly plateCount = signal(8);

  readonly worldSizeTier = signal<WorldSizeTier>('medium');
  readonly planetRadiusM = computed(() => WORLD_SIZE_TIER_RADIUS_M[this.worldSizeTier()]);
  /** Unlike `cell-planet-lab`'s fixed planet-wide framing, these are plain writable signals:
   * `buildPhysicsTestAt()` snaps both close to whatever patch/ball it just built (a 1 m ball is
   * invisible from a "see the whole planet" distance — that was the actual cause of "hard to
   * see where the ball is", not a rendering bug), and `zoomToPlanet()` restores the wide view.
   * `RaycastOrbitControlsComponent`'s `[cameraPosition]`/`[target]` inputs re-apply on every
   * signal change (not just once at startup — see `orbit-controls.component.ts`'s
   * `#initCameraPositionChanges()`), so setting these is a real, immediate camera snap. */
  readonly cameraPosition = signal<Vector3Tuple>([0, 0, 2.6 * this.planetRadiusM()]);
  readonly cameraTarget = signal<Vector3Tuple>([0, 0, 0]);
  private readonly avgCellAngleRad = signal(0);
  readonly avgCellSizeLabel = computed(() =>
    formatDistanceM(this.avgCellAngleRad() * this.planetRadiusM()),
  );

  /** Visual-only exaggeration of raw elevation into a radius offset, same convention
   * `cell-planet-lab`'s own `elevationScale` uses — kept as a fraction of the *local* unit
   * sphere (`previewMeshes` stay undisplaced-unit-sphere data; `root`'s own scale converts
   * that to real meters), not multiplied by `planetRadiusM()` directly. */
  readonly elevationScale = signal(2);

  readonly colliderPatchSampleCount = signal(17);
  readonly colliderPatchAngularDeg = signal(6);
  readonly colliderPatchBuildMs = signal('—');
  /** Whether the collider patch's own geometry is also drawn as a visible wireframe mesh (see
   * `rebuildColliderPatchDebugMesh()`) — without this there was no way to actually see where
   * the invisible Jolt collider sat, which was the "checkbox to see the terrain collider is
   * missing" complaint (`cell-planet-lab`'s equivalent M4d overlay has always had one; this lab
   * never got it ported over). Purely visual — the physics collider itself is unaffected by
   * this toggle. */
  readonly showColliderPatch = signal(true);
  readonly physicsGravityMagnitude = signal(1.62);
  readonly physicsPatch = signal<{
    geometry: BufferGeometry;
    center: IVec3;
    dropPosition: Vector3Tuple;
  } | null>(null);
  /** Bumped to force the template's `@for` to recreate the dynamic ball body — same
   * re-key-to-recreate trick `cell-planet-lab`'s old M4d block used. */
  readonly dropAttempt = signal(0);
  readonly physicsGravity = computed<Vector3Tuple>(() => {
    const patch = this.physicsPatch();
    const g = this.physicsGravityMagnitude();
    if (!patch) return [0, -g, 0];
    return [-patch.center.x * g, -patch.center.y * g, -patch.center.z * g];
  });
  readonly physicsBallRadiusM = PHYSICS_BALL_RADIUS_M;

  readonly cellTotal = signal(0);
  readonly buildMs = signal('—');

  private readonly root = new Group();
  private readonly previewMaterial = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    side: DoubleSide,
  });
  private previewMeshes: Mesh[] = [];
  private readonly lookRaycaster = new Raycaster();
  private readonly ndcCenter = new Vector2(0, 0);

  // Visible stand-in for the invisible Jolt collider (see showColliderPatch's doc comment) —
  // same magenta-wireframe convention cell-planet-lab's M4d overlay uses. Shares its
  // BufferGeometry with physicsPatch()'s Jolt shape (both just read positions/indices, so one
  // allocation serves both); disposed alongside it in physicsPatch's own cleanup, not here.
  private readonly colliderPatchMaterial = new MeshBasicMaterial({
    color: '#ff2fb0',
    wireframe: true,
    depthTest: true,
  });
  private colliderPatchDebugMesh: Mesh | null = null;

  private graph: IPlanetGraphCore | null = null;
  private tectonics: IPlanetTectonics | null = null;

  constructor() {
    this.engine.scene.background = new Color('#0a0d12');
    this.root.name = 'planet-physics-lab-preview';
    this.engine.scene.add(this.root);

    // Same rescale pattern as `cell-planet-lab`: `root` parents every rendered terrain mesh,
    // so one scale transform makes the world-size tier picker actually resize the planet.
    effect(() => {
      this.root.scale.setScalar(this.planetRadiusM());
    });

    this.destroyRef.onDestroy(() => {
      this.engine.scene.remove(this.root);
      for (const mesh of this.previewMeshes) mesh.geometry.dispose();
      this.previewMaterial.dispose();
      if (this.colliderPatchDebugMesh) this.engine.scene.remove(this.colliderPatchDebugMesh);
      this.colliderPatchMaterial.dispose();
      this.physicsPatch()?.geometry.dispose();
    });
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.regenerate());
  }

  onCellCount(event: Event): void {
    this.cellCount.set(Number((event.target as HTMLInputElement).value));
    this.regenerate();
  }

  onSeed(event: Event): void {
    this.seed.set(Number((event.target as HTMLInputElement).value) || 0);
    this.regenerate();
  }

  shuffleSeed(): void {
    this.seed.set(Math.floor(Math.random() * 999999));
    this.regenerate();
  }

  onRelax(event: Event): void {
    this.relax.set(Number((event.target as HTMLInputElement).value));
    this.regenerate();
  }

  onJitter(event: Event): void {
    this.jitter.set(Number((event.target as HTMLInputElement).value));
    this.regenerate();
  }

  onPlateCount(event: Event): void {
    this.plateCount.set(Number((event.target as HTMLInputElement).value));
    this.regenerate();
  }

  onElevationScale(event: Event): void {
    this.elevationScale.set(Number((event.target as HTMLInputElement).value));
    this.applyDisplacement();
  }

  onColliderPatchSampleCount(event: Event): void {
    this.colliderPatchSampleCount.set(
      Number((event.target as HTMLInputElement).value),
    );
  }

  onColliderPatchAngularWidth(event: Event): void {
    this.colliderPatchAngularDeg.set(
      Number((event.target as HTMLInputElement).value),
    );
  }

  onPhysicsGravity(event: Event): void {
    this.physicsGravityMagnitude.set(
      Number((event.target as HTMLInputElement).value),
    );
  }

  /** Rebuilds the existing patch/ball at the same spot, in the new tier's real-meter scale —
   * without this, changing world size after placing a test left the patch/ball frozen at
   * whatever real-meter magnitude the old tier baked in (they're Jolt-body siblings of `root`,
   * not children of it, so they get no free rescale — see the class doc comment), silently
   * detaching them from the terrain mesh underneath, which *does* rescale via `root.scale`. */
  setWorldSizeTier(tier: WorldSizeTier): void {
    this.worldSizeTier.set(tier);
    const patch = this.physicsPatch();
    if (patch) this.buildPhysicsTestAt(patch.center);
  }

  /** Moves the existing physics test to wherever the camera is currently looking. Renamed from
   * the original M4d code's "placeTestHere" now that a test always exists by default (see
   * `regenerate()`) — this only ever repositions one, never creates the first. */
  moveTestHere(): void {
    const direction = this.raycastPlanetDirection();
    if (!direction) return;
    this.buildPhysicsTestAt(direction);
  }

  /** Re-drops the ball from its spawn height above the existing patch, without resampling —
   * just forces the template's `@for` to recreate the dynamic rigid body. */
  respawnDrop(): void {
    if (!this.physicsPatch()) return;
    this.dropAttempt.update((n) => n + 1);
  }

  /** Restores the wide, whole-planet framing `zoomToPlanet()`'s opposite number
   * (`buildPhysicsTestAt()`) zooms away from — the way back after "move test here" or a tier
   * change snapped the camera in close. */
  zoomToPlanet(): void {
    const radiusM = this.planetRadiusM();
    this.cameraTarget.set([0, 0, 0]);
    this.cameraPosition.set([0, 0, 2.6 * radiusM]);
  }

  toggleShowColliderPatch(): void {
    this.showColliderPatch.update((visible) => !visible);
    if (this.colliderPatchDebugMesh) {
      this.colliderPatchDebugMesh.visible = this.showColliderPatch();
    }
  }

  private regenerate(): void {
    const t0 = performance.now();
    const graph = buildPlanetGraphCore({
      cellCount: this.cellCount(),
      seed: this.seed(),
      relaxationIterations: this.relax(),
      jitter: this.jitter() / 100,
    });
    this.graph = graph;
    this.avgCellAngleRad.set(this.computeAvgCellAngle(graph));

    this.tectonics = buildPlanetTectonics(graph, {
      plateCount: this.plateCount(),
      seed: this.seed(),
    });
    const t1 = performance.now();
    this.buildMs.set(`${(t1 - t0).toFixed(1)} ms`);
    this.cellTotal.set(graph.cells.length);

    this.rebuildPreviewMesh(graph, this.tectonics);

    this.physicsPatch()?.geometry.dispose();
    this.physicsPatch.set(null);
    // Auto-place a test at a fixed default direction right away, instead of waiting for the
    // user to orbit somewhere and click a button first — that "look at nothing in particular,
    // then hunt for a barely-visible ball" flow was the "having to look somewhere, hate it"
    // complaint. The direction itself is arbitrary (every point on the generated sphere is
    // equally valid); what matters is that a patch+ball already exist and the camera is already
    // focused on them by the time this method returns.
    this.buildPhysicsTestAt({ x: 0, y: 0, z: 1 });
  }

  private computeAvgCellAngle(graph: IPlanetGraphCore): number {
    let totalAngle = 0;
    let edgeCount = 0;
    for (const cell of graph.cells) {
      for (const neighborId of cell.neighbors) {
        if (neighborId <= cell.id) continue;
        const neighbor = graph.cells[neighborId];
        const d = Math.min(
          1,
          Math.max(
            -1,
            cell.center.x * neighbor.center.x +
              cell.center.y * neighbor.center.y +
              cell.center.z * neighbor.center.z,
          ),
        );
        totalAngle += Math.acos(d);
        edgeCount++;
      }
    }
    return edgeCount > 0 ? totalAngle / edgeCount : 0;
  }

  /** One mesh per chunk (`buildPlanetChunks`/`buildChunkMeshData`, same tessellation
   * `cell-planet-lab` uses) but no LOD pair, no per-frame culling — this lab's planets are
   * small and the camera never needs to be cheap here, unlike the full terrain lab. */
  private rebuildPreviewMesh(graph: IPlanetGraphCore, tectonics: IPlanetTectonics): void {
    for (const mesh of this.previewMeshes) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
    this.previewMeshes = [];

    const { chunks } = buildPlanetChunks(graph, { targetChunkSize: 150 });
    const elevMin = Math.min(...tectonics.elevation);
    const elevMax = Math.max(...tectonics.elevation);
    const scale = this.elevationScale() / 100;
    const color = new Color();

    for (const chunk of chunks) {
      const data = buildChunkMeshData(graph, tectonics.elevation, chunk);
      const vertexCount = data.elevations.length;
      const positions = new Float32Array(vertexCount * 3);
      const colors = new Float32Array(vertexCount * 3);
      for (let i = 0; i < vertexCount; i++) {
        const radius = 1 + data.elevations[i] * scale;
        const o = i * 3;
        positions[o] = data.directions[o] * radius;
        positions[o + 1] = data.directions[o + 1] * radius;
        positions[o + 2] = data.directions[o + 2] * radius;
        color.set(
          elevationColor(data.elevations[i], tectonics.seaLevelElevation, elevMin, elevMax),
        );
        colors[o] = color.r;
        colors[o + 1] = color.g;
        colors[o + 2] = color.b;
      }
      const geometry = new BufferGeometry();
      const positionAttr = new BufferAttribute(positions, 3);
      positionAttr.setUsage(DynamicDrawUsage);
      geometry.setAttribute('position', positionAttr);
      geometry.setAttribute('color', new BufferAttribute(colors, 3));
      geometry.computeVertexNormals();

      const mesh = new Mesh(geometry, this.previewMaterial);
      mesh.name = `preview-chunk-${chunk.id}`;
      mesh.userData = {
        directions: data.directions,
        elevations: data.elevations,
      } satisfies IPreviewMeshUserData;
      this.root.add(mesh);
      this.previewMeshes.push(mesh);
    }
  }

  /** Re-displaces every preview vertex from its stored (direction, elevation) pair using the
   * current `elevationScale()` — cheap, no geometry rebuild. Mirrors
   * `cell-planet-lab`'s `updatePreviewDisplacement()`. */
  private applyDisplacement(): void {
    const scale = this.elevationScale() / 100;
    for (const mesh of this.previewMeshes) {
      const { directions, elevations } = mesh.userData as IPreviewMeshUserData;
      const positionAttr = mesh.geometry.getAttribute('position') as BufferAttribute;
      const positions = positionAttr.array as Float32Array;
      for (let i = 0; i < elevations.length; i++) {
        const radius = 1 + elevations[i] * scale;
        const o = i * 3;
        positions[o] = directions[o] * radius;
        positions[o + 1] = directions[o + 1] * radius;
        positions[o + 2] = directions[o + 2] * radius;
      }
      positionAttr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
  }

  /** `raycastOrbitControls` focus resolver — same role as `cell-planet-lab`'s own, hits the
   * live preview meshes so zoom/rotate pivot on the actual displaced (and, here, real-scale)
   * surface under the pointer. */
  readonly raycastFocusResolver: RaycastFocusResolver = (
    context: RaycastFocusContext,
  ) => {
    const hit = context.raycaster.intersectObjects(this.previewMeshes, false)[0];
    return hit ? hit.point.toArray() : null;
  };

  /** Raycasts straight out from the camera (NDC center) against the live preview meshes,
   * returning the hit direction normalized to the unit sphere — dividing by the hit's own
   * length cancels out `root`'s real-world scale, so this stays a plain unit vector regardless
   * of `worldSizeTier()`. Own copy of `cell-planet-lab`'s identically-named private method;
   * not shared since each page raycasts against its own `previewMeshes`. */
  private raycastPlanetDirection(): IVec3 | null {
    const camera = this.engine.camera$.value;
    if (!camera || this.previewMeshes.length === 0) return null;

    this.lookRaycaster.setFromCamera(this.ndcCenter, camera);
    const hit = this.lookRaycaster.intersectObjects(this.previewMeshes, false)[0];
    if (!hit) return null;

    const len = hit.point.length() || 1;
    return { x: hit.point.x / len, y: hit.point.y / len, z: hit.point.z / len };
  }

  /** An arbitrary but stable tangent-plane basis at `direction` (any two mutually-perpendicular
   * vectors both perpendicular to `direction` — which specific pair doesn't matter, only that
   * they're reused consistently within one call) — used both to nudge the ball's drop point off
   * dead-center (see `buildPhysicsTestAt()`) and to frame the camera to one side of the patch
   * instead of staring straight down it. */
  private computeTangentBasis(direction: IVec3): { tangentX: Vector3; tangentY: Vector3 } {
    const dir = new Vector3(direction.x, direction.y, direction.z);
    const reference = Math.abs(dir.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const tangentX = new Vector3().crossVectors(reference, dir).normalize();
    const tangentY = new Vector3().crossVectors(dir, tangentX);
    return { tangentX, tangentY };
  }

  /** Snaps the camera to a close three-quarter view of the patch just built at `direction` —
   * the actual fix for "hard to see where the ball is": the old code left `cameraPosition`
   * fixed at a whole-planet framing (`2.6 * planetRadiusM()`) regardless of where a test was
   * placed, so a 1 m ball was rendered thousands of kilometers from the camera at any tier past
   * "mini". `CAMERA_FOCUS_DISTANCE_M` is a fixed distance sized to the ball, not the patch — see
   * that constant's doc comment for why framing off the patch's own (slider-controlled) span
   * would just relocate the same "too far to see the ball" bug. */
  private focusCameraOnPatch(direction: IVec3, surfacePosition: Vector3Tuple): void {
    const { tangentX, tangentY } = this.computeTangentBasis(direction);
    const dir = new Vector3(direction.x, direction.y, direction.z);
    const target = new Vector3(...surfacePosition);
    const position = target
      .clone()
      .addScaledVector(dir, CAMERA_FOCUS_DISTANCE_M * 0.55)
      .addScaledVector(tangentX, CAMERA_FOCUS_DISTANCE_M * 0.85)
      .addScaledVector(tangentY, CAMERA_FOCUS_DISTANCE_M * 0.4);
    this.cameraTarget.set(target.toArray() as Vector3Tuple);
    this.cameraPosition.set(position.toArray() as Vector3Tuple);
  }

  /** Renders `physicsPatch()`'s own geometry as a visible magenta wireframe — the debug overlay
   * this lab never had (see `showColliderPatch`'s doc comment). Added as a scene sibling of
   * `root`, same as the Jolt bodies themselves: the geometry's positions already carry real
   * meters (`buildPhysicsTestAt()`'s `radiusM * ...` math), so parenting it under `root` would
   * double-apply `root.scale`. */
  private rebuildColliderPatchDebugMesh(geometry: BufferGeometry): void {
    if (this.colliderPatchDebugMesh) {
      this.engine.scene.remove(this.colliderPatchDebugMesh);
    }
    const mesh = new Mesh(geometry, this.colliderPatchMaterial);
    mesh.name = 'planet-physics-lab-collider-patch-debug';
    mesh.visible = this.showColliderPatch();
    this.colliderPatchDebugMesh = mesh;
    this.engine.scene.add(mesh);
  }

  /** Builds a fresh Jolt-ready patch at `direction`, via the same
   * `buildColliderPatch()`/`colliderPatchIndices()` pair `cell-planet-lab`'s M4d debug overlay
   * uses. Unlike that debug overlay, this does NOT re-run every tick — the template's
   * `<joltMeshShape [geometry]>` would recreate the Jolt shape out from under any ball resting
   * on it, so a rebuild only happens on an explicit call (`regenerate()`'s default placement,
   * `moveTestHere()`, or a tier change).
   *
   * The one real change from the original M4d code (see this class's own doc comment): every
   * position here is built in real meters (`radiusM * ...`), not a unit-sphere fraction — this
   * geometry and the dropped ball's `[position]` are declared as Jolt-body siblings of `root`,
   * not children of it, so they get no scale transform for free and must carry the real
   * magnitude themselves.
   *
   * The ball's drop point is nudged off the patch's exact center along `tangentX` — dropped
   * dead-center, gravity (pointed straight at that same center, see `physicsGravity`) gives a
   * ball no lateral force at all, so it just compresses and sits; that read as "the ball doesn't
   * roll" even though the physics was working exactly as specified. Landing slightly off-center
   * makes it far more likely to touch down on a slope and actually roll, without needing to add
   * any velocity/torque inputs that don't exist on `JoltRigidBodyComponent` today. */
  private buildPhysicsTestAt(direction: IVec3): void {
    if (!this.graph || !this.tectonics) return;

    const sampleCount = this.colliderPatchSampleCount();
    const angularHalfWidth = (this.colliderPatchAngularDeg() * Math.PI) / 180;
    const t0 = performance.now();
    const patch = buildColliderPatch(this.graph, this.tectonics.elevation, direction, {
      angularHalfWidth,
      sampleCount,
    });
    const indices = colliderPatchIndices(patch);
    this.colliderPatchBuildMs.set(`${(performance.now() - t0).toFixed(2)} ms`);

    const scale = this.elevationScale() / 100;
    const radiusM = this.planetRadiusM();
    const positions = new Float32Array(patch.directions.length);
    for (let i = 0; i < patch.elevations.length; i++) {
      const radius = radiusM * (1 + patch.elevations[i] * scale);
      const o = i * 3;
      positions[o] = patch.directions[o] * radius;
      positions[o + 1] = patch.directions[o + 1] * radius;
      positions[o + 2] = patch.directions[o + 2] * radius;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    const { tangentX } = this.computeTangentBasis(direction);
    const centerElevation = sampleElevation(this.graph, this.tectonics.elevation, direction);
    const surfaceRadius = radiusM * (1 + centerElevation * scale);
    const surfacePosition: Vector3Tuple = [
      direction.x * surfaceRadius,
      direction.y * surfaceRadius,
      direction.z * surfaceRadius,
    ];
    const lateralOffsetM = radiusM * Math.sin(angularHalfWidth) * 0.35;
    const dropRadius = surfaceRadius + PHYSICS_DROP_HEIGHT_M;
    const dropPosition: Vector3Tuple = [
      direction.x * dropRadius + tangentX.x * lateralOffsetM,
      direction.y * dropRadius + tangentX.y * lateralOffsetM,
      direction.z * dropRadius + tangentX.z * lateralOffsetM,
    ];

    this.physicsPatch()?.geometry.dispose();
    this.physicsPatch.set({ geometry, center: direction, dropPosition });
    this.dropAttempt.update((n) => n + 1);

    this.rebuildColliderPatchDebugMesh(geometry);
    this.focusCameraOnPatch(direction, surfacePosition);
  }
}
