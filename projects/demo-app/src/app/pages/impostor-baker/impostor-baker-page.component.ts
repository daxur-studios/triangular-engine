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
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  buildFloraMesh,
  FLORA_OAK_ARCHETYPE,
  FLORA_OAK_COLORS,
  FLORA_PALM_ARCHETYPE,
  FLORA_PALM_COLORS,
  FLORA_PINE_ARCHETYPE,
  FLORA_PINE_COLORS,
  generateFloraSkeleton,
  type IFloraArchetype,
  type IFloraSpeciesColorHints,
} from 'triangular-engine/procedural';
import {
  buildOctahedralImpostorMesh,
  compressOctahedralImpostorAtlas,
  createOctahedralImpostorAtlas,
  exportOctahedralImpostorAtlas,
  type ICompressedOctahedralImpostorAtlas,
  type IOctahedralImpostorAtlas,
  type IOctahedralImpostorCompressionStats,
  type IOctahedralImpostorMaterialHandle,
  type OctahedralImpostorType,
} from 'triangular-engine/impostor';

export type TreeSpeciesKey = 'oak' | 'pine' | 'palm';

interface ITreeSpeciesOption {
  readonly key: TreeSpeciesKey;
  readonly name: string;
  readonly archetype: IFloraArchetype;
  readonly colors: IFloraSpeciesColorHints;
}

