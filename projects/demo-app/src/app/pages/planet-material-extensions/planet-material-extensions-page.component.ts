import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BufferAttribute, Mesh, SphereGeometry, Vector3 } from 'three';
import { EngineModule, EngineService, RaycastOrbitControlsComponent } from 'triangular-engine';
import {
  createPlanetDayNightUniforms,
  moonEclipseOcclusion,
  nightLightsEmissive,
  PlanetSurfaceMaterial,
  roadLayer,
  simpleDayNightLighting,
  SURFACE_LAYER_ORDER,
} from 'triangular-engine/planet-material';

/**
 * Plan 050 Phase 4: the reference demo for `PlanetSurfaceMaterial`'s extension slots, on a plain sphere.
 *
 * - a game surface layer: a road along a great circle (`roadLayer`, order `SURFACE_LAYER_ORDER.game`);
 * - a sun occluder: a moon eclipse (`moonEclipseOcclusion`), whose shadow follows the moon slider;
 * - the emissive stack: city lights on the night side (`nightLightsEmissive`);
 * - the replaceable lighting stage: `simpleDayNightLighting`, fed the occluder product.
 *
 * Each toggle adds or removes a slot entry, which recompiles (the stack key changes); the sliders only write
 * uniforms. `?backend=webgl2` runs the same renderer on its WebGL2 fallback.
 */
const query = new URLSearchParams(globalThis.location?.search ?? '');
const BACKEND: 'webgpu' | 'webgl2' = query.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu';
const RADIUS = 1;
const MOON_DISTANCE = 3;

@Component({
  standalone: true,
  selector: 'app-planet-material-extensions-page',
  imports: [EngineModule, RouterLink, RaycastOrbitControlsComponent],
  providers: EngineService.provide({
    showFPS: true,
    preferredRenderer: 'webgpu',
    webGpuRendererParameters: { forceWebGL: BACKEND === 'webgl2', antialias: true },
  }),
  host: { class: 'flex-page' },
  template: `
    <scene>
      <raycastOrbitControls [cameraPosition]="[0, 0.6, 3.2]" [target]="[0, 0, 0]" [near]="0.01" [far]="100" />
      <ambientLight [intensity]="0.4" />
    </scene>
    <aside class="panel">
      <a routerLink="/">← Examples</a>
      <h2>Planet material extensions</h2>
      <p class="row">
        <button (click)="switchBackend('webgpu')" [disabled]="backend === 'webgpu'">WebGPU</button>
        <button (click)="switchBackend('webgl2')" [disabled]="backend === 'webgl2'">forceWebGL</button>
      </p>
      <p class="row">
        <label><input type="checkbox" [checked]="roadOn()" (change)="setRoad($event)" /> road layer</label>
        <label><input type="checkbox" [checked]="eclipseOn()" (change)="setEclipse($event)" /> moon eclipse</label>
        <label><input type="checkbox" [checked]="lightsOn()" (change)="setLights($event)" /> city lights</label>
      </p>
      <p class="row">
        <label>
          sun {{ sunDegrees() }}°
          <input type="range" min="0" max="360" step="1" [value]="sunDegrees()" (input)="setSun($event)" />
        </label>
      </p>
      <p class="row">
        <label>
          moon {{ moonDegrees() }}°
          <input type="range" min="-60" max="60" step="0.5" [value]="moonDegrees()" (input)="setMoon($event)" />
        </label>
      </p>
      <p class="row">stack: {{ stackKey() }}</p>
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
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1rem;
      margin: 0.4rem 0;
    }
    .row {
      overflow-wrap: anywhere;
    }
    .row label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    button {
      padding: 0.25rem 0.75rem;
      border: 1px solid #3b5a70;
      border-radius: 0.4rem;
      background: #17303f;
      color: #e6edf3;
      cursor: pointer;
    }
    button:disabled {
      background: #2b7fb8;
      border-color: #2b7fb8;
      cursor: default;
    }
  `,
})
export class PlanetMaterialExtensionsPageComponent {
  private readonly engine = inject(EngineService);

  readonly backend = BACKEND;
  readonly roadOn = signal(true);
  readonly eclipseOn = signal(true);
  readonly lightsOn = signal(true);
  /** Sun longitude, degrees round +Y (0 = +Z, the camera side). */
  readonly sunDegrees = signal(0);
  /** The moon's offset from the sun axis, degrees round +Y: 0 puts it right between the sun and the planet's +Z side. */
  readonly moonDegrees = signal(0);
  readonly stackKey = signal('');

