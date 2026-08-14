import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  buildFloraMesh,
  deriveFloraSockets,
  generateFloraSkeleton,
  type FloraSocketKind,
  type IFloraArchetype,
} from 'triangular-engine/procedural';
import {
  enableScatterWindSway,
  type IScatterWindHandle,
  type ScatterWindDefinition,
} from 'triangular-engine/scatter';

const TREE_WIND: ScatterWindDefinition = { strength: 0.06, frequency: 0.8 };

const GROUND_SIZE_M = 60;
const VARIANT_SPACING_M = 4.5;
const VARIANT_COUNT = 6;

/** One illustrative species — see docs/runbook/014_procedural_sublibrary.md M1. */
const DEMO_OAK_ARCHETYPE: IFloraArchetype = {
  schemaVersion: 1,
  id: 'demo-oak',
  name: 'Demo oak',
  kind: 'tree',
  trunk: { heightM: [3.5, 5], radiusM: [0.28, 0.4], taper01: 0.45 },
  branching: {
    maxDepth: 3,
    childrenPerNode: [2, 3],
    // Wider than a "narrow crown" tree would use — lower/thicker limbs
    // sticking out closer to horizontal gives deriveFloraSockets' perch
    // filter (near-horizontal, thick enough) real candidates to find.
    spreadAngleRad: [0.6, 1.3],
    lengthFalloff01: 0.68,
  },
  foliage: { style: 'cluster-sphere', sizeM: [0.9, 1.5] },
  sockets: { perchesPerBranchDepth: { 1: 3, 2: 2 }, nestCavityChance01: 0.5, fruitSlotsMax: 4, flowerHeads: false },
  collider: { trunk: 'capsule' },
};

const TRUNK_COLOR = new Color('#6b4a2f');
const LEAF_COLOR = new Color('#4f8a3d');

const SOCKET_GIZMO_RADIUS_M = 0.12;
const SOCKET_GIZMO_COLOR_BY_KIND: Record<FloraSocketKind, string> = {
  perch: '#f2b134',
  'nest-cavity': '#8859ff',
  'fruit-slot': '#ff5a5a',
  'flower-head': '#ff8fd6',
  'climb-path': '#4fd1c5',
  'root-base': '#9fb3c8',
};

/**
 * First visual slice of triangular-engine/procedural — regenerating with
 * the same seed must reproduce an identical row of trees (M1/M3 human
 * verification check in docs/runbook/014_procedural_sublibrary.md). M2
 * (sockets + collider descriptors) is in; sockets render as colored gizmo
 * spheres. Scatter integration is M4, not here yet.
 */
