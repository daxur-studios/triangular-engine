import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  buildFloraMesh,
  generateFloraSkeleton,
  type IFloraArchetype,
} from 'triangular-engine/procedural';
import {
  buildOctahedralImpostorMesh,
  createOctahedralImpostorAtlas,
  exportOctahedralImpostorAtlas,
  type IOctahedralImpostorAtlas,
  type IOctahedralImpostorMaterialHandle,
} from 'triangular-engine/impostor';

/** One archetype is enough to prove out baking — see triangular-engine/procedural's flora-lab-page for a fuller showcase of the archetype system itself. */
const TREE_ARCHETYPE: IFloraArchetype = {
  schemaVersion: 1,
  id: 'impostor-demo-oak',
  name: 'Impostor demo oak',
  kind: 'tree',
  trunk: { heightM: [3.5, 5], radiusM: [0.28, 0.4], taper01: 0.45 },
  branching: {
    maxDepth: 3,
    childrenPerNode: [2, 3],
    spreadAngleRad: [0.6, 1.3],
    lengthFalloff01: 0.68,
  },
  foliage: { style: 'cluster-sphere', sizeM: [0.9, 1.5] },
  sockets: { perchesPerBranchDepth: {}, nestCavityChance01: 0, fruitSlotsMax: 0, flowerHeads: false },
  collider: { trunk: 'capsule' },
};
const TREE_SEED = 7;
const TRUNK_COLOR = new Color('#6b4a2f');
const LEAF_COLOR = new Color('#4f8a3d');

/** Big enough to stay under the largest forest-spread option's footprint plus margin. */
const GROUND_SIZE_M = 700;
/** The live tree stays at the world origin — it's also the atlas bake source, and `impostorTransform` bakes in its bounding-sphere center as a *world*-space offset (see octahedral-impostor-mesh.ts), so any other object built from the same atlas must be positioned relative to that same anchor. */
const IMPOSTOR_COMPARISON_POSITION = new Vector3(5, 0, 0);
const ATLAS_PREVIEW_SIZE_M = 4;
const ATLAS_PREVIEW_POSITION = new Vector3(0, 6, -6);
/** Forest instances start this far out (clear of the tree/impostor comparison pair) and scatter across a square of side `2 * forestSpreadM` beyond that. */
const FOREST_NEAR_Z_M = 12;
const FOREST_SCALE_RANGE: readonly [number, number] = [0.75, 1.35];
/** Directional light is aimed at the world origin regardless of distance — only its direction from that point matters for lighting. */
const SUN_DISTANCE_M = 30;

/**
 * Proves out `triangular-engine/impostor` end to end: bakes a hemispherical
 * octahedral atlas from a procedural tree, renders one impostor next to the
 * live mesh for comparison, and scatters a few thousand more across a field
 * as an InstancedMesh — the forest-scale case the library exists for. See
 * docs/runbook/005_scatter_sublibrary.md Phase 5 for where this is headed
 * next (wiring into scatter's reserved `'impostor'` LOD kind).
 */
@Component({
  selector: 'app-impostor-baker-page',
  imports: [RouterLink, EngineModule, DecimalPipe],
  templateUrl: './impostor-baker-page.component.html',
  styleUrl: './impostor-baker-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
})
export class ImpostorBakerPageComponent {
  readonly spritesPerSide = signal(12);
  readonly textureSizePx = signal(2048);
  readonly alphaClamp = signal(0.4);
  readonly transparent = signal(false);
  readonly forestCount = signal(4000);
  /** Half-extent (m) of the forest's scatter area — density is forestCount spread over this area, independent of instance count. */
  readonly forestSpreadM = signal(60);
  readonly baking = signal(false);

  /** 0 = north, 90 = east, ... — orbits the sun around the vertical axis. */
  readonly sunAzimuthDeg = signal(55);
  /** Negative = below the horizon, so the "as it gets dark" case (checking the impostor's normal-blend doesn't do anything weird at a grazing/absent light) is reachable, not just dim. */
  readonly sunElevationDeg = signal(45);
  readonly sunIntensity = signal(2.2);

