import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  QuaternionTuple,
  SphereGeometry,
  Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { JoltPhysicsModule } from 'triangular-engine/jolt';
import {
  buildStructureMesh,
  createChopstickTowerArchetype,
  createLaunchpadArchetype,
  createRunwayArchetype,
  deriveStructureColliders,
  deriveStructureFootprint2D,
  deriveStructureSockets,
  generateStructureSkeleton,
  poseStructureVariant,
  type IStructureArchetype,
  type IStructureFootprint2D,
  type IStructureVariant,
  type StructureSocketKind,
} from 'triangular-engine/procedural';

interface IStructureDisplayItem {
  readonly archetype: IStructureArchetype;
  readonly baseOffsetM: readonly [number, number, number];
  baseVariant: IStructureVariant;
  posedVariant: IStructureVariant;
  itemGroup: Group;
  meshGroup: Group;
  socketGroup: Group;
  footprintGroup: Group;
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

const SOCKET_GIZMO_COLOR_BY_KIND: Record<StructureSocketKind, string> = {
  'spawn-point': '#4caf50', // green
  'touchdown-zone': '#2196f3', // blue
  'catch-zone': '#e91e63', // pink
  'cable-anchor': '#9c27b0', // purple
  'refuel-dock': '#ff9800', // orange
  'power-in': '#ffeb3b', // yellow
  'corridor-node': '#00bcd4', // cyan
  perch: '#8bc34a', // light green
  custom: '#9e9e9e', // grey
};

@Component({
  selector: 'app-structures-lab-page',
  imports: [RouterLink, EngineModule, JoltPhysicsModule],
  templateUrl: './structures-lab-page.component.html',
  styleUrl: './structures-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class StructuresLabPageComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly seed = signal<number>(42);
  readonly wireframe = signal<boolean>(false);
  readonly showSockets = signal<boolean>(true);
  readonly showFootprints = signal<boolean>(true);

  // Parametric Dimensions
  readonly runwayLengthM = signal<number>(400);
  readonly runwayWidthM = signal<number>(40);
  readonly launchpadRadiusM = signal<number>(30);
  readonly towerHeightM = signal<number>(80);

  // Tower Joint Sliders
  readonly towerCarriageElevationM = signal<number>(35);
  readonly maxTowerCarriageElevationM = computed(() => Math.max(10, this.towerHeightM() - 15));
  readonly towerChopstickAngleRad = signal<number>(0);

  readonly activeStaticColliders = signal<readonly IActiveColliderItem[]>([]);
  readonly droppedBalls = signal<readonly IDroppedBall[]>([]);

  private readonly rootGroup = new Group();
  private displayItems: IStructureDisplayItem[] = [];
  private ballCounter = 0;

  constructor() {
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#0d1527');

    const grid = new GridHelper(600, 60, 0x475569, 0x1e293b);
    grid.position.y = 0.01;
    this.rootGroup.add(grid);

    this.engine.scene.add(this.rootGroup);

    this.rebuildAllStructures();

    this.destroyRef.onDestroy(() => {
      this.engine.scene.remove(this.rootGroup);
      this.engine.scene.background = previousBackground;
    });
  }

  onSeedChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!isNaN(val)) {
      this.seed.set(val);
      this.rebuildAllStructures();
    }
  }

  onRandomSeed(): void {
    const nextSeed = Math.floor(Math.random() * 90000) + 1000;
    this.seed.set(nextSeed);
    this.rebuildAllStructures();
  }

  toggleWireframe(): void {
    this.wireframe.update((v) => !v);
    this.updateMaterialWireframe();
  }

  toggleSockets(): void {
    this.showSockets.update((v) => !v);
    for (const item of this.displayItems) {
      item.socketGroup.visible = this.showSockets();
    }
  }

  toggleFootprints(): void {
    this.showFootprints.update((v) => !v);
    for (const item of this.displayItems) {
      item.footprintGroup.visible = this.showFootprints();
    }
  }

  onRunwayLengthChange(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.runwayLengthM.set(val);
    this.rebuildAllStructures();
  }

