import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
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
  createClipmapTerrainScene,
  IClipmapTerrainHeightSource,
  IClipmapTerrainSceneHandle,
} from 'triangular-engine/terrain';

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
  imports: [EngineModule],
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
      <span>shared planet sampler → baked height source → clipmap</span>
      <label>
        <span>Cell count: {{ cellCount() }}</span>
        <input type="range" min="200" max="3000" step="100" [value]="cellCount()" (input)="onCellCountInput($event)" />
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
  readonly isRebuilding = signal(false);

  /**
   * Temporary terrain-inspection camera. The orthographic camera remains in
   * the template as the future Civ-style map camera and can be reactivated
   * when the production pan/zoom controls are implemented.
   */
  readonly debugOrbitEnabled = true;

  private activeTextures: { height: DataTexture; color: DataTexture } | undefined;

  constructor() {
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
      this.rebuildWorld();
    }
  }

  onSeedInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.seed()) {
      this.seed.set(Math.max(0, Math.min(999999, Math.round(value))));
      this.rebuildWorld();
    }
  }

  onRelaxationInput(event: Event): void {
    const value = this.inputNumber(event);
    if (Number.isFinite(value) && value !== this.relaxationIterations()) {
      this.relaxationIterations.set(Math.round(value));
      this.rebuildWorld();
    }
  }

  onWorldProfileChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as WorldProfileKind;
    if (this.worldProfileKinds.includes(value) && value !== this.worldProfileKind()) {
      this.worldProfileKind.set(value);
      this.rebuildWorld();
    }
  }

  randomizeSeed(): void {
    this.seed.set(Math.floor(Math.random() * 1_000_000));
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
    const bake = buildPlanetSurfaceBake(graph, sampler, { width: 256, height: 128, heightScale: 14 });
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
}
