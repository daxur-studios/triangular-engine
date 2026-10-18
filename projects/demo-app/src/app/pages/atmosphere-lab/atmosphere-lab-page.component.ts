import { Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PerspectiveCamera, Vector3 } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  AtmosphereBackdrop,
  AtmosphereGpuModel,
  AtmosphereSkyViewLut,
  createAtmospherePreset,
  sunDirectionFromAngles,
  type AtmospherePresetId,
  type PhysicalAtmosphereProfile,
} from 'triangular-engine/atmosphere';
import { BentPlanetLab } from './bent-planet-lab';

/**
 * Plan 049 Phase 2a: the atmosphere on a plain sphere, with no cell planet involved.
 *
 * One full-screen pass (`AtmosphereBackdrop`) draws the sky and an analytic ground sphere from the baked
 * tables, so everything here is the atmosphere and nothing else: ground-to-space camera, dusk, the sun
 * disc, limb glow and the planet's shadow, for any planet size. The same Earth profile is similarity-scaled
 * to each size (Plan 049, "Planet sizes"), so the size buttons should all look like the same atmosphere.
 *
 * Drag to look around, wheel to change altitude. `?backend=webgl2` runs the same renderer on its WebGL2
 * fallback.
 */
const query = new URLSearchParams(globalThis.location?.search ?? '');
const BACKEND: 'webgpu' | 'webgl2' = query.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu';

interface SizeChoice {
  readonly label: string;
  readonly radiusM: number;
}

const SIZES: readonly SizeChoice[] = [
  { label: '64 km', radiusM: 64_000 },
  { label: '100 km', radiusM: 100_000 },
  { label: '600 km', radiusM: 600_000 },
  { label: 'Earth', radiusM: 6_371_000 },
];

interface ViewPreset {
  readonly label: string;
  /** Altitude as a multiple of the planet radius, or metres when `metres` is set. */
  readonly altitudeR?: number;
  readonly altitudeM?: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly sunElevation: number;
  readonly sunAzimuth: number;
  readonly exposure: number;
}

/** The Phase 3a gate views: from space, low orbit, and low and side-on over the map (looking east at the map edge). */
interface BentViewPreset extends ViewPreset {
  readonly anchorX: number;
  readonly anchorY: number;
}
const BENT_VIEWS: readonly BentViewPreset[] = [
  { label: 'Space', altitudeR: 3, yaw: 0, pitch: -90, sunElevation: 40, sunAzimuth: 90, exposure: 6, anchorX: 0, anchorY: 0 },
  { label: 'Low orbit', altitudeR: 0.05, yaw: 0, pitch: -16, sunElevation: 35, sunAzimuth: 90, exposure: 8, anchorX: 0, anchorY: 0 },
  { label: 'Low, side-on (east edge)', altitudeR: 0.004, yaw: 90, pitch: 1, sunElevation: 35, sunAzimuth: 90, exposure: 8, anchorX: 0.6, anchorY: 0 },
  { label: 'Side-on, high', altitudeR: 0.03, yaw: 90, pitch: -2, sunElevation: 35, sunAzimuth: 90, exposure: 8, anchorX: 0.3, anchorY: 0 },
];

const VIEWS: readonly ViewPreset[] = [
  { label: 'Ground, noon', altitudeM: 2, yaw: 0, pitch: 12, sunElevation: 60, sunAzimuth: 90, exposure: 8 },
  { label: 'Ground, dusk (toward sun)', altitudeM: 2, yaw: 0, pitch: 4, sunElevation: 1.5, sunAzimuth: 0, exposure: 14 },
  { label: 'Ground, dusk (away)', altitudeM: 2, yaw: 180, pitch: 20, sunElevation: 1.5, sunAzimuth: 0, exposure: 14 },
  { label: 'Ground, after sunset', altitudeM: 2, yaw: 0, pitch: 25, sunElevation: -6, sunAzimuth: 0, exposure: 40 },
  { label: 'Mountain top, 5 km', altitudeM: 5_000, yaw: 0, pitch: -3, sunElevation: 25, sunAzimuth: 90, exposure: 8 },
  { label: 'Low orbit, limb', altitudeR: 0.05, yaw: 0, pitch: -16, sunElevation: 20, sunAzimuth: 90, exposure: 8 },
  { label: 'Space, day side', altitudeR: 3, yaw: 0, pitch: -90, sunElevation: 65, sunAzimuth: 0, exposure: 6 },
  { label: 'Space, sun behind planet', altitudeR: 3, yaw: 0, pitch: -90, sunElevation: -84, sunAzimuth: 0, exposure: 40 },
  { label: 'Limb, backlit by the sun', altitudeR: 0.15, yaw: 0, pitch: -27, sunElevation: -32, sunAzimuth: 0, exposure: 30 },
  { label: 'Space, terminator', altitudeR: 3, yaw: 0, pitch: -90, sunElevation: 2, sunAzimuth: 0, exposure: 8 },
];

