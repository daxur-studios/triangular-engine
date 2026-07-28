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
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  Jolt,
  JoltPhysicsComponent,
  JoltPhysicsModule,
  JoltRigidBodyComponent,
  TerrainJoltColliderAdapter,
} from 'triangular-engine/jolt';
import {
  ConstantTerrainField,
  CylinderTerrainDomain,
  generateTerrainPatchMesh,
  PlaneTerrainDomain,
  SPHERE_TERRAIN_FACES,
  SphereTerrainDomain,
  type ITerrainPatchMesh,
} from 'triangular-engine/terrain';
import {
  createTrailRibbonGeometry,
  createTrailRibbonMaterial,
  type ITrailRibbonPoint,
} from 'triangular-engine/trail';

type GroundShape = 'plane' | 'sphere' | 'cylinder';

const PLANE_PATCH_SIZE_M = 50;
const PLANE_GRID_RADIUS = 2;
/** Small-planet scale: big enough to feel like ground, small enough to read curvature within the default camera framing. */
const SPHERE_RADIUS_M = 55;
const CYLINDER_RADIUS_M = 45;
const CYLINDER_LENGTH_M = 140;
const CYLINDER_ANGULAR_PATCHES = 8;
const CYLINDER_AXIAL_PATCHES = 2;
const TERRAIN_PATCH_RESOLUTION = 20;

/** Vehicle spawns this far above (plane/sphere) or inside (cylinder) the surface it lands on, along that point's local up. */
const DROP_HEIGHT_M = 3;
const VEHICLE_SIZE: Vector3Tuple = [1.6, 0.9, 2.6];
const VEHICLE_SPEED_MPS = 9;
const VEHICLE_SPRINT_MULTIPLIER = 1.8;
const GRAVITY_MPS2 = 9.81;
/** Below this radial distance, up/gravity direction is treated as undefined (axis/centre) and world-up is used instead. */
const MIN_RADIAL_LENGTH_SQ_M2 = 1e-6;

/** Ribbon points commit this far apart — adjacent points overlap so the strip never gaps as the vehicle drives fast. */
const TRACK_COMMIT_DISTANCE_M = 0.6;
const TRACK_WIDTH_M = 0.7;
/** Halves every this many seconds — matches ground-marks.md's `0.5 ** (age / halfLife)` decay shape. */
const TRAIL_FADE_HALF_LIFE_S = 3.5;
const TRAIL_MIN_ALPHA01 = 0.04;
/** Oldest points are dropped once the trail exceeds this length, independent of fade — bounds vertex count. */
const MAX_TRAIL_POINTS = 240;

const UP_AXIS = new Vector3(0, 1, 0);