  onRunwayWidthChange(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.runwayWidthM.set(val);
    this.rebuildAllStructures();
  }

  onLaunchpadRadiusChange(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.launchpadRadiusM.set(val);
    this.rebuildAllStructures();
  }

  onTowerHeightChange(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.towerHeightM.set(val);
    if (this.towerCarriageElevationM() > val - 15) {
      this.towerCarriageElevationM.set(Math.max(5, val * 0.45));
    }
    this.rebuildAllStructures();
  }

  onCarriageElevationChange(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.towerCarriageElevationM.set(val);
    this.applyJointPoses();
  }

  onChopstickAngleChange(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.towerChopstickAngleRad.set(val);
    this.applyJointPoses();
  }

  dropBall(x: number, y: number, z: number): void {
    this.ballCounter++;
    const colors = ['#f43f5e', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'];
    const newBall: IDroppedBall = {
      id: this.ballCounter,
      position: [x, y, z],
      color: colors[this.ballCounter % colors.length],
      radius: 1.5,
    };
    this.droppedBalls.update((b) => [...b.slice(-15), newBall]);
  }

  clearBalls(): void {
    this.droppedBalls.set([]);
  }

  private rebuildAllStructures(): void {
    for (const item of this.displayItems) {
      this.rootGroup.remove(item.itemGroup);
      item.meshGroup.clear();
      item.socketGroup.clear();
      item.footprintGroup.clear();
    }

    this.displayItems = [];
    const currentSeed = this.seed();

    const offsets: readonly [number, number, number][] = [
      [-90, 0, 0], // Runway
      [0, 0, 0],   // Launchpad
      [75, 0, 0],  // Tower
    ];

    const archetypes: IStructureArchetype[] = [
      createRunwayArchetype({ lengthM: this.runwayLengthM(), widthM: this.runwayWidthM() }),
      createLaunchpadArchetype({ radiusM: this.launchpadRadiusM() }),
      createChopstickTowerArchetype({ heightM: this.towerHeightM() }),
    ];

    archetypes.forEach((archetype, idx) => {
      const offset = offsets[idx] ?? [idx * 75, 0, 0];
      const solids = generateStructureSkeleton(archetype, currentSeed);
      const sockets = deriveStructureSockets(solids, archetype, currentSeed);
      const colliders = deriveStructureColliders(solids, archetype);
      const footprint = deriveStructureFootprint2D(archetype, currentSeed);

      const baseVariant: IStructureVariant = {
        archetypeId: archetype.id,
        seed: currentSeed,
        solids,
        sockets,
        colliders,
        footprint,
        joints: archetype.joints,
      };

      const itemGroup = new Group();
      itemGroup.name = `structure-${archetype.id}-root`;
      itemGroup.position.set(...offset);

      const meshGroup = new Group();
      meshGroup.name = `structure-${archetype.id}-meshes`;

      const socketGroup = new Group();
      socketGroup.name = `structure-${archetype.id}-sockets`;
      socketGroup.visible = this.showSockets();

      const footprintGroup = this.buildFootprintVisual(footprint);
      footprintGroup.visible = this.showFootprints();

      itemGroup.add(meshGroup, socketGroup, footprintGroup);
      this.rootGroup.add(itemGroup);

      this.displayItems.push({
        archetype,
        baseOffsetM: offset,
        baseVariant,
        posedVariant: baseVariant,
        itemGroup,
        meshGroup,
        socketGroup,
        footprintGroup,
      });
    });

    this.applyJointPoses();
  }

  private applyJointPoses(): void {
    const collidersList: IActiveColliderItem[] = [];

    for (const item of this.displayItems) {
      if (item.archetype.id.includes('tower') || item.archetype.id.includes('chopstick')) {
        item.posedVariant = poseStructureVariant(item.baseVariant, {
          'carriage-lift': this.towerCarriageElevationM(),
          'chopstick-left-hinge': this.towerChopstickAngleRad(),
          'chopstick-right-hinge': -this.towerChopstickAngleRad(),
        });
      } else {
        item.posedVariant = item.baseVariant;
      }

      this.rebuildDisplayMeshes(item);
      this.rebuildDisplaySockets(item);

      // Collect Jolt static colliders
      for (let i = 0; i < item.posedVariant.colliders.length; i++) {
        const col = item.posedVariant.colliders[i];
        const [ox, oy, oz] = item.baseOffsetM;
        const [px, py, pz] = col.anchorRelativePositionM;
        const worldPos: Vector3Tuple = [ox + px, oy + py, oz + pz];

        const isSphere = col.shape === 'sphere';
        const radius = col.shape === 'sphere' ? col.params[0] : col.shape === 'cylinder' || col.shape === 'capsule' ? col.params[1] : 1;
        const boxSize: [number, number, number] =
          col.shape === 'box'
            ? [col.params[0], col.params[1], col.params[2]]
            : [radius * 2, (col.params[0] ?? 1) * 2, radius * 2];

        collidersList.push({
          key: `${item.archetype.id}-col-${i}`,
          position: worldPos,
          quaternion: col.rotation as QuaternionTuple,
          isSphere,
          radius,
          boxSize,
        });
      }
    }

    this.activeStaticColliders.set(collidersList);
  }

  private rebuildDisplayMeshes(item: IStructureDisplayItem): void {
    while (item.meshGroup.children.length > 0) {
      const child = item.meshGroup.children[0] as Mesh;
      item.meshGroup.remove(child);
      child.geometry?.dispose();
    }

    const res = buildStructureMesh(item.posedVariant.solids, item.archetype);
    const mat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      metalness: 0.25,
      wireframe: this.wireframe(),
      side: DoubleSide,
    });

