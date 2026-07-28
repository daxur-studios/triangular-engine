import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Raycaster,
  Vector2,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  ConstantTerrainField,
  CylinderTerrainDomain,
  generateTerrainPatchMesh,
  SPHERE_TERRAIN_FACES,
  SphereTerrainDomain,
  type ITerrainPatchMesh,
} from 'triangular-engine/terrain';
import {
  createStampDecalGeometry,
  createTrailRibbonGeometry,
  createTrailRibbonMaterial,
  type ITrailRibbonPoint,
} from 'triangular-engine/trail';

type TrailLabMode = 'track' | 'scorch';
type GroundShape = 'plane' | 'sphere' | 'cylinder';

const GROUND_SIZE_M = 200;
const TRACK_WIDTH_M = 0.6;
/** Ribbon points commit this far apart — adjacent points overlap so the strip never gaps as the pointer moves fast. */
const TRACK_COMMIT_DISTANCE_M = 0.5;
const SCORCH_SIZE_M: Vector3Tuple = [1.8, 1.8, 0.6];
/** Small-planet scale: big enough to feel like ground, small enough to read curvature within the default camera framing. */
const SPHERE_RADIUS_M = 55;
const CYLINDER_RADIUS_M = 45;
const CYLINDER_LENGTH_M = 140;
const CYLINDER_ANGULAR_PATCHES = 8;
const CYLINDER_AXIAL_PATCHES = 2;
const TERRAIN_PATCH_RESOLUTION = 28;