function distanceM(a: Vector3Tuple, b: Vector3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function toVector3(v: { GetX(): number; GetY(): number; GetZ(): number }): Vector3 {
  return new Vector3(v.GetX(), v.GetY(), v.GetZ());
}

/** The direction "away from the ground" at a world position — radial for sphere/cylinder, constant for plane. */
function computeUpVector(shape: GroundShape, positionM: Vector3): Vector3 {
  switch (shape) {
    case 'plane':
      return UP_AXIS.clone();
    case 'sphere': {
      if (positionM.lengthSq() < MIN_RADIAL_LENGTH_SQ_M2) return UP_AXIS.clone();
      return positionM.clone().normalize();
    }
    case 'cylinder': {
      // Axis runs along world X (CylinderTerrainDomain.getSurfacePosition = [axial, cos*r, sin*r]).
      // Walking the inside of the tube: "up" (open air) points toward the axis, gravity pulls out to the wall.
      const radial = new Vector3(0, positionM.y, positionM.z);
      if (radial.lengthSq() < MIN_RADIAL_LENGTH_SQ_M2) return UP_AXIS.clone();
      return radial.normalize().negate();
    }
  }
}

interface ITimedTrailPoint {
  readonly positionM: Vector3Tuple;
  readonly normal: Vector3Tuple;
  readonly createdAtS: number;
}

function trailAlpha01(point: ITimedTrailPoint, nowS: number): number {
  const ageS = Math.max(0, nowS - point.createdAtS);
  return 0.5 ** (ageS / TRAIL_FADE_HALF_LIFE_S);
}

/**
 * Demo: a Jolt-driven box vehicle leaves a `triangular-engine/trail` ribbon
 * that fades and prunes itself over time (per-vertex `alpha01`, no BSP decay
 * policy involved), driving across whichever ground shape
 * `triangular-engine/terrain` currently supports — flat plane, planet
 * sphere, and the inside of an O'Neill cylinder. Gravity is not Jolt's
 * built-in uniform vector; each tick applies a `Body.AddForce` toward the
 * shape's local "down" (mirrors how brunos-space-program drives its own
 * spherical vehicle gravity), so the same WASD control code works unchanged
 * on all three shapes.
 */
@Component({
  selector: 'app-vehicle-trail-lab-page',
  imports: [RouterLink, EngineModule, JoltPhysicsModule],
  templateUrl: './vehicle-trail-lab-page.component.html',
  styleUrl: './vehicle-trail-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class VehicleTrailLabPageComponent {
  readonly groundShape = signal<GroundShape>('plane');
  readonly physicsDebug = signal(false);
  readonly trailPointCount = signal(0);

  protected readonly vehicleBoxParams = VEHICLE_SIZE;
  readonly vehicleSpawnPositionM = signal<Vector3Tuple>(
    this.surfaceSpawnPositionM('plane'),
  );
  readonly vehicleSpawnVelocityM = signal<Vector3Tuple>([0, 0, 0]);

  private readonly engine = inject(EngineService);
  private readonly physicsComponent = viewChild(JoltPhysicsComponent);
  private readonly vehicleBody = viewChild<JoltRigidBodyComponent>('vehicle');

  private readonly group = new Group();
  private readonly groundMaterial = new MeshStandardMaterial({
    color: '#5a5344',
    roughness: 1,
    side: DoubleSide,
  });
  private readonly trailMaterial = createTrailRibbonMaterial({ color: '#1c140a' });

  private readonly flatField = new ConstantTerrainField(0);
  private groundMeshes: Mesh[] = [];
  private groundPatches: ITerrainPatchMesh<unknown>[] = [];
  private groundAdapter?: TerrainJoltColliderAdapter;
  private groundCollidersDirty = true;

  private trailPoints: ITimedTrailPoint[] = [];
  private trailMesh?: Mesh;

  private readonly pressedKeys = new Set<string>();

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.rebuildGround();
    this.engine.scene.add(this.group);

    const onKeyDown = (event: KeyboardEvent) => this.pressedKeys.add(event.code);
    const onKeyUp = (event: KeyboardEvent) => this.pressedKeys.delete(event.code);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    this.engine.tick$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
      this.ensureGroundColliders();
      this.driveVehicle();
    });

    destroyRef.onDestroy(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      this.groundAdapter?.dispose();
      this.clearTrail();
      this.group.removeFromParent();
      this.disposeGroundMeshes();
      this.groundMaterial.dispose();
      this.trailMaterial.dispose();
    });
  }

  togglePhysicsDebug(): void {
    this.physicsDebug.update((enabled) => !enabled);
  }

  setGroundShape(shape: GroundShape): void {
    if (shape === this.groundShape()) return;
    this.groundShape.set(shape);
    this.rebuildGround();
    this.groundCollidersDirty = true;
    this.clearTrail();
    this.vehicleSpawnPositionM.set(this.surfaceSpawnPositionM(shape));
    this.vehicleSpawnVelocityM.set([0, 0, 0]);
  }

  /** Spawn point = the shape's reference surface point + `DROP_HEIGHT_M` along that point's own local up. */
  private surfaceSpawnPositionM(shape: GroundShape): Vector3Tuple {
    const surfacePoint =
      shape === 'plane'
        ? new Vector3(0, 0, 0)
        : shape === 'sphere'
          ? new Vector3(0, SPHERE_RADIUS_M, 0)
          : new Vector3(0, CYLINDER_RADIUS_M, 0);
    const up = computeUpVector(shape, surfacePoint);
    const spawn = surfacePoint.addScaledVector(up, DROP_HEIGHT_M);
    return [spawn.x, spawn.y, spawn.z];
  }

  private rebuildGround(): void {
    this.disposeGroundMeshes();
    this.groundPatches = [];
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

  private buildPlaneGround(): void {
    const domain = new PlaneTerrainDomain(PLANE_PATCH_SIZE_M);
    for (let z = -PLANE_GRID_RADIUS; z <= PLANE_GRID_RADIUS; z++) {
      for (let x = -PLANE_GRID_RADIUS; x <= PLANE_GRID_RADIUS; x++) {
        const patch = generateTerrainPatchMesh(this.flatField, domain, {
          address: { level: 0, x, z },
          resolution: TERRAIN_PATCH_RESOLUTION,
        });
        this.installTerrainPatch(patch);
      }
    }
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
    geometry.setIndex(new BufferAttribute(patch.surface.indices, 1));
    const mesh = new Mesh(geometry, this.groundMaterial);
    mesh.position.fromArray(patch.centerWorldM);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.groundMeshes.push(mesh);
    this.groundPatches.push(patch);
  }

  private disposeGroundMeshes(): void {
    for (const mesh of this.groundMeshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.groundMeshes = [];
  }

  /** Static Jolt mesh colliders lag one frame behind a shape switch — built lazily once physics metadata is ready. */
  private ensureGroundColliders(): void {
    const metadata = this.physicsComponent()?.physicsService.metaData$.value;
    if (!metadata || !this.groundCollidersDirty) return;

    const adapter = (this.groundAdapter ??= new TerrainJoltColliderAdapter(metadata));
    adapter.reconcile(new Set());
    this.groundPatches.forEach((patch, index) => {
      adapter.add({ key: `ground:${index}`, mesh: patch });
    });
    this.groundCollidersDirty = false;
  }

  /** Camera-forward-relative WASD projected onto the vehicle's local tangent plane, plus manual radial gravity via `AddForce`. */
  private driveVehicle(): void {
    const metadata = this.physicsComponent()?.physicsService.metaData$.value;
    const body = this.vehicleBody()?.body();
    if (!metadata || !body) return;

    const shape = this.groundShape();
    const position = toVector3(body.GetPosition());
    const up = computeUpVector(shape, position);

    const inverseMass = body.GetMotionProperties().GetInverseMass();
    if (inverseMass > 0) {
      const massKg = 1 / inverseMass;
      const gravityForce = up.clone().multiplyScalar(-GRAVITY_MPS2 * massKg);
      const joltForce = new Jolt.Vec3(gravityForce.x, gravityForce.y, gravityForce.z);
      body.AddForce(joltForce);
      Jolt.destroy(joltForce);
    }

    const cameraForward = new Vector3();
    this.engine.camera.getWorldDirection(cameraForward);
    cameraForward.addScaledVector(up, -cameraForward.dot(up));
    if (cameraForward.lengthSq() < 0.0001) {
      cameraForward.copy(up.clone().cross(new Vector3(1, 0, 0)));
      if (cameraForward.lengthSq() < 0.0001) cameraForward.copy(up.clone().cross(new Vector3(0, 0, 1)));
    }
    cameraForward.normalize();
    const right = new Vector3().crossVectors(cameraForward, up).normalize();

    const movement = new Vector3();
    if (this.pressedKeys.has('KeyW')) movement.add(cameraForward);
    if (this.pressedKeys.has('KeyS')) movement.sub(cameraForward);
    if (this.pressedKeys.has('KeyD')) movement.add(right);
    if (this.pressedKeys.has('KeyA')) movement.sub(right);

    if (movement.lengthSq() > 0) {
      const speed =
        VEHICLE_SPEED_MPS *
        (this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight')
          ? VEHICLE_SPRINT_MULTIPLIER
          : 1);
      movement.normalize().multiplyScalar(speed);

      const forward = movement.clone().normalize();
      const basisRight = new Vector3().crossVectors(forward, up).normalize();
      const basis = new Matrix4().makeBasis(basisRight, up, forward);
      const rotation = new Quaternion().setFromRotationMatrix(basis);
      const joltRotation = new Jolt.Quat(rotation.x, rotation.y, rotation.z, rotation.w);
      metadata.bodyInterface.SetRotation(body.GetID(), joltRotation, Jolt.EActivation_Activate);
      Jolt.destroy(joltRotation);
    }

    const currentVelocity = toVector3(body.GetLinearVelocity());
    const alongUpMps = currentVelocity.dot(up);
    const nextVelocity = movement.addScaledVector(up, alongUpMps);
    const joltVelocity = new Jolt.Vec3(nextVelocity.x, nextVelocity.y, nextVelocity.z);
    metadata.bodyInterface.SetLinearVelocity(body.GetID(), joltVelocity);
    Jolt.destroy(joltVelocity);

    this.updateTrail(position, up);
  }

  private updateTrail(vehiclePositionM: Vector3, up: Vector3): void {
    const nowS = this.engine.elapsedTime$.value;
    const contactPoint = vehiclePositionM.clone().addScaledVector(up, -VEHICLE_SIZE[1] / 2);
    const contactPositionM: Vector3Tuple = [contactPoint.x, contactPoint.y, contactPoint.z];
    const normalM: Vector3Tuple = [up.x, up.y, up.z];

    const lastPoint = this.trailPoints[this.trailPoints.length - 1];
    if (!lastPoint || distanceM(lastPoint.positionM, contactPositionM) >= TRACK_COMMIT_DISTANCE_M) {
      this.trailPoints.push({ positionM: contactPositionM, normal: normalM, createdAtS: nowS });
    }

    while (this.trailPoints.length > 0 && trailAlpha01(this.trailPoints[0], nowS) < TRAIL_MIN_ALPHA01) {
      this.trailPoints.shift();
    }
    while (this.trailPoints.length > MAX_TRAIL_POINTS) {
      this.trailPoints.shift();
    }

    this.trailPointCount.set(this.trailPoints.length);
    this.rebuildTrailMesh(nowS);
  }

  private rebuildTrailMesh(nowS: number): void {
    if (this.trailMesh) {
      this.group.remove(this.trailMesh);
      this.trailMesh.geometry.dispose();
      this.trailMesh = undefined;
    }
    if (this.trailPoints.length < 2) return;

    const ribbonPoints: ITrailRibbonPoint[] = this.trailPoints.map((point) => ({
      positionM: point.positionM,
      widthM: TRACK_WIDTH_M,
      alpha01: trailAlpha01(point, nowS),
      normal: point.normal,
    }));
    const geometry = createTrailRibbonGeometry(ribbonPoints);
    this.trailMesh = new Mesh(geometry, this.trailMaterial);
    this.group.add(this.trailMesh);
  }

  private clearTrail(): void {
    this.trailPoints = [];
    this.trailPointCount.set(0);
    if (this.trailMesh) {
      this.group.remove(this.trailMesh);
      this.trailMesh.geometry.dispose();
      this.trailMesh = undefined;
    }
  }
}
