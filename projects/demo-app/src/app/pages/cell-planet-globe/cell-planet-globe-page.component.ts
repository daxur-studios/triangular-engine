import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  FrontSide,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  SphereGeometry,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  IPlanetEcology,
  IPlanetGraphCore,
  IPlanetSurfaceSampler,
  IPlanetTectonics,
  WORLD_PROFILES,
  WorldProfileKind,
  findCellAt,
} from 'triangular-engine/worldgen';
import {
  CellPlanetMapFillMode,
  IPlanetGlobeGeometry,
  biomeColor,
  buildPlanetGlobeGeometry,
  elevationColor,
  lavaOceanColor,
  moistureColor,
  plateColor,
  temperatureColor,
  WORLD_SIZE_TIER_RADIUS_M,
  WorldSizeTier,
  formatDistanceM,
  writePlanetGlobeNormals,
  writePlanetGlobePositions,
} from 'triangular-engine/worldgen/render';
import {
  DEFAULT_TERRAIN_MATERIAL_PALETTE,
  evaluateTerrainMaterial,
  terrainMaterialColorRgb,
} from 'triangular-engine/terrain';
import { CellPlanetQuery, readCellPlanetQuery } from '../cell-planet-view-query';
import { CELL_PLANET_GENERATION_DEFAULTS } from '../cell-planet-generation-config';
import {
  CELL_PLANET_U0_BOOKMARK_IDS,
  CELL_PLANET_U0_FIXTURE,
  CellPlanetU0BookmarkId,
  getCellPlanetU0Bookmark,
} from '../cell-planet-u0-fixture';
import { getTerrainHeightScaleM } from '../cell-planet-25d-map/cell-planet-terrain-scale';
import { CellPlanetWorldService } from '../cell-planet-world.service';
import {
  CELL_PLANET_TERRAIN_STYLE_KINDS,
  CELL_PLANET_TERRAIN_STYLE_LABELS,
  CellPlanetTerrainStyle,
  isCellPlanetTerrainStyle,
  selectCellPlanetSurfaceSampler,
} from '../cell-planet-terrain-style';

/** Modest fixed tessellation: 96 x 48 quads → ~9.2k triangles. No LOD, by design (runbook 032). */
const GLOBE_LONGITUDE_SEGMENTS = 96;
const GLOBE_LATITUDE_RINGS = 48;

/** Match the 2.5D page's default stylized relief control. */
const DEFAULT_TERRAIN_RELIEF = 4;

/** Shared water colour for ocean shell and invalid-cell fallback, mirroring the 2.5D map. */
const OCEAN_COLOR = 'hsl(210, 55%, 22%)';

type CellPlanetGlobeFillMode = CellPlanetMapFillMode | 'material';

interface IGlobeMacroUniforms {
  readonly enabled: { value: number };
  readonly strength: { value: number };
  readonly scaleM: { value: number };
}

interface IGlobeMaterialColour {
  readonly rgb: readonly [number, number, number];
  readonly macroLandFactor: number;
}

/**
 * The fixed globe is intentionally coarse, so macro variation must be evaluated per fragment.
 * This mirrors the 2.5D shader's metre-based sampling instead of baking 48m detail into a
 * 96×48 vertex-colour grid, where interpolation would turn it into large polygon patches.
 */
const GLOBE_MACRO_FRAGMENT_FUNCTIONS = `
uniform float uTerrainMacroEnabled;
uniform float uTerrainMacroStrength;
uniform float uTerrainMacroScaleM;
varying vec3 vTerrainMacroPositionM;
varying float vTerrainMacroLandFactor;

float terrainMacroHash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float terrainMacroValueNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float x00 = mix(terrainMacroHash3(i + vec3(0.0, 0.0, 0.0)), terrainMacroHash3(i + vec3(1.0, 0.0, 0.0)), f.x);
  float x10 = mix(terrainMacroHash3(i + vec3(0.0, 1.0, 0.0)), terrainMacroHash3(i + vec3(1.0, 1.0, 0.0)), f.x);
  float x01 = mix(terrainMacroHash3(i + vec3(0.0, 0.0, 1.0)), terrainMacroHash3(i + vec3(1.0, 0.0, 1.0)), f.x);
  float x11 = mix(terrainMacroHash3(i + vec3(0.0, 1.0, 1.0)), terrainMacroHash3(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}

float terrainMacroVariation3(vec3 positionM) {
  float scale = max(uTerrainMacroScaleM, 1.0);
  vec3 broad = positionM / scale + vec3(17.3, -9.1, 4.7);
  vec3 breakup = vec3(
    (0.8 * positionM.x - 0.6 * positionM.z) / (scale * 1.73) - 23.1,
    positionM.y / (scale * 1.73) + 5.7,
    (0.6 * positionM.x + 0.8 * positionM.z) / (scale * 1.73) + 11.9
  );
  return terrainMacroValueNoise3(broad) * 0.65 + terrainMacroValueNoise3(breakup) * 0.35;
}
`;