    const mesh = new Mesh(res.geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    item.meshGroup.add(mesh);
  }

  private rebuildDisplaySockets(item: IStructureDisplayItem): void {
    while (item.socketGroup.children.length > 0) {
      const child = item.socketGroup.children[0] as Mesh;
      item.socketGroup.remove(child);
      child.geometry?.dispose();
    }

    for (const socket of item.posedVariant.sockets) {
      const colorHex = SOCKET_GIZMO_COLOR_BY_KIND[socket.kind] ?? '#ffffff';
      const geom = new SphereGeometry(socket.clearanceRadiusM * 0.15, 12, 8);
      const mat = new MeshBasicMaterial({ color: colorHex, wireframe: true });
      const gizmo = new Mesh(geom, mat);
      gizmo.position.set(...socket.positionM);
      item.socketGroup.add(gizmo);
    }
  }

  private buildFootprintVisual(footprint: IStructureFootprint2D): Group {
    const group = new Group();
    const lineMat = new LineBasicMaterial({ color: '#38bdf8' });

    if (footprint.kind === 'rect') {
      const hw = footprint.dimensionsM[0];
      const hl = footprint.dimensionsM[1];
      const points = [
        -hw, 0.05, -hl,  hw, 0.05, -hl,
         hw, 0.05, -hl,  hw, 0.05,  hl,
         hw, 0.05,  hl, -hw, 0.05,  hl,
        -hw, 0.05,  hl, -hw, 0.05, -hl,
      ];
      const geom = new BufferGeometry();
      geom.setAttribute('position', new Float32BufferAttribute(points, 3));
      group.add(new LineSegments(geom, lineMat));
    } else if (footprint.kind === 'circle') {
      const r = footprint.dimensionsM[0];
      const segs = 32;
      const points: number[] = [];
      for (let i = 0; i < segs; i++) {
        const a1 = (i / segs) * Math.PI * 2;
        const a2 = ((i + 1) / segs) * Math.PI * 2;
        points.push(Math.cos(a1) * r, 0.05, Math.sin(a1) * r);
        points.push(Math.cos(a2) * r, 0.05, Math.sin(a2) * r);
      }
      const geom = new BufferGeometry();
      geom.setAttribute('position', new Float32BufferAttribute(points, 3));
      group.add(new LineSegments(geom, lineMat));
    }

    return group;
  }

  private updateMaterialWireframe(): void {
    for (const item of this.displayItems) {
      for (const child of item.meshGroup.children) {
        if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
          child.material.wireframe = this.wireframe();
        }
      }
    }
  }
}
