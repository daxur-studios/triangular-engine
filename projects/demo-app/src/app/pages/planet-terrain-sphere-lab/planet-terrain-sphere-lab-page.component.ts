import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from 'three';
import {
  EngineModule,
  EngineService,
  RaycastFocusContext,
  RaycastOrbitControlsComponent,
} from 'triangular-engine';
import {
  SPHERE_TERRAIN_FACES,
  SphereTerrainDomain,
  TerrainSurfaceComponent,
  createSphereTerrainSurfaceSelector,
  type ISphereTerrainPatchAddress,
  type ITerrainPatchMesh,
  type ITerrainSurfaceGenerationRequest,
  type ITerrainSurfaceColorContext,
  type ITerrainSurfaceLodStats,
  type TerrainSurfaceMeshGenerator,
} from 'triangular-engine/terrain';
import { PlanetTerrainField, type PlanetTerrainFeatures } from './planet-terrain-field';

type Quality = 'standard' | 'high' | 'ultra';
type ColourMode = 'natural' | 'elevation' | 'geology' | 'lod';
type View = 'whole' | 'region' | 'close';
type PlanetSize = 'small' | 'moon' | 'earth';

const PLANET_SIZES: Readonly<Record<PlanetSize, number>> = {
  small: 5_000,
  moon: 1_737_400,
  earth: 6_371_000,
};
const QUALITY: Readonly<Record<Quality, { maxLod: number; resolution: number; budget: number; maxPatches: number }>> = {
  standard: { maxLod: 5, resolution: 20, budget: 4, maxPatches: 48 },
  high: { maxLod: 7, resolution: 28, budget: 6, maxPatches: 96 },
  ultra: { maxLod: 9, resolution: 36, budget: 8, maxPatches: 96 },
};

const VIEWS: Readonly<Record<View, { position: [number, number, number]; target: [number, number, number] }>> = {
  whole: { position: [8_200, 5_900, 8_700], target: [0, 0, 0] },
  region: { position: [4_900, 2_900, 5_400], target: [1_600, 700, 2_700] },
  close: { position: [4_480, 1_350, 3_650], target: [2_900, 950, 2_200] },
};

function levelOf(address: ISphereTerrainPatchAddress): number {
  return address.level;
}

function keyOf(address: ISphereTerrainPatchAddress): string {
  return `${address.face}:${address.level}:${address.x}:${address.y}`;
}