const GLOBE_MACRO_VERTEX_DECLARATIONS = `
attribute float terrainMacroLandFactor;
varying vec3 vTerrainMacroPositionM;
varying float vTerrainMacroLandFactor;
`;

const GLOBE_MACRO_VERTEX_ASSIGNMENT = `
vTerrainMacroPositionM = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTerrainMacroLandFactor = terrainMacroLandFactor;
`;

const GLOBE_MACRO_FRAGMENT_APPLICATION = `
if (uTerrainMacroEnabled > 0.5) {
  float signedVariation = (terrainMacroVariation3(vTerrainMacroPositionM) - 0.5) * 2.0;
  vec3 warmVariation = 1.0 + signedVariation * vec3(0.12, 0.09, 0.055);
  float amount = clamp(uTerrainMacroStrength, 0.0, 1.0) * clamp(vTerrainMacroLandFactor, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * warmVariation, amount);
}
`;

/**
 * Cell Planet globe prototype (runbook 032).
 *
 * A deliberately simple fixed-resolution sphere that displaces the **shared** world snapshot's
 * canonical surface sampler radially. It exists to validate geography, colour-mode parity with the
 * 2D/2.5D maps, height exaggeration and seabed relief before the runbook 031 chunked/quadtree
 * infrastructure is ready. All streaming, Meshoptimizer, quadtree LOD, seam stitching, scheduling
 * and caching are owned by 031 and intentionally absent here.
 *
 * Generation reuses the same graph → tectonics → ecology → `createPlanetSurfaceSampler` chain and
 * `CELL_PLANET_GENERATION_DEFAULTS` as the map pages, so equivalent directions agree. Rendering is
 * added to `EngineService.scene` imperatively because the mesh is a custom `BufferGeometry`; the
 * declarative `<scene>`/`<orbitControls>`/light components own the renderer, camera and RAF loop.
 */
