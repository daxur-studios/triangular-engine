import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Vector3,
} from 'three';
import { EngineModule, EngineService, ScreenshotService } from 'triangular-engine';
import {
  buildFloraMesh,
  buildGroundCoverClumpMesh,
  buildStructureMesh,
  COLONY_COMM_TOWER_ARCHETYPE,
  DEMO_CHOPSTICK_TOWER_ARCHETYPE,
  FLORA_OAK_ARCHETYPE,
  FLORA_OAK_COLORS,
  FLORA_PALM_ARCHETYPE,
  FLORA_PALM_COLORS,
  FLORA_PINE_ARCHETYPE,
  FLORA_PINE_COLORS,
  generateFloraSkeleton,
  generateStructureSkeleton,
  GROUND_COVER_MEADOW_GRASS_ARCHETYPE,
  GROUND_COVER_MEADOW_GRASS_COLORS,
  hashProceduralKey,
  type IFloraArchetype,
  type IFloraSpeciesColorHints,
} from 'triangular-engine/procedural';
import {
  generateTerrainPatchMesh,
  PlaneTerrainDomain,
  type IPlaneTerrainPatchAddress,
  type ITerrainField,
  type ITerrainFieldSample,
  type TerrainVector3,
} from 'triangular-engine/terrain';
import {
  buildScatterInstancedMesh,
  enableScatterWindSway,
  generateTerrainScatterInstances,
  selectFixedLevelScatterCells,
  type IScatterWindHandle,
  type ITerrainScatterInstance,
  type ScatterPlacementRules,
  type ScatterScaleRange,
  type ScatterWindDefinition,
} from 'triangular-engine/scatter';
import { WaterSurfaceComponent, PlaneWaterDomain } from 'triangular-engine/water';

// Terrain Configuration
const PATCH_SIZE_M = 40;
const GRID_RADIUS = 2; // 5x5 patches = 200m x 200m
const TERRAIN_RESOLUTION = 24;
const WORLD_SEED = 9_127;

// Scatter Configuration
const SCATTER_SELECT_RADIUS_M = 1_000_000;
const TREE_SCALE: ScatterScaleRange = { min: 0.85, max: 1.3 };
const PALM_SCALE: ScatterScaleRange = { min: 0.8, max: 1.25 };
const PINE_SCALE: ScatterScaleRange = { min: 0.9, max: 1.4 };
const GRASS_SCALE: ScatterScaleRange = { min: 0.7, max: 1.2 };

const TREE_WIND: ScatterWindDefinition = { strength: 0.05, frequency: 1.1 };
const GRASS_WIND: ScatterWindDefinition = { strength: 0.07, frequency: 2.2 };

const TREE_VARIANTS = 4;
const GRASS_VARIANTS = 4;

/** Heightfield function generating coastal beaches, low rolling meadows, a flat plateau, and mountain peaks. */
function sampleWorldElevation(x: number, z: number): number {
  // Coastal slope on negative X
  const coastRamp = Math.min(1.0, Math.max(0.0, (x + 50) / 45));
  const coastDepth = (1.0 - coastRamp) * -8.0;

  // Mountain rise on positive X and North Z
  const mountainWeight = Math.max(0.0, (x - 15) / 55) * 1.5;
  const mountains =
    (Math.sin(x / 18) * 9.0 +
      Math.cos(z / 22) * 7.5 +
      Math.sin((x + z) / 12) * 5.0) *
    mountainWeight;

  // Rolling midland meadow undulations
  const meadow =
    Math.sin(x / 24) * 2.5 +
    Math.cos(z / 28) * 2.2 +
    Math.sin((x * 0.5 - z) / 16) * 1.5 +
    4.5;

  // Flat launch plateau around (22, -18)
  const dxPlateau = x - 22;
  const dzPlateau = z - (-18);
  const distPlateau = Math.sqrt(dxPlateau * dxPlateau + dzPlateau * dzPlateau);
  const plateauFactor = Math.max(0.0, 1.0 - distPlateau / 22);
  const smoothPlateau = plateauFactor * plateauFactor * (3 - 2 * plateauFactor);

  let rawHeight = (meadow + mountains) * coastRamp + coastDepth;
  // Blend flat plateau at y = 4.2m
  rawHeight = rawHeight * (1.0 - smoothPlateau) + 4.2 * smoothPlateau;

  return rawHeight;
}