@Component({
  standalone: true,
  selector: 'app-atmosphere-lab-page',
  imports: [EngineModule, RouterLink],
  providers: EngineService.provide({
    showFPS: true,
    preferredRenderer: 'webgpu',
    webGpuRendererParameters: {
      forceWebGL: BACKEND === 'webgl2',
      antialias: false,
      trackTimestamp: true,
    },
  }),
  host: {
    class: 'flex-page',
    '(pointermove)': 'onPointerMove($event)',
    '(wheel)': 'onWheel($event)',
  },
  template: `
    <scene />

    <aside class="panel" (pointermove)="$event.stopPropagation()" (wheel)="$event.stopPropagation()">
      <a routerLink="/">← Examples</a>
      <h2>Atmosphere lab · plain sphere</h2>
      <p class="row">
        <button (click)="switchBackend('webgpu')" [disabled]="backend === 'webgpu'">WebGPU</button>
        <button (click)="switchBackend('webgl2')" [disabled]="backend === 'webgl2'">forceWebGL</button>
      </p>

      <p class="label">Planet size {{ baking() ? '(baking tables…)' : '' }}</p>
      <p class="row">
        @for (size of sizes; track size.label) {
          <button (click)="setSize(size)" [class.active]="sizeLabel() === size.label">{{ size.label }}</button>
        }
      </p>
      <p class="label">Atmosphere</p>
      <p class="row">
        <button (click)="setPreset('earth')" [class.active]="presetId() === 'earth'">Earth</button>
        <button (click)="setPreset('mars')" [class.active]="presetId() === 'mars'">Mars</button>
      </p>

      <label
        >air height {{ heightLabel() }} (rebakes on release)
        <input
          type="range"
          min="0"
          max="1"
          step="0.005"
          [value]="heightSlider()"
          (input)="heightSlider.set(num($event))"
          (change)="applyHeight()"
        />
      </label>
      <p class="row">
        <button (click)="resetHeight()" [class.active]="thickness() === undefined">preset height</button>
      </p>

      <p class="label">Bent planet (Plan 049, Phase 3a spike)</p>
      <p class="row">
        <button (click)="toggleBent()" [class.active]="bentOn()">bent planet {{ bentOn() ? 'on' : 'off' }}</button>
        <button (click)="toggleSweep()" [class.active]="sweep()" [disabled]="!bentOn()">
          {{ sweep() ? 'stop sweep' : 'sweep 0 → 1 → 0' }}
        </button>
      </p>
      @if (bentOn()) {
        <label
          >morph {{ morph().toFixed(3) }} (k = {{ curvatureLabel() }})
          <input type="range" min="0" max="1" step="0.001" [value]="morph()" (input)="setMorph($event)" />
        </label>
        <label
          >camera over map x {{ anchorX().toFixed(2) }}
          <input type="range" min="-0.98" max="0.98" step="0.01" [value]="anchorX()" (input)="setAnchor($event, 'x')" />
        </label>
        <label
          >camera over map y {{ anchorY().toFixed(2) }}
          <input type="range" min="-0.95" max="0.95" step="0.01" [value]="anchorY()" (input)="setAnchor($event, 'y')" />
        </label>
        <p class="row">
          <button (click)="setDayNight('real')" [class.active]="dayNight() === 'real'">real day/night</button>
          <button (click)="setDayNight('alwaysDay')" [class.active]="dayNight() === 'alwaysDay'">always day (50°)</button>
          <button (click)="toggleMask()" [class.active]="maskOn()">map mask {{ maskOn() ? 'on' : 'off' }}</button>
        </p>
        <p class="row">
          @for (view of bentViews; track view.label) {
            <button (click)="applyBentView(view)">{{ view.label }}</button>
          }
        </p>
      }

      <p class="label">View</p>
      <p class="row">
        @for (view of views; track view.label) {
          <button (click)="applyView(view)">{{ view.label }}</button>
        }
      </p>

      <label
        >altitude {{ altitudeLabel() }}
        <input type="range" min="0" max="1" step="0.001" [value]="altitudeSlider()" (input)="setAltitudeSlider($event)" />
      </label>
      <label
        >look yaw {{ yaw().toFixed(0) }}°
        <input type="range" min="-180" max="180" step="1" [value]="yaw()" (input)="yaw.set(num($event))" />
      </label>
      <label
        >look pitch {{ pitch().toFixed(0) }}°
        <input type="range" min="-90" max="90" step="0.5" [value]="pitch()" (input)="pitch.set(num($event))" />
      </label>
      <label
        >sun elevation {{ sunElevation().toFixed(1) }}°
        <input type="range" min="-90" max="90" step="0.1" [value]="sunElevation()" (input)="setSunElevation($event)" />
      </label>
      <label
        >sun azimuth {{ sunAzimuth().toFixed(0) }}°
        <input type="range" min="-180" max="180" step="1" [value]="sunAzimuth()" (input)="setSunAzimuth($event)" />
      </label>
      <label
        >exposure {{ exposure().toFixed(1) }}
        <input type="range" min="0" max="100" step="0.5" [value]="exposure()" (input)="setExposure($event)" />
      </label>
      <p class="row">
        <button (click)="toggleSunAnimation()" [class.active]="animateSun()">
          {{ animateSun() ? 'stop sun' : 'animate sun' }}
        </button>
        <button (click)="toggleGround()" [class.active]="ground()">ground {{ ground() ? 'on' : 'off' }}</button>
        <button (click)="toggleChecker()" [class.active]="checker()">checker {{ checker() ? 'on' : 'off' }}</button>
      </p>
      <p class="row">
        <button (click)="toggleSkyView()" [class.active]="skyViewOn()">
          sky from {{ skyViewOn() ? 'table' : 'per-pixel march' }}
        </button>
      </p>
      <label class="check">
        <input type="checkbox" [checked]="spaceLowRes()" (change)="setSpaceLowRes($event)" />
        half-res march from space ({{ spaceLabel() }})
      </label>
      <p class="note">
        GPU {{ gpuMs() }} · table renders {{ tableRenders() }} · {{ skyViewOn() ? 'table' : 'march' }} path
      </p>
      <p class="note">
        {{ backend }} · {{ sizeLabel() }} {{ presetId() }} · bake {{ bakeMs() }} ms · drag = look, wheel = altitude
      </p>
    </aside>
  `,
  styles: `
    :host {
      position: relative;
    }
    .panel {
      position: absolute;
      top: 1rem;
      left: 1rem;
      background: rgba(10, 14, 20, 0.85);
      color: #eee;
      padding: 1rem;
      border-radius: 8px;
      max-width: 340px;
      max-height: calc(100vh - 2rem);
      overflow-y: auto;
      font: 13px/1.4 system-ui;
      z-index: 20;
    }
    .panel input[type='range'] {
      width: 100%;
    }
    .panel h2 {
      margin: 0.3rem 0;
      font-size: 15px;
    }
    .panel label {
      display: block;
    }
    .panel label.check {
      margin: 0.3rem 0;
    }
    .row {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      margin: 0.3rem 0;
    }
    .label {
      margin: 0.5rem 0 0;
      opacity: 0.7;
    }
    .note {
      opacity: 0.6;
      margin: 0.5rem 0 0;
    }
    button.active {
      outline: 2px solid #6cf;
    }
  `,
})
export class AtmosphereLabPageComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly backend = BACKEND;
  readonly sizes = SIZES;
  readonly views = VIEWS;
  readonly bentViews = BENT_VIEWS;
  readonly bentOn = signal(false);
  readonly morph = signal(0);
  readonly sweep = signal(false);
  readonly anchorX = signal(0);
  readonly anchorY = signal(0);
  readonly dayNight = signal<'real' | 'alwaysDay'>('real');
  readonly maskOn = signal(true);

  readonly sizeLabel = signal('Earth');
  readonly presetId = signal<AtmospherePresetId>('earth');
  readonly baking = signal(false);
  readonly bakeMs = signal(0);
  readonly yaw = signal(0);
  readonly pitch = signal(12);
  readonly sunElevation = signal(60);
  readonly sunAzimuth = signal(90);
  readonly exposure = signal(8);
  readonly altitudeSlider = signal(0);
  readonly animateSun = signal(false);
  readonly ground = signal(true);
  readonly checker = signal(true);
  readonly skyViewOn = signal(true);
  readonly spaceLowRes = signal(true);
  readonly spaceLabel = signal('inside the air');
  /** Air height / planet radius; undefined keeps the preset's natural height. Slider is log: 0.002 .. 1. */
  readonly thickness = signal<number | undefined>(undefined);
  readonly heightSlider = signal(0.5);
  readonly gpuMs = signal('n/a');
  readonly tableRenders = signal(0);

  private radiusM = 6_371_000;
  private altitudeM = 2;
  private readonly model: AtmosphereGpuModel;
  private readonly backdrop: AtmosphereBackdrop;
  private readonly skyView: AtmosphereSkyViewLut;
  private readonly bentLab: BentPlanetLab;
  private sweepDirection = 1;
  private frame = 0;
  private timestampsPending = false;
  private readonly forward = new Vector3();

  constructor() {
    const started = performance.now();
    this.model = new AtmosphereGpuModel(this.buildProfile());
    this.bakeMs.set(Math.round(performance.now() - started));
    this.skyView = new AtmosphereSkyViewLut(this.model);
    this.backdrop = new AtmosphereBackdrop(this.model, { skyView: this.skyView });
    this.engine.scene.add(this.backdrop.mesh);
    this.bentLab = new BentPlanetLab(this.model);
    this.bentLab.setVisible(false);
    this.engine.scene.add(this.bentLab.pass, this.bentLab.grid);

    const camera = this.engine.camera;
    if (camera instanceof PerspectiveCamera) {
      camera.fov = 75;
      camera.near = 0.1;
      camera.far = 100;
      camera.updateProjectionMatrix();
    }
    this.applyView(VIEWS[0]);

    const tick = this.engine.tick$.subscribe((delta) => {
      if (this.animateSun()) {
        let elevation = this.sunElevation() + delta * 6;
        if (elevation > 90) elevation -= 180;
        this.sunElevation.set(elevation);
        this.applySun();
      }
      if (this.bentOn()) this.tickBent(delta);
      this.updateCamera();
      this.updateSkyViewAndTimings();
    });
    this.destroyRef.onDestroy(() => {
      tick.unsubscribe();
      this.engine.scene.remove(this.backdrop.mesh, this.bentLab.pass, this.bentLab.grid);
      this.bentLab.dispose();
      this.backdrop.dispose();
      this.skyView.dispose();
      this.model.dispose();
    });
  }

  private buildProfile(): PhysicalAtmosphereProfile {
    const profile = createAtmospherePreset(this.presetId(), { radiusM: this.radiusM, thickness: this.thickness() });
    if (profile.kind !== 'physical') throw new Error('Expected a physical atmosphere profile');
    return profile;
  }

  private rebake(): void {
    this.baking.set(true);
    // Let the "baking" label paint before the synchronous bake blocks the thread.
    setTimeout(() => {
      const started = performance.now();
      this.model.setProfile(this.buildProfile());
      this.bakeMs.set(Math.round(performance.now() - started));
      this.baking.set(false);
      this.syncAltitudeSlider();
    }, 30);
  }

  setSize(size: SizeChoice): void {
    // Keep the same equivalent viewpoint: altitude scales with the planet.
    const k = size.radiusM / this.radiusM;
    this.radiusM = size.radiusM;
    this.altitudeM = Math.max(1, this.altitudeM * k);
    this.sizeLabel.set(size.label);
    this.bentLab.setPlanetRadius(size.radiusM);
    this.backdrop.setAltitude(this.altitudeM);
    this.rebake();
  }

  private sliderToThickness(v: number): number {
    return 0.002 * Math.pow(500, v);
  }

  heightLabel(): string {
    const t = this.thickness() ?? this.sliderToThickness(this.heightSlider());
    const prefix = this.thickness() === undefined ? 'preset' : '';
    return `${prefix} ${(t * 100).toFixed(t < 0.1 ? 2 : 0)}% of radius = ${this.formatLength(t * this.radiusM)}`.trim();
  }

  private formatLength(m: number): string {
    return m < 1000 ? `${m.toFixed(0)} m` : `${(m / 1000).toFixed(m < 1e5 ? 1 : 0)} km`;
  }

  applyHeight(): void {
    this.thickness.set(this.sliderToThickness(this.heightSlider()));
    this.rebake();
  }

  resetHeight(): void {
    this.thickness.set(undefined);
    this.rebake();
  }

  setPreset(id: AtmospherePresetId): void {
    this.presetId.set(id);
    this.rebake();
  }

  applyView(view: ViewPreset): void {
    this.altitudeM = view.altitudeM ?? (view.altitudeR ?? 1) * this.radiusM;
    this.yaw.set(view.yaw);
    this.pitch.set(view.pitch);
    this.sunElevation.set(view.sunElevation);
    this.sunAzimuth.set(view.sunAzimuth);
    this.exposure.set(view.exposure);
    this.backdrop.exposure.value = view.exposure;
    this.backdrop.setAltitude(this.altitudeM);
    this.syncAltitudeSlider();
    this.applySun();
  }

  // The slider is logarithmic: 0 = 1 m, 1 = 30 planet radii.
  private altitudeToSlider(metres: number): number {
    const max = Math.log(30 * this.radiusM);
    return Math.min(1, Math.max(0, Math.log(Math.max(1, metres)) / max));
  }

  private syncAltitudeSlider(): void {
    this.altitudeSlider.set(this.altitudeToSlider(this.altitudeM));
  }

  altitudeLabel(): string {
    const m = this.altitudeM;
    return m < 1000 ? `${m.toFixed(m < 10 ? 1 : 0)} m` : m < 1e6 ? `${(m / 1000).toFixed(1)} km` : `${(m / 1e6).toFixed(2)} Mm`;
  }

  setAltitudeSlider(event: Event): void {
    const v = this.num(event);
    this.altitudeM = Math.exp(v * Math.log(30 * this.radiusM));
    this.altitudeSlider.set(v);
    this.backdrop.setAltitude(this.altitudeM);
  }

  setSunElevation(event: Event): void {
    this.sunElevation.set(this.num(event));
    this.applySun();
  }

  setSunAzimuth(event: Event): void {
    this.sunAzimuth.set(this.num(event));
    this.applySun();
  }

  setExposure(event: Event): void {
    this.exposure.set(this.num(event));
    this.backdrop.exposure.value = this.exposure();
  }

  toggleSunAnimation(): void {
    this.animateSun.update((on) => !on);
  }

  toggleGround(): void {
    this.ground.update((on) => !on);
    this.backdrop.groundEnabled.value = this.ground() ? 1 : 0;
  }

  toggleSkyView(): void {
    this.skyViewOn.update((on) => !on);
    this.backdrop.skyViewEnabled.value = this.skyViewOn() ? 1 : 0;
    this.skyView.invalidate();
  }

  setSpaceLowRes(event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.spaceLowRes.set(on);
    this.backdrop.spaceLowResEnabled.value = on ? 1 : 0;
  }

  /** Refreshes the sky-view table (outside any render pass) and, every 5 frames, reads the GPU timestamp. */
  private updateSkyViewAndTimings(): void {
    const renderer: any = this.engine.renderer;
    if (!renderer?.initialized) return;
    if (!this.bentOn()) {
      this.backdrop.update(renderer, this.engine.camera);
      this.tableRenders.set(this.skyView.renderCount);
      const size = this.backdrop.spaceSize;
      this.spaceLabel.set(size.x > 0 && this.altitudeM >= this.model.uTopAltitude.value ? `${size.x} x ${size.y}` : 'not in use inside the air');
    }
    if (++this.frame % 5 !== 0 || this.timestampsPending || !renderer.resolveTimestampsAsync) return;
    this.timestampsPending = true;
    renderer
      .resolveTimestampsAsync('render')
      .then((ms: number | undefined) => {
        const value = typeof ms === 'number' && ms > 0 ? ms : renderer.info?.render?.timestamp;
        this.gpuMs.set(typeof value === 'number' && value > 0 ? value.toFixed(2) + ' ms' : 'n/a (no timestamp query)');
      })
      .catch(() => this.gpuMs.set('n/a (no timestamp query)'))
      .finally(() => (this.timestampsPending = false));
  }

  toggleChecker(): void {
    this.checker.update((on) => !on);
    this.backdrop.checkerStrength.value = this.checker() ? 1 : 0;
  }

  private applySun(): void {
    const dir = sunDirectionFromAngles(this.sunElevation(), this.sunAzimuth());
    this.model.setSunDirection(dir.x, dir.y, dir.z);
    this.bentLab.setSun(this.sunElevation(), this.sunAzimuth());
  }

  // -- bent planet (Phase 3a) ----------------------------------------------------------------------

  toggleBent(): void {
    const on = !this.bentOn();
    this.bentOn.set(on);
    this.backdrop.mesh.visible = !on;
    this.bentLab.setVisible(on);
    this.gpuMs.set('n/a');
    if (!on) {
      this.sweep.set(false);
      const camera = this.engine.camera;
      if (camera instanceof PerspectiveCamera) {
        camera.near = 0.1;
        camera.far = 100;
        camera.updateProjectionMatrix();
      }
    }
    this.skyView.invalidate();
  }

  toggleSweep(): void {
    this.sweep.update((on) => !on);
  }

  setMorph(event: Event): void {
    this.sweep.set(false);
    this.morph.set(this.num(event));
    this.bentLab.setMorph(this.morph());
  }

  curvatureLabel(): string {
    return (this.bentLab.bent.k * this.radiusM).toFixed(4) + ' / R';
  }

  setAnchor(event: Event, axis: 'x' | 'y'): void {
    (axis === 'x' ? this.anchorX : this.anchorY).set(this.num(event));
    this.bentLab.setAnchor(this.anchorX(), this.anchorY());
  }

  setDayNight(mode: 'real' | 'alwaysDay'): void {
    this.dayNight.set(mode);
    this.bentLab.setDayNight(mode);
  }

  toggleMask(): void {
    this.maskOn.update((on) => !on);
    this.bentLab.setMaskEnabled(this.maskOn());
  }

  applyBentView(view: BentViewPreset): void {
    this.applyView(view);
    this.anchorX.set(view.anchorX);
    this.anchorY.set(view.anchorY);
    this.bentLab.setAnchor(view.anchorX, view.anchorY);
  }

  private tickBent(delta: number): void {
    if (this.sweep()) {
      // 0 -> 1 -> 0 over about 12 seconds.
      let next = this.morph() + (this.sweepDirection * delta) / 6;
      if (next >= 1 || next <= 0) {
        this.sweepDirection = -this.sweepDirection;
        next = Math.min(1, Math.max(0, next));
      }
      this.morph.set(next);
      this.bentLab.setMorph(next);
    }
    this.bentLab.setAltitude(this.altitudeM);
    this.bentLab.exposure.value = this.exposure();
    this.bentLab.update(this.engine.camera);
  }

  private updateCamera(): void {
    const camera = this.engine.camera;
    const pitch = (Math.max(-89.5, Math.min(89.5, this.pitch())) * Math.PI) / 180;
    const yaw = (this.yaw() * Math.PI) / 180;
    this.forward.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
    camera.position.set(0, 0, 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.forward);
    camera.updateMatrixWorld();
  }

  onPointerMove(event: PointerEvent): void {
    if (!(event.buttons & 1)) return;
    this.yaw.update((y) => ((((y - event.movementX * 0.2 + 180) % 360) + 360) % 360) - 180);
    this.pitch.update((p) => Math.max(-90, Math.min(90, p - event.movementY * 0.2)));
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.altitudeM = Math.min(30 * this.radiusM, Math.max(1, this.altitudeM * Math.exp(event.deltaY * 0.0015)));
    this.backdrop.setAltitude(this.altitudeM);
    this.syncAltitudeSlider();
  }

  num(event: Event): number {
    return Number((event.target as HTMLInputElement).value);
  }

  switchBackend(backend: 'webgpu' | 'webgl2'): void {
    const url = new URL(globalThis.location.href);
    url.searchParams.set('backend', backend);
    globalThis.location.href = url.toString();
  }
}
