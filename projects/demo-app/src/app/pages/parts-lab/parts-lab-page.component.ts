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
  PART_ROCKET_LANDING_LEG_ARCHETYPE,
  posePartVariant,
  type IPartArchetype,
  type IPartMassProperties,
  type IPartVariant,
  type PartSocketKind,
} from 'triangular-engine/procedural';

interface IPartDisplayItem {
  readonly archetype: IPartArchetype;
  readonly baseOffsetM: readonly [number, number, number];
  variant: IPartVariant;
  meshGroup: Group;
  socketGroup: Group;
}

interface IActiveColliderItem {
  readonly key: string;
  readonly position: Vector3Tuple;
  readonly quaternion: QuaternionTuple;
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

const SOCKET_GIZMO_COLOR_BY_KIND: Record<PartSocketKind, string> = {
  attach: '#4caf50', // green
  thrust: '#ff9800', // orange
  foot: '#2196f3', // blue
  pivot: '#e91e63', // pink
  lift: '#9c27b0', // purple
};

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
  readonly legDeploy01 = signal(0.0);
  readonly selectedPartIndex = signal(1); // 0 = wing, 1 = leg, 2 = engine

  readonly currentMassProps = signal<IPartMassProperties | null>(null);
  readonly activePartColliders = signal<readonly IActiveColliderItem[]>([]);
  readonly balls = signal<readonly IDroppedBall[]>([]);

  private nextBallId = 1;
  private readonly rootGroup = new Group();
  private displayItems: IPartDisplayItem[] = [];

  constructor() {
    const grid = new GridHelper(20, 20, 0x445566, 0x223344);
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

  onDeploySlider(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = parseFloat(target.value);
    this.legDeploy01.set(value);
    this.updateLegPose();
  }

  selectPart(index: number): void {
    this.selectedPartIndex.set(index);
    if (this.displayItems[index]) {
      this.currentMassProps.set(this.displayItems[index].variant.mass);
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
      { archetype: PART_AIRCRAFT_WING_ARCHETYPE, offset: [-3.2, 0.8, 0] },
      { archetype: PART_ROCKET_LANDING_LEG_ARCHETYPE, offset: [0, 1.6, 0] },
      { archetype: PART_ROCKET_ENGINE_ARCHETYPE, offset: [3.2, 1.2, 0] },
    ];

    for (let i = 0; i < archetypes.length; i++) {
      const { archetype, offset } = archetypes[i];
      const skeleton = generatePartSkeleton(archetype, this.seed() + i * 37);
      const sockets = derivePartSockets(skeleton, archetype, this.seed() + i * 37);
      const colliders = derivePartColliders(skeleton, archetype);
      const mass = derivePartMassProperties(skeleton);

      const variant: IPartVariant = {
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
        variant,
        meshGroup,
        socketGroup,
      };

      this.displayItems.push(item);
      this.renderItemVisuals(item);
    }

    this.updateLegPose();
    this.selectPart(this.selectedPartIndex());
    this.refreshActiveColliders();
  }

  private updateLegPose(): void {
    const legItem = this.displayItems[1];
    if (!legItem || !legItem.archetype.joint) return;

    const maxRad = legItem.archetype.joint.rangeRad[1];
    const targetRad = this.legDeploy01() * maxRad;

    const initialSkeleton = generatePartSkeleton(
      legItem.archetype,
      this.seed() + 37,
    );
    const initialSockets = derivePartSockets(
      initialSkeleton,
      legItem.archetype,
      this.seed() + 37,
    );
    const initialColliders = derivePartColliders(
      initialSkeleton,
      legItem.archetype,
    );
    const initialMass = derivePartMassProperties(initialSkeleton);

    const baseVariant: IPartVariant = {
      solids: initialSkeleton,
      sockets: initialSockets,
      colliders: initialColliders,
      mass: initialMass,
      joint: legItem.archetype.joint,
    };

    legItem.variant = posePartVariant(baseVariant, targetRad);
    this.renderItemVisuals(legItem);

    if (this.selectedPartIndex() === 1) {
      this.currentMassProps.set(legItem.variant.mass);
    }

    this.refreshActiveColliders();
  }

  private refreshActiveColliders(): void {
    const colliders: IActiveColliderItem[] = [];

    for (const item of this.displayItems) {
      for (let i = 0; i < item.variant.colliders.length; i++) {
        const col = item.variant.colliders[i];
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
            boxSize = [col.params[1] * 2, col.params[0] * 2, col.params[1] * 2];
            break;
          case 'capsule':
            boxSize = [col.params[1] * 2, col.params[0] * 2, col.params[1] * 2];
            break;
        }

        colliders.push({
          key: `${item.archetype.id}-${i}`,
          position: worldPos,
          quaternion: quat,
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
    const meshResult = buildPartMesh(item.variant.solids, item.archetype);
    const mat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.5,
      metalness: 0.3,
      wireframe: this.wireframe(),
      side: DoubleSide,
    });
    const mesh = new Mesh(meshResult.geometry, mat);
    item.meshGroup.add(mesh);

    // 2. Sockets
    item.socketGroup.clear();
    item.socketGroup.visible = this.showSockets();
    for (const socket of item.variant.sockets) {
      const colorHex = SOCKET_GIZMO_COLOR_BY_KIND[socket.kind] ?? '#ffffff';
      const sphereMat = new MeshBasicMaterial({ color: colorHex });
      const sphereGeom = new SphereGeometry(socket.clearanceRadiusM * 0.25, 8, 8);
      const socketMesh = new Mesh(sphereGeom, sphereMat);
      socketMesh.position.set(...socket.positionM);
      item.socketGroup.add(socketMesh);

      // Orientation pointer line
      const pointerGeom = new BufferGeometry();
      const start = new Vector3(...socket.positionM);
      const dirVec = new Vector3(0, 0, 0.3).applyQuaternion(
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
      const lineMat = new LineBasicMaterial({ color: colorHex });
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
   * Spawns a real dynamic Jolt physics sphere above the selected part declaratively.
   */
  dropPhysicsBall(): void {
    const selectedItem = this.displayItems[this.selectedPartIndex()];
    if (!selectedItem) return;

    const spawnX = selectedItem.baseOffsetM[0] + (Math.random() - 0.5) * 0.3;
    const spawnY = selectedItem.baseOffsetM[1] + 2.2;
    const spawnZ = selectedItem.baseOffsetM[2] + (Math.random() - 0.5) * 0.3;

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
