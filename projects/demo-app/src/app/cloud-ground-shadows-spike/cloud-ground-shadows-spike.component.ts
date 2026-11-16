import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { EngineModule, EngineService, OrbitControlsComponent } from 'triangular-engine';
import { PlanetAtmosphereComponent } from 'triangular-engine/atmosphere';
import { PlanetCloudsComponent } from 'triangular-engine/cloud-volumes';
import { PlanetComponent, PlanetTerrainComponent } from 'triangular-engine/lod-surface';
import { cellPlanetFor, createGroundSample, groundFrame, type Vec3 } from 'triangular-engine/lod-surface/core';
import { bakeInWorker } from '../pages/lod-surface-lab/lod-height-bake-client';
import { PLANET_RADIUS_M, groundUp, nearPlaneFor, planetPoseView, resolvePlanetCamera } from '../pages/planet-scene/planet-camera';
import {
  createCloudGroundShadowsSpikeScene,
  type ICloudGroundShadowsSpikeSceneHandle,
} from './core';

const DEG = Math.PI / 180;
/** The camera heights the buttons jump to, metres above the ground. */
const VIEWS = [
  { label: '300 m', altitudeM: 300, pitchDeg: -20 },
  { label: '3 km', altitudeM: 3_000, pitchDeg: -35 },
  { label: '30 km', altitudeM: 30_000, pitchDeg: -60 },
  { label: '300 km', altitudeM: 300_000, pitchDeg: -90 },
] as const;

/**
 * Spike (Plan 051): can an analytic cloud density, evaluated along the sun ray and fed to the planet lighting
 * stage's `directShadow` input, put smooth cloud shadows on the terrain at the same ground position as the clouds
 * drawn above it, with no ray march, at every zoom?
 *
 * `<planet>` with terrain, atmosphere and the cloud shell, as the planet scene page writes it. The atmosphere's own
 * lighting stage is switched off for the terrain (`[lighting]="false"`) and replaced by the same stage with a
 * `directShadow` from `core/` that reads the shell's density (`PlanetCloudShell.coverageAt`) where the sun ray crosses
 * the cloud layer. Pass: the shadow is under the cloud that casts it (put the sun low and the offset is plain), smooth
 * edges, and no change in what the shadow looks like at 300 m, 3 km, 30 km and 300 km.
 */
