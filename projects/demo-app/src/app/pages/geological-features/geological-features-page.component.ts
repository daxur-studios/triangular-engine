import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  defaultGeologicalTerrainSettings,
  sampleGeologicalElevation,
  type CanyonSettings,
  type GeologicalFeatureKind,
  type GeologicalTerrainDomain,
  type GeologicalTerrainSettings,
  type VolcanoSettings,
} from './geological-feature-terrain';

interface FeatureCatalogueItem {
  readonly kind: string;
  readonly name: string;
  readonly status: 'interactive' | 'planned';
  readonly description: string;
}

const WORLD_SIZE = 220;
const SEGMENTS = 150;
const SPHERE_RADIUS = 260;
const CYLINDER_RADIUS = 180;
const CYLINDER_LENGTH = 420;

@Component({
  selector: 'app-geological-features-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './geological-features-page.component.html',
  styleUrl: './geological-features-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class GeologicalFeaturesPageComponent {
  readonly activeFeature = signal<GeologicalFeatureKind>('volcano');
  readonly domain = signal<GeologicalTerrainDomain>('plane');
  readonly sphereVolcanoCount = signal(4);
  readonly settings = signal(defaultGeologicalTerrainSettings());
  readonly wireframe = signal(false);
  readonly catalogue: readonly FeatureCatalogueItem[] = [
    { kind: 'volcano', name: 'Volcano', status: 'interactive', description: 'Asymmetric cone, crater rim, caldera, and radial erosion.' },
    { kind: 'canyon', name: 'Canyon', status: 'interactive', description: 'Meandering channel with adjustable depth, width, and wall profile.' },
    { kind: 'crater', name: 'Impact crater', status: 'planned', description: 'Bowl, raised rim, ejecta blanket, and age-driven erosion.' },
    { kind: 'ridge', name: 'Mountain ridge', status: 'planned', description: 'Spline-authored ridges with width, sharpness, and branching.' },
    { kind: 'mesa', name: 'Mesa / butte', status: 'planned', description: 'Flat cap, steep walls, and talus around an authored footprint.' },
    { kind: 'fault', name: 'Fault scarp / rift', status: 'planned', description: 'Displaced terrain along a line with fractured edge detail.' },
    { kind: 'dunes', name: 'Dune field', status: 'planned', description: 'Directional repeating landforms with seeded variation.' },
  ];

  private readonly engine = inject(EngineService);
  private geometry: BufferGeometry = new PlaneGeometry(
    WORLD_SIZE,
    WORLD_SIZE,
    SEGMENTS,
    SEGMENTS,
  );
  private readonly material = new MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.92,
    vertexColors: true,
    side: 2,
  });
  private readonly terrain = new Mesh(this.geometry, this.material);

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#071018');
    this.terrain.rotation.x = -Math.PI / 2;
    this.terrain.receiveShadow = true;
    this.engine.scene.add(this.terrain);
    this.rebuildTerrain();

    destroyRef.onDestroy(() => {
      this.terrain.removeFromParent();
      this.geometry.dispose();
      this.material.dispose();
      this.engine.scene.background = previousBackground;
    });
  }

  selectFeature(kind: GeologicalFeatureKind): void {
    this.activeFeature.set(kind);
    this.rebuildTerrain();
  }

  selectDomain(domain: GeologicalTerrainDomain): void {
    this.domain.set(domain);
    this.replaceGeometry();
    this.rebuildTerrain();
  }

  setSphereVolcanoCount(event: Event): void {
    this.sphereVolcanoCount.set(Number((event.target as HTMLInputElement).value));
    this.rebuildTerrain();
  }

  updateVolcano(key: keyof VolcanoSettings, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.settings.update((current) => ({
      ...current,
      volcano: { ...current.volcano, [key]: value },
    }));
    this.rebuildTerrain();
  }

  updateCanyon(key: keyof CanyonSettings, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.settings.update((current) => ({
      ...current,
      canyon: { ...current.canyon, [key]: value },
    }));
    this.rebuildTerrain();
  }

  toggleWireframe(): void {
    this.wireframe.update((value) => !value);
    this.material.wireframe = this.wireframe();
    this.material.needsUpdate = true;
  }

  randomizeSeed(): void {
    const seed = Math.floor(Math.random() * 999);
    const feature = this.activeFeature();
    this.settings.update((current) => ({
      ...current,
      [feature]: {
        ...current[feature],
        seed,
        ...(feature === 'volcano'
          ? { ridgeCount: 5 + Math.floor(Math.random() * 8) }
          : {}),
      },
    } as GeologicalTerrainSettings));
    this.rebuildTerrain();
  }

  reset(): void {
    this.settings.set(defaultGeologicalTerrainSettings());
    this.rebuildTerrain();
  }

  private replaceGeometry(): void {
    const previous = this.geometry;
    this.geometry =
      this.domain() === 'plane'
        ? new PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS)
        : this.domain() === 'sphere'
          ? new SphereGeometry(SPHERE_RADIUS, 128, 72)
          : new CylinderGeometry(
              CYLINDER_RADIUS,
              CYLINDER_RADIUS,
              CYLINDER_LENGTH,
              128,
              64,
              true,
            );
    this.terrain.geometry = this.geometry;
    this.terrain.rotation.set(this.domain() === 'plane' ? -Math.PI / 2 : 0, 0, 0);
    previous.dispose();
  }

  private rebuildTerrain(): void {
    const position = this.geometry.getAttribute('position') as BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    const low = new Color('#243f48');
    const earth = new Color('#79664f');
    const high = new Color('#c0a071');
    const ash = new Color('#4b4642');
    const color = new Color();
    const kind = this.activeFeature();
    const settings = this.settings();

    for (let index = 0; index < position.count; index++) {
      const originalX = position.getX(index);
      const originalY = position.getY(index);
      const originalZ = position.getZ(index);
      const sample = this.sampleSurfaceElevation(
        kind,
        originalX,
        originalY,
        originalZ,
        settings,
      );
      const x = sample.sampleX;
      const z = sample.sampleZ;
      const elevation = sample.elevation;
      position.setXYZ(
        index,
        sample.renderX,
        sample.renderY,
        sample.renderZ,
      );
      const normalized = Math.max(0, Math.min(1, (elevation + 36) / 90));
      color.copy(low).lerp(earth, Math.min(1, normalized * 1.8));
      if (normalized > 0.56) color.lerp(high, (normalized - 0.56) / 0.44);
      if (kind === 'volcano' && Math.hypot(x, z) < settings.volcano.craterRadius * 1.15) {
        color.lerp(ash, 0.7);
      }
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }

    position.needsUpdate = true;
    this.geometry.setAttribute('color', new BufferAttribute(colors, 3));
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
    this.engine.requestSingleRender();
  }

  private sampleSurfaceElevation(
    kind: GeologicalFeatureKind,
    x: number,
    y: number,
    z: number,
    settings: GeologicalTerrainSettings,
  ): {
    readonly elevation: number;
    readonly sampleX: number;
    readonly sampleZ: number;
    readonly renderX: number;
    readonly renderY: number;
    readonly renderZ: number;
  } {
    if (this.domain() === 'plane') {
      const elevation = sampleGeologicalElevation(kind, x, -y, settings);
      return {
        elevation,
        sampleX: x,
        sampleZ: -y,
        renderX: x,
        renderY: y,
        renderZ: elevation,
      };
    }

    if (this.domain() === 'cylinder') {
      const angle = Math.atan2(z, x);
      const surfaceX = y;
      const surfaceZ = angle * CYLINDER_RADIUS;
      const elevation = sampleGeologicalElevation(kind, surfaceX, surfaceZ, settings);
      const radius = CYLINDER_RADIUS + elevation * 0.7;
      return {
        elevation,
        sampleX: surfaceX,
        sampleZ: surfaceZ,
        renderX: Math.cos(angle) * radius,
        renderY: y,
        renderZ: Math.sin(angle) * radius,
      };
    }

    const length = Math.hypot(x, y, z) || SPHERE_RADIUS;
    const latitude = Math.asin(y / length);
    const longitude = Math.atan2(z, x);
    const featureCount = kind === 'volcano' ? this.sphereVolcanoCount() : 1;
    let elevation = 0;
    for (let feature = 0; feature < featureCount; feature++) {
      const featureLatitude = -0.42 + feature * 0.28;
      const featureLongitude = -2.3 + feature * 1.37;
      const dx = (longitude - featureLongitude) * SPHERE_RADIUS * Math.cos(featureLatitude);
      const dz = (latitude - featureLatitude) * SPHERE_RADIUS;
      elevation = Math.max(
        elevation,
        sampleGeologicalElevation(kind, dx, dz, settings),
      );
    }
    const radius = SPHERE_RADIUS + elevation * 0.7;
    return {
      elevation,
      sampleX: longitude * SPHERE_RADIUS,
      sampleZ: latitude * SPHERE_RADIUS,
      renderX: (x / length) * radius,
      renderY: (y / length) * radius,
      renderZ: (z / length) * radius,
    };
  }
}