function distanceM(a: Vector3Tuple, b: Vector3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Demo for `triangular-engine/trail` (doc 04 §north-star "surface trails" —
 * ground-marks.md's G1 slice): drag across the ground to lay a
 * `createTrailRibbonGeometry` strip (rover tracks), or click in scorch mode
 * to stamp a `createStampDecalGeometry` decal (engine scorch, leg pads).
 * The ground toggles between a flat plane and static plane/sphere/cylinder
 * patches from `triangular-engine/terrain`, exercising per-point surface
 * normals on curved ground ahead of G2's real flight-scene integration.
 * Decay/persistence policy is deliberately out of scope here — that's the
 * app-side G0/G2 slices in ground-marks.md, not this engine utility.
 */
@Component({
  selector: 'app-trail-lab-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './trail-lab-page.component.html',
  styleUrl: './trail-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class TrailLabPageComponent {
  readonly mode = signal<TrailLabMode>('track');
  readonly groundShape = signal<GroundShape>('plane');
  readonly trackCount = signal(0);
  readonly scorchCount = signal(0);

  private readonly engine = inject(EngineService);
  private readonly raycaster = new Raycaster();
  private readonly group = new Group();
  /** One mesh for the flat plane, six for a cubesphere, or the cylinder's angular×axial grid — `raycastGround` hit-tests all of them. */
  private groundMeshes: Mesh[] = [];
  private readonly flatField = new ConstantTerrainField(0);
  private readonly groundMaterial = new MeshStandardMaterial({
    color: '#5a5344',
    roughness: 1,
    side: DoubleSide,
  });
  private readonly trackMaterial = createTrailRibbonMaterial({
    color: '#241d14',
  });
  private readonly scorchMaterial = new MeshBasicMaterial({
    color: '#150f0a',
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: DoubleSide,
  });

  /** Bound to `<orbitControls [isActive]>` so an in-progress drag claims the pointer instead of also rotating the camera. */
  readonly isOrbitActive = signal(true);

  private isDragging = false;
  private activeTrailPoints: ITrailRibbonPoint[] = [];
  private activeTrailMesh?: Mesh;
  private readonly trailMeshes: Mesh[] = [];
  private readonly decalMeshes: Mesh[] = [];

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.rebuildGround();
    this.engine.scene.add(this.group);

    this.engine.mousedown$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((event) => this.onMouseDown(event));
    this.engine.mousemove$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((event) => this.onMouseMove(event));
    this.engine.mouseup$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => this.onMouseUp());
    this.engine.click$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((event) => this.onClick(event));

    destroyRef.onDestroy(() => {
      this.clearMarks();
      this.group.removeFromParent();
      this.disposeGroundMeshes();
      this.groundMaterial.dispose();
      this.trackMaterial.dispose();
      this.scorchMaterial.dispose();
    });
  }

  setMode(mode: TrailLabMode): void {
    this.mode.set(mode);
  }

  setGroundShape(shape: GroundShape): void {
    if (shape === this.groundShape()) return;
    this.groundShape.set(shape);
    this.clearMarks();
    this.rebuildGround();
  }

  private rebuildGround(): void {
    this.disposeGroundMeshes();
    switch (this.groundShape()) {
      case 'plane':
        this.buildPlaneGround();
        break;
      case 'sphere':
        this.buildSphereGround();
        break;
      case 'cylinder':
        this.buildCylinderGround();
        break;
    }
  }

  private disposeGroundMeshes(): void {
    for (const mesh of this.groundMeshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.groundMeshes = [];
  }

  private buildPlaneGround(): void {
    const geometry = new PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new Mesh(geometry, this.groundMaterial);
    this.group.add(mesh);
    this.groundMeshes.push(mesh);
  }

  private buildSphereGround(): void {
    const domain = new SphereTerrainDomain(SPHERE_RADIUS_M);
    for (const face of SPHERE_TERRAIN_FACES) {
      const patch = generateTerrainPatchMesh(this.flatField, domain, {
        address: { face, level: 0, x: 0, y: 0 },
        resolution: TERRAIN_PATCH_RESOLUTION,
      });
      this.installTerrainPatch(patch);
    }
  }

  private buildCylinderGround(): void {
    const domain = new CylinderTerrainDomain({
      radiusM: CYLINDER_RADIUS_M,
      lengthM: CYLINDER_LENGTH_M,
      levelZeroAngularPatchCount: CYLINDER_ANGULAR_PATCHES,
      levelZeroAxialPatchCount: CYLINDER_AXIAL_PATCHES,
    });
    for (let axialIndex = 0; axialIndex < CYLINDER_AXIAL_PATCHES; axialIndex++) {
      for (
        let angularIndex = 0;
        angularIndex < CYLINDER_ANGULAR_PATCHES;
        angularIndex++
      ) {
        const patch = generateTerrainPatchMesh(this.flatField, domain, {
          address: { level: 0, angularIndex, axialIndex },
          resolution: TERRAIN_PATCH_RESOLUTION,
        });
        this.installTerrainPatch(patch);
      }
    }
  }

  private installTerrainPatch(patch: ITerrainPatchMesh<unknown>): void {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(patch.surface.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(patch.surface.normals, 3));
    geometry.setAttribute('uv', new BufferAttribute(patch.surface.uvs, 2));
    geometry.setIndex(new BufferAttribute(patch.surface.indices, 1));
    const mesh = new Mesh(geometry, this.groundMaterial);
    mesh.position.fromArray(patch.centerWorldM);
    this.group.add(mesh);
    this.groundMeshes.push(mesh);
  }

  clearMarks(): void {
    for (const mesh of this.trailMeshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.trailMeshes.length = 0;
    for (const mesh of this.decalMeshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.decalMeshes.length = 0;
    if (this.activeTrailMesh) {
      this.group.remove(this.activeTrailMesh);
      this.activeTrailMesh.geometry.dispose();
      this.activeTrailMesh = undefined;
    }
    this.activeTrailPoints = [];
    this.trackCount.set(0);
    this.scorchCount.set(0);
  }

  private onMouseDown(event: MouseEvent | null): void {
    if (!event || this.mode() !== 'track') return;
    const hit = this.raycastGround(event);
    if (!hit) return;
    this.isDragging = true;
    this.isOrbitActive.set(false);
    this.activeTrailPoints = [
      { positionM: hit.positionM, widthM: TRACK_WIDTH_M, alpha01: 1, normal: hit.normal },
    ];
  }

  private onMouseMove(event: MouseEvent | null): void {
    if (!event || !this.isDragging) return;
    const hit = this.raycastGround(event);
    if (!hit) return;
    const lastPoint = this.activeTrailPoints[this.activeTrailPoints.length - 1];
    if (distanceM(lastPoint.positionM, hit.positionM) < TRACK_COMMIT_DISTANCE_M) {
      return;
    }
    this.activeTrailPoints.push({
      positionM: hit.positionM,
      widthM: TRACK_WIDTH_M,
      alpha01: 1,
      normal: hit.normal,
    });
    this.rebuildActiveTrailMesh();
  }

  private onMouseUp(): void {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.isOrbitActive.set(true);
    if (this.activeTrailMesh) {
      this.trailMeshes.push(this.activeTrailMesh);
      this.trackCount.set(this.trailMeshes.length);
    }
    this.activeTrailMesh = undefined;
    this.activeTrailPoints = [];
  }

  private onClick(event: MouseEvent | null): void {
    if (!event || this.mode() !== 'scorch') return;
    const hit = this.raycastGround(event);
    if (!hit) return;
    const geometry = createStampDecalGeometry({
      targetMesh: hit.mesh,
      positionM: hit.positionM,
      normal: hit.normal,
      sizeM: SCORCH_SIZE_M,
      headingRad: Math.random() * Math.PI * 2,
    });
    const mesh = new Mesh(geometry, this.scorchMaterial);
    this.group.add(mesh);
    this.decalMeshes.push(mesh);
    this.scorchCount.set(this.decalMeshes.length);
  }

  private rebuildActiveTrailMesh(): void {
    if (this.activeTrailMesh) {
      this.group.remove(this.activeTrailMesh);
      this.activeTrailMesh.geometry.dispose();
      this.activeTrailMesh = undefined;
    }
    if (this.activeTrailPoints.length < 2) return;
    const geometry = createTrailRibbonGeometry(this.activeTrailPoints);
    this.activeTrailMesh = new Mesh(geometry, this.trackMaterial);
    this.group.add(this.activeTrailMesh);
  }

  private raycastGround(
    event: MouseEvent,
  ): { positionM: Vector3Tuple; normal: Vector3Tuple; mesh: Mesh } | undefined {
    const resolution = this.engine.resolution$.value;
    const ndc = new Vector2(
      (event.offsetX / resolution.width) * 2 - 1,
      -(event.offsetY / resolution.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.engine.camera);
    const [hit] = this.raycaster.intersectObjects(this.groundMeshes, false);
    if (!hit || !hit.face || !(hit.object instanceof Mesh)) return undefined;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    return {
      positionM: [hit.point.x, hit.point.y, hit.point.z],
      normal: [normal.x, normal.y, normal.z],
      mesh: hit.object,
    };
  }
}
