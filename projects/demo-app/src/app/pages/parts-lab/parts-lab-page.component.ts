import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BufferGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  QuaternionTuple,
  SphereGeometry,
  Vector3,
  Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { JoltPhysicsModule } from 'triangular-engine/jolt';
import {
  buildPartMesh,
  derivePartColliders,
  derivePartMassProperties,
  derivePartSockets,
  generatePartSkeleton,
  PART_AIRCRAFT_WING_ARCHETYPE,
  PART_ROCKET_ENGINE_ARCHETYPE,
  PART_ROCKET_FUEL_TANK_ARCHETYPE,
  PART_ROCKET_LANDING_LEG_ARCHETYPE,
  posePartVariant,
  type IPartArchetype,
  type IPartMassProperties,
  type IPartSolid,
  type IPartVariant,
  type PartSocketKind,
} from 'triangular-engine/procedural';

interface IPartDisplayItem {
  readonly archetype: IPartArchetype;
  readonly baseOffsetM: readonly [number, number, number];
  baseVariant: IPartVariant;
  posedVariant: IPartVariant;
  meshGroup: Group;
  socketGroup: Group;
}

interface IActiveColliderItem {
  readonly key: string;
  readonly position: Vector3Tuple;
  readonly quaternion: QuaternionTuple;
  readonly rotation: Vector3Tuple;
  readonly isSphere: boolean;
  readonly radius: number;
  readonly boxSize: [number, number, number];
}

interface IDroppedBall {
  readonly id: number;
  readonly position: Vector3Tuple;
  readonly color: string;
  readonly radius: number;
}

interface IDynamicVesselItem {
  readonly id: number;
  readonly position: Vector3Tuple;
  readonly quaternion: QuaternionTuple;
  readonly colliders: readonly IActiveColliderItem[];
  readonly geometry: BufferGeometry;
}

const SOCKET_GIZMO_COLOR_BY_KIND: Record<PartSocketKind, string> = {
  attach: '#4caf50', // green
  thrust: '#ff9800', // orange
  foot: '#2196f3', // blue
  pivot: '#e91e63', // pink
  lift: '#9c27b0', // purple
};

const DEG_TO_RAD = Math.PI / 180;

