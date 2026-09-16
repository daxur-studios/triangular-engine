import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
} from 'three';
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
import { PlanetTerrainField } from './planet-terrain-field';

type Quality = 'standard' | 'high' | 'ultra';
type ColourMode = 'natural' | 'elevation' | 'geology' | 'lod';
type View = 'whole' | 'region' | 'close';
type PlanetSize = 'small' | 'moon' | 'earth';

const PLANET_SIZES: Readonly<Record<PlanetSize, number>> = {
  small: 5_000,
  moon: 1_737_400,
  earth: 6_371_000,
};
const QUALITY: Readonly<Record<Quality, { maxLod: number; resolution: number; budget: number; maxPatches: number; reduction: number }>> = {
  standard: { maxLod: 5, resolution: 20, budget: 4, maxPatches: 48, reduction: 0.55 },
  high: { maxLod: 7, resolution: 28, budget: 6, maxPatches: 96, reduction: 0.35 },
  ultra: { maxLod: 9, resolution: 36, budget: 8, maxPatches: 96, reduction: 0.15 },
};

interface IWorkerTimings {
  readonly generationMs: number;
  readonly simplificationMs: number;
}

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
        [createColors]="createColors()"
        [colorRevision]="rebuildRevision()"
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
      <label><span>Mesh reduction: {{ reductionPercent() }}%</span>
        <input
          type="range"
          min="0"
          max="95"
          step="1"
          [value]="reductionPercent()"
          (change)="setReduction($event)"
        />
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
        <span>Last patch: generate {{ formatMs(timings().generationMs) }} · simplify {{ formatMs(timings().simplificationMs) }} · worker {{ formatMs(timings().workerMs) }}</span>
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
      readonly startedAt: number;
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
  readonly reductionPercent = signal(Math.round(QUALITY.high.reduction * 100));
  readonly rebuildRevision = signal(0);
  readonly colourMode = signal<ColourMode>('natural');
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
  readonly timings = signal<IWorkerTimings & { readonly workerMs: number }>({
    generationMs: 0,
    simplificationMs: 0,
    workerMs: 0,
  });
  readonly meshGenerator: TerrainSurfaceMeshGenerator<ISphereTerrainPatchAddress> =
    (request) => this.generatePatchInWorker(request);
  readonly getLevel = levelOf;
  readonly getKey = keyOf;
  readonly qualityConfig = () => QUALITY[this.quality()];
  readonly createMaterial = () => {
    const mode = this.colourMode();
    return mode === 'lod'
      ? new MeshBasicMaterial({ vertexColors: true, side: DoubleSide })
      : createPlanetColourMaterial(mode, {
          roughness: 0.94,
          side: DoubleSide,
        });
  };
  readonly createColors = computed<
    ((context: ITerrainSurfaceColorContext<ISphereTerrainPatchAddress>) => Float32Array) | undefined
  >(() =>
    this.colourMode() === 'lod'
      ? (context) => createLodColors(context.surface.positions.length, context.address.level)
      : undefined,
  );

  constructor() {
    this.terrainWorker.onmessage = ({
      data,
    }: MessageEvent<{
      readonly id: number;
      readonly patch?: ITerrainPatchMesh<ISphereTerrainPatchAddress>;
      readonly timings?: IWorkerTimings;
      readonly error?: string;
    }>) => {
      const pending = this.workerRequests.get(data.id);
      if (!pending) return;
      this.workerRequests.delete(data.id);
      if (data.error) pending.reject(new Error(data.error));
      else if (data.patch) {
        if (data.timings) {
          this.timings.set({
            ...data.timings,
            workerMs: performance.now() - pending.startedAt,
          });
        }
        pending.resolve(data.patch);
      }
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
    if (value in QUALITY) {
      this.quality.set(value);
      this.reductionPercent.set(Math.round(QUALITY[value].reduction * 100));
      this.rebuildRevision.update((revision) => revision + 1);
    }
  }

  setReduction(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    this.reductionPercent.set(Math.min(95, Math.max(0, Math.round(value))));
    this.rebuildRevision.update((revision) => revision + 1);
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
    if (this.colourModes.includes(value)) {
      this.colourMode.set(value);
      this.rebuildRevision.update((revision) => revision + 1);
    }
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
      this.workerRequests.set(id, { resolve, reject, startedAt: performance.now() });
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
        reduction: this.reductionPercent() / 100,
        targetError: 0.08,
      });
    });
  }

  onLodChange(value: ITerrainSurfaceLodStats): void {
    this.stats.set(value);
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  }

  formatMs(value: number): string {
    return `${value.toFixed(1)} ms`;
  }

  formatLevels(levels: Readonly<Record<number, number>>): string {
    return Object.entries(levels)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([level, count]) => `L${level}:${count}`)
      .join(' · ') || '—';
  }
}

