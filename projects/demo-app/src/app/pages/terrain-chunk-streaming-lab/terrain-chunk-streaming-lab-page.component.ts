import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { simplifyIndexedGeometry } from 'triangular-engine/meshoptimizer';
import {
  generateTerrainPatchMesh,
  TerrainSurfaceComponent,
  type ITerrainSurfaceColorContext,
  type ITerrainSurfaceGenerationRequest,
  type ITerrainField,
  type ITerrainFieldSample,
  type IPlaneTerrainPatchAddress,
  PlaneTerrainDomain,
  ITerrainPatchGeometry,
  ITerrainPatchMesh,
} from 'triangular-engine/terrain';
import type { TerrainVector3 } from 'triangular-engine/terrain';

type Quality = 'standard' | 'high' | 'ultra';

const QUALITY: Record<
  Quality,
  {
    label: string;
    maxLod: number;
    resolution: number;
    reduction: number;
  }
> = {
  standard: { label: 'Standard', maxLod: 2, resolution: 24, reduction: 0.55 },
  high: { label: 'High', maxLod: 3, resolution: 32, reduction: 0.35 },
  ultra: { label: 'Ultra', maxLod: 4, resolution: 40, reduction: 0.15 },
};

const ROOTS: readonly IPlaneTerrainPatchAddress[] = Array.from(
  { length: 16 },
  (_, index) => ({
    level: 0,
    x: -2 + (index % 4),
    z: -2 + Math.floor(index / 4),
  }),
);

class StreamingTerrainField implements ITerrainField {
  readonly minElevationM = -120;
  readonly maxElevationM = 420;

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    return { elevationM: this.elevation(x, z) };
  }

  sampleBatch(
    positions: Float64Array,
    output = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let index = 0; index < output.length; index += 1) {
      output[index] = this.elevation(
        positions[index * 3],
        positions[index * 3 + 2],
      );
    }
    return output;
  }

  features(
    x: number,
    z: number,
  ): { ridge: number; river: number; volcano: number } {
    const ridge = gaussian(Math.abs(z - (0.22 * x - 520)), 145);
    const river = Math.max(
      gaussian(Math.abs(z - (-0.28 * x - 620)), 42),
      gaussian(Math.abs(z - (0.18 * x + 460)), 35),
    );
    const volcano = gaussian(Math.hypot(x - 1_600, z + 1_000), 620);
    return { ridge, river, volcano };
  }

  private elevation(x: number, z: number): number {
    const { ridge, river, volcano } = this.features(x, z);
    const rolling = 16 + Math.sin(x / 330) * 12 + Math.cos(z / 280) * 10;
    const mountain = ridge * (210 + 28 * Math.sin((x + z) / 130));
    const volcanoHeight =
      volcano * 230 - gaussian(Math.hypot(x - 1_600, z + 1_000), 135) * 170;
    return rolling + mountain + volcanoHeight - river * 135;
  }
}

function gaussian(distance: number, width: number): number {
  return Math.exp(-(distance * distance) / (2 * width * width));
}

function createGeometry(
  patch: ITerrainPatchMesh<IPlaneTerrainPatchAddress>,
): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(patch.surface.positions, 3),
  );
  geometry.setAttribute(
    'normal',
    new BufferAttribute(patch.surface.normals, 3),
  );
  geometry.setAttribute('uv', new BufferAttribute(patch.surface.uvs, 2));
  geometry.setIndex(new BufferAttribute(patch.surface.indices, 1));
  return geometry;
}

function compactSimplifiedGeometry(
  geometry: BufferGeometry,
): ITerrainPatchGeometry {
  const index = geometry.index;
  if (!index)
    throw new Error(
      'Streaming terrain simplification returned no index buffer.',
    );
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const remap = new Map<number, number>();
  const indices = new Uint32Array(index.count);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let indexOffset = 0; indexOffset < index.count; indexOffset += 1) {
    const sourceIndex = Number(index.array[indexOffset]);
    let compactIndex = remap.get(sourceIndex);
    if (compactIndex === undefined) {
      compactIndex = remap.size;
      remap.set(sourceIndex, compactIndex);
      for (let axis = 0; axis < 3; axis += 1) {
        positions.push(position.getComponent(sourceIndex, axis));
        normals.push(normal.getComponent(sourceIndex, axis));
      }
      for (let axis = 0; axis < 2; axis += 1) {
        uvs.push(uv.getComponent(sourceIndex, axis));
      }
    }
    indices[indexOffset] = compactIndex;
  }
  const indexArray = remap.size <= 65_535 ? new Uint16Array(indices) : indices;
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: indexArray,
  };
}