  readonly sunPosition = computed<[number, number, number]>(() => {
    const azimuthRad = (this.sunAzimuthDeg() * Math.PI) / 180;
    const elevationRad = (this.sunElevationDeg() * Math.PI) / 180;
    return [
      Math.cos(elevationRad) * Math.sin(azimuthRad) * SUN_DISTANCE_M,
      Math.sin(elevationRad) * SUN_DISTANCE_M,
      Math.cos(elevationRad) * Math.cos(azimuthRad) * SUN_DISTANCE_M,
    ];
  });

  private readonly engine = inject(EngineService);
  private readonly group = new Group();
  private readonly treeSource: Group;

  private atlas?: IOctahedralImpostorAtlas;
  private impostorMesh?: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private materialHandle?: IOctahedralImpostorMaterialHandle<MeshStandardMaterial>;
  private forestMesh?: InstancedMesh;
  private albedoPreviewMesh?: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private normalDepthPreviewMesh?: Mesh<PlaneGeometry, MeshBasicMaterial>;

  constructor() {
    const ground = new Mesh(
      new PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M),
      new MeshStandardMaterial({ color: '#3c4a33', roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.group.add(ground);

    this.treeSource = this.buildTree(TREE_SEED);
    this.group.add(this.treeSource);

    this.engine.scene.add(this.group);
    this.bake();

    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  rebake(): void {
    this.bake();
  }

  setSpritesPerSide(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    this.spritesPerSide.set(parsed);
    this.bake();
  }

  setTextureSize(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    this.textureSizePx.set(parsed);
    this.bake();
  }

  setAlphaClamp(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    this.alphaClamp.set(parsed);
    this.materialHandle?.setAlphaClamp(parsed);
  }

  setTransparent(value: boolean): void {
    this.transparent.set(value);
    this.materialHandle?.setTransparent(value);
  }

  setForestCount(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    this.forestCount.set(parsed);
    this.rebuildForestIfBaked();
  }

  setForestSpread(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    this.forestSpreadM.set(parsed);
    this.rebuildForestIfBaked();
  }

  private rebuildForestIfBaked(): void {
    // Reuses the already-baked geometry/material — only the bake params in
    // bake() (which change the atlas itself) need a full rebake; count and
    // spread only change instance placement.
    if (this.impostorMesh && this.materialHandle) {
      this.rebuildForest(this.impostorMesh.geometry, this.materialHandle.material);
    }
  }

  setSunAzimuth(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    this.sunAzimuthDeg.set(parsed);
  }

  setSunElevation(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    this.sunElevationDeg.set(parsed);
  }

  setSunIntensity(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    this.sunIntensity.set(parsed);
  }

  downloadAlbedo(): void {
    this.downloadAtlasTexture('albedo', 'octahedral-impostor-albedo');
  }

  downloadNormalDepth(): void {
    this.downloadAtlasTexture('normalDepth', 'octahedral-impostor-normal-depth');
  }

  private downloadAtlasTexture(which: 'albedo' | 'normalDepth', fileName: string): void {
    const renderer = this.engine.renderer;
    if (!this.atlas || !(renderer instanceof WebGLRenderer)) return;
    exportOctahedralImpostorAtlas(renderer, this.atlas, which, fileName);
  }

  private bake(): void {
    const renderer = this.engine.renderer;
    if (!(renderer instanceof WebGLRenderer)) {
      console.warn('[impostor-baker] Octahedral impostor baking requires a WebGL renderer.');
      return;
    }

    this.baking.set(true);
    this.disposeBaked();

    // computeObjectBoundingSphere (used both by the atlas bake and by
    // buildOctahedralImpostorMesh) reads matrixWorld directly and does not
    // update it itself.
    this.treeSource.updateMatrixWorld(true);

    const atlas = createOctahedralImpostorAtlas({
      renderer,
      target: this.treeSource,
      textureSize: this.textureSizePx(),
      spritesPerSide: this.spritesPerSide(),
    });
    this.atlas = atlas;

    const { mesh, materialHandle } = buildOctahedralImpostorMesh({
      target: this.treeSource,
      baseType: MeshStandardMaterial,
      albedo: atlas.albedo,
      normalDepth: atlas.normalDepth,
      spritesPerSide: this.spritesPerSide(),
      alphaClamp: this.alphaClamp(),
      transparent: this.transparent(),
    });
    mesh.position.copy(IMPOSTOR_COMPARISON_POSITION);
    this.group.add(mesh);
    this.impostorMesh = mesh;
    this.materialHandle = materialHandle;

    this.buildAtlasPreview(atlas);
    this.rebuildForest(mesh.geometry, materialHandle.material);

    this.baking.set(false);
  }

  private buildTree(seed: number): Group {
    const group = new Group();
    const skeleton = generateFloraSkeleton(TREE_ARCHETYPE, seed);
    const { geometry } = buildFloraMesh(skeleton, TREE_ARCHETYPE);
    this.colorizeByWindWeight(geometry);
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    group.add(mesh);
    return group;
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

  private buildAtlasPreview(atlas: IOctahedralImpostorAtlas): void {
    const albedoMesh = new Mesh(
      new PlaneGeometry(ATLAS_PREVIEW_SIZE_M, ATLAS_PREVIEW_SIZE_M),
      new MeshBasicMaterial({ map: atlas.albedo, transparent: true }),
    );
    albedoMesh.position.copy(ATLAS_PREVIEW_POSITION).setX(ATLAS_PREVIEW_POSITION.x - ATLAS_PREVIEW_SIZE_M * 0.6);
    this.group.add(albedoMesh);
    this.albedoPreviewMesh = albedoMesh;

    const normalDepthMesh = new Mesh(
      new PlaneGeometry(ATLAS_PREVIEW_SIZE_M, ATLAS_PREVIEW_SIZE_M),
      new MeshBasicMaterial({ map: atlas.normalDepth }),
    );
    normalDepthMesh.position.copy(ATLAS_PREVIEW_POSITION).setX(ATLAS_PREVIEW_POSITION.x + ATLAS_PREVIEW_SIZE_M * 0.6);
    this.group.add(normalDepthMesh);
    this.normalDepthPreviewMesh = normalDepthMesh;
  }

  /** Scattered separately from the single comparison impostor so its count can change without a full rebake — both share `geometry`/`material` with it (and each other) rather than owning their own copies. */
  private rebuildForest(geometry: PlaneGeometry, material: MeshStandardMaterial): void {
    if (this.forestMesh) {
      this.group.remove(this.forestMesh);
      this.forestMesh = undefined;
    }

    const count = this.forestCount();
    const spreadM = this.forestSpreadM();
    const forest = new InstancedMesh(geometry, material, count);
    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const upAxis = new Vector3(0, 1, 0);
    const scale = new Vector3();
    const [scaleMin, scaleMax] = FOREST_SCALE_RANGE;

    for (let i = 0; i < count; i++) {
      position.set(
        (Math.random() - 0.5) * spreadM * 2,
        0,
        FOREST_NEAR_Z_M + Math.random() * spreadM,
      );
      quaternion.setFromAxisAngle(upAxis, Math.random() * Math.PI * 2);
      scale.setScalar(scaleMin + Math.random() * (scaleMax - scaleMin));
      forest.setMatrixAt(i, matrix.compose(position, quaternion, scale));
    }
    forest.instanceMatrix.needsUpdate = true;

    this.group.add(forest);
    this.forestMesh = forest;
  }

  private disposeBaked(): void {
    if (this.forestMesh) {
      this.group.remove(this.forestMesh);
      this.forestMesh = undefined;
    }
    if (this.impostorMesh) {
      this.group.remove(this.impostorMesh);
      // Shared with forestMesh (same geometry/material instances) — safe to
      // dispose once here since both were just removed from the scene.
      this.impostorMesh.geometry.dispose();
      this.impostorMesh = undefined;
    }
    this.materialHandle?.material.dispose();
    this.materialHandle = undefined;

    for (const preview of [this.albedoPreviewMesh, this.normalDepthPreviewMesh]) {
      if (!preview) continue;
      this.group.remove(preview);
      preview.geometry.dispose();
      preview.material.dispose();
    }
    this.albedoPreviewMesh = undefined;
    this.normalDepthPreviewMesh = undefined;

    this.atlas?.renderTarget.dispose();
    this.atlas = undefined;
  }

  private dispose(): void {
    this.disposeBaked();
    this.group.removeFromParent();
  }
}
