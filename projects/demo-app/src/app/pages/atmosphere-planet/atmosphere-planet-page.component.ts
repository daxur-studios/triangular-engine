import { Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BufferAttribute, Color, Mesh, SphereGeometry, Vector3 } from 'three';
import { EngineModule, EngineService, RaycastOrbitControlsComponent } from 'triangular-engine';
import { PlanetAtmosphereComponent, type PlanetAtmospherePresetId, type PlanetSkyBody } from 'triangular-engine/atmosphere';
import { PlanetSurfaceMaterial } from 'triangular-engine/planet-material';

/**
 * Plan 049 Phase 2b: the atmosphere on a `PlanetSurfaceMaterial` globe (the morph stays at 0), wired with
 * `<planetAtmosphere>` (Phase 4a).
 *
 * - Stage 4 (`[lighting]`): the surface is relit from the atmosphere, so dusk is orange on the ground too.
 * - Stage 6 (`[haze]`): aerial perspective from the camera to each surface point.
 * - The sky and the limb glow (`[sky]`) are drawn behind the globe, with stars (`[stars]`) and a moon (Phase 5) in it.
 *
 * The globe is a unit sphere; its size in metres is the atmosphere profile's radius, so the size buttons only rescale
 * the air. Drag to orbit, wheel to zoom: the view buttons move the camera to an altitude. `?backend=webgl2` runs the
 * WebGL2 fallback.
 */
const query = new URLSearchParams(globalThis.location?.search ?? '');
const BACKEND: 'webgpu' | 'webgl2' = query.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu';
const RADIUS_UNITS = 1;

interface SizeChoice {
  readonly label: string;
  readonly radiusM: number;
}

const SIZES: readonly SizeChoice[] = [
  { label: '64 km', radiusM: 64_000 },
  { label: '600 km', radiusM: 600_000 },
  { label: 'Earth', radiusM: 6_371_000 },
];

interface ViewChoice {
  readonly label: string;
  /** Camera distance from the centre in planet radii. */
  readonly distance: number;
  /** Camera latitude, degrees. */
  readonly latitude: number;
  /** Look along the ground towards the horizon instead of down at the planet. */
  readonly horizon?: boolean;
}

const VIEWS: readonly ViewChoice[] = [
  { label: 'Space', distance: 3.2, latitude: 10 },
  { label: 'Low orbit', distance: 1.08, latitude: 10 },
  { label: 'High above ground', distance: 1.004, latitude: 10 },
  { label: 'Horizon (on the ground)', distance: 1.0002, latitude: 10, horizon: true },
];