@Component({
  selector: 'app-cloud-ground-shadows-spike',
  imports: [EngineModule, RouterLink, PlanetComponent, PlanetTerrainComponent, PlanetAtmosphereComponent, PlanetCloudsComponent],
  templateUrl: './cloud-ground-shadows-spike.component.html',
  styleUrl: './cloud-ground-shadows-spike.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      preferredRenderer: 'webgpu',
      webGpuRendererParameters: { antialias: false, reversedDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class CloudGroundShadowsSpikeComponent implements AfterViewInit {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly terrainLayer = viewChild<PlanetTerrainComponent>('terrainBody');
  private readonly atmosphereLayer = viewChild(PlanetAtmosphereComponent);
  private readonly cloudsLayer = viewChild(PlanetCloudsComponent);
  private readonly orbitRef = viewChild(OrbitControlsComponent);

  readonly radiusM = PLANET_RADIUS_M;
  /** The standard cell planet with its relief squashed to 1 m: flat ground, so the shadow's radius-only maths is exact. */
  readonly world = { ...cellPlanetFor(PLANET_RADIUS_M), heightScaleM: 1 };
  readonly bake = bakeInWorker;
  readonly views = VIEWS;

  readonly altitudeM = signal<number>(VIEWS[1].altitudeM);
  readonly pitchDeg = signal<number>(VIEWS[1].pitchDeg);
  readonly sunElevationDeg = signal(25);
  readonly sunAzimuthDeg = signal(40);
  readonly cloudsOn = signal(true);
  readonly shadowsOn = signal(true);
  /** Cloud layer height above the ground, metres. */
  readonly cloudHeightM = signal(PLANET_RADIUS_M * 0.0015);
  /** Terrain cell size on screen, pixels: bigger is fewer triangles. */
  readonly cellPixels = signal(16);
  /** Free mouse orbit instead of the height and pitch sliders. */
  readonly orbitOn = signal(false);
  readonly orbitStart = signal<{ position: [number, number, number]; target: [number, number, number]; up: [number, number, number] } | null>(null);
  readonly installed = signal(false);
  readonly drawCalls = signal(0);
  readonly triangles = signal(0);

  /** The sun in the planet's body frame, from the elevation and azimuth over the view's ground point. */
  readonly sun = computed<readonly [number, number, number]>(() => {
    const { up, east, north } = groundFrame('sphere', planetPoseView('mid-20km').ground);
    const el = this.sunElevationDeg() * DEG;
    const az = this.sunAzimuthDeg() * DEG;
    const v = [0, 1, 2].map((k) => up[k] * Math.sin(el) + Math.cos(el) * (east[k] * Math.cos(az) + north[k] * Math.sin(az)));
    const length = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / length, v[1] / length, v[2] / length];
  });

  private readonly viewReady = signal(false);
  private shadow: ICloudGroundShadowsSpikeSceneHandle | undefined;
  private readonly groundSample = createGroundSample();
  private readonly basis = new Matrix4();
  private readonly right = new Vector3();
  private readonly cameraUp = new Vector3();
  private readonly back = new Vector3();
  private lastDiagMs = 0;

  constructor() {
    // Put the shadowed lighting stage on the terrain once the terrain material, the atmosphere and the shell all exist.
    effect(() => {
      // The planet's inputs are bound after the view queries resolve; reading the terrain's surface earlier throws.
      if (!this.viewReady()) return;
      const surface = this.terrainLayer()?.surface() as { setLightingStage?: unknown } | null | undefined;
      const atmosphere = this.atmosphereLayer()?.atmosphere();
      const shell = this.cloudsLayer()?.shell();
      if (!surface || typeof surface.setLightingStage !== 'function' || !atmosphere || !shell || this.shadow) return;
      this.shadow = createCloudGroundShadowsSpikeScene({
        atmosphere,
        shell,
        surface: surface as { setLightingStage(entry: { id: string; stage: unknown } | null): unknown },
      });
      this.installed.set(true);
    });

    // Seed the new orbit from the camera's pose in one go: the up vector re-derives the orbit's angles from the target
    // and position, so the three must be set in this order, not as separate inputs that bind in any order.
    effect(() => {
      const start = this.orbitStart();
      const orbit = this.orbitRef()?.orbitControls();
      if (!start || !orbit) return;
      orbit.target.set(...start.target);
      orbit.object.position.set(...start.position);
      orbit.setUpVector(new Vector3(...start.up));
      orbit.update();
    });

    // Read the signals before the optional `shadow`, or a first run with no shadow yet would track nothing.
    effect(() => {
      const strength = this.shadowsOn() ? 1 : 0;
      this.installed();
      this.shadow?.setStrength(strength);
    });

    const tick = this.engine.tick$.subscribe(() => {
      if (!this.viewReady()) return;
      if (!this.orbitOn()) this.placeCamera();
      const now = performance.now();
      if (now - this.lastDiagMs >= 500) {
        this.lastDiagMs = now;
        const render = this.engine.renderer.info.render as { drawCalls?: number; calls: number; triangles: number };
        this.drawCalls.set(render.drawCalls ?? render.calls);
        this.triangles.set(render.triangles);
      }
    });
    this.destroyRef.onDestroy(() => {
      tick.unsubscribe();
      this.shadow?.dispose();
    });
  }

  ngAfterViewInit(): void {
    this.viewReady.set(true);
  }

  jump(view: (typeof VIEWS)[number]): void {
    this.orbitOn.set(false);
    this.altitudeM.set(view.altitudeM);
    this.pitchDeg.set(view.pitchDeg);
  }

  /** Free orbit starts from where the camera is now, aimed at the ground point below the view; off hands back to the sliders. */
  toggleOrbit(): void {
    if (this.orbitOn()) {
      this.orbitOn.set(false);
      return;
    }
    this.placeCamera();
    const camera = this.engine.camera;
    const view = { ...planetPoseView('mid-20km'), altitudeM: this.altitudeM(), pitchRad: this.pitchDeg() * DEG };
    const up = groundUp(view);
    // Aim at the ground point the camera is looking at (the view ray meets the flat planet sphere), else straight below.
    const p = camera.position;
    const d = camera.getWorldDirection(new Vector3());
    const b = p.dot(d);
    const disc = b * b - (p.lengthSq() - this.radiusM * this.radiusM);
    const t = disc > 0 ? -b - Math.sqrt(disc) : 0;
    const target: [number, number, number] =
      t > 0 ? [p.x + d.x * t, p.y + d.y * t, p.z + d.z * t] : [up[0] * this.radiusM, up[1] * this.radiusM, up[2] * this.radiusM];
    this.orbitStart.set({ position: [p.x, p.y, p.z], target, up: [up[0], up[1], up[2]] });
    this.orbitOn.set(true);
  }

  setNumber(target: 'sunElevationDeg' | 'sunAzimuthDeg' | 'altitudeM' | 'pitchDeg' | 'cloudHeightM' | 'cellPixels', event: Event): void {
    this[target].set(Number((event.target as HTMLInputElement).value));
  }

  /** The camera stands over the same ground point at the chosen height, looking along the chosen pitch. */
  private placeCamera(): void {
    const view = { ...planetPoseView('mid-20km'), altitudeM: this.altitudeM(), pitchRad: this.pitchDeg() * DEG };
    const R = this.radiusM;
    const up = groundUp(view);
    let groundHeight = 0;
    const terrain = this.terrainLayer();
    if (terrain) {
      const sample = terrain.groundAt([up[0] * R, up[1] * R, up[2] * R] as Vec3, this.groundSample);
      if (sample) groundHeight = sample.heightM;
    }
    const camera = resolvePlanetCamera(view, R, groundHeight);
    const engineCamera = this.engine.camera;
    this.right.set(...camera.right);
    this.cameraUp.set(...camera.up);
    this.back.set(-camera.forward[0], -camera.forward[1], -camera.forward[2]);
    engineCamera.position.set(camera.position[0], camera.position[1], camera.position[2]);
    engineCamera.quaternion.setFromRotationMatrix(this.basis.makeBasis(this.right, this.cameraUp, this.back));
    if (engineCamera instanceof PerspectiveCamera) {
      const near = nearPlaneFor(camera.clearanceM);
      if (engineCamera.near !== near || engineCamera.far !== 1e9) {
        engineCamera.near = near;
        engineCamera.far = 1e9;
        engineCamera.updateProjectionMatrix();
      }
    }
    engineCamera.updateMatrixWorld();
  }
}
