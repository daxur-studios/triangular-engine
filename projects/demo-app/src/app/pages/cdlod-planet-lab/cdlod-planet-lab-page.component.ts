import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  EngineModule,
  EngineService,
  RaycastFocusContext,
  RaycastOrbitControlsComponent,
} from 'triangular-engine';
import { Vector3 } from 'three';
import {
  CdlodPlanetComponent,
  CdlodPlaneComponent,
  CdlodCylinderComponent,
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
  INoiseTerrainMaskDef,
  ITerrainBiomeDef,
  ITerrainDef,
  createPlaneSurfaceSampler,
} from 'triangular-engine/celestial';

export type CdlodTopology = 'sphere' | 'plane' | 'cylinder';

interface IPlanetOption {
  id: string;
  name: string;
  body?: ICelestialBody;
}

@Component({
  standalone: true,
  selector: 'app-cdlod-planet-lab-page',
  imports: [
    CommonModule,
    FormsModule,
    EngineModule,
    RaycastOrbitControlsComponent,
    CdlodPlanetComponent,
    CdlodPlaneComponent,
    CdlodCylinderComponent,
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
        <raycastOrbitControls
          [cameraPosition]="cameraPosition()"
          [target]="cameraTarget()"
          [near]="0.5"
          [far]="500000000"
          [isActive]="true"
          [raycastFocusResolver]="terrainRaycastFocus"
        />

        <directionalLight
          [position]="[10000000, 20000000, 10000000]"
          [intensity]="2.2"
        />
        <ambientLight [intensity]="0.35" />

        @if (topology() === 'sphere') {
          <cdlodPlanet
            [body]="selectedBody()"
            [engineVersion]="engineVersion()"
            [quality]="selectedQuality()"
            [wireframe]="wireframe()"
            [hidePatchEdges]="hidePatchEdges()"
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
            [hidePatchEdges]="hidePatchEdges()"
            [cdlodMorphing]="cdlodMorphing()"
            [featureAdaptive]="featureAdaptive()"
            [freezeLod]="freezeLod()"
            [useWorkers]="useWorkers()"
            (telemetry)="onTelemetry($event)"
          />
        } @else if (topology() === 'cylinder') {
          <cdlodCylinder
            [body]="selectedBody()"
            [radiusM]="cylinderRadiusM()"
            [rootSectors]="cylinderRootSectors()"
            [axialStreamingRadius]="cylinderAxialRadius()"
            [maxLevel]="cylinderMaxLevel()"
            [wireframe]="wireframe()"
            [hidePatchEdges]="hidePatchEdges()"
            [cdlodMorphing]="cdlodMorphing()"
            [featureAdaptive]="featureAdaptive()"
            [freezeLod]="freezeLod()"
            [useWorkers]="useWorkers()"
            (telemetry)="onTelemetry($event)"
          />
        }
      </scene>

      <!-- Control Sidebar (Left) -->
      <div class="overlay-panel">
        <header class="panel-header">
          <h2>CDLOD Multi-Surface Lab</h2>
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
            <button
              type="button"
              class="pill-btn"
              [class.active]="topology() === 'cylinder'"
              (click)="setTopology('cylinder')"
            >
              O'Neill Cylinder
            </button>
          </div>
        </section>

        <!-- Engine Version Selector -->
        <section class="control-group">
          <label class="control-label">CDLOD Engine Version</label>
          <div class="pill-group">
            <button
              type="button"
              class="pill-btn"
              [class.active]="engineVersion() === 'v3'"
              (click)="engineVersion.set('v3')"
            >
              V3 (Smart LOD)
            </button>
            <button
              type="button"
              class="pill-btn"
              [class.active]="engineVersion() === 'v2'"
              (click)="engineVersion.set('v2')"
            >
              V2 (Classic)
            </button>
          </div>
        </section>

        <section class="control-group">
          <div class="flex-between">
            <label class="control-label">Surface / Biome Preset</label>
            <button
              type="button"
              class="studio-toggle-btn"
              [class.active]="studioOpen()"
              (click)="studioOpen.set(!studioOpen())"
            >
              ⚙ Terrain Studio
            </button>
          </div>
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
        } @else if (topology() === 'plane') {
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
        } @else if (topology() === 'cylinder') {
          <section class="control-group">
            <label class="control-label">
              Cylinder Radius: {{ (cylinderRadiusM() / 1000).toFixed(1) }} km (Diameter {{
                ((cylinderRadiusM() * 2) / 1000).toFixed(1)
              }} km)
            </label>
            <input
              type="range"
              min="1000"
              max="12000"
              step="500"
              [ngModel]="cylinderRadiusM()"
              (ngModelChange)="cylinderRadiusM.set($event)"
              class="styled-slider"
            />
          </section>

          <section class="control-group">
            <label class="control-label">Circumferential Sectors: {{ cylinderRootSectors() }}</label>
            <div class="pill-group">
              <button
                type="button"
                class="pill-btn"
                [class.active]="cylinderRootSectors() === 6"
                (click)="cylinderRootSectors.set(6)"
              >
                6
              </button>
              <button
                type="button"
                class="pill-btn"
                [class.active]="cylinderRootSectors() === 8"
                (click)="cylinderRootSectors.set(8)"
              >
                8
              </button>
              <button
                type="button"
                class="pill-btn"
                [class.active]="cylinderRootSectors() === 12"
                (click)="cylinderRootSectors.set(12)"
              >
                12
              </button>
            </div>
          </section>

          <section class="control-group">
            <label class="control-label">Axial Length Tiles: {{ cylinderAxialRadius() * 2 + 1 }}</label>
            <input
              type="range"
              min="1"
              max="8"
              step="1"
              [ngModel]="cylinderAxialRadius()"
              (ngModelChange)="cylinderAxialRadius.set($event)"
              class="styled-slider"
            />
          </section>

          <section class="control-group">
            <label class="control-label">Max Subdivision Level: {{ cylinderMaxLevel() }}</label>
            <input
              type="range"
              min="1"
              max="8"
              step="1"
              [ngModel]="cylinderMaxLevel()"
              (ngModelChange)="cylinderMaxLevel.set($event)"
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
              [ngModel]="hidePatchEdges()"
              (ngModelChange)="hidePatchEdges.set($event)"
            />
            <span>Hide Patch Edges</span>
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

      <!-- Terrain & Biome Studio Panel (Right) -->
      @if (studioOpen()) {
        <div class="overlay-panel-right">
          <header class="panel-header flex-between">
            <div>
              <h2>Terrain & Biome Studio</h2>
              <p class="subtitle">Real-time planetary generator architect</p>
            </div>
            <button
              type="button"
              class="close-btn"
              (click)="studioOpen.set(false)"
            >
              ✕
            </button>
          </header>

          <!-- Studio Tabs -->
          <div class="studio-tab-bar">
            <button
              type="button"
              class="tab-btn"
              [class.active]="studioTab() === 'continents'"
              (click)="studioTab.set('continents')"
            >
              Continents
            </button>
            <button
              type="button"
              class="tab-btn"
              [class.active]="studioTab() === 'mountains'"
              (click)="studioTab.set('mountains')"
            >
              Mountains
            </button>
            <button
              type="button"
              class="tab-btn"
              [class.active]="studioTab() === 'hills'"
              (click)="studioTab.set('hills')"
            >
              Hills / Plains
            </button>
            <button
              type="button"
              class="tab-btn"
              [class.active]="studioTab() === 'specialized'"
              (click)="studioTab.set('specialized')"
            >
              Specialized
            </button>
          </div>

          <!-- Tab 1: Continents & Oceans -->
          @if (studioTab() === 'continents') {
            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Continent Scale / Frequency</label>
                <span class="value-badge">{{ continentFrequency().toFixed(2) }}</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="2.0"
                step="0.02"
                [ngModel]="continentFrequency()"
                (ngModelChange)="onTweakGenerator('continentFrequency', $event)"
                class="styled-slider"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Sea Level Threshold</label>
                <span class="value-badge">{{ seaLevelThreshold().toFixed(2) }}</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="0.5"
                step="0.01"
                [ngModel]="seaLevelThreshold()"
                (ngModelChange)="onTweakGenerator('seaLevelThreshold', $event)"
                class="styled-slider"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Base Land Height</label>
                <span class="value-badge">{{ landHeightM() }} m</span>
              </div>
              <input
                type="range"
                min="50"
                max="800"
                step="10"
                [ngModel]="landHeightM()"
                (ngModelChange)="onTweakGenerator('landHeightM', $event)"
                class="styled-slider"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Ocean Depth</label>
                <span class="value-badge">{{ (oceanDepthM() / 1000).toFixed(1) }} km</span>
              </div>
              <input
                type="range"
                min="1000"
                max="8000"
                step="200"
                [ngModel]="oceanDepthM()"
                (ngModelChange)="onTweakGenerator('oceanDepthM', $event)"
                class="styled-slider"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Domain Warp (Organic Coasts)</label>
                <span class="value-badge">{{ domainWarpStrength().toFixed(2) }}</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="0.5"
                step="0.01"
                [ngModel]="domainWarpStrength()"
                (ngModelChange)="onTweakGenerator('domainWarpStrength', $event)"
                class="styled-slider"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Coast Variation Strength</label>
                <span class="value-badge">{{ coastVariationStrength().toFixed(2) }}</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="1.0"
                step="0.05"
                [ngModel]="coastVariationStrength()"
                (ngModelChange)="onTweakGenerator('coastVariationStrength', $event)"
                class="styled-slider"
              />
            </section>
          }

          <!-- Tab 2: Alpine Mountains -->
          @if (studioTab() === 'mountains') {
            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Mountain Peak Height (Amplitude)</label>
                <span class="value-badge highlight-val">{{ (mountainAmplitudeM() / 1000).toFixed(1) }} km</span>
              </div>
              <input
                type="range"
                min="1000"
                max="14000"
                step="200"
                [ngModel]="mountainAmplitudeM()"
                (ngModelChange)="onTweakGenerator('mountainAmplitudeM', $event)"
                class="styled-slider accent-orange"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Ridge Sharpness Exponent</label>
                <span class="value-badge">{{ mountainRidgeExponent().toFixed(1) }}</span>
              </div>
              <input
                type="range"
                min="1.5"
                max="5.0"
                step="0.1"
                [ngModel]="mountainRidgeExponent()"
                (ngModelChange)="onTweakGenerator('mountainRidgeExponent', $event)"
                class="styled-slider"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Mountain Ridge Frequency (Scale)</label>
                <span class="value-badge">{{ mountainFrequency().toFixed(1) }}</span>
              </div>
              <input
                type="range"
                min="2.0"
                max="16.0"
                step="0.5"
                [ngModel]="mountainFrequency()"
                (ngModelChange)="onTweakGenerator('mountainFrequency', $event)"
                class="styled-slider"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Mountain Coverage (Threshold)</label>
                <span class="value-badge">{{ mountainThreshold().toFixed(2) }}</span>
              </div>
              <input
                type="range"
                min="-0.05"
                max="0.30"
                step="0.01"
                [ngModel]="mountainThreshold()"
                (ngModelChange)="onTweakGenerator('mountainThreshold', $event)"
                class="styled-slider"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Rocky Spurs Amplitude</label>
                <span class="value-badge">{{ mountainSpurAmplitudeM() }} m</span>
              </div>
              <input
                type="range"
                min="0"
                max="1500"
                step="50"
                [ngModel]="mountainSpurAmplitudeM()"
                (ngModelChange)="onTweakGenerator('mountainSpurAmplitudeM', $event)"
                class="styled-slider"
              />
            </section>
          }

          <!-- Tab 3: Hills & Meadows -->
          @if (studioTab() === 'hills') {
            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Rolling Hills Height</label>
                <span class="value-badge highlight-green">{{ hillsAmplitudeM() }} m</span>
              </div>
              <input
                type="range"
                min="20"
                max="300"
                step="5"
                [ngModel]="hillsAmplitudeM()"
                (ngModelChange)="onTweakGenerator('hillsAmplitudeM', $event)"
                class="styled-slider accent-green"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Rolling Hills Frequency</label>
                <span class="value-badge">{{ hillsFrequency().toFixed(1) }}</span>
              </div>
              <input
                type="range"
                min="5"
                max="35"
                step="1"
                [ngModel]="hillsFrequency()"
                (ngModelChange)="onTweakGenerator('hillsFrequency', $event)"
                class="styled-slider"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Meadow Micro-Grain (Texture)</label>
                <span class="value-badge">{{ meadowMicroGrainM().toFixed(1) }} m</span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                step="0.5"
                [ngModel]="meadowMicroGrainM()"
                (ngModelChange)="onTweakGenerator('meadowMicroGrainM', $event)"
                class="styled-slider"
              />
            </section>
          }

          <!-- Tab 4: Specialized Biomes -->
          @if (studioTab() === 'specialized') {
            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Plateau / Mesa Height</label>
                <span class="value-badge">{{ plateauAmplitudeM() }} m</span>
              </div>
              <input
                type="range"
                min="200"
                max="2500"
                step="50"
                [ngModel]="plateauAmplitudeM()"
                (ngModelChange)="onTweakGenerator('plateauAmplitudeM', $event)"
                class="styled-slider"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Plateau Terraces / Tiers</label>
                <span class="value-badge">{{ plateauTerraceCount() }}</span>
              </div>
              <input
                type="range"
                min="2"
                max="8"
                step="1"
                [ngModel]="plateauTerraceCount()"
                (ngModelChange)="onTweakGenerator('plateauTerraceCount', $event)"
                class="styled-slider"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Rift Canyon Depth</label>
                <span class="value-badge">{{ canyonDepthM() }} m</span>
              </div>
              <input
                type="range"
                min="100"
                max="2000"
                step="50"
                [ngModel]="canyonDepthM()"
                (ngModelChange)="onTweakGenerator('canyonDepthM', $event)"
                class="styled-slider"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Rift Canyon Corridor Width</label>
                <span class="value-badge">{{ canyonWidth().toFixed(2) }}</span>
              </div>
              <input
                type="range"
                min="0.10"
                max="0.60"
                step="0.05"
                [ngModel]="canyonWidth()"
                (ngModelChange)="onTweakGenerator('canyonWidth', $event)"
                class="styled-slider"
              />
            </section>

            <section class="control-group">
              <div class="flex-between">
                <label class="control-label">Desert Dune Amplitude</label>
                <span class="value-badge">{{ duneAmplitudeM() }} m</span>
              </div>
              <input
                type="range"
                min="10"
                max="200"
                step="5"
                [ngModel]="duneAmplitudeM()"
                (ngModelChange)="onTweakGenerator('duneAmplitudeM', $event)"
                class="styled-slider"
              />
            </section>
          }

          <!-- Quick Presets & Seed Actions -->
          <section class="control-group studio-actions">
            <label class="control-label">Quick Styles & Actions</label>
            <div class="action-grid">
              <button
                type="button"
                class="action-btn"
                (click)="applyPreset('home')"
              >
                🌍 Stock Earth-like
              </button>
              <button
                type="button"
                class="action-btn"
                (click)="applyPreset('extreme-peaks')"
              >
                🏔 Alpine Massifs (11km)
              </button>
              <button
                type="button"
                class="action-btn"
                (click)="applyPreset('archipelago')"
              >
                🏝 Island Chains & Bays
              </button>
              <button
                type="button"
                class="action-btn"
                (click)="applyPreset('canyons-mesas')"
              >
                🏜 Canyon & Mesas
              </button>
            </div>

            <div class="seed-row">
              <span class="control-label">Seed: 0x{{ terrainSeed().toString(16).toUpperCase() }}</span>
              <button
                type="button"
                class="pill-btn seed-btn"
                (click)="randomizeSeed()"
              >
                🎲 New Seed
              </button>
            </div>
          </section>
        </div>
      }
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

      .overlay-panel-right {
        position: absolute;
        top: 16px;
        right: 16px;
        width: 340px;
        background: rgba(18, 22, 28, 0.92);
        backdrop-filter: blur(14px);
        border: 1px solid rgba(59, 130, 246, 0.3);
        border-radius: 12px;
        padding: 16px;
        color: #f0f4f8;
        box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
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

      .flex-between {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .control-group {
        margin-bottom: 12px;
      }

      .control-label {
        display: block;
        font-size: 0.8rem;
        font-weight: 500;
        color: #cbd5e1;
        margin-bottom: 4px;
      }

      .value-badge {
        font-size: 0.75rem;
        font-weight: 600;
        color: #60a5fa;
        background: rgba(59, 130, 246, 0.15);
        padding: 2px 6px;
        border-radius: 4px;
      }

      .value-badge.highlight-val {
        color: #fb923c;
        background: rgba(251, 146, 60, 0.15);
      }

      .value-badge.highlight-green {
        color: #4ade80;
        background: rgba(74, 222, 128, 0.15);
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
        accent-color: #3b82f6;
      }

      .styled-slider.accent-orange {
        accent-color: #f97316;
      }

      .styled-slider.accent-green {
        accent-color: #22c55e;
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

      .studio-toggle-btn {
        padding: 3px 8px;
        background: rgba(59, 130, 246, 0.15);
        border: 1px solid rgba(59, 130, 246, 0.4);
        border-radius: 4px;
        color: #60a5fa;
        font-size: 0.72rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .studio-toggle-btn.active {
        background: #3b82f6;
        color: #ffffff;
      }

      .close-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 1rem;
        cursor: pointer;
        padding: 4px;
      }

      .studio-tab-bar {
        display: flex;
        gap: 4px;
        margin-bottom: 12px;
        background: #0f172a;
        padding: 3px;
        border-radius: 8px;
      }

      .tab-btn {
        flex: 1;
        padding: 5px 4px;
        background: transparent;
        border: none;
        border-radius: 6px;
        color: #94a3b8;
        font-size: 0.72rem;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .tab-btn.active {
        background: #1e293b;
        color: #ffffff;
        font-weight: 600;
      }

      .action-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-bottom: 8px;
      }

      .action-btn {
        padding: 6px 8px;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 6px;
        color: #e2e8f0;
        font-size: 0.72rem;
        cursor: pointer;
        text-align: left;
        transition: all 0.15s ease;
      }

      .action-btn:hover {
        background: #334155;
        border-color: #60a5fa;
      }

      .seed-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }

      .seed-btn {
        flex: 0 0 auto;
        padding: 4px 10px;
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
    { id: 'custom', name: '🎨 Custom Studio World' },
    { id: 'home-planet', name: 'Home Planet (Stock Balanced)', body: HOME_PLANET },
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

  readonly selectedPlanetId = signal<string>('custom');
  readonly selectedQuality = signal<QualityPresetId>('balanced');
  readonly engineVersion = signal<'v2' | 'v3'>('v3');

  // Studio State
  readonly studioOpen = signal(true);
  readonly studioTab = signal<'continents' | 'mountains' | 'hills' | 'specialized'>('mountains');

  // Continents & Oceans
  readonly continentFrequency = signal<number>(0.72);
  readonly seaLevelThreshold = signal<number>(0.25);
  readonly oceanDepthM = signal<number>(4500);
  readonly landHeightM = signal<number>(160);
  readonly coastTransitionWidth = signal<number>(0.016);
  readonly coastVariationStrength = signal<number>(0.85);
  readonly domainWarpStrength = signal<number>(0.18);
  readonly domainWarpFrequency = signal<number>(1.2);

  // Alpine Mountains
  readonly mountainAmplitudeM = signal<number>(7800);
  readonly mountainFrequency = signal<number>(7.0);
  readonly mountainRidgeExponent = signal<number>(3.2);
  readonly mountainThreshold = signal<number>(0.04);
  readonly mountainSpurAmplitudeM = signal<number>(600);

  // Rolling Hills & Lowlands
  readonly hillsAmplitudeM = signal<number>(95);
  readonly hillsFrequency = signal<number>(16.0);
  readonly meadowMicroGrainM = signal<number>(2.5);

  // Specialized Biomes
  readonly plateauAmplitudeM = signal<number>(900);
  readonly plateauTerraceCount = signal<number>(4);
  readonly canyonDepthM = signal<number>(700);
  readonly canyonWidth = signal<number>(0.30);
  readonly duneAmplitudeM = signal<number>(80);

  // Seed
  readonly terrainSeed = signal<number>(0x5eed_484f);

  // Plane state
  readonly planeRootSizeM = signal<number>(4096);
  readonly planeStreamingRadius = signal<number>(4);
  readonly planeMaxLevel = signal<number>(6);
  readonly planeBaseResolution = signal<number>(32);

  // Cylinder state
  readonly cylinderRadiusM = signal<number>(4000);
  readonly cylinderRootSectors = signal<number>(8);
  readonly cylinderAxialRadius = signal<number>(3);
  readonly cylinderMaxLevel = signal<number>(6);

  readonly wireframe = signal(false);
  readonly hidePatchEdges = signal(false);
  readonly cdlodMorphing = signal(true);
  readonly featureAdaptive = signal(true);
  readonly showTerrain = signal(true);
  readonly showOcean = signal(true);
  readonly useWorkers = signal(true);
  readonly freezeLod = signal(false);

  readonly telemetry = signal<ICdlodTelemetry | null>(null);

  readonly terrainRaycastFocus = (context: RaycastFocusContext): Vector3 | null => {
    const hits = context.raycaster.intersectObjects(
      context.sceneChildren as unknown as import('three').Object3D[],
      true,
    );
    if (hits.length > 0) {
      return hits[0].point;
    }
    return null;
  };

  readonly customBody = computed<ICelestialBody>(() => {
    const seed = this.terrainSeed();
    const contFreq = this.continentFrequency();
    const seaLevelThresh = this.seaLevelThreshold();
    const oceanDepth = this.oceanDepthM();
    const landHeight = this.landHeightM();
    const transitionWidth = this.coastTransitionWidth();
    const coastVarStrength = this.coastVariationStrength();
    const warpStrength = this.domainWarpStrength();
    const warpFreq = this.domainWarpFrequency();

    const mtnAmp = this.mountainAmplitudeM();
    const mtnFreq = this.mountainFrequency();
    const mtnExp = this.mountainRidgeExponent();
    const mtnThresh = this.mountainThreshold();
    const mtnSpur = this.mountainSpurAmplitudeM();

    const hillsAmp = this.hillsAmplitudeM();
    const hillsFreq = this.hillsFrequency();
    const microGrain = this.meadowMicroGrainM();

    const platAmp = this.plateauAmplitudeM();
    const platTiers = this.plateauTerraceCount();
    const canyonDepth = this.canyonDepthM();
    const canyonW = this.canyonWidth();
    const duneAmp = this.duneAmplitudeM();

    const landMaskDef: INoiseTerrainMaskDef = {
      kind: 'noise-mask-3d',
      frequency: contFreq,
      octaves: 5,
      lacunarity: 2.1,
      persistence: 0.48,
      lowerThreshold: seaLevelThresh - 0.03,
      upperThreshold: seaLevelThresh + 0.01,
    };

    const biomes: ITerrainBiomeDef[] = [
      {
        id: 'alpine-ridges',
        mask: {
          kind: 'noise-mask-3d',
          frequency: 1.2,
          octaves: 3,
          lacunarity: 2,
          persistence: 0.5,
          seedOffset: 500,
          lowerThreshold: mtnThresh,
          upperThreshold: mtnThresh + 0.18,
        },
        generators: [
          {
            kind: 'ridged-fractal-3d',
            amplitudeM: mtnAmp,
            frequency: mtnFreq,
            octaves: 6,
            lacunarity: 2.15,
            persistence: 0.52,
            ridgeExponent: mtnExp,
            seedOffset: 510,
            mask: landMaskDef,
          },
          {
            kind: 'ridged-fractal-3d',
            amplitudeM: mtnSpur,
            frequency: 30,
            octaves: 4,
            lacunarity: 2,
            persistence: 0.5,
            ridgeExponent: 2.0,
            seedOffset: 520,
            mask: landMaskDef,
          },
        ],
        visual: {
          colorRgb: [0.28, 0.30, 0.34],
          highColorRgb: [0.96, 0.97, 1.0],
        },
      },
      {
        id: 'rolling-hills',
        mask: {
          kind: 'noise-mask-3d',
          frequency: 1.4,
          octaves: 3,
          lacunarity: 2,
          persistence: 0.5,
          seedOffset: 300,
          lowerThreshold: -0.02,
          upperThreshold: 0.20,
        },
        generators: [
          {
            kind: 'fractal-noise-3d',
            amplitudeM: hillsAmp,
            frequency: hillsFreq,
            octaves: 3,
            lacunarity: 2,
            persistence: 0.5,
            seedOffset: 310,
            mask: landMaskDef,
          },
        ],
        visual: {
          colorRgb: [0.32, 0.48, 0.22],
          highColorRgb: [0.58, 0.52, 0.32],
        },
      },
      {
        id: 'tableland-plateaus',
        mask: {
          kind: 'noise-mask-3d',
          frequency: 1.3,
          octaves: 3,
          lacunarity: 2,
          persistence: 0.5,
          seedOffset: 700,
          lowerThreshold: 0.06,
          upperThreshold: 0.26,
        },
        generators: [
          {
            kind: 'terrace-fractal-3d',
            amplitudeM: platAmp,
            frequency: 5.0,
            octaves: 4,
            lacunarity: 2,
            persistence: 0.5,
            terraceCount: platTiers,
            stepSharpness: 0.88,
            seedOffset: 710,
            mask: landMaskDef,
          },
        ],
        visual: {
          colorRgb: [0.55, 0.42, 0.28],
          highColorRgb: [0.78, 0.65, 0.48],
        },
      },
      {
        id: 'desert-dunes',
        mask: {
          kind: 'noise-mask-3d',
          frequency: 1.2,
          octaves: 3,
          lacunarity: 2,
          persistence: 0.5,
          seedOffset: 850,
          lowerThreshold: 0.08,
          upperThreshold: 0.28,
        },
        generators: [
          {
            kind: 'dunes-3d',
            amplitudeM: duneAmp,
            frequency: 24,
            octaves: 3,
            lacunarity: 2,
            persistence: 0.5,
            windDirectionBodyFixed: [0.8, 0.2, 0.5],
            waveAsymmetry: 0.65,
            seedOffset: 860,
            mask: landMaskDef,
          },
        ],
        visual: {
          colorRgb: [0.76, 0.58, 0.32],
          highColorRgb: [0.88, 0.74, 0.48],
        },
      },
      {
        id: 'rift-canyons',
        mask: {
          kind: 'noise-mask-3d',
          frequency: 1.3,
          octaves: 3,
          lacunarity: 2,
          persistence: 0.5,
          seedOffset: 950,
          lowerThreshold: 0.10,
          upperThreshold: 0.30,
        },
        generators: [
          {
            kind: 'canyon-3d',
            depthM: canyonDepth,
            frequency: 4.2,
            octaves: 5,
            lacunarity: 2,
            persistence: 0.5,
            canyonWidth: canyonW,
            wallSteepness: 3.2,
            seedOffset: 960,
            mask: landMaskDef,
          },
        ],
        visual: {
          colorRgb: [0.48, 0.24, 0.16],
          highColorRgb: [0.68, 0.42, 0.28],
        },
      },
      {
        id: 'lowland-meadows',
        mask: {
          kind: 'noise-mask-3d',
          frequency: 1.1,
          octaves: 3,
          lacunarity: 2,
          persistence: 0.5,
          seedOffset: 100,
          lowerThreshold: -0.50,
          upperThreshold: 0.02,
        },
        generators: [
          {
            kind: 'fractal-noise-3d',
            amplitudeM: 14,
            frequency: 4,
            octaves: 2,
            lacunarity: 2,
            persistence: 0.5,
            seedOffset: 110,
            mask: landMaskDef,
          },
        ],
        visual: {
          colorRgb: [0.22, 0.52, 0.18],
          highColorRgb: [0.42, 0.62, 0.28],
        },
      },
    ];

    const terrainDef: ITerrainDef = {
      seed,
      minElevationM: -oceanDepth - 500,
      maxElevationM: mtnAmp + 2500,
      generators: [
        {
          kind: 'continental-3d',
          frequency: contFreq,
          octaves: 5,
          lacunarity: 2.1,
          persistence: 0.48,
          seaLevelThreshold: seaLevelThresh,
          transitionWidth,
          oceanDepthM: oceanDepth,
          landHeightM: landHeight,
          coastVariation: {
            frequency: 4.5,
            octaves: 3,
            lacunarity: 2,
            persistence: 0.5,
            seedOffset: 1200,
            strength: coastVarStrength,
          },
          warp: {
            frequency: warpFreq,
            octaves: 3,
            lacunarity: 2,
            persistence: 0.5,
            strength: warpStrength,
            seedOffset: 340,
          },
        },
        {
          kind: 'fractal-noise-3d',
          amplitudeM: microGrain,
          frequency: 120,
          octaves: 3,
          lacunarity: 2,
          persistence: 0.5,
          seedOffset: 950,
          mask: landMaskDef,
        },
      ],
      biomes,
      visual: {
        colorRgb: [0.22, 0.52, 0.18],
        highColorRgb: [0.96, 0.97, 1.0],
      },
      ocean: {
        seaLevelM: 0,
        shallowColorRgb: [0.1, 0.45, 0.65],
        deepColorRgb: [0.02, 0.08, 0.25],
        depthFalloffM: 1500,
      },
    };

    return {
      ...HOME_PLANET,
      id: 'custom-planet',
      terrain: terrainDef,
    };
  });

  readonly selectedBody = computed<ICelestialBody>(() => {
    const id = this.selectedPlanetId();
    if (id === 'custom') {
      return this.customBody();
    }
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
    if (this.topology() === 'cylinder') {
      const r = this.cylinderRadiusM();
      // Position inside the habitat, elevated above the bottom floor
      return [0, -r + 150, 450];
    }
    const r = this.selectedBody().radiusM;
    return [0, r * 1.5, r * 2.2];
  });

  readonly cameraTarget = computed<[number, number, number]>(() => {
    if (this.topology() === 'plane') {
      return [0, this.originElevationM(), 0];
    }
    if (this.topology() === 'cylinder') {
      const r = this.cylinderRadiusM();
      // Look forward along the cylinder tube
      return [0, -r + 80, 0];
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

  onTweakGenerator(key: string, value: number): void {
    this.selectedPlanetId.set('custom');
    switch (key) {
      case 'continentFrequency':
        this.continentFrequency.set(value);
        break;
      case 'seaLevelThreshold':
        this.seaLevelThreshold.set(value);
        break;
      case 'landHeightM':
        this.landHeightM.set(value);
        break;
      case 'oceanDepthM':
        this.oceanDepthM.set(value);
        break;
      case 'domainWarpStrength':
        this.domainWarpStrength.set(value);
        break;
      case 'coastVariationStrength':
        this.coastVariationStrength.set(value);
        break;
      case 'mountainAmplitudeM':
        this.mountainAmplitudeM.set(value);
        break;
      case 'mountainRidgeExponent':
        this.mountainRidgeExponent.set(value);
        break;
      case 'mountainFrequency':
        this.mountainFrequency.set(value);
        break;
      case 'mountainThreshold':
        this.mountainThreshold.set(value);
        break;
      case 'mountainSpurAmplitudeM':
        this.mountainSpurAmplitudeM.set(value);
        break;
      case 'hillsAmplitudeM':
        this.hillsAmplitudeM.set(value);
        break;
      case 'hillsFrequency':
        this.hillsFrequency.set(value);
        break;
      case 'meadowMicroGrainM':
        this.meadowMicroGrainM.set(value);
        break;
      case 'plateauAmplitudeM':
        this.plateauAmplitudeM.set(value);
        break;
      case 'plateauTerraceCount':
        this.plateauTerraceCount.set(value);
        break;
      case 'canyonDepthM':
        this.canyonDepthM.set(value);
        break;
      case 'canyonWidth':
        this.canyonWidth.set(value);
        break;
      case 'duneAmplitudeM':
        this.duneAmplitudeM.set(value);
        break;
    }
  }

  randomizeSeed(): void {
    this.selectedPlanetId.set('custom');
    this.terrainSeed.set(Math.floor(Math.random() * 0xffff_ffff));
  }

  applyPreset(type: 'home' | 'extreme-peaks' | 'archipelago' | 'canyons-mesas'): void {
    this.selectedPlanetId.set('custom');
    if (type === 'home') {
      this.continentFrequency.set(0.72);
      this.seaLevelThreshold.set(0.25);
      this.landHeightM.set(160);
      this.oceanDepthM.set(4500);
      this.domainWarpStrength.set(0.18);
      this.mountainAmplitudeM.set(7800);
      this.mountainRidgeExponent.set(3.2);
      this.mountainFrequency.set(7.0);
      this.mountainThreshold.set(0.04);
      this.mountainSpurAmplitudeM.set(600);
      this.hillsAmplitudeM.set(95);
      this.hillsFrequency.set(16.0);
      this.plateauAmplitudeM.set(900);
      this.canyonDepthM.set(700);
      this.duneAmplitudeM.set(80);
    } else if (type === 'extreme-peaks') {
      this.continentFrequency.set(0.65);
      this.seaLevelThreshold.set(0.20);
      this.landHeightM.set(240);
      this.mountainAmplitudeM.set(11500);
      this.mountainRidgeExponent.set(3.8);
      this.mountainFrequency.set(6.0);
      this.mountainThreshold.set(0.0);
      this.mountainSpurAmplitudeM.set(900);
      this.hillsAmplitudeM.set(140);
    } else if (type === 'archipelago') {
      this.continentFrequency.set(1.4);
      this.seaLevelThreshold.set(0.32);
      this.landHeightM.set(90);
      this.oceanDepthM.set(5500);
      this.domainWarpStrength.set(0.35);
      this.coastVariationStrength.set(0.95);
      this.mountainAmplitudeM.set(4200);
      this.mountainRidgeExponent.set(2.8);
    } else if (type === 'canyons-mesas') {
      this.continentFrequency.set(0.6);
      this.seaLevelThreshold.set(0.15);
      this.landHeightM.set(300);
      this.plateauAmplitudeM.set(1600);
      this.plateauTerraceCount.set(6);
      this.canyonDepthM.set(1400);
      this.canyonWidth.set(0.45);
      this.mountainAmplitudeM.set(5000);
    }
  }

  formatDistance(meters: number): string {
    if (!Number.isFinite(meters)) return '0 m';
    if (meters >= 1_000_000) return `${(meters / 1_000_000).toFixed(2)} Mm`;
    if (meters >= 1_000) return `${(meters / 1_000).toFixed(1)} km`;
    return `${Math.round(meters)} m`;
  }
}