@Component({
  standalone: true,
  selector: 'app-atmosphere-planet-page',
  imports: [EngineModule, RouterLink, RaycastOrbitControlsComponent, PlanetAtmosphereComponent],
  providers: EngineService.provide({
    showFPS: true,
    preferredRenderer: 'webgpu',
    webGpuRendererParameters: { forceWebGL: BACKEND === 'webgl2', antialias: false },
  }),
  host: { class: 'flex-page' },
  template: `
    <scene>
      <raycastOrbitControls [cameraPosition]="[0, 0.6, 3.2]" [target]="[0, 0, 0]" [near]="0.00005" [far]="100" />
      <planetAtmosphere
        [preset]="presetId()"
        [radius]="radiusM()"
        [radiusUnits]="radiusUnits"
        [planet]="globe"
        [surfaces]="surfaces"
        [lighting]="lightingOn()"
        [haze]="perspectiveOn()"
        [sky]="skyOn()"
        [stars]="stars()"
        [sunDirection]="sunDirection()"
        [exposure]="exposure()"
      />
    </scene>
    <aside class="panel">
      <a routerLink="/">← Examples</a>
      <h2>Atmosphere on the planet material</h2>
      <p class="row">
        <button (click)="switchBackend('webgpu')" [disabled]="backend === 'webgpu'">WebGPU</button>
        <button (click)="switchBackend('webgl2')" [disabled]="backend === 'webgl2'">forceWebGL</button>
      </p>
      <p class="label">Planet size</p>
      <p class="row">
        @for (size of sizes; track size.label) {
          <button (click)="setSize(size)" [class.active]="sizeLabel() === size.label">{{ size.label }}</button>
        }
        <button (click)="setPreset('earth')" [class.active]="presetId() === 'earth'">Earth air</button>
        <button (click)="setPreset('mars')" [class.active]="presetId() === 'mars'">Mars air</button>
      </p>
      <p class="label">Camera</p>
      <p class="row">
        @for (view of views; track view.label) {
          <button (click)="applyView(view)">{{ view.label }}</button>
        }
      </p>
      <p class="note">altitude {{ altitudeLabel() }}</p>
      <p class="row">
        <label><input type="checkbox" [checked]="lightingOn()" (change)="setLighting($event)" /> atmosphere lighting</label>
        <label><input type="checkbox" [checked]="perspectiveOn()" (change)="setPerspective($event)" /> aerial perspective</label>
        <label><input type="checkbox" [checked]="skyOn()" (change)="setSky($event)" /> sky and limb</label>
      </p>
      <label
        >sun longitude {{ sunLongitude() }}°
        <input type="range" min="-180" max="180" step="1" [value]="sunLongitude()" (input)="setSunLongitude($event)" />
      </label>
      <label
        >sun latitude {{ sunLatitude() }}°
        <input type="range" min="-90" max="90" step="1" [value]="sunLatitude()" (input)="setSunLatitude($event)" />
      </label>
      <label
        >stars {{ stars() }}
        <input type="range" min="0" max="3" step="0.1" [value]="stars()" (input)="setStars($event)" />
      </label>
      <p class="row">
        <label><input type="checkbox" [checked]="moonOn()" (change)="setMoon($event)" /> moon</label>
      </p>
      <label
        >moon longitude {{ moonLongitude() }}°
        <input type="range" min="-180" max="180" step="1" [value]="moonLongitude()" (input)="setMoonLongitude($event)" />
      </label>
      <label
        >exposure {{ exposure() }}
        <input type="range" min="1" max="60" step="0.5" [value]="exposure()" (input)="setExposure($event)" />
      </label>
      <p class="note">{{ backend }} · bake {{ bakeMs() }} ms · stack {{ stackKey() }}</p>
    </aside>
  `,
  styles: `
    .panel {
      position: absolute;
      left: 1rem;
      bottom: 1rem;
      width: min(26rem, calc(100vw - 2rem));
      padding: 0.75rem 1rem;
      border: 1px solid #294253;
      border-radius: 0.75rem;
      background: rgba(5, 13, 21, 0.92);
      color: #e6edf3;
      font: 14px/1.35 Inter, system-ui, sans-serif;
      box-shadow: 0 1rem 3rem #0008;
    }
    .panel a {
      color: #7cc4ff;
    }
    .panel h2 {
      margin: 0.25rem 0 0.5rem;
      font-size: 1.1rem;
    }
    .panel label {
      display: block;
    }
    .panel input[type='range'] {
      width: 100%;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem 1rem;
      margin: 0.4rem 0;
    }
    .row label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .label,
    .note {
      margin: 0.4rem 0 0;
      opacity: 0.7;
    }
    button {
      padding: 0.25rem 0.75rem;
      border: 1px solid #3b5a70;
      border-radius: 0.4rem;
      background: #17303f;
      color: #e6edf3;
      cursor: pointer;
    }
    button:disabled,
    button.active {
      background: #2b7fb8;
      border-color: #2b7fb8;
    }
  `,
})
export class AtmospherePlanetPageComponent {
  private readonly engine = inject(EngineService);

  readonly backend = BACKEND;
  readonly sizes = SIZES;
  readonly views = VIEWS;
  readonly radiusUnits = RADIUS_UNITS;
  private readonly orbit = viewChild(RaycastOrbitControlsComponent);
  private readonly atmosphere = viewChild(PlanetAtmosphereComponent);

  readonly sizeLabel = signal('64 km');
  readonly radiusM = signal(64_000);
  readonly presetId = signal<PlanetAtmospherePresetId>('earth');
  readonly bakeMs = signal(0);
  readonly lightingOn = signal(true);
  readonly perspectiveOn = signal(true);
  readonly skyOn = signal(true);
  readonly sunLongitude = signal(40);
  readonly sunLatitude = signal(15);
  readonly exposure = signal(8);
  readonly stars = signal(1);
  readonly moonOn = signal(true);
  readonly moonLongitude = signal(-120);
  readonly stackKey = signal('');
  readonly altitudeLabel = signal('');

  readonly sunDirection = computed<[number, number, number]>(() => {
    const lon = (this.sunLongitude() * Math.PI) / 180;
    const lat = (this.sunLatitude() * Math.PI) / 180;
    return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
  });

  private moon?: PlanetSkyBody;
  private readonly material = new PlanetSurfaceMaterial();
  readonly globe = new Mesh(this.buildGlobe(), this.material);
  readonly surfaces = [this.material];