class ScenicTerrainField implements ITerrainField {
  readonly minElevationM = -10;
  readonly maxElevationM = 50;

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    return { elevationM: sampleWorldElevation(x, z) };
  }

  sampleBatch(
    positions: Float64Array,
    out = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let i = 0; i < out.length; i++) {
      out[i] = sampleWorldElevation(positions[i * 3], positions[i * 3 + 2]);
    }
    return out;
  }
}

interface IFloraVariant {
  readonly geometry: BufferGeometry;
}

@Component({
  selector: 'app-photo-mode-lab-page',
  standalone: true,
  imports: [RouterLink, EngineModule, WaterSurfaceComponent],
  templateUrl: './photo-mode-lab-page.component.html',
  styleUrl: './photo-mode-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class PhotoModeLabPageComponent {
  private readonly engine = inject(EngineService);
  private readonly screenshot = inject(ScreenshotService);
  private readonly destroyRef = inject(DestroyRef);

  readonly waterDomain = new PlaneWaterDomain({
    seaLevelY: 0.0,
  });

  // Photo Mode State Signals
  readonly fov = signal<number>(55);
  readonly sunAngle = signal<number>(45); // degrees
  readonly selectedResolution = signal<'native' | '1080p' | '1440p' | '4k' | '8k'>('1080p');
  readonly selectedSamples = signal<number>(16);
  readonly ultraQualityBoost = signal<boolean>(true);

  // Capture status
  readonly isCapturing = signal<boolean>(false);
  readonly captureProgress = signal<number>(0);
  readonly lastCaptureBlob = signal<Blob | null>(null);
  readonly lastCaptureUrl = signal<string | null>(null);
  readonly statusMessage = signal<string>('Ready to capture');

  // Scene object references
  private readonly sceneGroup = new Group();
  private readonly windHandles: IScatterWindHandle[] = [];
  private sunLight?: DirectionalLight;

  constructor() {
    this.initScene();
  }

  private async initScene() {
    const scene = this.engine.scene;
    scene.name = 'ScenicWorld_Scene';
    scene.add(this.sceneGroup);

    // Warm Atmospheric Lighting & Fog
    scene.background = new Color('#a5c8ed');
    scene.fog = new FogExp2('#bcd7f2', 0.0035);

    const ambient = new AmbientLight('#bfd9f7', 0.65);
    this.sceneGroup.add(ambient);

    const sun = new DirectionalLight('#fff4e0', 1.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0001;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 350;
    const shadowD = 120;
    sun.shadow.camera.left = -shadowD;
    sun.shadow.camera.right = shadowD;
    sun.shadow.camera.top = shadowD;
    sun.shadow.camera.bottom = -shadowD;
    this.sunLight = sun;
    this.updateSunPosition(this.sunAngle());
    this.sceneGroup.add(sun);

    // Enable soft shadow mapping on engine renderer
    if (this.engine.renderer) {
      this.engine.renderer.shadowMap.enabled = true;
      this.engine.renderer.shadowMap.type = PCFSoftShadowMap;
    }

    // Set initial Camera Position overlooking beach, meadows, catch tower, and mountains
    const camera = this.engine.camera as PerspectiveCamera;
    camera.fov = this.fov();
    camera.position.set(-25, 24, 75);
    camera.lookAt(18, 12, -5);
    camera.updateProjectionMatrix();

    // 1. Build Multi-Biome Terrain
    this.buildTerrain();

    // 2. Build Procedural Catch Tower Complex
    this.buildRocketComplex();

    // 3. Build Multi-Biome Flora (Palms at beach, Oaks in meadow, Pines on mountain)
    this.buildFloraLayers();

    // 4. Build Meadow Grass
    this.buildGrassLayer();

    // 5. Connect Wind Sway to Engine Elapsed Time
    this.engine.elapsedTime$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((elapsedTimeS) => {
        for (const handle of this.windHandles) {
          handle.setTimeS(elapsedTimeS);
        }
      });

    this.destroyRef.onDestroy(() => {
      this.cleanup();
    });
  }

  /** Builds the 5x5 plane terrain grid with vertex colors based on biome altitude. */
  private buildTerrain() {
    const domain = new PlaneTerrainDomain(PATCH_SIZE_M);
    const field = new ScenicTerrainField();

    const terrainMaterial = new MeshStandardMaterial({
      roughness: 0.88,
      metalness: 0.05,
      vertexColors: true,
      flatShading: false,
    });

    for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x++) {
      for (let z = -GRID_RADIUS; z <= GRID_RADIUS; z++) {
        const address: IPlaneTerrainPatchAddress = { level: 0, x, z };
        const patchMesh = generateTerrainPatchMesh(field, domain, {
          address,
          resolution: TERRAIN_RESOLUTION,
        });

        // Compute Vertex Colors based on height & slope
        const geom = new BufferGeometry();
        geom.setAttribute('position', new Float32BufferAttribute(patchMesh.surface.positions, 3));
        geom.setAttribute('normal', new Float32BufferAttribute(patchMesh.surface.normals, 3));
        geom.setIndex(new BufferAttribute(patchMesh.surface.indices, 1));

        const count = patchMesh.surface.positions.length / 3;
        const colors = new Float32Array(count * 3);
        const tempPos = new Vector3();

        for (let i = 0; i < count; i++) {
          tempPos.set(
            patchMesh.surface.positions[i * 3],
            patchMesh.surface.positions[i * 3 + 1],
            patchMesh.surface.positions[i * 3 + 2],
          );

          const y = tempPos.y;
          let r = 0.35, g = 0.55, b = 0.25; // Default lush meadow green

          if (y < 1.2) {
            // Wet Sand
            r = 0.72; g = 0.65; b = 0.48;
          } else if (y < 3.8) {
            // Beach Sand
            r = 0.88; g = 0.82; b = 0.62;
          } else if (y < 16.0) {
            // Meadow grass gradient
            const t = (y - 3.8) / 12.2;
            r = 0.28 + t * 0.12;
            g = 0.52 - t * 0.05;
            b = 0.22 - t * 0.02;
          } else if (y < 28.0) {
            // Highland rock/dirt
            const t = (y - 16.0) / 12.0;
            r = 0.40 + t * 0.10;
            g = 0.42 - t * 0.08;
            b = 0.30 - t * 0.05;
          } else {
            // Mountain peak rock
            const t = Math.min(1.0, (y - 28.0) / 14.0);
            r = 0.50 + t * 0.35;
            g = 0.52 + t * 0.35;
            b = 0.55 + t * 0.38;
          }

          colors[i * 3] = r;
          colors[i * 3 + 1] = g;
          colors[i * 3 + 2] = b;
        }

        geom.setAttribute('color', new Float32BufferAttribute(colors, 3));
        geom.computeVertexNormals();

        const mesh = new Mesh(geom, terrainMaterial);
        mesh.receiveShadow = true;
        this.sceneGroup.add(mesh);
      }
    }
  }

  /** Builds the coastal Starbase Catch Tower and Deep Space antenna structures. */
  private buildRocketComplex() {
    const towerMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0.65,
    });

    // 1. Starbase Chopstick Catch Tower
    const towerArchetype = DEMO_CHOPSTICK_TOWER_ARCHETYPE;
    const towerSolids = generateStructureSkeleton(towerArchetype, 42);
    const { geometry: towerGeom } = buildStructureMesh(towerSolids, towerArchetype);

    const towerMesh = new Mesh(towerGeom, towerMat);
    towerMesh.position.set(20, 4.2, -18);
    towerMesh.castShadow = true;
    towerMesh.receiveShadow = true;
    this.sceneGroup.add(towerMesh);

    // 2. Deep Space Relay Antenna Mast
    const commArchetype = COLONY_COMM_TOWER_ARCHETYPE;
    const commSolids = generateStructureSkeleton(commArchetype, 101);
    const { geometry: commGeom } = buildStructureMesh(commSolids, commArchetype);

    const commMesh = new Mesh(commGeom, towerMat);
    commMesh.position.set(38, 4.2, -6);
    commMesh.castShadow = true;
    commMesh.receiveShadow = true;
    this.sceneGroup.add(commMesh);
  }

  /** Builds Palms at the beach, Oaks in meadows, and Pines on high mountain slopes. */
  private buildFloraLayers() {
    const domain = new PlaneTerrainDomain(PATCH_SIZE_M);
    const field = new ScenicTerrainField();

    // 1. Palms at Beach / Coastline (y in [0.8, 4.2], x < 0)
    this.instantiateFloraSpecies({
      archetype: FLORA_PALM_ARCHETYPE,
      colorHints: FLORA_PALM_COLORS,
      layerId: 'palms-coastal',
      candidatePoolSize: 8,
      density01: 0.65,
      scaleRange: PALM_SCALE,
      wind: { strength: 0.06, frequency: 1.3 },
      domain,
      field,
      filterPosition: (pos) => pos.y >= 0.8 && pos.y <= 4.2 && pos.x < 5,
    });

    // 2. Oaks in Meadows (y in [3.8, 16.0])
    this.instantiateFloraSpecies({
      archetype: FLORA_OAK_ARCHETYPE,
      colorHints: FLORA_OAK_COLORS,
      layerId: 'oaks-meadow',
      candidatePoolSize: 10,
      density01: 0.5,
      scaleRange: TREE_SCALE,
      wind: TREE_WIND,
      domain,
      field,
      filterPosition: (pos) => pos.y >= 3.8 && pos.y <= 16.0 && (pos.x < 10 || pos.x > 32 || pos.z > 0),
    });

    // 3. Pines on Mountains (y in [15.5, 45.0])
    this.instantiateFloraSpecies({
      archetype: FLORA_PINE_ARCHETYPE,
      colorHints: FLORA_PINE_COLORS,
      layerId: 'pines-mountain',
      candidatePoolSize: 14,
      density01: 0.7,
      scaleRange: PINE_SCALE,
      wind: { strength: 0.04, frequency: 0.9 },
      domain,
      field,
      filterPosition: (pos) => pos.y >= 15.5,
    });
  }

  /** Helper to generate variants and instantiate scatter for a flora species. */
  private instantiateFloraSpecies(config: {
    archetype: IFloraArchetype;
    colorHints: IFloraSpeciesColorHints;
    layerId: string;
    candidatePoolSize: number;
    density01: number;
    scaleRange: ScatterScaleRange;
    wind: ScatterWindDefinition;
    domain: PlaneTerrainDomain;
    field: ITerrainField;
    filterPosition: (pos: Vector3) => boolean;
  }) {
    const trunkColor = new Color(config.colorHints.trunkHex);
    const leafColor = new Color(config.colorHints.leafHex);

    const variants: IFloraVariant[] = [];
    for (let v = 0; v < TREE_VARIANTS; v++) {
      const seed = 500 + v * 17;
      const skeleton = generateFloraSkeleton(config.archetype, seed);
      const { geometry } = buildFloraMesh(skeleton, config.archetype);

      // Colorize by windWeight (0 = trunk, 1 = leaves)
      const windWeight = geometry.getAttribute('windWeight');
      if (windWeight) {
        const colors = new Float32Array(windWeight.count * 3);
        const blended = new Color();
        for (let i = 0; i < windWeight.count; i++) {
          blended.copy(trunkColor).lerp(leafColor, windWeight.getX(i));
          colors[i * 3] = blended.r;
          colors[i * 3 + 1] = blended.g;
          colors[i * 3 + 2] = blended.b;
        }
        geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
      }

      variants.push({ geometry });
    }

    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0.1,
      side: DoubleSide,
    });

    const windHandle = enableScatterWindSway(material, config.wind, {
      useVertexWindWeight: true,
    });
    this.windHandles.push(windHandle);

    const roots: IPlaneTerrainPatchAddress[] = [];
    for (let z = -GRID_RADIUS; z <= GRID_RADIUS; z++) {
      for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x++) {
        roots.push({ level: 0, x, z });
      }
    }

    const placementRules: ScatterPlacementRules = {
      alignment: 'align-to-surface-up',
      slopeMax01: 0.7,
    };

    const instancesByVariant: ITerrainScatterInstance[][] = Array.from(
      { length: TREE_VARIANTS },
      () => [],
    );

    for (const address of roots) {
      const cellAddresses = selectFixedLevelScatterCells(config.domain, {
        roots: [address],
        anchorWorldM: [0, 0, 0],
        radiusM: SCATTER_SELECT_RADIUS_M,
        fixedLevel: address.level + 1,
        getLevel: (a) => a.level,
      });

      for (const cellAddress of cellAddresses) {
        const cellKey = `plane:${cellAddress.level}:${cellAddress.x}:${cellAddress.z}`;
        const instances = generateTerrainScatterInstances({
          field: config.field,
          domain: config.domain,
          cellAddress,
          cellKey,
          identity: {
            worldSeed: WORLD_SEED,
            layerId: config.layerId,
            speciesId: config.archetype.id,
            generatorVersion: 1,
          },
          candidatePoolSize: config.candidatePoolSize,
          rules: placementRules,
          baseDensity01: config.density01,
        });

        for (const instance of instances) {
          const pos = new Vector3(...instance.worldPositionM);
          if (config.filterPosition(pos)) {
            const variantIdx = hashProceduralKey(instance.instanceId) % TREE_VARIANTS;
            instancesByVariant[variantIdx].push(instance);
          }
        }
      }
    }

    for (let v = 0; v < TREE_VARIANTS; v++) {
      const bucket = instancesByVariant[v];
      if (bucket.length === 0) continue;

      const mesh = buildScatterInstancedMesh({
        instances: bucket,
        geometry: variants[v].geometry,
        material,
        rules: placementRules,
        scale: config.scaleRange,
        anchorWorldM: [0, 0, 0],
        castShadow: true,
      });

      this.sceneGroup.add(mesh);
    }
  }

  /** Builds dense meadow grass across midland elevations. */
  private buildGrassLayer() {
    const domain = new PlaneTerrainDomain(PATCH_SIZE_M);
    const field = new ScenicTerrainField();

    const baseColor = new Color(GROUND_COVER_MEADOW_GRASS_COLORS.baseHex);
    const tipColor = new Color(GROUND_COVER_MEADOW_GRASS_COLORS.tipHex);

    const variants: BufferGeometry[] = [];
    for (let v = 0; v < GRASS_VARIANTS; v++) {
      const seed = 200 + v * 13;
      const { geometry } = buildGroundCoverClumpMesh(
        GROUND_COVER_MEADOW_GRASS_ARCHETYPE,
        seed,
      );

      const height01 = geometry.getAttribute('height01');
      if (height01) {
        const colors = new Float32Array(height01.count * 3);
        const blended = new Color();
        for (let i = 0; i < height01.count; i++) {
          blended.copy(baseColor).lerp(tipColor, height01.getX(i));
          colors[i * 3] = blended.r;
          colors[i * 3 + 1] = blended.g;
          colors[i * 3 + 2] = blended.b;
        }
        geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
      }

      variants.push(geometry);
    }

    const grassMaterial = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.75,
      side: DoubleSide,
    });

    const windHandle = enableScatterWindSway(grassMaterial, GRASS_WIND);
    this.windHandles.push(windHandle);

    const roots: IPlaneTerrainPatchAddress[] = [];
    for (let z = -GRID_RADIUS; z <= GRID_RADIUS; z++) {
      for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x++) {
        roots.push({ level: 0, x, z });
      }
    }

    const placementRules: ScatterPlacementRules = {
      alignment: 'align-to-surface-up',
      slopeMax01: 0.6,
    };

    const grassBuckets: ITerrainScatterInstance[][] = Array.from(
      { length: GRASS_VARIANTS },
      () => [],
    );

    for (const address of roots) {
      const cellAddresses = selectFixedLevelScatterCells(domain, {
        roots: [address],
        anchorWorldM: [0, 0, 0],
        radiusM: SCATTER_SELECT_RADIUS_M,
        fixedLevel: address.level + 2,
        getLevel: (a) => a.level,
      });

      for (const cellAddress of cellAddresses) {
        const cellKey = `plane:${cellAddress.level}:${cellAddress.x}:${cellAddress.z}`;
        const instances = generateTerrainScatterInstances({
          field,
          domain,
          cellAddress,
          cellKey,
          identity: {
            worldSeed: WORLD_SEED,
            layerId: 'meadow-grass',
            speciesId: GROUND_COVER_MEADOW_GRASS_ARCHETYPE.id,
            generatorVersion: 1,
          },
          candidatePoolSize: 18,
          rules: placementRules,
          baseDensity01: 0.85,
        });

        for (const instance of instances) {
          const pos = new Vector3(...instance.worldPositionM);
          const distPlateau = Math.hypot(pos.x - 22, pos.z - (-18));
          if (pos.y >= 3.2 && pos.y <= 16.5 && distPlateau > 16) {
            const v = hashProceduralKey(instance.instanceId) % GRASS_VARIANTS;
            grassBuckets[v].push(instance);
          }
        }
      }
    }

    for (let v = 0; v < GRASS_VARIANTS; v++) {
      const bucket = grassBuckets[v];
      if (bucket.length === 0) continue;

      const mesh = buildScatterInstancedMesh({
        instances: bucket,
        geometry: variants[v],
        material: grassMaterial,
        rules: placementRules,
        scale: GRASS_SCALE,
        anchorWorldM: [0, 0, 0],
      });

      this.sceneGroup.add(mesh);
    }
  }

  // --- Photo Mode Actions ---

  public setFov(val: number) {
    this.fov.set(val);
    const camera = this.engine.camera as PerspectiveCamera;
    camera.fov = val;
    camera.updateProjectionMatrix();
  }

  public setSunAngle(deg: number) {
    this.sunAngle.set(deg);
    this.updateSunPosition(deg);
  }

  private updateSunPosition(deg: number) {
    if (!this.sunLight) return;
    const rad = (deg * Math.PI) / 180;
    const radius = 180;
    this.sunLight.position.set(Math.cos(rad) * radius, Math.sin(rad) * radius, 60);
    this.sunLight.lookAt(0, 0, 0);
  }

  public setResolution(res: 'native' | '1080p' | '1440p' | '4k' | '8k') {
    this.selectedResolution.set(res);
  }

  public setSamples(samples: number) {
    this.selectedSamples.set(samples);
  }

  public toggleUltraQuality() {
    this.ultraQualityBoost.update((v) => !v);
  }

  /** Triggers the progressive high-quality photo capture pipeline. */
  public async takePhoto() {
    if (this.isCapturing()) return;

    this.isCapturing.set(true);
    this.captureProgress.set(0);
    this.statusMessage.set('Preparing scene for capture...');

    const res = this.selectedResolution();
    let resolutionConfig: { width: number; height: number } | undefined = undefined;
    let multiplier = 1;

    if (res === '1080p') resolutionConfig = { width: 1920, height: 1080 };
    else if (res === '1440p') resolutionConfig = { width: 2560, height: 1440 };
    else if (res === '4k') resolutionConfig = { width: 3840, height: 2160 };
    else if (res === '8k') resolutionConfig = { width: 7680, height: 4320 };
    else multiplier = 1;

    const samples = this.selectedSamples();
    const ultra = this.ultraQualityBoost();

    try {
      const blob = await this.screenshot.capture({
        format: 'image/png',
        multiplier,
        resolution: resolutionConfig,
        samples,
        hideOverlays: true,
        onProgress: (p) => {
          this.captureProgress.set(Math.round(p * 100));
          this.statusMessage.set(`Rendering progressive sample ${Math.round(p * samples)} of ${samples}...`);
        },
        prepare: async () => {
          if (!ultra || !this.sunLight) return;
          // Temporarily elevate shadow resolution to 4096 during capture
          const origShadowSize = this.sunLight.shadow.mapSize.x;
          this.sunLight.shadow.mapSize.set(4096, 4096);
          if (this.sunLight.shadow.map) {
            this.sunLight.shadow.map.dispose();
            (this.sunLight.shadow as any).map = null;
          }

          return () => {
            // Restore shadow map size
            if (this.sunLight) {
              this.sunLight.shadow.mapSize.set(origShadowSize, origShadowSize);
              if (this.sunLight.shadow.map) {
                this.sunLight.shadow.map.dispose();
                (this.sunLight.shadow as any).map = null;
              }
            }
          };
        },
      });

      this.lastCaptureBlob.set(blob);
      if (this.lastCaptureUrl()) {
        URL.revokeObjectURL(this.lastCaptureUrl()!);
      }
      const url = URL.createObjectURL(blob);
      this.lastCaptureUrl.set(url);
      this.statusMessage.set(`Capture completed successfully (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);

      // Automatically trigger download
      this.screenshot.download(blob, `scenic-capture-${res}-${samples}x-${Date.now()}.png`);
    } catch (err) {
      console.error('Capture failed:', err);
      this.statusMessage.set('Capture failed. See console for details.');
    } finally {
      this.isCapturing.set(false);
    }
  }

  public async copyToClipboard() {
    const blob = this.lastCaptureBlob();
    if (!blob) return;
    try {
      await this.screenshot.copyToClipboard(blob);
      this.statusMessage.set('Screenshot copied to clipboard!');
    } catch (err) {
      console.error(err);
      this.statusMessage.set('Failed to copy to clipboard.');
    }
  }

  private cleanup() {
    if (this.lastCaptureUrl()) {
      URL.revokeObjectURL(this.lastCaptureUrl()!);
    }
    this.sceneGroup.clear();
  }
}