function levelOf(address: IPlaneTerrainPatchAddress): number {
  return address.level;
}

@Component({
  selector: 'app-terrain-chunk-streaming-lab-page',
  imports: [EngineModule, RouterLink, TerrainSurfaceComponent],
  template: `
    <scene [showFps]="true">
      <orbitControls
        [cameraPosition]="cameraPosition()"
        [target]="cameraTarget()"
        [near]="1"
      />
      <ambientLight [intensity]="1.35" />
      <directionalLight [position]="[3000, 5000, 1800]" [intensity]="2.2" />
      <terrainSurface
        [field]="field"
        [domain]="domain"
        [roots]="roots"
        [maxLod]="qualityConfig().maxLod"
        [refinementDistance]="5200"
        [resolution]="qualityConfig().resolution"
        [skirtDepth]="0"
        [generationBudget]="2"
        [lodHysteresis]="0.2"
        [freezeLod]="freezeLod()"
        [wireframe]="wireframe()"
        [meshGenerator]="meshGenerator"
        [createMaterial]="createMaterial"
        [createColors]="createColors"
        [colorRevision]="lodColours() ? 1 : 0"
        [getLevel]="getLevel"
        (lodChange)="onLodChange($event)"
      />
    </scene>

    <aside class="panel" aria-label="Terrain chunk streaming lab controls">
      <a routerLink="/">← Examples</a>
      <h2>Terrain chunk streaming lab</h2>
      <p class="subtitle">
        C1 camera-driven quadtree coverage over a 16 km square.
      </p>
      <p class="explanation">
        The camera selects detail. A complete parent cut stays visible until all
        replacement children are ready, then the cut changes together. Mixed
        LOD edges reuse finer neighbour samples; no skirts are used.
      </p>

      <label>
        <span>Quality</span>
        <select [value]="quality()" (change)="setQuality($event)">
          @for (option of qualityOptions; track option) {
            <option [value]="option">{{ qualityLabels[option] }}</option>
          }
        </select>
      </label>
      <label>
        <span>Build delay: {{ generationDelayMs() }} ms</span>
        <input
          type="range"
          min="0"
          max="500"
          step="25"
          [value]="generationDelayMs()"
          (input)="setGenerationDelay($event)"
        />
      </label>
      <button
        type="button"
        [class.active]="wireframe()"
        (click)="toggleWireframe()"
      >
        Wireframe: {{ wireframe() ? 'on' : 'off' }}
      </button>
      <button
        type="button"
        [class.active]="lodColours()"
        (click)="toggleLodColours()"
      >
        LOD colours: {{ lodColours() ? 'on' : 'off' }}
      </button>
      <button
        type="button"
        [class.active]="freezeLod()"
        (click)="toggleFreezeLod()"
      >
        Freeze LOD: {{ freezeLod() ? 'on' : 'off' }}
      </button>
      <button type="button" (click)="setView('overview')">Overview</button>
      <button type="button" (click)="setView('close')">Close detail</button>

      <div class="stats">
        <span>Selection: {{ stats().desired }} chunks</span>
        <span>Displayed: {{ stats().resident }} chunks</span>
        <span>Pending: {{ stats().queued }} jobs</span>
        <span>Draw calls: {{ stats().drawCalls }}</span>
        <span>Triangles: {{ stats().triangles.toLocaleString() }}</span>
        <span>Geometry: {{ formatBytes(stats().geometryBytes) }}</span>
        <span>Levels: {{ formatLevels(stats().levels) }}</span>
      </div>

      <details>
        <summary>What this proves</summary>
        <p>
          This is the first large-area streaming test. It measures parent
          fallback, camera-driven refinement, asynchronous replacement and
          bounded visible coverage. It does not yet represent the full cell
          planet or spherical globe.
        </p>
      </details>
    </aside>
  `,
  styleUrl: './terrain-chunk-streaming-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class TerrainChunkStreamingLabPageComponent {
  readonly field = new StreamingTerrainField();
  readonly domain = new PlaneTerrainDomain(4_096);
  readonly roots = ROOTS;
  readonly quality = signal<Quality>('standard');
  readonly qualityOptions: Quality[] = ['standard', 'high', 'ultra'];
  readonly qualityLabels = Object.fromEntries(
    this.qualityOptions.map((option) => [option, QUALITY[option].label]),
  ) as Record<Quality, string>;
  readonly wireframe = signal(false);
  readonly lodColours = signal(false);
  readonly freezeLod = signal(false);
  readonly generationDelayMs = signal(0);
  readonly cameraPosition = signal<[number, number, number]>([0, 2_900, 4_800]);
  readonly cameraTarget = signal<[number, number, number]>([0, 0, 0]);
  readonly stats = signal({
    desired: 0,
    resident: 0,
    queued: 0,
    drawCalls: 0,
    triangles: 0,
    geometryBytes: 0,
    levels: {} as Readonly<Record<number, number>>,
  });

  private readonly engine = inject(EngineService);
  private disposed = false;

  readonly qualityConfig = () => QUALITY[this.quality()];
  readonly getLevel = levelOf;
  readonly createMaterial = (): Material => {
    if (this.lodColours()) {
      return new MeshBasicMaterial({ vertexColors: true });
    }
    return new MeshStandardMaterial({
      color: '#789c67',
      roughness: 0.94,
      vertexColors: true,
    });
  };
  readonly createColors = (
    context: ITerrainSurfaceColorContext<IPlaneTerrainPatchAddress>,
  ): Float32Array => {
    const colors = new Float32Array(context.surface.positions.length);
    const meadow = new Color('#679b58');
    const ridge = new Color('#92745f');
    const river = new Color('#3d92c9');
    const snow = new Color('#d8d4c6');
    const color = new Color();
    for (let offset = 0; offset < colors.length; offset += 3) {
      const x = context.centerWorldM[0] + context.surface.positions[offset];
      const z = context.centerWorldM[2] + context.surface.positions[offset + 2];
      const features = this.field.features(x, z);
      const elevation =
        context.centerWorldM[1] + context.surface.positions[offset + 1];
      if (this.lodColours()) {
        color.setHSL(
          0.28 - context.address.level * 0.04,
          0.5,
          0.38 + context.address.level * 0.05,
        );
      } else if (features.river > 0.32) color.copy(river);
      else if (features.ridge > 0.32 || features.volcano > 0.35) {
        color.copy(ridge).lerp(snow, Math.max(0, (elevation - 230) / 150));
      } else color.copy(meadow);
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
    return colors;
  };

  readonly meshGenerator = async (
    request: ITerrainSurfaceGenerationRequest<IPlaneTerrainPatchAddress>,
  ): Promise<ITerrainPatchMesh<IPlaneTerrainPatchAddress>> => {
    const delayMs = this.generationDelayMs();
    if (delayMs > 0)
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    const generated = generateTerrainPatchMesh(request.field, request.domain, {
      address: request.address,
      resolution: request.resolution,
      baseResolution: request.baseResolution,
      edgeRefinementLevels: request.edgeRefinementLevels,
      edgeRefinementSegments: request.edgeRefinementSegments,
      skirtDepthM: request.skirtDepthM,
    });
    const simplified = await simplifyIndexedGeometry(
      createGeometry(generated),
      {
        ratio: this.qualityConfig().reduction,
        targetError: 0.08,
        flags: ['LockBorder'],
      },
    );
    if (this.disposed) return generated;
    return {
      ...generated,
      surface: compactSimplifiedGeometry(simplified.geometry),
    };
  };

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.disposed = true;
    });
  }

  setQuality(event: Event): void {
    this.quality.set((event.target as HTMLSelectElement).value as Quality);
  }

  toggleWireframe(): void {
    this.wireframe.update((value) => !value);
  }

  toggleLodColours(): void {
    this.lodColours.update((value) => !value);
  }

  toggleFreezeLod(): void {
    this.freezeLod.update((value) => !value);
  }

  setGenerationDelay(event: Event): void {
    this.generationDelayMs.set(
      Math.max(
        0,
        Math.min(500, Number((event.target as HTMLInputElement).value)),
      ),
    );
  }

  setView(view: 'overview' | 'close'): void {
    if (view === 'overview') {
      this.cameraPosition.set([0, 2_900, 4_800]);
      this.cameraTarget.set([0, 0, 0]);
    } else {
      this.cameraPosition.set([-720, 720, 880]);
      this.cameraTarget.set([-500, 0, -500]);
    }
  }

  onLodChange(value: {
    desired: number;
    resident: number;
    queued: number;
    drawCalls: number;
    triangles: number;
    geometryBytes: number;
    levels: Readonly<Record<number, number>>;
  }): void {
    this.stats.set(value);
  }

  formatBytes(bytes: number): string {
    if (bytes < 1_024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
    return `${(bytes / 1_048_576).toFixed(1)} MiB`;
  }

  formatLevels(levels: Readonly<Record<number, number>>): string {
    return (
      Object.entries(levels)
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([level, count]) => `L${level}:${count}`)
        .join(' · ') || '—'
    );
  }
}