  private readonly dayNight = createPlanetDayNightUniforms();
  private readonly road = roadLayer({ axis: new Vector3(0, 1, 0), halfWidth: 0.02, color: '#f2c14e' });
  private readonly eclipse = moonEclipseOcclusion({ planetRadius: RADIUS, moonRadius: 0.27 });
  private readonly lights = nightLightsEmissive({ strength: 0.8 });
  private readonly material = new PlanetSurfaceMaterial({
    lighting: { id: 'dayNight', stage: simpleDayNightLighting(this.dayNight) },
  });
  private readonly moon = new Mesh(new SphereGeometry(0.27, 32, 16), new PlanetSurfaceMaterial());

  constructor() {
    this.dayNight.uDayNightEnabled.value = 1;
    this.material.addSurfaceLayer({ id: 'roads', order: SURFACE_LAYER_ORDER.game, layer: this.road.layer });
    this.material.addSunOcclusion({ id: 'moon', occlusion: this.eclipse.occlusion });
    this.material.addEmissive({ id: 'cityLights', emissive: this.lights.emissive });

    this.engine.scene.add(new Mesh(this.buildGlobe(), this.material), this.moon);
    this.applyAngles();
    this.stackKey.set(this.material.stackKey);
  }

  switchBackend(backend: 'webgpu' | 'webgl2'): void {
    const url = new URL(globalThis.location.href);
    url.searchParams.set('backend', backend);
    globalThis.location.href = url.toString();
  }

  setRoad(event: Event): void {
    this.toggle(this.roadOn, event, () => this.material.addSurfaceLayer({ id: 'roads', order: SURFACE_LAYER_ORDER.game, layer: this.road.layer }), () =>
      this.material.removeSurfaceLayer('roads'),
    );
  }

  setEclipse(event: Event): void {
    this.toggle(this.eclipseOn, event, () => this.material.addSunOcclusion({ id: 'moon', occlusion: this.eclipse.occlusion }), () =>
      this.material.removeSunOcclusion('moon'),
    );
    this.moon.visible = this.eclipseOn();
  }

  setLights(event: Event): void {
    this.toggle(this.lightsOn, event, () => this.material.addEmissive({ id: 'cityLights', emissive: this.lights.emissive }), () =>
      this.material.removeEmissive('cityLights'),
    );
  }

  setSun(event: Event): void {
    this.sunDegrees.set(Number((event.target as HTMLInputElement).value));
    this.applyAngles();
  }

  setMoon(event: Event): void {
    this.moonDegrees.set(Number((event.target as HTMLInputElement).value));
    this.applyAngles();
  }

  private toggle(flag: ReturnType<typeof signal<boolean>>, event: Event, add: () => void, remove: () => void): void {
    const on = (event.target as HTMLInputElement).checked;
    flag.set(on);
    if (on) add();
    else remove();
    this.stackKey.set(this.material.stackKey);
  }

  /** The sun and moon both live in the body frame. The moon sits on the sun side, `moonDegrees` round Y from the sun axis. */
  private applyAngles(): void {
    const sun = (this.sunDegrees() * Math.PI) / 180;
    const sunDirection = new Vector3(Math.sin(sun), 0, Math.cos(sun));
    this.dayNight.uSunDirection.value.copy(sunDirection);
    this.eclipse.sunDirection.value.copy(sunDirection);
    this.lights.sunDirection.value.copy(sunDirection);

    const moon = sun + (this.moonDegrees() * Math.PI) / 180;
    const moonPosition = new Vector3(Math.sin(moon), 0.05, Math.cos(moon)).multiplyScalar(MOON_DISTANCE);
    this.eclipse.moonPosition.value.copy(moonPosition);
    this.moon.position.copy(moonPosition);
  }

  /** A sphere with the attributes the material reads: the flat map equals the sphere (the morph stays at 0) and a latitude colour. */
  private buildGlobe(): SphereGeometry {
    const geometry = new SphereGeometry(RADIUS, 128, 64);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    geometry.setAttribute('aFlatPos', new BufferAttribute(new Float32Array(position.array), 3));
    geometry.setAttribute('aFlatNorm', new BufferAttribute(new Float32Array(normal.array), 3));
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const lat = Math.abs(position.getY(i)) / RADIUS;
      // Ice at the poles, green in the temperate band, sand near the equator.
      const ice = Math.max(0, (lat - 0.8) / 0.2);
      colors[i * 3] = 0.25 + 0.5 * ice + 0.25 * (1 - lat);
      colors[i * 3 + 1] = 0.4 + 0.4 * ice;
      colors[i * 3 + 2] = 0.2 + 0.6 * ice;
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    return geometry;
  }
}