function createPlanetColourMaterial(
  mode: Exclude<ColourMode, 'lod'>,
  options: { readonly roughness: number; readonly side: typeof DoubleSide },
): MeshStandardMaterial {
  const modeValue = mode === 'elevation' ? 1 : mode === 'geology' ? 2 : 0;
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: options.roughness,
    side: options.side,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms['planetColourMode'] = { value: modeValue };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vPlanetWorldPosition;',
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvPlanetWorldPosition = worldPosition.xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
          varying vec3 vPlanetWorldPosition;
          uniform int planetColourMode;

          float planetClamp(float value, float lower, float upper) {
            return min(upper, max(lower, value));
          }

          float planetSrgbToLinear(float value) {
            return value <= 0.04045
              ? value / 12.92
              : pow((value + 0.055) / 1.055, 2.4);
          }

          vec3 planetSrgbToLinear(vec3 value) {
            return vec3(
              planetSrgbToLinear(value.r),
              planetSrgbToLinear(value.g),
              planetSrgbToLinear(value.b)
            );
          }

          float planetInverseSmoothstep(float outer, float inner, float value) {
            float t = planetClamp((value - outer) / (inner - outer), 0.0, 1.0);
            return t * t * (3.0 - 2.0 * t);
          }

          float planetAngularDistance(vec3 a, vec3 b) {
            return acos(planetClamp(dot(normalize(a), normalize(b)), -1.0, 1.0));
          }

          float planetBump(vec3 direction, vec3 center, float outerAngle, float innerAngle) {
            return planetInverseSmoothstep(
              outerAngle,
              innerAngle,
              planetAngularDistance(direction, center)
            );
          }

          float planetBelt(vec3 direction, vec3 normal, float width) {
            float distance = asin(abs(dot(direction, normalize(normal))));
            return exp(-pow(distance / width, 2.0));
          }

          float planetRiverChannel(vec3 direction, vec3 from, vec3 to) {
            vec3 a = normalize(from);
            vec3 b = normalize(to);
            vec3 lineNormal = normalize(cross(a, b));
            float lineDistance = asin(planetClamp(abs(dot(direction, lineNormal)), 0.0, 1.0));
            float endpointDistance = min(
              planetAngularDistance(direction, a),
              planetAngularDistance(direction, b)
            );
            float distance = max(0.0, min(lineDistance, endpointDistance + 0.035));
            return exp(-pow(distance / 0.018, 2.0));
          }

          vec3 planetFeatureColour(vec3 direction) {
            float continental = 0.0;
            continental += planetBump(direction, vec3(0.86, 0.18, 0.47), 1.05, 0.441) * 0.72;
            continental += planetBump(direction, vec3(-0.22, 0.64, 0.74), 0.78, 0.328) * 0.56;
            continental += planetBump(direction, vec3(-0.76, -0.2, 0.61), 0.68, 0.286) * 0.48;
            continental += planetBump(direction, vec3(0.2, -0.82, 0.54), 0.62, 0.2604) * 0.42;
            continental += planetBump(direction, vec3(0.45, 0.73, -0.5), 0.46, 0.1932) * 0.35;

            float land = smoothstep(0.28, 0.62, continental);
            float shelf = -410.0 + land * 420.0 + continental * 70.0;
            float beltA = planetBelt(direction, vec3(0.08, 0.92, 0.38), 0.095);
            float beltB = planetBelt(direction, vec3(-0.84, 0.16, 0.52), 0.075);
            float beltC = planetBelt(direction, vec3(0.45, -0.2, 0.87), 0.052);
            float beltVariation = 0.55 + 0.45 * abs(
              sin(direction.x * 17.0 + direction.y * 9.0) *
              cos(direction.z * 13.0 - direction.x * 5.0)
            );
            float mountain = land * min(
              1.0,
              (beltA * 0.95 + beltB * 0.75 + beltC * 0.55) * beltVariation
            );
            float ridgeDetail =
              0.55 * abs(sin(direction.x * 43.0 + direction.z * 29.0)) +
              0.30 * abs(cos(direction.y * 61.0 - direction.x * 17.0)) +
              0.15 * abs(sin((direction.x + direction.y - direction.z) * 97.0));
            float mountains = mountain * (380.0 + ridgeDetail * 340.0);

            float volcano = 0.0;
            volcano += planetBump(direction, vec3(0.8, 0.33, 0.5), 0.13, 0.0234) * 720.0;
            volcano += planetBump(direction, vec3(-0.34, 0.76, 0.56), 0.10, 0.018) * 560.0;
            volcano += planetBump(direction, vec3(-0.72, -0.27, 0.64), 0.085, 0.0153) * 480.0;
            volcano += planetBump(direction, vec3(0.18, -0.7, 0.69), 0.075, 0.0135) * 420.0;
            float crater = planetBump(direction, vec3(0.68, 0.5, -0.53), 0.12, 0.065) * -260.0;
            float mesa = planetBump(direction, vec3(-0.44, 0.24, -0.86), 0.16, 0.1) * 260.0;
            float river = max(
              planetRiverChannel(direction, vec3(0.82, 0.48, 0.3), vec3(0.73, 0.08, 0.68)),
              max(
                planetRiverChannel(direction, vec3(-0.32, 0.88, 0.34), vec3(-0.78, 0.18, 0.6)),
                planetRiverChannel(direction, vec3(0.33, -0.72, 0.61), vec3(-0.12, -0.88, 0.45))
              )
            );
            float elevation = planetClamp(
              shelf + mountains + volcano + mesa + crater - river * land * 210.0 +
              sin(direction.x * 31.0 + direction.z * 19.0) * 9.0 +
              sin(direction.y * 47.0 - direction.x * 23.0) * 6.0,
              -520.0,
              1360.0
            );

            if (planetColourMode == 1) {
              if (elevation < -320.0) return vec3(0.071, 0.247, 0.439);
              if (elevation < -40.0) return vec3(0.176, 0.514, 0.718);
              if (elevation < 80.0) return vec3(0.780, 0.718, 0.471);
              if (elevation < 420.0) return vec3(0.369, 0.592, 0.310);
              if (elevation < 850.0) return vec3(0.494, 0.463, 0.404);
              return vec3(0.906, 0.898, 0.859);
            }
            if (planetColourMode == 2) {
              if (volcano / 720.0 > 0.12) return vec3(0.776, 0.373, 0.220);
              if (-crater / 260.0 > 0.12) return vec3(0.541, 0.416, 0.447);
              if (mesa / 260.0 > 0.12) return vec3(0.757, 0.576, 0.329);
              if (mountain > 0.18) return vec3(0.596, 0.482, 0.408);
              if (river > 0.25) return vec3(0.294, 0.600, 0.784);
              return land > 0.45 ? vec3(0.392, 0.600, 0.345) : vec3(0.114, 0.322, 0.482);
            }
            if (elevation < 0.0) return vec3(0.137, 0.369, 0.569);
            if (river > 0.4) return vec3(0.271, 0.616, 0.816);
            if (elevation > 920.0) return vec3(0.894, 0.878, 0.820);
            if (mountain > 0.2) return vec3(0.549, 0.455, 0.373);
            return elevation < 100.0 ? vec3(0.612, 0.682, 0.361) : vec3(0.420, 0.608, 0.318);
          }`,
      )
      .replace(
        '#include <map_fragment>',
        `
          diffuseColor *= vec4(
            planetSrgbToLinear(planetFeatureColour(normalize(vPlanetWorldPosition))),
            1.0
          );
        `,
      );
  };
  material.customProgramCacheKey = () => `planet-procedural-colour-v2-${mode}`;
  return material;
}

function createLodColors(vertexValueCount: number, level: number): Float32Array {
  const color = new Color().setHSL(0.1 + level * 0.055, 0.72, 0.46);
  const colors = new Float32Array(vertexValueCount);
  for (let offset = 0; offset < colors.length; offset += 3) {
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }
  return colors;
}

function normalize(value: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...value) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}