@Component({
  selector: 'app-parts-lab-page',
  imports: [RouterLink, EngineModule, JoltPhysicsModule],
  templateUrl: './parts-lab-page.component.html',
  styleUrl: './parts-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class PartsLabPageComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly seed = signal(42);
  readonly wireframe = signal(false);
  readonly showSockets = signal(true);
  readonly showColliders = signal(false);

  readonly selectedPartIndex = signal(0); // 0 = wing, 1 = leg, 2 = engine, 3 = tank
  readonly wingFlapDeg = signal(0.0); // -25 to +25 deg
  readonly legDeploy01 = signal(0.0); // 0 to 1 (0 to 66 deg + 0.65m stroke)
  readonly engineGimbalDeg = signal(0.0); // -10 to +10 deg

  readonly currentMassProps = signal<IPartMassProperties | null>(null);
  readonly activePartColliders = signal<readonly IActiveColliderItem[]>([]);
  readonly balls = signal<readonly IDroppedBall[]>([]);
  readonly vessels = signal<readonly IDynamicVesselItem[]>([]);

  readonly vesselMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.45,
    metalness: 0.35,
    side: DoubleSide,
  });

  private nextBallId = 1;
  private nextVesselId = 1;
  private readonly rootGroup = new Group();
  private displayItems: IPartDisplayItem[] = [];

  constructor() {
    const grid = new GridHelper(24, 24, 0x445566, 0x223344);
    grid.position.y = 0.001;
    this.rootGroup.add(grid);

    this.engine.scene.add(this.rootGroup);

    this.rebuildAllParts();

    this.destroyRef.onDestroy(() => this.dispose());
  }

  setSeed(value: number): void {
    this.seed.set(Math.max(0, Math.floor(value)));
    this.rebuildAllParts();
  }

  randomizeSeed(): void {
    this.setSeed(Math.floor(Math.random() * 100_000));
  }

  toggleWireframe(): void {
    this.wireframe.update((v) => !v);
    this.vesselMaterial.wireframe = this.wireframe();
    this.updateMaterials();
  }

  toggleSockets(): void {
    this.showSockets.update((v) => !v);
    for (const item of this.displayItems) {
      item.socketGroup.visible = this.showSockets();
    }
  }

  toggleColliders(): void {
    this.showColliders.update((v) => !v);
  }

  onWingFlapSlider(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = parseFloat(target.value);
    this.wingFlapDeg.set(value);
    this.updatePartPose(0, value * DEG_TO_RAD);
  }

  onLegDeploySlider(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = parseFloat(target.value);
    this.legDeploy01.set(value);
    const maxRad = this.displayItems[1]?.archetype.joint?.rangeRad[1] ?? 1.15;
    this.updatePartPose(1, value * maxRad);
  }

  onEngineGimbalSlider(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = parseFloat(target.value);
    this.engineGimbalDeg.set(value);
    this.updatePartPose(2, value * DEG_TO_RAD);
  }

  selectPart(index: number): void {
    this.selectedPartIndex.set(index);
    if (this.displayItems[index]) {
      this.currentMassProps.set(this.displayItems[index].posedVariant.mass);
    }
  }

  private rebuildAllParts(): void {
    for (const item of this.displayItems) {
      item.meshGroup.clear();
      item.socketGroup.clear();
    }
    this.displayItems = [];

    const archetypes: {
      archetype: IPartArchetype;
      offset: readonly [number, number, number];
    }[] = [
      { archetype: PART_AIRCRAFT_WING_ARCHETYPE, offset: [-4.5, 0.8, 0] },
      { archetype: PART_ROCKET_LANDING_LEG_ARCHETYPE, offset: [-1.5, 1.8, 0] },
      { archetype: PART_ROCKET_ENGINE_ARCHETYPE, offset: [1.5, 1.2, 0] },
      { archetype: PART_ROCKET_FUEL_TANK_ARCHETYPE, offset: [4.5, 1.5, 0] },
    ];

    for (let i = 0; i < archetypes.length; i++) {
      const { archetype, offset } = archetypes[i];
      const skeleton = generatePartSkeleton(archetype, this.seed() + i * 37);
      const sockets = derivePartSockets(skeleton, archetype, this.seed() + i * 37);
      const colliders = derivePartColliders(skeleton, archetype);
      const mass = derivePartMassProperties(skeleton);

      const baseVariant: IPartVariant = {
        solids: skeleton,
        sockets,
        colliders,
        mass,
        joint: archetype.joint,
      };

      const meshGroup = new Group();
      const socketGroup = new Group();

      const itemGroup = new Group();
      itemGroup.position.set(offset[0], offset[1], offset[2]);
      itemGroup.add(meshGroup, socketGroup);
      this.rootGroup.add(itemGroup);

      const item: IPartDisplayItem = {
        archetype,
        baseOffsetM: offset,
        baseVariant,
        posedVariant: baseVariant,
        meshGroup,
        socketGroup,
      };

      this.displayItems.push(item);
    }

    // 1. Initial render for all 4 items
    for (const item of this.displayItems) {
      this.renderItemVisuals(item);
    }

    // 2. Apply active joint poses
    this.updatePartPose(0, this.wingFlapDeg() * DEG_TO_RAD);
    const maxLegRad = this.displayItems[1]?.archetype.joint?.rangeRad[1] ?? 1.15;
    this.updatePartPose(1, this.legDeploy01() * maxLegRad);
    this.updatePartPose(2, this.engineGimbalDeg() * DEG_TO_RAD);

    this.selectPart(this.selectedPartIndex());
    this.refreshActiveColliders();
  }

  private updatePartPose(index: number, angleRad: number): void {
    const item = this.displayItems[index];
    if (!item) return;

    item.posedVariant = posePartVariant(item.baseVariant, angleRad);
    this.renderItemVisuals(item);

    if (this.selectedPartIndex() === index) {
      this.currentMassProps.set(item.posedVariant.mass);
    }

    this.refreshActiveColliders();
  }

  private refreshActiveColliders(): void {
    const colliders: IActiveColliderItem[] = [];

    for (const item of this.displayItems) {
      for (let i = 0; i < item.posedVariant.colliders.length; i++) {
        const col = item.posedVariant.colliders[i];
        const worldPos: Vector3Tuple = [
          item.baseOffsetM[0] + col.anchorRelativePositionM[0],
          item.baseOffsetM[1] + col.anchorRelativePositionM[1],
          item.baseOffsetM[2] + col.anchorRelativePositionM[2],
        ];
        const quat: QuaternionTuple = [
          col.rotation[0],
          col.rotation[1],
          col.rotation[2],
          col.rotation[3],
        ];
        const euler = new Euler().setFromQuaternion(new Quaternion(...quat));
        const rotEuler: Vector3Tuple = [euler.x, euler.y, euler.z];

        let isSphere = false;
        let radius = 0.1;
        let boxSize: [number, number, number] = [0.1, 0.1, 0.1];

        switch (col.shape) {
          case 'sphere':
            isSphere = true;
            radius = col.params[0];
            break;
          case 'box':
            boxSize = [col.params[0], col.params[1], col.params[2]];
            break;
          case 'cylinder':
          case 'capsule':
            boxSize = [col.params[1] * 2, col.params[0] * 2, col.params[1] * 2];
            break;
        }

        colliders.push({
          key: `${item.archetype.id}-${i}`,
          position: worldPos,
          quaternion: quat,
          rotation: rotEuler,
          isSphere,
          radius,
          boxSize,
        });
      }
    }

    this.activePartColliders.set(colliders);
  }

  private renderItemVisuals(item: IPartDisplayItem): void {
    // 1. Mesh
    item.meshGroup.clear();
    const meshResult = buildPartMesh(item.posedVariant.solids, item.archetype);
    const mat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.45,
      metalness: 0.35,
      wireframe: this.wireframe(),
      side: DoubleSide,
    });
    const mesh = new Mesh(meshResult.geometry, mat);
    item.meshGroup.add(mesh);

    // 2. Sockets
    item.socketGroup.clear();
    item.socketGroup.visible = this.showSockets();
    for (const socket of item.posedVariant.sockets) {
      const colorHex = SOCKET_GIZMO_COLOR_BY_KIND[socket.kind] ?? '#ffffff';
      const sphereMat = new MeshBasicMaterial({ color: colorHex });
      const sphereGeom = new SphereGeometry(0.035, 12, 8);
      const socketMesh = new Mesh(sphereGeom, sphereMat);
      socketMesh.position.set(...socket.positionM);
      item.socketGroup.add(socketMesh);

      // Orientation pointer line
      const pointerGeom = new BufferGeometry();
      const start = new Vector3(...socket.positionM);
      const dirVec = new Vector3(0, 0, 0.22).applyQuaternion(
        new Quaternion(...socket.orientation),
      );
      const end = start.clone().add(dirVec);

      pointerGeom.setAttribute(
        'position',
        new Float32BufferAttribute(
          [start.x, start.y, start.z, end.x, end.y, end.z],
          3,
        ),
      );
      const lineMat = new LineBasicMaterial({ color: colorHex, linewidth: 2 });
      const line = new LineSegments(pointerGeom, lineMat);
      item.socketGroup.add(line);
    }
  }

  private updateMaterials(): void {
    for (const item of this.displayItems) {
      item.meshGroup.traverse((child) => {
        if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
          child.material.wireframe = this.wireframe();
        }
      });
    }
  }

  /**
   * Assembles the 4 procedural parts into a complete multi-part spacecraft vessel
   * and drops it as a single dynamic Jolt compound rigid body with accurate local sub-shapes!
   */
  dropDynamicVessel(): void {
    const s = this.seed();

    // 1. Generate & pose individual parts for the vessel
    const tankSkel = generatePartSkeleton(PART_ROCKET_FUEL_TANK_ARCHETYPE, s);
    const engineSkel = generatePartSkeleton(PART_ROCKET_ENGINE_ARCHETYPE, s + 1);
    const wingSkel = generatePartSkeleton(PART_AIRCRAFT_WING_ARCHETYPE, s + 2);
    const legSkel = generatePartSkeleton(PART_ROCKET_LANDING_LEG_ARCHETYPE, s + 3);

    const posedWing = posePartVariant(
      {
        solids: wingSkel,
        sockets: [],
        colliders: derivePartColliders(wingSkel, PART_AIRCRAFT_WING_ARCHETYPE),
        mass: derivePartMassProperties(wingSkel),
        joint: PART_AIRCRAFT_WING_ARCHETYPE.joint,
      },
      this.wingFlapDeg() * DEG_TO_RAD,
    );

    const posedLeg = posePartVariant(
      {
        solids: legSkel,
        sockets: [],
        colliders: derivePartColliders(legSkel, PART_ROCKET_LANDING_LEG_ARCHETYPE),
        mass: derivePartMassProperties(legSkel),
        joint: PART_ROCKET_LANDING_LEG_ARCHETYPE.joint,
      },
      0.65 * (PART_ROCKET_LANDING_LEG_ARCHETYPE.joint?.rangeRad[1] ?? 1.15),
    );

    const posedEngine = posePartVariant(
      {
        solids: engineSkel,
        sockets: [],
        colliders: derivePartColliders(engineSkel, PART_ROCKET_ENGINE_ARCHETYPE),
        mass: derivePartMassProperties(engineSkel),
        joint: PART_ROCKET_ENGINE_ARCHETYPE.joint,
      },
      this.engineGimbalDeg() * DEG_TO_RAD,
    );

    // 2. Transform parts into vessel-local frame
    const vesselSolids: IPartSolid[] = [];
    const vesselColliders: IActiveColliderItem[] = [];
    let colIndex = 0;

    const addTransformedPart = (
      solids: readonly IPartSolid[],
      colliders: readonly any[],
      offset: readonly [number, number, number],
      rotYRad = 0,
    ) => {
      const qRot = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotYRad);

      for (const solid of solids) {
        const pLocal = new Vector3(...solid.positionM).applyQuaternion(qRot).add(new Vector3(...offset));
        const qLocal = new Quaternion(...solid.orientation).premultiply(qRot);

        vesselSolids.push({
          ...solid,
          id: `${solid.id}-vessel-${colIndex}`,
          positionM: [pLocal.x, pLocal.y, pLocal.z],
          orientation: [qLocal.x, qLocal.y, qLocal.z, qLocal.w],
        });
      }

      for (const col of colliders) {
        const pLocal = new Vector3(...col.anchorRelativePositionM).applyQuaternion(qRot).add(new Vector3(...offset));
        const qLocal = new Quaternion(...col.rotation).premultiply(qRot);
        const euler = new Euler().setFromQuaternion(qLocal);
        const rotEuler: Vector3Tuple = [euler.x, euler.y, euler.z];

        let isSphere = false;
        let radius = 0.1;
        let boxSize: [number, number, number] = [0.1, 0.1, 0.1];

        switch (col.shape) {
          case 'sphere':
            isSphere = true;
            radius = col.params[0];
            break;
          case 'box':
            boxSize = [col.params[0], col.params[1], col.params[2]];
            break;
          case 'cylinder':
          case 'capsule':
            boxSize = [col.params[1] * 2, col.params[0] * 2, col.params[1] * 2];
            break;
        }

        vesselColliders.push({
          key: `vessel-col-${colIndex++}`,
          position: [pLocal.x, pLocal.y, pLocal.z],
          quaternion: [qLocal.x, qLocal.y, qLocal.z, qLocal.w],
          rotation: rotEuler,
          isSphere,
          radius,
          boxSize,
        });
      }
    };

    // Core Tank at [0, 0, 0]
    addTransformedPart(tankSkel, derivePartColliders(tankSkel, PART_ROCKET_FUEL_TANK_ARCHETYPE), [0, 0, 0]);

    // Engine at bottom [0, -1.98, 0]
    addTransformedPart(posedEngine.solids, posedEngine.colliders, [0, -1.98, 0]);

    // Starboard Wing (+X)
    addTransformedPart(posedWing.solids, posedWing.colliders, [0.6, 0, 0]);

    // Port Wing (-X, rotated 180 around Y)
    addTransformedPart(posedWing.solids, posedWing.colliders, [-0.6, 0, 0], Math.PI);

    // Front Landing Leg (+Z)
    addTransformedPart(posedLeg.solids, posedLeg.colliders, [0, -0.7, 0.6], 0);

    // Rear Landing Leg (-Z, rotated 180 around Y)
    addTransformedPart(posedLeg.solids, posedLeg.colliders, [0, -0.7, -0.6], Math.PI);

    // 3. Build merged visual mesh geometry
    const meshResult = buildPartMesh(vesselSolids);

    // 4. Randomize initial spawn pose high in the air
    const spawnX = (Math.random() - 0.5) * 2.5;
    const spawnY = 5.5 + Math.random() * 1.5;
    const spawnZ = (Math.random() - 0.5) * 2.5;

    const randEuler = new Euler(
      (Math.random() - 0.5) * 1.2,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 1.2,
    );
    const randQuat = new Quaternion().setFromEuler(randEuler);

    const vesselItem: IDynamicVesselItem = {
      id: this.nextVesselId++,
      position: [spawnX, spawnY, spawnZ],
      quaternion: [randQuat.x, randQuat.y, randQuat.z, randQuat.w],
      colliders: vesselColliders,
      geometry: meshResult.geometry,
    };

    this.vessels.update((list) => [...list, vesselItem]);
  }

  clearVessels(): void {
    this.vessels.set([]);
  }

  /**
   * Spawns a real dynamic Jolt physics sphere above the selected part declaratively.
   */
  dropPhysicsBall(): void {
    const selectedItem = this.displayItems[this.selectedPartIndex()];
    if (!selectedItem) return;

    const spawnX = selectedItem.baseOffsetM[0] + (Math.random() - 0.5) * 0.4;
    const spawnY = selectedItem.baseOffsetM[1] + 2.2;
    const spawnZ = selectedItem.baseOffsetM[2] + (Math.random() - 0.5) * 0.4;

    const hue = Math.floor(Math.random() * 360);
    const color = `hsl(${hue}, 85%, 55%)`;

    this.balls.update((list) => [
      ...list,
      {
        id: this.nextBallId++,
        position: [spawnX, spawnY, spawnZ],
        color,
        radius: 0.18,
      },
    ]);
  }

  private dispose(): void {
    this.rootGroup.clear();
  }
}
