import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  CdlodPlanetComponent,
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
} from 'triangular-engine/celestial';

interface IPlanetOption {
  id: string;
  name: string;
  body: ICelestialBody;
}

@Component({
  standalone: true,
  selector: 'app-cdlod-planet-lab-page',
  imports: [CommonModule, FormsModule, EngineModule, CdlodPlanetComponent],
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
          [near]="1"
          [far]="200000000"
          [isActive]="true"
        />

        <directionalLight
          [position]="[10000000, 20000000, 10000000]"
          [intensity]="2.2"
        />
        <ambientLight [intensity]="0.35" />

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
      </scene>

      <!-- Control Sidebar -->
      <div class="overlay-panel">
        <header class="panel-header">
          <h2>CDLOD Planetary Terrain Lab</h2>
          <p class="subtitle">
            Continuous Distance-Dependent LOD with GPU Geomorphing
          </p>
        </header>

        <section class="control-group">
          <label class="control-label">Celestial Body</label>
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

          <label class="toggle-item">
            <input
              type="checkbox"
              [ngModel]="showOcean()"
              (ngModelChange)="showOcean.set($event)"
            />
            <span>Ocean Layer</span>
          </label>

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
      }

      .panel-header h2 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
        color: #ffffff;
      }

      .subtitle {
        margin: 4px 0 12px 0;
        font-size: 0.75rem;
        color: #94a3b8;
      }

      .control-group {
        margin-bottom: 14px;
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

  readonly cameraPosition = computed<[number, number, number]>(() => {
    const r = this.selectedBody().radiusM;
    return [0, r * 1.5, r * 2.2];
  });

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