@Component({
  selector: 'app-flora-lab-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './flora-lab-page.component.html',
  styleUrl: './flora-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class FloraLabPageComponent {
  readonly seed = signal(1);
  readonly wireframe = signal(false);
  readonly showSockets = signal(true);
  readonly variantCount = VARIANT_COUNT;
  readonly socketKinds = Object.keys(SOCKET_GIZMO_COLOR_BY_KIND) as FloraSocketKind[];
  readonly socketGizmoColorByKind = SOCKET_GIZMO_COLOR_BY_KIND;

  private readonly engine = inject(EngineService);
  private readonly group = new Group();
  private readonly treeMeshes: Mesh[] = [];
  private readonly socketGizmos: Mesh[] = [];
  private readonly material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  private readonly windHandle: IScatterWindHandle;
  private readonly socketGizmoGeometry = new SphereGeometry(SOCKET_GIZMO_RADIUS_M, 8, 6);
  // depthTest off + renderOrder above the tree mesh keeps debug gizmos
  // visible even when buried inside foliage geometry (fruit-slot/flower-head
  // sockets sit at the same tip point the foliage cluster is centered on).
  private readonly socketGizmoMaterialByKind = new Map(
    Object.entries(SOCKET_GIZMO_COLOR_BY_KIND).map(
      ([kind, color]) => [kind as FloraSocketKind, new MeshBasicMaterial({ color, depthTest: false })] as const,
    ),
  );

  constructor() {
    const ground = new Mesh(
      new PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M),
      new MeshStandardMaterial({ color: '#3c4a33', roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.group.add(ground);

    // Real wind sway (M4 unblocked this — see docs/runbook/014, Milestone 4):
    // reads the same baked windWeight attribute the trunk-to-leaf color lerp
    // below uses, via scatter's material patch rather than a new one here.
    this.windHandle = enableScatterWindSway(this.material, TREE_WIND, {
      useVertexWindWeight: true,
    });

    this.engine.scene.add(this.group);
    this.regenerate();

    const destroyRef = inject(DestroyRef);
    this.engine.elapsedTime$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((elapsedTimeS) => this.windHandle.setTimeS(elapsedTimeS));
    destroyRef.onDestroy(() => this.dispose());
  }

  regenerate(): void {
    this.seed.set(Math.floor(Math.random() * 999_999) + 1);
    this.rebuildTrees();
  }

  setSeed(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    this.seed.set(Math.floor(parsed));
    this.rebuildTrees();
  }

  toggleWireframe(): void {
    this.wireframe.set(!this.wireframe());
    this.material.wireframe = this.wireframe();
  }

  toggleSockets(): void {
    this.showSockets.set(!this.showSockets());
    for (const gizmo of this.socketGizmos) gizmo.visible = this.showSockets();
  }

  private rebuildTrees(): void {
    this.clearTrees();
    const baseSeed = this.seed();
    const offsetM = ((this.variantCount - 1) * VARIANT_SPACING_M) / 2;

    for (let i = 0; i < this.variantCount; i++) {
      const variantSeed = baseSeed + i;
      const originXM = i * VARIANT_SPACING_M - offsetM;
      const skeleton = generateFloraSkeleton(DEMO_OAK_ARCHETYPE, variantSeed);
      const { geometry } = buildFloraMesh(skeleton, DEMO_OAK_ARCHETYPE);
      this.colorizeByWindWeight(geometry);

      const mesh = new Mesh(geometry, this.material);
      mesh.position.set(originXM, 0, 0);
      this.group.add(mesh);
      this.treeMeshes.push(mesh);

      const sockets = deriveFloraSockets(skeleton, DEMO_OAK_ARCHETYPE, variantSeed);
      for (const socket of sockets) {
        const gizmoMaterial = this.socketGizmoMaterialByKind.get(socket.kind);
        if (!gizmoMaterial) continue;
        const gizmo = new Mesh(this.socketGizmoGeometry, gizmoMaterial);
        gizmo.position.set(
          originXM + socket.positionM[0],
          socket.positionM[1],
          socket.positionM[2],
        );
        gizmo.renderOrder = 1;
        gizmo.visible = this.showSockets();
        this.group.add(gizmo);
        this.socketGizmos.push(gizmo);
      }
    }
  }

  private colorizeByWindWeight(geometry: BufferGeometry): void {
    const windWeight = geometry.getAttribute('windWeight');
    const colors = new Float32Array(windWeight.count * 3);
    const blended = new Color();
    for (let i = 0; i < windWeight.count; i++) {
      blended.copy(TRUNK_COLOR).lerp(LEAF_COLOR, windWeight.getX(i));
      colors[i * 3] = blended.r;
      colors[i * 3 + 1] = blended.g;
      colors[i * 3 + 2] = blended.b;
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  }

  private clearTrees(): void {
    for (const mesh of this.treeMeshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.treeMeshes.length = 0;

    for (const gizmo of this.socketGizmos) this.group.remove(gizmo);
    this.socketGizmos.length = 0;
  }

  private dispose(): void {
    this.clearTrees();
    this.group.removeFromParent();
    this.material.dispose();
    this.socketGizmoGeometry.dispose();
    for (const gizmoMaterial of this.socketGizmoMaterialByKind.values()) gizmoMaterial.dispose();
  }
}