  constructor() {
    this.engine.scene.add(this.globe);
    const tick = this.engine.tick$.subscribe(() => this.onTick());
    inject(DestroyRef).onDestroy(() => {
      tick.unsubscribe();
      this.engine.scene.remove(this.globe);
      this.material.dispose();
      this.globe.geometry.dispose();
    });
  }

  private onTick(): void {
    const atmosphere = this.atmosphere()?.atmosphere();
    if (!atmosphere) return;
    // A moon three times the real one's size, so it reads at the demo's field of view, 10 degrees off the equator.
    this.moon ??= atmosphere.addSkyBody({ angularRadiusDeg: 0.8, albedo: new Color(0.3, 0.3, 0.3) });
    const lon = (this.moonLongitude() * Math.PI) / 180;
    const lat = (10 * Math.PI) / 180;
    this.moon.direction.set(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
    this.moon.body.mesh.visible = this.moonOn();
    const m = atmosphere.binding.cameraAltitude.value;
    this.altitudeLabel.set(m < 1000 ? `${m.toFixed(0)} m` : `${(m / 1000).toFixed(m < 1e5 ? 1 : 0)} km`);
    this.bakeMs.set(Math.round(atmosphere.lastBakeMs));
    this.stackKey.set(this.material.stackKey);
  }

  setSize(size: SizeChoice): void {
    this.radiusM.set(size.radiusM);
    this.sizeLabel.set(size.label);
  }

  setPreset(id: PlanetAtmospherePresetId): void {
    this.presetId.set(id);
  }

  applyView(view: ViewChoice): void {
    const lat = (view.latitude * Math.PI) / 180;
    const up = new Vector3(0, Math.sin(lat), Math.cos(lat));
    const position = up.clone().multiplyScalar(view.distance * RADIUS_UNITS);
    this.engine.camera.position.copy(position);
    // The orbit target is the point it looks at: the planet's centre, or a spot on the ground ahead for the horizon.
    const target = this.orbit()?.orbitControls()?.target;
    if (!target) return;
    if (view.horizon) {
      const east = new Vector3(1, 0, 0);
      target.copy(position).addScaledVector(east, 0.02 * RADIUS_UNITS).addScaledVector(up, 0.0001 * RADIUS_UNITS);
    } else {
      target.set(0, 0, 0);
    }
  }

  setLighting(event: Event): void {
    this.lightingOn.set((event.target as HTMLInputElement).checked);
  }

  setPerspective(event: Event): void {
    this.perspectiveOn.set((event.target as HTMLInputElement).checked);
  }

  setSky(event: Event): void {
    this.skyOn.set((event.target as HTMLInputElement).checked);
  }

  setSunLongitude(event: Event): void {
    this.sunLongitude.set(Number((event.target as HTMLInputElement).value));
  }

  setSunLatitude(event: Event): void {
    this.sunLatitude.set(Number((event.target as HTMLInputElement).value));
  }

  setStars(event: Event): void {
    this.stars.set(Number((event.target as HTMLInputElement).value));
  }

  setMoon(event: Event): void {
    this.moonOn.set((event.target as HTMLInputElement).checked);
  }

  setMoonLongitude(event: Event): void {
    this.moonLongitude.set(Number((event.target as HTMLInputElement).value));
  }

  setExposure(event: Event): void {
    this.exposure.set(Number((event.target as HTMLInputElement).value));
  }

  switchBackend(backend: 'webgpu' | 'webgl2'): void {
    const url = new URL(globalThis.location.href);
    url.searchParams.set('backend', backend);
    globalThis.location.href = url.toString();
  }

  /** A sphere with the attributes the material reads (the flat map equals the sphere) and a latitude colour. */
  private buildGlobe(): SphereGeometry {
    const geometry = new SphereGeometry(RADIUS_UNITS, 128, 64);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    geometry.setAttribute('aFlatPos', new BufferAttribute(new Float32Array(position.array), 3));
    geometry.setAttribute('aFlatNorm', new BufferAttribute(new Float32Array(normal.array), 3));
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const lat = Math.abs(position.getY(i)) / RADIUS_UNITS;
      const ice = Math.max(0, (lat - 0.8) / 0.2);
      colors[i * 3] = 0.2 + 0.5 * ice + 0.15 * (1 - lat);
      colors[i * 3 + 1] = 0.3 + 0.4 * ice;
      colors[i * 3 + 2] = 0.15 + 0.5 * ice;
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    return geometry;
  }
}