const TREE_SPECIES: readonly ITreeSpeciesOption[] = [
  {
    key: 'oak',
    name: 'Oak (Deciduous)',
    archetype: FLORA_OAK_ARCHETYPE,
    colors: FLORA_OAK_COLORS,
  },
  {
    key: 'pine',
    name: 'Pine (Conifer)',
    archetype: FLORA_PINE_ARCHETYPE,
    colors: FLORA_PINE_COLORS,
  },
  {
    key: 'palm',
    name: 'Palm (Tropical)',
    archetype: FLORA_PALM_ARCHETYPE,
    colors: FLORA_PALM_COLORS,
  },
];

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
 * Proves out `triangular-engine/impostor` end to end: bakes a hemispherical or
 * spherical octahedral atlas from a procedural tree (Oak, Pine, Palm), renders one
 * impostor next to the live mesh for comparison, and scatters a few thousand more
 * across a field as an InstancedMesh — the forest-scale case the library exists for.
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
  readonly treeSpeciesList = TREE_SPECIES;
  readonly selectedSpeciesKey = signal<TreeSpeciesKey>('oak');
  readonly treeSeed = signal(7);

  readonly impostorType = signal<OctahedralImpostorType>('hemispherical');
  readonly spritesPerSide = signal(12);
  readonly textureSizePx = signal(2048);
  readonly alphaClamp = signal(0.4);
  readonly transparent = signal(false);
  readonly forestCount = signal(4000);
  /** Half-extent (m) of the forest's scatter area — density is forestCount spread over this area, independent of instance count. */
  readonly forestSpreadM = signal(60);
  readonly baking = signal(false);

  // Compression inspection state
  readonly textureMode = signal<'raw' | 'compressed'>('raw');
  readonly compressing = signal(false);
  readonly compressionQuality = signal(0.8);
  readonly compressionFormat = signal<'image/webp' | 'image/jpeg' | 'image/png'>('image/webp');
  readonly normalDepthMode = signal<'lossless' | 'lossy'>('lossless');
  readonly compressionStats = signal<IOctahedralImpostorCompressionStats | null>(null);

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
  private treeSource!: Group;

  private atlas?: IOctahedralImpostorAtlas;
  private compressedAtlas?: ICompressedOctahedralImpostorAtlas;
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

    this.treeSource = this.buildTree(this.treeSeed());
    this.group.add(this.treeSource);

    this.engine.scene.add(this.group);
    this.bake();

    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  setSpecies(key: TreeSpeciesKey): void {
    if (this.selectedSpeciesKey() === key) return;
    this.selectedSpeciesKey.set(key);
    this.rebuildSourceTreeAndBake();
  }

  setTreeSeed(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    this.treeSeed.set(parsed);
    this.rebuildSourceTreeAndBake();
  }

  private rebuildSourceTreeAndBake(): void {
    if (this.treeSource) {
      this.group.remove(this.treeSource);
      this.treeSource.traverse((child) => {
        if (child instanceof Mesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material?.dispose();
        }
      });
    }
    this.treeSource = this.buildTree(this.treeSeed());
    this.group.add(this.treeSource);
    this.bake();
  }

  rebake(): void {
    this.bake();
  }

  setImpostorType(value: OctahedralImpostorType): void {
    this.impostorType.set(value);
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

  async setTextureMode(mode: 'raw' | 'compressed'): Promise<void> {
    if (mode === 'compressed' && !this.compressedAtlas) {
      await this.compressAtlas();
    }
    this.textureMode.set(mode);
    this.applyActiveTextures();
  }

  setCompressionQuality(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    this.compressionQuality.set(parsed);
  }

  setCompressionFormat(value: 'image/webp' | 'image/jpeg' | 'image/png'): void {
    this.compressionFormat.set(value);
  }

  setNormalDepthMode(value: 'lossless' | 'lossy'): void {
    this.normalDepthMode.set(value);
  }

  async compressAtlas(): Promise<void> {
    const renderer = this.engine.renderer;
    if (!this.atlas || !(renderer instanceof WebGLRenderer)) return;

    this.compressing.set(true);
    try {
      this.compressedAtlas?.dispose();
      this.compressedAtlas = undefined;

      const compressed = await compressOctahedralImpostorAtlas(renderer, this.atlas, {
        quality: this.compressionQuality(),
        fileType: this.compressionFormat(),
        normalDepthMode: this.normalDepthMode(),
        maxSizeMB: 2,
      });

      this.compressedAtlas = compressed;
      this.compressionStats.set(compressed.stats);

      if (this.textureMode() === 'compressed') {
        this.applyActiveTextures();
      }
    } catch (err) {
      console.error('[impostor-baker] Compression error:', err);
    } finally {
      this.compressing.set(false);
    }
  }

  downloadAlbedo(): void {
    this.downloadAtlasTexture('albedo', `octahedral-${this.selectedSpeciesKey()}-albedo`);
  }

  downloadNormalDepth(): void {
    this.downloadAtlasTexture('normalDepth', `octahedral-${this.selectedSpeciesKey()}-normal-depth`);
  }

  downloadCompressedAlbedo(): void {
    if (!this.compressedAtlas) return;
    const ext = this.compressionFormat() === 'image/webp' ? 'webp' : this.compressionFormat() === 'image/jpeg' ? 'jpg' : 'png';
    this.downloadBlob(this.compressedAtlas.albedoBlob, `octahedral-${this.selectedSpeciesKey()}-albedo-compressed.${ext}`);
  }

  downloadCompressedNormalDepth(): void {
    if (!this.compressedAtlas) return;
    const ext = this.normalDepthMode() === 'lossy' && this.compressionFormat() === 'image/webp' ? 'webp' : 'png';
    this.downloadBlob(this.compressedAtlas.normalDepthBlob, `octahedral-${this.selectedSpeciesKey()}-normal-depth-compressed.${ext}`);
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private downloadAtlasTexture(which: 'albedo' | 'normalDepth', fileName: string): void {
    const renderer = this.engine.renderer;
    if (!this.atlas || !(renderer instanceof WebGLRenderer)) return;
    exportOctahedralImpostorAtlas(renderer, this.atlas, which, fileName);
  }

  private applyActiveTextures(): void {
    if (!this.atlas || !this.materialHandle) return;

    const useCompressed = this.textureMode() === 'compressed' && !!this.compressedAtlas;
    const albedo = useCompressed ? this.compressedAtlas!.albedo : this.atlas.albedo;
    const normalDepth = useCompressed ? this.compressedAtlas!.normalDepth : this.atlas.normalDepth;

    const mat = this.materialHandle.material as unknown as {
      map: Texture | null;
      normalMap: Texture | null;
      needsUpdate: boolean;
    };
    mat.map = albedo;
    mat.normalMap = normalDepth;
    mat.needsUpdate = true;

    if (this.albedoPreviewMesh) {
      this.albedoPreviewMesh.material.map = albedo;
      this.albedoPreviewMesh.material.needsUpdate = true;
    }
    if (this.normalDepthPreviewMesh) {
      this.normalDepthPreviewMesh.material.map = normalDepth;
      this.normalDepthPreviewMesh.material.needsUpdate = true;
    }
  }

  private bake(): void {
    const renderer = this.engine.renderer;
    if (!(renderer instanceof WebGLRenderer)) {
      console.warn('[impostor-baker] Octahedral impostor baking requires a WebGL renderer.');
      return;
    }

    this.baking.set(true);
    this.disposeBaked();

    this.treeSource.updateMatrixWorld(true);

    const atlas = createOctahedralImpostorAtlas({
      renderer,
      target: this.treeSource,
      textureSize: this.textureSizePx(),
      spritesPerSide: this.spritesPerSide(),
      type: this.impostorType(),
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
      type: this.impostorType(),
    });
    mesh.position.copy(IMPOSTOR_COMPARISON_POSITION);
    this.group.add(mesh);
    this.impostorMesh = mesh;
    this.materialHandle = materialHandle;

    this.buildAtlasPreview(atlas);
    this.rebuildForest(mesh.geometry, materialHandle.material);

    this.baking.set(false);

    if (this.textureMode() === 'compressed') {
      this.compressAtlas();
    }
  }

  private buildTree(seed: number): Group {
    const group = new Group();
    const option = TREE_SPECIES.find((s) => s.key === this.selectedSpeciesKey()) ?? TREE_SPECIES[0];
    const skeleton = generateFloraSkeleton(option.archetype, seed);
    const { geometry } = buildFloraMesh(skeleton, option.archetype);
    this.colorizeByWindWeight(geometry, option.colors);
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    group.add(mesh);
    return group;
  }

  private colorizeByWindWeight(geometry: BufferGeometry, colors: IFloraSpeciesColorHints): void {
    const windWeight = geometry.getAttribute('windWeight');
    const colorsArray = new Float32Array(windWeight.count * 3);
    const trunkColor = new Color(colors.trunkHex);
    const leafColor = new Color(colors.leafHex);
    const blended = new Color();
    for (let i = 0; i < windWeight.count; i++) {
      blended.copy(trunkColor).lerp(leafColor, windWeight.getX(i));
      colorsArray[i * 3] = blended.r;
      colorsArray[i * 3 + 1] = blended.g;
      colorsArray[i * 3 + 2] = blended.b;
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colorsArray, 3));
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

  /** Scattered separately from the single comparison impostor so its count can change without a full rebake. */
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

    this.compressedAtlas?.dispose();
    this.compressedAtlas = undefined;
    this.compressionStats.set(null);

    this.atlas?.renderTarget.dispose();
    this.atlas = undefined;
  }

  private dispose(): void {
    this.disposeBaked();
    this.group.removeFromParent();
  }
}
