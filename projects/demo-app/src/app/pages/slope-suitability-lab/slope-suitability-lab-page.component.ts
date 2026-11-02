import { Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BufferAttribute, Mesh, SphereGeometry, Vector3 } from 'three';
import { EngineModule, EngineService, OrbitControlsComponent } from 'triangular-engine';
import {
  PlanetSurfaceMaterial,
  SURFACE_LAYER_ORDER,
  slopeSuitabilityLayer,
} from 'triangular-engine/planet-material';

const PLANET_RADIUS_M = 1_000;
const CAMERA_POSITION: [number, number, number] = [0, 350, 2_850];

/** Interactive engine demo of the reusable grade overlay on a rough terrain planet. */
@Component({
  standalone: true,
  selector: 'app-slope-suitability-lab-page',
  imports: [EngineModule, RouterLink, OrbitControlsComponent],
  providers: EngineService.provide({
    showFPS: true,
    preferredRenderer: 'webgpu',
    webGpuRendererParameters: { antialias: true },
  }),
  host: { class: 'flex-page' },
  template: `
    <scene [showFps]="true">
      <orbitControls [cameraPosition]="cameraPosition" [target]="[0, 0, 0]" [near]="0.1" [far]="10000" />
      <ambientLight [intensity]="0.8" />
      <directionalLight [position]="[1800, 2200, 1500]" [intensity]="2" />
    </scene>
    <ng-template portalTarget="overlay" lane="topStart" [order]="10">
      <section class="panel">
        <a routerLink="/">← Examples</a>
        <h2>Terrain slope suitability</h2>
        <p>Green is below the selected vehicle limit; red is too steep. Rotate and zoom the planet.</p>
        <label class="toggle">
          <input type="checkbox" [checked]="enabled()" (change)="setEnabled($event)" />
          Show grade overlay
        </label>
        <label class="slider">
          <span>Maximum slope <b>{{ maxSlopeDegrees() }}°</b></span>
          <input
            type="range"
            min="5"
            max="45"
            step="1"
            [value]="maxSlopeDegrees()"
            (input)="setMaxSlope($event)"
          />
        </label>
        <p class="note">Changing the vehicle limit updates a shader uniform. This visualization does not affect routing or physics.</p>
      </section>
    </ng-template>
  `,
  styles: `
    .panel {
      width: min(21rem, calc(100vw - 2rem));
      padding: 0.9rem 1rem;
      border: 1px solid #385267;
      border-radius: 0.65rem;
      background: rgb(7 17 29 / 92%);
      color: #e7edf3;
      font: 14px/1.4 Inter, system-ui, sans-serif;
    }
    a { color: #8dc8ff; }
    h2 { margin: 0.5rem 0 0.25rem; font-size: 1.05rem; }
    p { margin: 0.35rem 0 0.7rem; }
    .toggle, .slider { display: grid; gap: 0.35rem; margin-top: 0.7rem; }
    .toggle { grid-template-columns: auto 1fr; align-items: center; }
    .slider span { display: flex; justify-content: space-between; }
    input[type='range'] { width: 100%; }
    .note { margin-bottom: 0; color: #a8bac8; font-size: 12px; }
  `,
})
export class SlopeSuitabilityLabPageComponent {
  private readonly engine = inject(EngineService);
  readonly cameraPosition = CAMERA_POSITION;
  readonly enabled = signal(true);
  readonly maxSlopeDegrees = signal(18);

  private readonly grade = slopeSuitabilityLayer({
    enabled: true,
    maxSlopeDegrees: this.maxSlopeDegrees(),
    transitionDegrees: 4,
    opacity: 0.9,
  });
  private readonly surface = new PlanetSurfaceMaterial();
  private readonly globe = new Mesh(this.buildTerrain(), this.surface);

  constructor() {
    this.surface.addSurfaceLayer({
      id: 'slopeSuitability',
      order: SURFACE_LAYER_ORDER.game,
      layer: this.grade.layer,
    });
    this.engine.scene.add(this.globe);
    inject(DestroyRef).onDestroy(() => {
      this.engine.scene.remove(this.globe);
      this.globe.geometry.dispose();
      this.surface.dispose();
      this.engine.onComponentDestroy();
    });
  }

  setEnabled(event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    this.enabled.set(enabled);
    this.grade.enabled.value = enabled ? 1 : 0;
  }

  setMaxSlope(event: Event): void {
    const degrees = Math.max(5, Math.min(45, Number((event.target as HTMLInputElement).value)));
    this.maxSlopeDegrees.set(degrees);
    this.grade.maxSlopeDegrees.value = degrees;
  }

  /** Builds a modest deterministic rolling surface so the grade layer has meaningful slopes to display. */
  private buildTerrain(): SphereGeometry {
    const geometry = new SphereGeometry(PLANET_RADIUS_M, 160, 96);
    const position = geometry.getAttribute('position');
    const color = new Float32Array(position.count * 3);
    const direction = new Vector3();
    for (let i = 0; i < position.count; i++) {
      direction.fromBufferAttribute(position, i).normalize();
      const broad = Math.sin(direction.x * 8 + direction.z * 3) * Math.cos(direction.y * 7 - direction.z * 2);
      const ridges = Math.sin(direction.x * 21 + direction.y * 13) * Math.cos(direction.z * 19);
      const elevationM = 62 * broad + 14 * ridges;
      direction.multiplyScalar(PLANET_RADIUS_M + elevationM);
      position.setXYZ(i, direction.x, direction.y, direction.z);

      const temperate = Math.max(0, 1 - Math.abs(direction.y / PLANET_RADIUS_M));
      color[i * 3] = 0.22 + 0.12 * temperate;
      color[i * 3 + 1] = 0.3 + 0.2 * temperate;
      color[i * 3 + 2] = 0.18 + 0.05 * temperate;
    }
    geometry.computeVertexNormals();
    const normal = geometry.getAttribute('normal');
    geometry.setAttribute('aFlatPos', new BufferAttribute(new Float32Array(position.array), 3));
    geometry.setAttribute('aFlatNorm', new BufferAttribute(new Float32Array(normal.array), 3));
    geometry.setAttribute('color', new BufferAttribute(color, 3));
    return geometry;
  }
}
