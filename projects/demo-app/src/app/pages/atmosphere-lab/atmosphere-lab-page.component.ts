import { Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PerspectiveCamera, Vector3 } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  AtmosphereBackdrop,
  AtmosphereGpuModel,
  createAtmospherePreset,
  sunDirectionFromAngles,
  type AtmospherePresetId,
  type PhysicalAtmosphereProfile,
} from 'triangular-engine/atmosphere';

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

  private radiusM = 6_371_000;
  private altitudeM = 2;
  private readonly model: AtmosphereGpuModel;
  private readonly backdrop: AtmosphereBackdrop;
  private readonly forward = new Vector3();

  constructor() {
    const started = performance.now();
    this.model = new AtmosphereGpuModel(this.buildProfile());
    this.bakeMs.set(Math.round(performance.now() - started));
    this.backdrop = new AtmosphereBackdrop(this.model);
    this.engine.scene.add(this.backdrop.mesh);

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
      this.updateCamera();
    });
    this.destroyRef.onDestroy(() => {
      tick.unsubscribe();
      this.engine.scene.remove(this.backdrop.mesh);
      this.backdrop.dispose();
      this.model.dispose();
    });
  }

  private buildProfile(): PhysicalAtmosphereProfile {
    const profile = createAtmospherePreset(this.presetId(), { radiusM: this.radiusM });
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
    this.backdrop.setAltitude(this.altitudeM);
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

  toggleChecker(): void {
    this.checker.update((on) => !on);
    this.backdrop.checkerStrength.value = this.checker() ? 1 : 0;
  }

  private applySun(): void {
    const dir = sunDirectionFromAngles(this.sunElevation(), this.sunAzimuth());
    this.model.setSunDirection(dir.x, dir.y, dir.z);
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