@Component({
  selector: 'app-cell-planet-globe-page',
  imports: [FormsModule, EngineModule, RouterLink],
  templateUrl: './cell-planet-globe-page.component.html',
  styleUrl: './cell-planet-globe-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CellPlanetGlobePageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly worldService = inject(CellPlanetWorldService);

  readonly cellCount = signal<number>(CELL_PLANET_GENERATION_DEFAULTS.cellCount);
  readonly seed = signal<number>(CELL_PLANET_GENERATION_DEFAULTS.seed);
  readonly relaxationIterations = signal<number>(CELL_PLANET_GENERATION_DEFAULTS.relaxationIterations);
  readonly worldProfileKind = signal<WorldProfileKind>(CELL_PLANET_GENERATION_DEFAULTS.worldProfile);
  readonly worldProfileKinds: WorldProfileKind[] = ['terran', 'moon', 'volcanic', 'protoplanet'];
  readonly terrainStyle = signal<CellPlanetTerrainStyle>('blended');
  readonly terrainStyleKinds = CELL_PLANET_TERRAIN_STYLE_KINDS;
  readonly terrainStyleLabels = CELL_PLANET_TERRAIN_STYLE_LABELS;
  /** Same physical body-size tiers as the 2.5D page. */
  readonly worldSizeTier = signal<WorldSizeTier>('medium');
  readonly worldSizeKinds: WorldSizeTier[] = ['mini', 'small', 'medium', 'large', 'extra-large'];
  readonly u0Fixture = CELL_PLANET_U0_FIXTURE;
  readonly u0Bookmarks = CELL_PLANET_U0_FIXTURE.bookmarks;
  readonly u0BookmarkIds = CELL_PLANET_U0_BOOKMARK_IDS;
  readonly u0BookmarkId = signal<CellPlanetU0BookmarkId>('overview');
  readonly u0Bookmark = computed(() => getCellPlanetU0Bookmark(this.u0BookmarkId()));
  readonly waterLevel = signal(0);
  readonly fillMode = signal<CellPlanetGlobeFillMode>('biome');
  readonly fillModes: CellPlanetGlobeFillMode[] = ['biome', 'elevation', 'plates', 'temperature', 'moisture', 'land', 'material'];
  readonly macroVariationEnabled = signal(true);
  readonly macroVariationStrength = signal(0.35);
  readonly macroVariationScaleM = signal(48);
  /** Stylized relief multiplier; in planet mode this is converted to metres like 2.5D. */
  readonly terrainHeightScale = signal(DEFAULT_TERRAIN_RELIEF);
  readonly seabedRelief = signal(true);
  readonly showOcean = signal(true);

  readonly planetRadiusM = computed(() => WORLD_SIZE_TIER_RADIUS_M[this.worldSizeTier()]);
  readonly globeRadiusM = computed(() => this.planetRadiusM());
  readonly terrainHeightScaleM = computed(() =>
    getTerrainHeightScaleM(this.planetRadiusM(), this.terrainHeightScale()),
  );
  readonly orbitCameraPosition = computed(() => {
    const radius = this.globeRadiusM();
    const bookmark = this.u0Bookmark();
    if (bookmark.id !== 'overview') {
      const distance = radius * (1 + bookmark.cameraRadiusFactor);
      return [
        bookmark.direction.x * distance,
        bookmark.direction.y * distance,
        bookmark.direction.z * distance,
      ] as [number, number, number];
    }
    return [0, radius * 1.2, radius * 2.8] as [number, number, number];
  });
  readonly orbitCameraTarget = computed(() => {
    const bookmark = this.u0Bookmark();
    if (bookmark.id === 'overview') return [0, 0, 0] as [number, number, number];
    const radius = this.globeRadiusM() * 0.98;
    return [
      bookmark.direction.x * radius,
      bookmark.direction.y * radius,
      bookmark.direction.z * radius,
    ] as [number, number, number];
  });
  readonly cameraNearM = computed(() => Math.max(0.1, this.globeRadiusM() * 1e-6));
  readonly cameraFarM = computed(() => Math.max(2_000, this.globeRadiusM() * 8));
  readonly formatDistanceM = formatDistanceM;

  readonly longitudeSegments = GLOBE_LONGITUDE_SEGMENTS;
  readonly latitudeRings = GLOBE_LATITUDE_RINGS;

  readonly triangles = signal(0);
  readonly vertices = signal(0);
  readonly buildMs = signal(0);
  readonly drawCalls = signal(0);
  readonly selectedCellId = signal<number | null>(null);

  private readonly preservedQueryParams = signal<CellPlanetQuery>({});
  readonly comparisonQueryParams = signal<Record<string, string | number | boolean>>({});

  private graph!: IPlanetGraphCore;
  private tectonics!: IPlanetTectonics;
  private ecology!: IPlanetEcology;
  private geometry!: IPlanetGlobeGeometry;
  /** Display elevations — canonical `geometry.elevations`, or sea-clamped when seabed relief is off. */
  private displayElevations!: Float32Array;
  private mesh: Mesh<BufferGeometry, MeshStandardMaterial> | undefined;
  private oceanMesh: Mesh<BufferGeometry, MeshStandardMaterial> | undefined;
  private seaLevelElevation = 0;
  private elevationMin = 0;
  private elevationMax = 0;
  private maxSlope = 0;
  private readonly colorScratch = new Color();
  private materialRiverMask: ArrayLike<number> = new Uint8Array(0);
  private ridgeCellSet = new Set<number>();
  private globeMacroUniforms: IGlobeMacroUniforms | undefined;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const query = readCellPlanetQuery(params);
      this.preservedQueryParams.set(query);
      this.restoreQuery(query);
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    });

    this.destroyRef.onDestroy(() => {
      this.disposeMesh();
      this.disposeOceanMesh();
    });
  }

  onCellCountInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.cellCount()) {
      this.cellCount.set(Math.max(200, Math.min(6000, Math.round(value))));
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  onSeedInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.seed()) {
      this.seed.set(Math.max(0, Math.min(999999, Math.round(value))));
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  onRelaxationInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.relaxationIterations()) {
      this.relaxationIterations.set(Math.max(0, Math.min(6, Math.round(value))));
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  onWorldProfileChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as WorldProfileKind;
    if (this.worldProfileKinds.includes(value) && value !== this.worldProfileKind()) {
      this.worldProfileKind.set(value);
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  onTerrainStyleChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (!isCellPlanetTerrainStyle(value) || value === this.terrainStyle()) return;
    this.terrainStyle.set(value);
    this.updateComparisonQueryParams();
    this.rebuildWorld();
  }

  onWorldSizeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as WorldSizeTier;
    if (this.worldSizeKinds.includes(value) && value !== this.worldSizeTier()) {
      this.worldSizeTier.set(value);
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  onWorldSizeValueChange(value: string): void {
    if (!this.worldSizeKinds.includes(value as WorldSizeTier) || value === this.worldSizeTier()) return;
    this.worldSizeTier.set(value as WorldSizeTier);
    this.updateComparisonQueryParams();
    this.rebuildWorld();
  }

  onWaterLevelInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.waterLevel()) {
      this.waterLevel.set(Math.max(-1, Math.min(1, value)));
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  onFillModeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as CellPlanetGlobeFillMode;
    if (this.fillModes.includes(value) && value !== this.fillMode()) {
      this.fillMode.set(value);
      this.updateComparisonQueryParams();
      this.rebuildColors();
    }
  }

  onMacroVariationChange(event: Event): void {
    this.macroVariationEnabled.set((event.target as HTMLInputElement).checked);
    this.updateComparisonQueryParams();
    this.rebuildColors();
  }

  onMacroVariationStrengthInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value)) {
      this.macroVariationStrength.set(Math.max(0, Math.min(1, value)));
      this.updateComparisonQueryParams();
      this.rebuildColors();
    }
  }

  onMacroVariationScaleInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value)) {
      this.macroVariationScaleM.set(Math.max(8, Math.min(128, value)));
      this.updateComparisonQueryParams();
      this.rebuildColors();
    }
  }

  onTerrainHeightScaleInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.terrainHeightScale()) {
      this.terrainHeightScale.set(Math.max(0, Math.min(14, value)));
      this.refreshDisplacement();
      this.updateComparisonQueryParams();
    }
  }

  onSeabedReliefChange(event: Event): void {
    this.seabedRelief.set((event.target as HTMLInputElement).checked);
    this.applySeabedRelief();
    this.refreshDisplacement();
    this.updateComparisonQueryParams();
  }

  onOceanChange(event: Event): void {
    this.showOcean.set((event.target as HTMLInputElement).checked);
    this.updateOceanMesh();
    this.updateComparisonQueryParams();
  }

  randomizeSeed(): void {
    this.seed.set(Math.floor(Math.random() * 1_000_000));
    this.updateComparisonQueryParams();
    this.rebuildWorld();
  }

  applyU0Baseline(): void {
    this.cellCount.set(this.u0Fixture.cellCount);
    this.seed.set(this.u0Fixture.seed);
    this.relaxationIterations.set(this.u0Fixture.relaxationIterations);
    this.worldProfileKind.set(this.u0Fixture.worldProfile);
    this.worldSizeTier.set(this.u0Fixture.worldSize);
    this.terrainHeightScale.set(this.u0Fixture.terrainHeightScale);
    this.waterLevel.set(this.u0Fixture.waterLevel);
    this.showOcean.set(this.u0Fixture.showOcean);
    this.u0BookmarkId.set('overview');
    this.selectedCellId.set(null);
    this.updateComparisonQueryParams();
    this.rebuildWorld();
  }

  onU0BookmarkChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as CellPlanetU0BookmarkId;
    if (!this.u0BookmarkIds.includes(value)) return;
    if (
      this.cellCount() !== this.u0Fixture.cellCount ||
      this.seed() !== this.u0Fixture.seed ||
      this.relaxationIterations() !== this.u0Fixture.relaxationIterations ||
      this.worldProfileKind() !== this.u0Fixture.worldProfile ||
      this.worldSizeTier() !== this.u0Fixture.worldSize ||
      this.terrainHeightScale() !== this.u0Fixture.terrainHeightScale ||
      this.waterLevel() !== this.u0Fixture.waterLevel ||
      this.showOcean() !== this.u0Fixture.showOcean
    ) {
      this.applyU0Baseline();
    }
    this.u0BookmarkId.set(value);
    this.selectedCellId.set(getCellPlanetU0Bookmark(value).cellId);
    this.rebuildColors();
    this.updateComparisonQueryParams();
  }

  private rebuildWorld(): void {
    const startedAt = performance.now();
    const seed = this.seed();
    const world = this.worldService.build({
      cellCount: this.cellCount(),
      seed,
      relaxationIterations: this.relaxationIterations(),
      worldProfileKind: this.worldProfileKind(),
      waterLevel: this.waterLevel(),
    });
    const { graph, tectonics, ecology, seaLevelElevation } = world;
    const sampler: IPlanetSurfaceSampler = selectCellPlanetSurfaceSampler(
      world,
      this.terrainStyle(),
      true,
    );
    const profile = WORLD_PROFILES[this.worldProfileKind()];

    this.materialRiverMask = buildRiverMaterialMask(graph, ecology);
    this.ridgeCellSet = new Set(tectonics.ridgeCellIds);

    let elevationMin = Infinity;
    let elevationMax = -Infinity;
    for (const elevation of tectonics.elevation) {
      elevationMin = Math.min(elevationMin, elevation);
      elevationMax = Math.max(elevationMax, elevation);
    }

    this.graph = graph;
    this.tectonics = tectonics;
    this.ecology = ecology;
    this.seaLevelElevation = seaLevelElevation;
    this.elevationMin = elevationMin;
    this.elevationMax = elevationMax;
    this.maxSlope = ecology.slope.reduce((max, slope) => Math.max(max, slope), 0);

    this.geometry = buildPlanetGlobeGeometry({
      sampler,
      cellIdAt: (direction) => findCellAt(graph, direction).id,
      radius: this.globeRadiusM(),
      heightScale: this.terrainHeightScaleM(),
      longitudeSegments: GLOBE_LONGITUDE_SEGMENTS,
      latitudeRings: GLOBE_LATITUDE_RINGS,
    });
    this.displayElevations = Float32Array.from(this.geometry.elevations);
    this.applySeabedRelief();

    this.installMesh(this.geometry);
    this.rebuildColors();
    this.updateOceanMesh();
    this.triangles.set(this.geometry.triangleCount);
    this.vertices.set(this.geometry.vertexCount);
    this.buildMs.set(performance.now() - startedAt);
  }

  private installMesh(geometry: IPlanetGlobeGeometry): void {
    this.disposeMesh();
    const buffer = new BufferGeometry();
    buffer.setAttribute('position', new BufferAttribute(geometry.positions, 3));
    buffer.setAttribute('normal', new BufferAttribute(geometry.normals, 3));
    buffer.setAttribute('color', new BufferAttribute(new Float32Array(geometry.vertexCount * 3), 3));
    buffer.setAttribute('terrainMacroLandFactor', new BufferAttribute(new Float32Array(geometry.vertexCount), 1));
    buffer.setIndex(new BufferAttribute(geometry.indices, 1));
    buffer.computeBoundingSphere();

    const macroUniforms: IGlobeMacroUniforms = {
      enabled: { value: 0 },
      strength: { value: this.macroVariationStrength() },
      scaleM: { value: this.macroVariationScaleM() },
    };
    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      flatShading: false,
      // Winding is verified outward in the adapter spec; front side makes a regression visible.
      side: FrontSide,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms['uTerrainMacroEnabled'] = macroUniforms.enabled;
      shader.uniforms['uTerrainMacroStrength'] = macroUniforms.strength;
      shader.uniforms['uTerrainMacroScaleM'] = macroUniforms.scaleM;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GLOBE_MACRO_VERTEX_DECLARATIONS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GLOBE_MACRO_VERTEX_ASSIGNMENT}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLOBE_MACRO_FRAGMENT_FUNCTIONS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${GLOBE_MACRO_FRAGMENT_APPLICATION}`);
    };
    material.customProgramCacheKey = () => 'cell-planet-globe-material-macro-v1';
    const mesh = new Mesh(buffer, material);
    mesh.name = 'cell-planet-globe-terrain';
    this.engine.scene.add(mesh);
    this.mesh = mesh;
    this.globeMacroUniforms = macroUniforms;
  }

  private disposeMesh(): void {
    if (!this.mesh) return;
    this.engine.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh = undefined;
    this.globeMacroUniforms = undefined;
  }

  /**
   * Re-displaces canonical directions/elevations for a new exaggeration or seabed-relief setting.
   * No sampler pass and no graph rebuild — geography is unchanged, only display radius/normals.
   */
  private refreshDisplacement(): void {
    if (!this.mesh || !this.geometry) return;
    writePlanetGlobePositions(
      this.geometry.positions,
      this.geometry.directions,
      this.displayElevations,
      this.geometry.radius,
      this.terrainHeightScaleM(),
    );
    writePlanetGlobeNormals(this.geometry.normals, this.geometry.positions, this.geometry.indices);

    const position = this.mesh.geometry.getAttribute('position') as BufferAttribute;
    const normal = this.mesh.geometry.getAttribute('normal') as BufferAttribute;
    position.needsUpdate = true;
    normal.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
    this.updateOceanMesh();
  }

  /**
   * Seabed relief on: underwater vertices keep their below-sea bathymetry (the shared sampler
   * preserves it). Off: they are clamped to the sea datum for a flat ocean floor.
   */
  private applySeabedRelief(): void {
    if (!this.geometry) return;
    const relief = this.seabedRelief();
    for (let i = 0; i < this.geometry.vertexCount; i++) {
      this.displayElevations[i] =
        !relief && this.geometry.landMask[i] === 0 ? this.seaLevelElevation : this.geometry.elevations[i];
    }
  }

  private rebuildColors(): void {
    if (!this.mesh || !this.geometry) return;
    const color = this.mesh.geometry.getAttribute('color') as BufferAttribute;
    const values = color.array as Float32Array;
    const macroLandFactor = this.mesh.geometry.getAttribute('terrainMacroLandFactor') as BufferAttribute;
    const macroLandValues = macroLandFactor.array as Float32Array;
    const mode = this.fillMode();
    const oceanSubstance = WORLD_PROFILES[this.worldProfileKind()].oceanSubstance;
    const selectedCellId = this.selectedCellId();

    for (let i = 0; i < this.geometry.vertexCount; i++) {
      const cellId = this.geometry.cellIds[i];
      if (cellId === selectedCellId) {
        macroLandValues[i] = 1;
        this.colorScratch.set('#ffe066');
        const o = i * 3;
        values[o] = this.colorScratch.r;
        values[o + 1] = this.colorScratch.g;
        values[o + 2] = this.colorScratch.b;
        continue;
      }
      if (mode === 'material') {
        const materialColour = this.resolveMaterialColor(cellId, oceanSubstance);
        const rgb = materialColour.rgb;
        macroLandValues[i] = materialColour.macroLandFactor;
        // The shared palette is authored in sRGB, while Color stores the
        // renderer's working-space value used by vertex-colour lighting.
        this.colorScratch.setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
      } else {
        macroLandValues[i] = 0;
        this.colorScratch.setStyle(this.resolveCellColor(cellId, mode, oceanSubstance));
      }
      const o = i * 3;
      values[o] = this.colorScratch.r;
      values[o + 1] = this.colorScratch.g;
      values[o + 2] = this.colorScratch.b;
    }
    color.needsUpdate = true;
    macroLandFactor.needsUpdate = true;
    this.updateGlobeMacroUniforms();
  }

  /** Mirrors the 2.5D map's data-layer precedence so equivalent cells read the same colour. */
  private resolveCellColor(
    cellId: number,
    mode: CellPlanetMapFillMode,
    oceanSubstance: 'water' | 'lava',
  ): string {
    if (cellId < 0 || cellId >= this.tectonics.elevation.length) {
      return oceanSubstance === 'lava' ? lavaOceanColor() : OCEAN_COLOR;
    }
    if (oceanSubstance === 'lava' && this.ecology.waterBodyKind[cellId] === 'ocean') {
      return lavaOceanColor();
    }
    if (mode === 'plates') return plateColor(this.tectonics.plateIdByCell[cellId]);
    if (mode === 'elevation') {
      return elevationColor(
        this.tectonics.elevation[cellId],
        this.tectonics.seaLevelElevation,
        this.elevationMin,
        this.elevationMax,
      );
    }
    if (mode === 'temperature') return temperatureColor(this.ecology.temperature[cellId]);
    if (mode === 'moisture') return moistureColor(this.ecology.moisture[cellId]);
    if (mode === 'land') {
      return this.tectonics.isLand[cellId] ? 'hsl(100, 40%, 38%)' : 'hsl(210, 60%, 22%)';
    }
    return biomeColor(this.ecology.biome[cellId]);
  }

  private resolveMaterialColor(
    cellId: number,
    oceanSubstance: 'water' | 'lava',
  ): IGlobeMaterialColour {
    if (cellId < 0 || cellId >= this.tectonics.elevation.length) {
      return {
        rgb: oceanSubstance === 'lava'
          ? DEFAULT_TERRAIN_MATERIAL_PALETTE.lavaWater
          : DEFAULT_TERRAIN_MATERIAL_PALETTE.water,
        macroLandFactor: 0,
      };
    }
    const elevationM = this.tectonics.elevation[cellId] ?? this.seaLevelElevation;
    const temperature01 = Math.max(0, Math.min(1, ((this.ecology.temperature[cellId] ?? 0) + 1) * 0.5));
    const snowIce01 = this.ecology.biome[cellId] === 'ice_cap' ? 1
      : this.ecology.biome[cellId] === 'glacier' ? 0.9
      : this.ecology.biome[cellId] === 'tundra' ? 0.35 : 0;
    const arid01 = this.ecology.biome[cellId] === 'desert' ? 1
      : this.ecology.biome[cellId] === 'steppe' ? 0.45
      : this.ecology.biome[cellId] === 'savanna' ? 0.25 : 0;
    const sample = evaluateTerrainMaterial({
      elevationM,
      seaLevelM: this.seaLevelElevation,
      minElevationM: this.elevationMin,
      maxElevationM: this.elevationMax,
      slope01: this.maxSlope > 0 ? (this.ecology.slope[cellId] ?? 0) / this.maxSlope : 0,
      moisture01: this.ecology.moisture[cellId],
      temperature01,
      snowIce01,
      arid01,
      ridge01: this.ridgeCellSet.has(cellId) ? 1 : 0,
      river01: this.materialRiverMask[cellId] ?? 0,
    }, {
      snowlineM: this.seaLevelElevation + Math.max(1, this.elevationMax - this.seaLevelElevation) * 0.68,
      snowlineBlendM: Math.max(0.05, (this.elevationMax - this.seaLevelElevation) * 0.16),
    });
    return {
      rgb: terrainMaterialColorRgb(sample, { oceanSubstance }),
      macroLandFactor: 1 - Math.min(1, sample.weights.water + sample.snow01 * 0.75),
    };
  }

  private updateGlobeMacroUniforms(): void {
    if (!this.globeMacroUniforms) return;
    this.globeMacroUniforms.enabled.value = this.fillMode() === 'material' && this.macroVariationEnabled() ? 1 : 0;
    this.globeMacroUniforms.strength.value = Math.max(0, Math.min(1, this.macroVariationStrength()));
    this.globeMacroUniforms.scaleM.value = Math.max(1, this.macroVariationScaleM());
  }

  /** Translucent shell at the (display-scaled) sea datum so bathymetry reads as underwater relief. */
  private updateOceanMesh(): void {
    if (!this.oceanMesh) {
      const material = new MeshStandardMaterial({
        color: '#1c5f8a',
        transparent: true,
        opacity: 0.45,
        roughness: 0.2,
        metalness: 0.05,
      });
      this.oceanMesh = new Mesh(new SphereGeometry(1, GLOBE_LONGITUDE_SEGMENTS, GLOBE_LATITUDE_RINGS), material);
      this.oceanMesh.name = 'cell-planet-globe-ocean';
      this.engine.scene.add(this.oceanMesh);
    }
    const oceanRadius = this.globeRadiusM() + this.seaLevelElevation * this.terrainHeightScaleM();
    this.oceanMesh.scale.setScalar(Math.max(0.0001, oceanRadius));
    this.oceanMesh.visible = this.showOcean();
    this.drawCalls.set(this.mesh ? (this.showOcean() ? 2 : 1) : 0);
  }

  private disposeOceanMesh(): void {
    if (!this.oceanMesh) return;
    this.engine.scene.remove(this.oceanMesh);
    this.oceanMesh.geometry.dispose();
    this.oceanMesh.material.dispose();
    this.oceanMesh = undefined;
  }

  private inputNumber(event: Event): number {
    return (event.target as HTMLInputElement).valueAsNumber;
  }

  private restoreQuery(query: CellPlanetQuery): void {
    const cellCount = this.numberQuery(query.cellCount);
    if (cellCount !== null) this.cellCount.set(Math.max(200, Math.min(6000, Math.round(cellCount))));
    const seed = this.numberQuery(query.seed);
    if (seed !== null) this.seed.set(Math.max(0, Math.min(999999, Math.round(seed))));
    const relaxation = this.numberQuery(query.relaxation);
    if (relaxation !== null) this.relaxationIterations.set(Math.max(0, Math.min(6, Math.round(relaxation))));
    if (query.worldProfile && this.worldProfileKinds.includes(query.worldProfile as WorldProfileKind)) {
      this.worldProfileKind.set(query.worldProfile as WorldProfileKind);
    }
    if (isCellPlanetTerrainStyle(query.terrainStyle)) this.terrainStyle.set(query.terrainStyle);
    if (query.worldSize && this.worldSizeKinds.includes(query.worldSize as WorldSizeTier)) {
      this.worldSizeTier.set(query.worldSize as WorldSizeTier);
    }
    if (query.fillMode && this.fillModes.includes(query.fillMode as CellPlanetMapFillMode)) {
      this.fillMode.set(query.fillMode as CellPlanetMapFillMode);
    }
    const waterLevel = this.numberQuery(query.waterLevel);
    if (waterLevel !== null) this.waterLevel.set(Math.max(-1, Math.min(1, waterLevel)));
    const terrainHeightScale = this.numberQuery(query.terrainHeightScale);
    if (terrainHeightScale !== null) {
      this.terrainHeightScale.set(Math.max(0, Math.min(14, terrainHeightScale)));
    } else {
      // Accept URLs from the former unit-sphere prototype. Its 0.25 default maps to
      // the current 4x stylized relief default without changing the shared geography.
      const globeHeightScale = this.numberQuery(query.globeHeightScale ?? (query as Record<string, string | undefined>)['heightScale']);
      if (globeHeightScale !== null) this.terrainHeightScale.set(Math.max(0, Math.min(14, globeHeightScale * 16)));
    }
    this.macroVariationEnabled.set(this.booleanQuery(query.macroVariation, this.macroVariationEnabled()));
    const macroStrength = this.numberQuery(query.macroVariationStrength);
    if (macroStrength !== null) this.macroVariationStrength.set(Math.max(0, Math.min(1, macroStrength)));
    const macroScale = this.numberQuery(query.macroVariationScaleM);
    if (macroScale !== null) this.macroVariationScaleM.set(Math.max(8, Math.min(128, macroScale)));
    this.seabedRelief.set(this.booleanQuery(query.seabedRelief, this.seabedRelief()));
    this.showOcean.set(this.booleanQuery(query.showOcean, this.showOcean()));
    const selectedCell = this.numberQuery(query.selectedCell);
    this.selectedCellId.set(
      selectedCell !== null && Number.isInteger(selectedCell) && selectedCell >= 0 ? selectedCell : null,
    );
    if (query.u0Bookmark && this.u0BookmarkIds.includes(query.u0Bookmark as CellPlanetU0BookmarkId)) {
      this.u0BookmarkId.set(query.u0Bookmark as CellPlanetU0BookmarkId);
      if (selectedCell === null) {
        this.selectedCellId.set(getCellPlanetU0Bookmark(query.u0Bookmark as CellPlanetU0BookmarkId).cellId);
      }
    }
  }

  private updateComparisonQueryParams(): void {
    const queryParams = {
      ...this.preservedQueryParams(),
      cellCount: this.cellCount(),
      seed: this.seed(),
      relaxation: this.relaxationIterations(),
      worldProfile: this.worldProfileKind(),
      terrainStyle: this.terrainStyle(),
      worldSize: this.worldSizeTier(),
      fillMode: this.fillMode(),
      waterLevel: this.waterLevel(),
      terrainHeightScale: this.terrainHeightScale(),
      macroVariation: this.macroVariationEnabled(),
      macroVariationStrength: this.macroVariationStrength(),
      macroVariationScaleM: this.macroVariationScaleM(),
      seabedRelief: this.seabedRelief(),
      showOcean: this.showOcean(),
      selectedCell: this.selectedCellId() ?? '',
      u0Bookmark: this.u0BookmarkId(),
    };
    this.comparisonQueryParams.set(queryParams);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      replaceUrl: true,
    });
  }

  private numberQuery(value: string | undefined): number | null {
    if (value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  private booleanQuery(value: string | undefined, fallback: boolean): boolean {
    return value === 'true' ? true : value === 'false' ? false : fallback;
  }
}

function buildRiverMaterialMask(graph: IPlanetGraphCore, ecology: IPlanetEcology): Uint8Array {
  const mask = new Uint8Array(graph.cells.length);
  const thresholdCos = Math.cos(0.09);
  for (const cell of graph.cells) {
    for (const path of ecology.riverPaths) {
      if (path.some((point) => cell.center.x * point.x + cell.center.y * point.y + cell.center.z * point.z >= thresholdCos)) {
        mask[cell.id] = 1;
        break;
      }
    }
  }
  return mask;
}
