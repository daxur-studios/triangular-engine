import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ClampToEdgeWrapping, DataTexture, FloatType, LinearFilter, RGBAFormat, UnsignedByteType } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  WORLD_PROFILES,
  WorldProfileKind,
  buildPlanetEcology,
  buildPlanetGraphCore,
  buildPlanetSurfaceBake,
  buildPlanetTectonics,
  createPlanetSurfaceSampler,
} from 'triangular-engine/worldgen';
import {
  MAP_PROJECTIONS,
  MAP_PROJECTION_KINDS,
  MAP_PROJECTION_LABELS,
  MapProjectionKind,
} from 'triangular-engine/worldgen/render';
import {
  createClipmapTerrainScene,
  IClipmapTerrainHeightSource,
  IClipmapTerrainSceneHandle,
} from 'triangular-engine/terrain';
import { CellPlanetQuery, readCellPlanetQuery } from '../cell-planet-view-query';

function makeHeightTexture(values: Float32Array, min: number, max: number, width: number, height: number): DataTexture {
  const range = Math.max(0.000001, max - min);
  const rgba = new Float32Array(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const normalized = (values[i] - min) / range;
    const offset = i * 4;
    rgba[offset] = normalized;
    rgba[offset + 1] = normalized;
    rgba[offset + 2] = normalized;
    rgba[offset + 3] = 1;
  }
  const texture = new DataTexture(rgba, width, height, RGBAFormat, FloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function makeLandTexture(landMask: Uint8Array, width: number, height: number): DataTexture {
  const rgba = new Uint8Array(landMask.length * 4);
  for (let i = 0; i < landMask.length; i++) {
    const land = landMask[i] === 1;
    const offset = i * 4;
    rgba[offset] = land ? 91 : 17;
    rgba[offset + 1] = land ? 126 : 62;
    rgba[offset + 2] = land ? 58 : 118;
    rgba[offset + 3] = 255;
  }
  const texture = new DataTexture(rgba, width, height, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

@Component({
  selector: 'app-cell-planet-25d-map-page',
  imports: [EngineModule, RouterLink],
  template: `
    <scene [showFps]="true">
      <orthographicCamera
        [position]="[0, 110, 110]"
        [lookAt]="[0, 0, 0]"
        [left]="-160"
        [right]="160"
        [top]="100"
        [bottom]="-100"
        [far]="1000"
        [isActive]="!debugOrbitEnabled"
      />
      <!-- Temporary inspection camera. Keep this separate from the future
           Civ-style top-down camera so terrain work can be inspected from
           arbitrary angles without committing to the final map controls. -->
      <orbitControls
        [cameraPosition]="[150, 130, 150]"
        [target]="[0, 0, 0]"
        [near]="0.1"
        [far]="2000"
        [isActive]="debugOrbitEnabled"
      />
    </scene>
    <aside class="readout">
      <strong>Cell planet · 2.5D terrain</strong>
      <nav class="view-switch" aria-label="Map view">
        <a
          [routerLink]="['/cell-planet-map']"
          [queryParams]="comparisonQueryParams()"
        >2D map</a>
        <a
          [routerLink]="['/cell-planet-25d-map']"
          [queryParams]="comparisonQueryParams()"
          class="active"
          aria-current="page"
        >2.5D terrain</a>
      </nav>
      <span>shared planet sampler → baked height source → clipmap</span>
      <label>
        <span>Cell count: {{ cellCount() }}</span>
        <input type="range" min="200" max="6000" step="100" [value]="cellCount()" (input)="onCellCountInput($event)" />
      </label>
      <label>
        <span>Seed: {{ seed() }}</span>
        <input type="number" min="0" max="999999" step="1" [value]="seed()" (input)="onSeedInput($event)" />
      </label>
      <label>
        <span>Relaxation: {{ relaxationIterations() }}</span>
        <input type="range" min="0" max="6" step="1" [value]="relaxationIterations()" (input)="onRelaxationInput($event)" />
      </label>
      <label>
        <span>World profile</span>
        <select [value]="worldProfileKind()" (change)="onWorldProfileChange($event)">
          @for (profile of worldProfileKinds; track profile) {
            <option [value]="profile">{{ profile }}</option>
          }
        </select>
      </label>
      <label>
        <span>Map projection</span>
        <select [value]="projectionType()" (change)="onProjectionTypeChange($event)">
          @for (kind of projectionKinds; track kind) {
            <option [value]="kind">{{ projectionLabels[kind] }}</option>
          }
        </select>
      </label>
      <button type="button" (click)="randomizeSeed()">Randomize seed</button>
      @if (isRebuilding()) {
        <span>Rebuilding world…</span>
      }
      <span>draw calls: {{ drawCalls() }} · triangles: {{ triangles().toLocaleString() }}</span>
      <span>LOD instances: {{ instances() }}</span>
      <span>Debug orbit view · drag to rotate · wheel to zoom</span>
    </aside>
  `,
  styleUrl: './cell-planet-25d-map-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CellPlanet25dMapPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly terrain: IClipmapTerrainSceneHandle;

  readonly drawCalls = signal(0);
  readonly triangles = signal(0);
  readonly instances = signal('');
  readonly cellCount = signal(600);
  readonly seed = signal(51);
  readonly relaxationIterations = signal(2);
  readonly worldProfileKind = signal<WorldProfileKind>('terran');
  readonly worldProfileKinds: WorldProfileKind[] = ['terran', 'moon', 'volcanic', 'protoplanet'];
  readonly projectionType = signal<MapProjectionKind>('equirectangular');
  readonly projectionKinds = MAP_PROJECTION_KINDS;
  readonly projectionLabels = MAP_PROJECTION_LABELS;
  readonly isRebuilding = signal(false);
  private readonly preservedQueryParams = signal<CellPlanetQuery>({});
  readonly comparisonQueryParams = signal<Record<string, string | number | boolean>>({});

  /**
   * Temporary terrain-inspection camera. The orthographic camera remains in
   * the template as the future Civ-style map camera and can be reactivated
   * when the production pan/zoom controls are implemented.
   */
  readonly debugOrbitEnabled = true;

  private activeTextures: { height: DataTexture; color: DataTexture } | undefined;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const query = readCellPlanetQuery(params);
      this.preservedQueryParams.set(query);
      this.restoreQuery(query);
      this.updateComparisonQueryParams();
    });
    this.terrain = createClipmapTerrainScene(this.engine, (diagnostics) => {
      this.drawCalls.set(diagnostics.drawCalls);
      this.triangles.set(diagnostics.triangles);
      this.instances.set(diagnostics.instanceCountsByLevel.join(' · '));
    }, {
      levelCount: 5,
      baseTileSizeM: 16,
      blockRadiusTiles: 4,
      heightScaleM: 1,
      lodFocus: { x: 0, z: 0 },
    });
    this.terrain.setShowLevelTint(false);
    this.rebuildWorld();

    this.destroyRef.onDestroy(() => {
      this.terrain.dispose();
      this.activeTextures?.height.dispose();
      this.activeTextures?.color.dispose();
    });
  }

  onCellCountInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.cellCount()) {
      this.cellCount.set(Math.round(value));
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
      this.relaxationIterations.set(Math.round(value));
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

  onProjectionTypeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as MapProjectionKind;
    if (this.projectionKinds.includes(value) && value !== this.projectionType()) {
      this.projectionType.set(value);
      this.updateComparisonQueryParams();
      this.rebuildWorld();
    }
  }

  randomizeSeed(): void {
    this.seed.set(Math.floor(Math.random() * 1_000_000));
    this.updateComparisonQueryParams();
    this.rebuildWorld();
  }

  private rebuildWorld(): void {
    this.isRebuilding.set(true);
    const seed = this.seed();
    const profile = WORLD_PROFILES[this.worldProfileKind()];
    const graph = buildPlanetGraphCore({
      cellCount: this.cellCount(),
      seed,
      relaxationIterations: this.relaxationIterations(),
    });
    const tectonics = buildPlanetTectonics(graph, {
      plateCount: 10,
      seed,
      ...profile.tectonics,
    });
    const ecology = buildPlanetEcology(graph, tectonics, {
      climate: profile.climate,
      biomes: profile.biomes,
    });
    const sampler = createPlanetSurfaceSampler(graph, tectonics, ecology);
    const projection = MAP_PROJECTIONS[this.projectionType()];
    const bake = buildPlanetSurfaceBake(graph, sampler, {
      width: 256,
      height: 128,
      heightScale: 14,
      projection: {
        directionAt: (x, y, width, height) => {
          const lonLat = projection.unproject(x, y, width, height);
          if (!lonLat) return null;
          const cosLatitude = Math.cos(lonLat.lat);
          return {
            x: cosLatitude * Math.cos(lonLat.lon),
            y: Math.sin(lonLat.lat),
            z: cosLatitude * Math.sin(lonLat.lon),
          };
        },
      },
    });
    const minHeightM = Math.min(...bake.elevations);
    const maxHeightM = Math.max(...bake.elevations);
    const heightTexture = makeHeightTexture(bake.elevations, minHeightM, maxHeightM, bake.width, bake.height);
    const colorTexture = makeLandTexture(bake.landMask, bake.width, bake.height);
    const source: IClipmapTerrainHeightSource = {
      texture: heightTexture,
      colorTexture,
      minHeightM,
      maxHeightM,
      bounds: { minX: -128, minZ: -64, maxX: 128, maxZ: 64 },
    };
    const previousTextures = this.activeTextures;
    this.activeTextures = { height: heightTexture, color: colorTexture };
    this.terrain.setHeightSource(source);
    previousTextures?.height.dispose();
    previousTextures?.color.dispose();
    this.isRebuilding.set(false);
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
    if (query.projection && this.projectionKinds.includes(query.projection as MapProjectionKind)) {
      this.projectionType.set(query.projection as MapProjectionKind);
    }
  }

  private updateComparisonQueryParams(): void {
    this.comparisonQueryParams.set({
      ...this.preservedQueryParams(),
      cellCount: this.cellCount(),
      seed: this.seed(),
      relaxation: this.relaxationIterations(),
      worldProfile: this.worldProfileKind(),
      projection: this.projectionType(),
    });
  }

  private numberQuery(value: string | undefined): number | null {
    if (value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
}