@Component({
  selector: 'app-planet-terrain-sphere-lab-page',
  imports: [EngineModule, RouterLink, RaycastOrbitControlsComponent, TerrainSurfaceComponent],
  template: `
    <scene [showFps]="true" [logarithmicDepthBuffer]="true">
      <raycastOrbitControls
        [cameraPosition]="cameraPosition()"
        [target]="cameraTarget()"
        [near]="1"
        [far]="100000000000"
        [raycastFocusResolver]="terrainRaycastFocus"
      />
      <ambientLight [intensity]="1.1" />
      <directionalLight [position]="[7_000, 10_000, 5_000]" [intensity]="2.4" />
      <terrainSurface
        [field]="field"
        [domain]="domain()"
        [roots]="roots()"
        [maxLod]="qualityConfig().maxLod"
        [refinementDistance]="undefined"
        [resolution]="qualityConfig().resolution"
        [skirtDepth]="0"
        [generationBudget]="qualityConfig().budget"
        [maxPatches]="qualityConfig().maxPatches"
        [batching]="batching()"
        [lodHysteresis]="0.18"
        [freezeLod]="freezeLod()"
        [wireframe]="wireframe()"
        [patchSelector]="patchSelector()"
        [meshGenerator]="meshGenerator"
        [createMaterial]="createMaterial"
        [createColors]="createColors"
        [colorRevision]="colourRevision()"
        [getLevel]="getLevel"
        [getKey]="getKey"
        (lodChange)="onLodChange($event)"
      />
    </scene>

    <aside class="panel" aria-label="Planet terrain sphere lab controls">
      <a routerLink="/">← Examples</a>
      <h2>Planet terrain · sphere streaming</h2>
      <p class="subtitle">
        Whole-planet six-face coverage with one continuous sampled field.
      </p>
      <p class="explanation">
        This is the scale test the small planar fixture could not provide:
        continents, plate-like mountain belts, volcanic peaks, mesas, a crater,
        river valleys, and adaptive surface chunks on one sphere.
      </p>

      <label><span>Quality</span>
        <select [value]="quality()" (change)="setQuality($event)">
          @for (option of qualityOptions; track option) {
            <option [value]="option">{{ option }}</option>
          }
        </select>
      </label>
      <label><span>Planet size</span>
        <select [value]="planetSize()" (change)="setPlanetSize($event)">
          @for (option of planetSizeOptions; track option) {
            <option [value]="option">{{ option }}</option>
          }
        </select>
      </label>
      <label><span>Colours</span>
        <select [value]="colourMode()" (change)="setColourMode($event)">
          @for (mode of colourModes; track mode) {
            <option [value]="mode">{{ mode }}</option>
          }
        </select>
      </label>

      <div class="button-row">
        @for (view of viewOptions; track view) {
          <button type="button" [class.active]="activeView() === view" (click)="setView(view)">
            {{ view }} view
          </button>
        }
      </div>
      <div class="button-row">
        <button type="button" [class.active]="wireframe()" (click)="toggleWireframe()">
          Wireframe: {{ wireframe() ? 'on' : 'off' }}
        </button>
        <button type="button" [class.active]="freezeLod()" (click)="toggleFreezeLod()">
          Freeze LOD: {{ freezeLod() ? 'on' : 'off' }}
        </button>
        <button type="button" [class.active]="batching()" (click)="toggleBatching()">
          Batch render: {{ batching() ? 'on' : 'off' }}
        </button>
      </div>

      <div class="stats">
        <span>Planet radius: {{ radiusLabel() }}</span>
        <span>Visible chunks: {{ stats().resident }} / desired {{ stats().desired }}</span>
        <span>Pending builds: {{ stats().queued }}</span>
        <span>Draw calls: {{ stats().drawCalls }} · triangles: {{ stats().triangles.toLocaleString() }}</span>
        <span>Geometry: {{ formatBytes(stats().geometryBytes) }}</span>
        <span>LOD distribution: {{ formatLevels(stats().levels) }}</span>
      </div>

      <details open>
        <summary>What to test</summary>
        <p>
          Start at whole view, switch to region and close view, then orbit around
          the surface. Use geology/elevation colours to confirm the field has
          global features, and LOD colours or Freeze LOD to inspect the quadtree
          cut without camera-driven changes.
        </p>
      </details>
    </aside>
  `,
  styleUrl: './planet-terrain-sphere-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class PlanetTerrainSphereLabPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly terrainWorker = new Worker(
    new URL('./planet-terrain-sphere.worker', import.meta.url),
    { type: 'module' },
  );
  private nextWorkerRequestId = 0;
  private readonly workerRequests = new Map<
    number,
    {
      readonly resolve: (patch: ITerrainPatchMesh<ISphereTerrainPatchAddress>) => void;
      readonly reject: (error: Error) => void;
    }
  >();
  readonly field = new PlanetTerrainField();
  readonly planetSize = signal<PlanetSize>('small');
  readonly planetSizeOptions: readonly PlanetSize[] = ['small', 'moon', 'earth'];
  readonly radiusM = computed(() => PLANET_SIZES[this.planetSize()]);
  readonly domain = computed(() => new SphereTerrainDomain(this.radiusM()));
  readonly roots = computed(() =>
    SPHERE_TERRAIN_FACES.map((face) => ({ face, level: 0, x: 0, y: 0 })),
  );
  readonly patchSelector = computed(() =>
    createSphereTerrainSurfaceSelector({
      radiusM: this.radiusM(),
      minElevationM: this.field.minElevationM,
      maxElevationM: this.field.maxElevationM,
      patchResolution: this.qualityConfig().resolution,
      maxPatches: this.qualityConfig().maxPatches,
      splitErrorPx: 14,
      mergeErrorPx: 5,
      screenSpaceErrorFactorPx: 680,
    }).select,
  );
  readonly radiusLabel = computed(() => `${this.radiusM().toLocaleString()} m`);
  readonly quality = signal<Quality>('high');
  readonly qualityOptions: readonly Quality[] = ['standard', 'high', 'ultra'];
  readonly colourMode = signal<ColourMode>('natural');
  readonly colourRevision = () =>
    this.colourModes.indexOf(this.colourMode()) + 1;
  readonly colourModes: readonly ColourMode[] = ['natural', 'elevation', 'geology', 'lod'];
  readonly activeView = signal<View>('whole');
  readonly viewOptions: readonly View[] = ['whole', 'region', 'close'];
  readonly wireframe = signal(false);
  readonly freezeLod = signal(false);
  readonly batching = signal(true);
  readonly cameraPosition = signal<[number, number, number]>(VIEWS.whole.position);
  readonly cameraTarget = signal<[number, number, number]>(VIEWS.whole.target);
  readonly terrainRaycastFocus = (context: RaycastFocusContext): Vector3 | null => {
    const hit = context.raycaster.intersectObjects(
      context.sceneChildren as unknown as import('three').Object3D[],
      true,
    )[0];
    return hit?.point ?? null;
  };
  readonly stats = signal<ITerrainSurfaceLodStats>({
    desired: 0,
    resident: 0,
    queued: 0,
    drawCalls: 0,
    triangles: 0,
    geometryBytes: 0,
    levels: {},
  });
  readonly meshGenerator: TerrainSurfaceMeshGenerator<ISphereTerrainPatchAddress> =
    (request) => this.generatePatchInWorker(request);
  readonly getLevel = levelOf;
  readonly getKey = keyOf;
  readonly qualityConfig = () => QUALITY[this.quality()];
  readonly createMaterial = () =>
    this.colourMode() === 'lod'
      ? new MeshBasicMaterial({ vertexColors: true, side: DoubleSide })
      : new MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.94,
          side: DoubleSide,
        });
  readonly createColors = (
    context: ITerrainSurfaceColorContext<ISphereTerrainPatchAddress>,
  ): Float32Array => {
    const colors = new Float32Array(context.surface.positions.length);
    const color = new Color();
    for (let offset = 0; offset < colors.length; offset += 3) {
      const direction = normalize([
        context.centerWorldM[0] + context.surface.positions[offset],
        context.centerWorldM[1] + context.surface.positions[offset + 1],
        context.centerWorldM[2] + context.surface.positions[offset + 2],
      ]);
      const features = this.field.features(direction);
      color.copy(colourFor(features, context.address.level, this.colourMode()));
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
    return colors;
  };

  constructor() {
    this.terrainWorker.onmessage = ({
      data,
    }: MessageEvent<{
      readonly id: number;
      readonly patch?: ITerrainPatchMesh<ISphereTerrainPatchAddress>;
      readonly error?: string;
    }>) => {
      const pending = this.workerRequests.get(data.id);
      if (!pending) return;
      this.workerRequests.delete(data.id);
      if (data.error) pending.reject(new Error(data.error));
      else if (data.patch) pending.resolve(data.patch);
      else pending.reject(new Error('Planet terrain worker returned no patch.'));
    };
    this.terrainWorker.onerror = () => {
      const error = new Error('Planet terrain worker failed.');
      for (const pending of this.workerRequests.values()) pending.reject(error);
      this.workerRequests.clear();
    };
    this.destroyRef.onDestroy(() => {
      this.terrainWorker.terminate();
      const error = new Error('Planet terrain worker was terminated.');
      for (const pending of this.workerRequests.values()) pending.reject(error);
      this.workerRequests.clear();
    });
  }

  setQuality(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as Quality;
    if (value in QUALITY) this.quality.set(value);
  }

  setPlanetSize(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as PlanetSize;
    if (value in PLANET_SIZES) {
      this.planetSize.set(value);
      const view = VIEWS[this.activeView()];
      const scale = PLANET_SIZES[value] / PLANET_SIZES.small;
      this.cameraPosition.set(view.position.map((entry) => entry * scale) as [number, number, number]);
      this.cameraTarget.set(view.target.map((entry) => entry * scale) as [number, number, number]);
    }
  }

  setColourMode(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as ColourMode;
    if (this.colourModes.includes(value)) this.colourMode.set(value);
  }

  setView(view: View): void {
    this.activeView.set(view);
    const scale = this.radiusM() / PLANET_SIZES.small;
    this.cameraPosition.set(VIEWS[view].position.map((entry) => entry * scale) as [number, number, number]);
    this.cameraTarget.set(VIEWS[view].target.map((entry) => entry * scale) as [number, number, number]);
  }

  toggleWireframe(): void {
    this.wireframe.update((value) => !value);
  }

  toggleFreezeLod(): void {
    this.freezeLod.update((value) => !value);
  }

  toggleBatching(): void {
    this.batching.update((value) => !value);
  }

  private generatePatchInWorker(
    request: ITerrainSurfaceGenerationRequest<ISphereTerrainPatchAddress>,
  ): Promise<ITerrainPatchMesh<ISphereTerrainPatchAddress>> {
    const id = this.nextWorkerRequestId++;
    return new Promise((resolve, reject) => {
      this.workerRequests.set(id, { resolve, reject });
      this.terrainWorker.postMessage({
        id,
        address: request.address,
        radiusM: this.radiusM(),
        baseResolution: request.baseResolution,
        resolution: request.resolution,
        edgeRefinementMask: request.edgeRefinementMask,
        edgeRefinementLevel: request.edgeRefinementLevel,
        edgeRefinementLevels: request.edgeRefinementLevels,
        edgeRefinementSegments: request.edgeRefinementSegments,
        skirtDepthM: request.skirtDepthM,
      });
    });
  }

  onLodChange(value: ITerrainSurfaceLodStats): void {
    this.stats.set(value);
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(bytes < 1024 * 1024 ? 1 : 2)} ${bytes < 1024 * 1024 ? 'KiB' : 'MiB'}`;
  }

  formatLevels(levels: Readonly<Record<number, number>>): string {
    return Object.entries(levels)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([level, count]) => `L${level}:${count}`)
      .join(' · ') || '—';
  }
}

function colourFor(features: PlanetTerrainFeatures, level: number, mode: ColourMode): Color {
  if (mode === 'lod') return new Color().setHSL(0.1 + level * 0.055, 0.72, 0.46);
  if (mode === 'elevation') {
    if (features.elevationM < -320) return new Color('#123f70');
    if (features.elevationM < -40) return new Color('#2d83b7');
    if (features.elevationM < 80) return new Color('#c7b778');
    if (features.elevationM < 420) return new Color('#5e974f');
    if (features.elevationM < 850) return new Color('#7e7667');
    return new Color('#e8e5db');
  }
  if (mode === 'geology') {
    if (features.volcano > 0.12) return new Color('#c65f38');
    if (features.crater > 0.12) return new Color('#8a6a72');
    if (features.mesa > 0.12) return new Color('#c19354');
    if (features.mountain > 0.18) return new Color('#987b68');
    if (features.river > 0.25) return new Color('#4b99c8');
    return features.land > 0.45 ? new Color('#649958') : new Color('#1d527b');
  }
  if (features.elevationM < 0) return new Color('#235e91');
  if (features.river > 0.4) return new Color('#459dd0');
  if (features.elevationM > 920) return new Color('#e4e0d1');
  if (features.mountain > 0.2) return new Color('#8c745f');
  return features.elevationM < 100 ? new Color('#9cae5c') : new Color('#6b9b51');
}

function normalize(value: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...value) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}
