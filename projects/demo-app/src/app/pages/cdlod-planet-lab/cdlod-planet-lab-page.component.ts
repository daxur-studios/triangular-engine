import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  CdlodPlanetComponent,
  CdlodPlaneComponent,
  ICdlodTelemetry,
  QualityPresetId,
} from 'triangular-engine/terrain';
import {
  ALPINE_PLANET,
  ARCHIPELAGO_PLANET,
  CANYON_PLANET,
  CRATERED_MOON,
  FAR_MOON,
  HOME_MOON,
  HOME_PLANET,
  ICelestialBody,
  createPlaneSurfaceSampler,
} from 'triangular-engine/celestial';

export type CdlodTopology = 'sphere' | 'plane';

interface IPlanetOption {
  id: string;
  name: string;
  body: ICelestialBody;
}

@Component({
  standalone: true,
  selector: 'app-cdlod-planet-lab-page',
  imports: [
    CommonModule,
    FormsModule,
    EngineModule,
    CdlodPlanetComponent,
    CdlodPlaneComponent,
  ],
  providers: [
    ...EngineService.provide({
      showFPS: true,
      webGLRendererParameters: {
        antialias: true,
        logarithmicDepthBuffer: true,
      },
    }),
  ],
  template: `
    <div class="flex-page">
      <scene>
        <orbitControls
          [cameraPosition]="cameraPosition()"
          [target]="cameraTarget()"
          [near]="0.5"
          [far]="500000000"
          [isActive]="true"
        />

        <directionalLight
          [position]="[10000000, 20000000, 10000000]"
          [intensity]="2.2"
        />
        <ambientLight [intensity]="0.35" />

        @if (topology() === 'sphere') {
          <cdlodPlanet
            [body]="selectedBody()"
            [quality]="selectedQuality()"
            [wireframe]="wireframe()"
            [cdlodMorphing]="cdlodMorphing()"
            [featureAdaptive]="featureAdaptive()"
            [showTerrain]="showTerrain()"
            [showOcean]="showOcean()"
            [freezeLod]="freezeLod()"
            [useWorkers]="useWorkers()"
            (telemetry)="onTelemetry($event)"
          />
        } @else if (topology() === 'plane') {
          <cdlodPlane
            [body]="selectedBody()"
            [rootPatchSizeM]="planeRootSizeM()"
            [streamingRadiusTiles]="planeStreamingRadius()"
            [maxLevel]="planeMaxLevel()"
            [baseResolution]="planeBaseResolution()"
            [wireframe]="wireframe()"
            [cdlodMorphing]="cdlodMorphing()"
            [featureAdaptive]="featureAdaptive()"
            [freezeLod]="freezeLod()"
            [useWorkers]="useWorkers()"
            (telemetry)="onTelemetry($event)"
          />
        }
      </scene>

      <!-- Control Sidebar -->
      <div class="overlay-panel">
        <header class="panel-header">
          <h2>CDLOD Multi-Surface Terrain Lab</h2>
          <p class="subtitle">
            Continuous Distance-Dependent LOD with GPU Geomorphing
          </p>
        </header>

        <!-- Topology Selector -->
        <section class="control-group">
          <label class="control-label">World Topology</label>
          <div class="pill-group">
            <button
              type="button"
              class="pill-btn"
              [class.active]="topology() === 'sphere'"
              (click)="setTopology('sphere')"
            >
              3D Sphere
            </button>
            <button
              type="button"
              class="pill-btn"
              [class.active]="topology() === 'plane'"
              (click)="setTopology('plane')"
            >
              2D Plane
            </button>
          </div>
        </section>

        <section class="control-group">
          <label class="control-label">Surface / Biome Preset</label>
          <select
            [ngModel]="selectedPlanetId()"
            (ngModelChange)="onSelectPlanet($event)"
            class="styled-select"
          >
            @for (planet of planetOptions; track planet.id) {
              <option [value]="planet.id">{{ planet.name }}</option>
            }
          </select>
        </section>

        @if (topology() === 'sphere') {
          <section class="control-group">
            <label class="control-label">Quality Preset</label>
            <div class="pill-group">
              <button
                type="button"
                class="pill-btn"
                [class.active]="selectedQuality() === 'laptop'"
                (click)="selectedQuality.set('laptop')"
              >
                Laptop
              </button>
              <button
                type="button"
                class="pill-btn"
                [class.active]="selectedQuality() === 'balanced'"
                (click)="selectedQuality.set('balanced')"
              >
                Balanced
              </button>
              <button
                type="button"
                class="pill-btn"
                [class.active]="selectedQuality() === 'ultra'"
                (click)="selectedQuality.set('ultra')"
              >
                Ultra
              </button>
            </div>
          </section>
        } @else {
          <section class="control-group">
            <label class="control-label">
              Root Patch Size: {{ (planeRootSizeM() / 1000).toFixed(1) }} km
            </label>
            <input
              type="range"
              min="1024"
              max="32768"
              step="1024"
              [ngModel]="planeRootSizeM()"
              (ngModelChange)="planeRootSizeM.set($event)"
              class="styled-slider"
            />
          </section>

          <section class="control-group">
            <label class="control-label">
              Streaming Radius: {{ planeStreamingRadius() }} tiles (~{{
                (
                  (planeStreamingRadius() * 2 + 1) *
                  (planeRootSizeM() / 1000)
                ).toFixed(0)
              }} km coverage)
            </label>
            <input
              type="range"
              min="1"
              max="12"
              step="1"
              [ngModel]="planeStreamingRadius()"
              (ngModelChange)="planeStreamingRadius.set($event)"
              class="styled-slider"
            />
          </section>

          <section class="control-group">
            <label class="control-label">Max Subdivision Level: {{ planeMaxLevel() }}</label>
            <input
              type="range"
              min="1"
              max="8"
              step="1"
              [ngModel]="planeMaxLevel()"
              (ngModelChange)="planeMaxLevel.set($event)"
              class="styled-slider"
            />
          </section>
        }

        <section class="control-group toggles-grid">
          <label class="toggle-item">
            <input
              type="checkbox"
              [ngModel]="wireframe()"
              (ngModelChange)="wireframe.set($event)"
            />
            <span>Wireframe</span>
          </label>

          <label class="toggle-item">
            <input
              type="checkbox"
              [ngModel]="cdlodMorphing()"
              (ngModelChange)="cdlodMorphing.set($event)"
            />
            <span>GPU Geomorphing</span>
          </label>

          <label class="toggle-item">
            <input
              type="checkbox"
              [ngModel]="featureAdaptive()"
              (ngModelChange)="featureAdaptive.set($event)"
            />
            <span>Feature Adaptive</span>
          </label>

          @if (topology() === 'sphere') {
            <label class="toggle-item">
              <input
                type="checkbox"
                [ngModel]="showOcean()"
                (ngModelChange)="showOcean.set($event)"
              />
              <span>Ocean Layer</span>
            </label>
          }

          <label class="toggle-item">
            <input
              type="checkbox"
              [ngModel]="useWorkers()"
              (ngModelChange)="useWorkers.set($event)"
            />
            <span>Web Workers</span>
          </label>

          <label class="toggle-item">
            <input
              type="checkbox"
              [ngModel]="freezeLod()"
              (ngModelChange)="freezeLod.set($event)"
            />
            <span>Freeze LOD</span>
          </label>
        </section>

        <!-- Live Telemetry Display -->
        @if (telemetry(); as tel) {
          <section class="telemetry-panel">
            <h3>Live Telemetry</h3>
            <div class="telemetry-grid">
              <div class="telemetry-stat">
                <span class="stat-label">Altitude</span>
                <span class="stat-val">{{
                  formatDistance(tel.cameraAltitudeM)
                }}</span>
              </div>
              <div class="telemetry-stat">
                <span class="stat-label">Triangles</span>
                <span class="stat-val">{{
                  tel.activeTriangles.toLocaleString()
                }}</span>
              </div>
              <div class="telemetry-stat">
                <span class="stat-label">Patches</span>
                <span class="stat-val">{{ tel.activePatches }}</span>
              </div>
              <div class="telemetry-stat">
                <span class="stat-label">Draw Calls</span>
                <span class="stat-val">{{ tel.drawCalls }}</span>
              </div>
              <div class="telemetry-stat">
                <span class="stat-label">High Detail</span>
                <span class="stat-val">{{ tel.highDetailCount }}</span>
              </div>
              <div class="telemetry-stat">
                <span class="stat-label">Coarse</span>
                <span class="stat-val">{{ tel.coarseCount }}</span>
              </div>
              <div class="telemetry-stat full-width">
                <span class="stat-label">FPS</span>
                <span class="stat-val highlight">{{ tel.fps }}</span>
              </div>
            </div>
          </section>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .overlay-panel {
        position: absolute;
        top: 16px;
        left: 16px;
        width: 320px;
        background: rgba(18, 22, 28, 0.88);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        padding: 16px;
        color: #f0f4f8;
        box-shadow: 0 16px 32px rgba(0, 0, 0, 0.4);
        z-index: 10;
        max-height: calc(100vh - 32px);
        overflow-y: auto;
      }

      .panel-header h2 {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 600;
        color: #ffffff;
      }

      .subtitle {
        margin: 4px 0 12px 0;
        font-size: 0.75rem;
        color: #94a3b8;
      }

      .control-group {
        margin-bottom: 12px;
      }

      .control-label {
        display: block;
        font-size: 0.8rem;
        font-weight: 500;
        color: #cbd5e1;
        margin-bottom: 6px;
      }

      .styled-select {
        width: 100%;
        padding: 8px 10px;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 6px;
        color: #f8fafc;
        font-size: 0.85rem;
        outline: none;
      }

      .styled-slider {
        width: 100%;
      }

      .pill-group {
        display: flex;
        gap: 6px;
      }

      .pill-btn {
        flex: 1;
        padding: 6px 8px;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 6px;
        color: #94a3b8;
        font-size: 0.8rem;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .pill-btn.active {
        background: #3b82f6;
        border-color: #60a5fa;
        color: #ffffff;
        font-weight: 600;
      }

      .toggles-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .toggle-item {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.78rem;
        color: #cbd5e1;
        cursor: pointer;
      }

      .telemetry-panel {
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      .telemetry-panel h3 {
        margin: 0 0 8px 0;
        font-size: 0.85rem;
        font-weight: 600;
        color: #e2e8f0;
      }

      .telemetry-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }

      .telemetry-stat {
        background: rgba(30, 41, 59, 0.6);
        padding: 6px 8px;
        border-radius: 6px;
        display: flex;
        flex-direction: column;
      }

      .telemetry-stat.full-width {
        grid-column: span 2;
      }

      .stat-label {
        font-size: 0.68rem;
        color: #94a3b8;
      }

      .stat-val {
        font-size: 0.88rem;
        font-weight: 600;
        color: #f1f5f9;
      }

      .stat-val.highlight {
        color: #4ade80;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex-page',
  },
})
export class CdlodPlanetLabPageComponent {
  readonly topology = signal<CdlodTopology>('sphere');

  readonly planetOptions: readonly IPlanetOption[] = [
    { id: 'home-planet', name: 'Home Planet (Temperate)', body: HOME_PLANET },
    {
      id: 'alpine-planet',
      name: 'Alpine World (High Peaks)',
      body: ALPINE_PLANET,
    },
    {
      id: 'canyon-planet',
      name: 'Canyon World (Arid Rifts)',
      body: CANYON_PLANET,
    },
    {
      id: 'archipelago-planet',
      name: 'Archipelago (Tropical Atolls)',
      body: ARCHIPELAGO_PLANET,
    },
    {
      id: 'cratered-moon',
      name: 'Cratered Moon (Basalt & Maria)',
      body: CRATERED_MOON,
    },
    { id: 'home-moon', name: 'Moon (Gray)', body: HOME_MOON },
    { id: 'far-moon', name: 'Moon (Icy Cyan Plains)', body: FAR_MOON },
  ];

  readonly selectedPlanetId = signal<string>('home-planet');
  readonly selectedQuality = signal<QualityPresetId>('balanced');
  readonly planeRootSizeM = signal<number>(4096);
  readonly planeStreamingRadius = signal<number>(4);
  readonly planeMaxLevel = signal<number>(6);
  readonly planeBaseResolution = signal<number>(32);
  readonly wireframe = signal(false);
  readonly cdlodMorphing = signal(true);
  readonly featureAdaptive = signal(true);
  readonly showTerrain = signal(true);
  readonly showOcean = signal(true);
  readonly useWorkers = signal(true);
  readonly freezeLod = signal(false);

  readonly telemetry = signal<ICdlodTelemetry | null>(null);

  readonly selectedBody = computed<ICelestialBody>(() => {
    const id = this.selectedPlanetId();
    return this.planetOptions.find((p) => p.id === id)?.body ?? HOME_PLANET;
  });

  readonly originElevationM = computed<number>(() => {
    const body = this.selectedBody();
    const sampler = createPlaneSurfaceSampler(body);
    return sampler.sample([0, 0, 0]).elevationM;
  });

  readonly cameraPosition = computed<[number, number, number]>(() => {
    if (this.topology() === 'plane') {
      const elev = this.originElevationM();
      const rootSize = this.planeRootSizeM();
      return [0, elev + Math.max(450, rootSize * 0.25), rootSize * 0.6];
    }
    const r = this.selectedBody().radiusM;
    return [0, r * 1.5, r * 2.2];
  });

  readonly cameraTarget = computed<[number, number, number]>(() => {
    if (this.topology() === 'plane') {
      return [0, this.originElevationM(), 0];
    }
    return [0, 0, 0];
  });

  setTopology(t: CdlodTopology): void {
    this.topology.set(t);
  }

  onSelectPlanet(id: string): void {
    this.selectedPlanetId.set(id);
  }

  onTelemetry(data: ICdlodTelemetry): void {
    this.telemetry.set(data);
  }

  formatDistance(meters: number): string {
    if (!Number.isFinite(meters)) return '0 m';
    if (meters >= 1_000_000) return `${(meters / 1_000_000).toFixed(2)} Mm`;
    if (meters >= 1_000) return `${(meters / 1_000).toFixed(1)} km`;
    return `${Math.round(meters)} m`;
  }
}
