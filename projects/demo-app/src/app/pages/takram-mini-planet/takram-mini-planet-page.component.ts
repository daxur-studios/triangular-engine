import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe, PercentPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Color, FrontSide, NoToneMapping, Vector3, type Texture } from 'three';
import {
  EngineModule,
  EngineService,
  OrbitControlsComponent,
} from 'triangular-engine';
import { PostprocessingModule } from 'triangular-engine/postprocessing';
import {
  TakramAerialPerspectiveComponent,
  TakramAtmosphereComponent,
  TakramCloudsComponent,
  TakramModule,
} from 'triangular-engine/takram';
import {
  TakramCloudControlsComponent,
  TakramCloudControlsStore,
} from '../../shared/takram-cloud-controls/takram-cloud-controls.component';
import { TakramCloudDemoTextures } from '../../shared/takram-cloud-controls/takram-cloud-demo-textures.service';

/** Phase 3 diagnostic: tests whether a thinner atmosphere/radius ratio removes LUT banding. */
const THIN_ATMOSPHERE_HEIGHT = 6_000;
const CLOUD_ALTITUDE = 3_000;
const CLOUD_HEIGHT = 2_000;
const TRANSITION_START = 30_000;
const TRANSITION_END = 80_000;
const REFERENCE_PLANET_RADIUS = 6_360_000;
const REFERENCE_LOCAL_WEATHER_REPEAT = 100;

type PlanetSizePreset = 'small' | 'medium' | 'large';

/**
 * `large`'s radius/atmosphereHeight numerically match `AtmosphereParameters.DEFAULT`
 * (bottomRadius 6,360,000 / atmosphereHeight 60,000), but `radius` here is this
 * preset's *true rendered surface* radius (globe mesh, ellipsoid, worldToECEF
 * translation) — `TakramAtmosphereService.configurePlanet()` derives the actual
 * `atmosphere.bottomRadius` from it with the same headroom ratio Earth's own
 * WGS84-ellipsoid-vs-bottomRadius default config uses, so it no longer equals
 * this number exactly. See `configurePlanet()`'s `GROUND_OFFSET_RATIO` doc.
 */
const PLANET_SIZE_PRESETS: Record<
  PlanetSizePreset,
  { radius: number; atmosphereHeight: number; label: string }
> = {
  small: { radius: 100_000, atmosphereHeight: 20_000, label: 'Small (100 km)' },
  medium: {
    radius: 1_000_000,
    atmosphereHeight: 40_000,
    label: 'Medium (1,000 km)',
  },
  large: {
    radius: 6_360_000,
    atmosphereHeight: 60_000,
    label: 'Large (Earth, 6,360 km)',
  },
};

@Component({
  selector: 'app-takram-mini-planet-page',
  imports: [
    DecimalPipe,
    PercentPipe,
    EngineModule,
    PostprocessingModule,
    TakramModule,
    TakramCloudControlsComponent,
  ],
  templateUrl: './takram-mini-planet-page.component.html',
  styleUrl: './takram-mini-planet-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    TakramCloudControlsStore,
    TakramCloudDemoTextures,
    EngineService.provide({
      showFPS: true,
      pixelRatio: 1,
      toneMapping: NoToneMapping,
      toneMappingExposure: 1.3,
      webGLRendererParameters: {
        antialias: false,
        logarithmicDepthBuffer: true,
        // Required by the on-page diagnostic runner, which copies the final
        // composited framebuffer after each controlled render variant.
        preserveDrawingBuffer: true,
      },
    }),
  ],
  host: { class: 'flex-page' },
})
export class TakramMiniPlanetPageComponent {
  readonly planetSizePresets = PLANET_SIZE_PRESETS;
  readonly planetSizePresetKeys: PlanetSizePreset[] = [
    'small',
    'medium',
    'large',
  ];
  readonly planetSizePreset = signal<PlanetSizePreset>('small');
  readonly planetRadius = computed(
    () => PLANET_SIZE_PRESETS[this.planetSizePreset()].radius,
  );
  /**
   * `AerialPerspectiveEffect`/`CloudsEffect` bake their ATMOSPHERE GPU uniform
   * once at construction (a one-time snapshot of bottomRadius/topRadius/density
   * profiles, not a live reference) and `CloudsEffect` doesn't expose it
   * publicly, so mutating `TakramAtmosphereService.atmosphere` after mount
   * cannot refresh already-constructed effects. Force a full destroy/recreate
   * of the atmosphere subtree on every size switch so effects are always
   * freshly baked with the correct radius, matching how the working
   * single-preset case behaves from first mount.
   */
  readonly planetMounted = signal(true);
  /**
   * Scale-appropriate "home" framing so orbit controls always start near the
   * current surface. Capped well under the clouds effect's 'low' quality
   * preset `maxRayDistance` (100,000 m, fixed regardless of planet size —
   * confirmed via CloudsEffect's `qualityPreset` setter, which unconditionally
   * `Object.assign`s the preset's raymarch params including maxRayDistance on
   * every reactive settings update, so overriding it manually gets stomped).
   * At Large, an unclamped 3%-of-radius altitude (~190,800 m) already exceeds
   * that budget, so the cloud layer becomes unreachable by the raymarcher —
   * exactly the "clouds vanish when zooming out toward the cloud shell"
   * symptom.
   */
  readonly cameraHomePosition = computed<[number, number, number]>(() => {
    const altitude = Math.min(
      60_000,
      Math.max(2_000, this.planetRadius() * 0.03),
    );
    return [0, altitude, altitude * 2.5];
  });

  setPlanetSizePreset(preset: PlanetSizePreset): void {
    if (preset === this.planetSizePreset()) return;
    this.planetMounted.set(false);
    this.planetSizePreset.set(preset);
    setTimeout(() => this.planetMounted.set(true));
  }
  readonly controls = inject(TakramCloudControlsStore);
  readonly textures = inject(TakramCloudDemoTextures);
  readonly planetCentre = computed<[number, number, number]>(() => [
    0,
    -this.planetRadius(),
    0,
  ]);
  /** The surface point under the camera is always the origin regardless of planet radius. */
  readonly surfaceTarget: [number, number, number] = [0, 0, 0];
  readonly cloudShellRadius = computed(
    () => this.planetRadius() + CLOUD_ALTITUDE + CLOUD_HEIGHT * 0.5,
  );
  /**
   * Takram samples weather in normalized globe UVs. Repeats must scale with
   * radius to keep the Earth preset's checker/cloud width constant in metres.
   */
  readonly cloudLocalWeatherRepeat = computed<[number, number]>(() => {
    const repeat =
      REFERENCE_LOCAL_WEATHER_REPEAT *
      (this.planetRadius() / REFERENCE_PLANET_RADIUS);
    return [repeat, repeat];
  });
  readonly cameraAltitude = signal(0);
  readonly shellOpacity = computed(() =>
    smoothstep(TRANSITION_START, TRANSITION_END, this.cameraAltitude()),
  );
  readonly shellMaterial = computed(() => ({
    color: '#f4f7f8',
    opacity: this.shellOpacity() * 0.9,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  }));

  /** Phase 0 diagnostic isolation toggles — see docs/runbook/003. */
  readonly diagClouds = signal(true);
  readonly diagAerial = signal(true);
  readonly diagAerialSky = signal(true);
  readonly diagAerialInscatter = signal(true);
  readonly diagAerialTransmittance = signal(true);
  readonly diagAerialGround = signal(true);
  readonly diagAerialPostLighting = signal(true);
  readonly diagAerialGeometricCorrection = signal(true);
  readonly diagPlanet = signal(true);
  readonly diagShell = signal(true);
  /** Phase 1 test: raises planet mesh tessellation to rule out facet banding. */
  readonly diagHighTessellation = signal(false);
  readonly planetSegments = computed<{ width: number; height: number }>(() =>
    this.diagHighTessellation()
      ? { width: 512, height: 256 }
      : { width: 96, height: 64 },
  );
  /** Phase 3 test: shrinks the atmosphere/radius ratio to rule out LUT banding. */
  readonly diagThinAtmosphere = signal(false);
  readonly atmosphereHeight = computed(() =>
    this.diagThinAtmosphere()
      ? THIN_ATMOSPHERE_HEIGHT
      : PLANET_SIZE_PRESETS[this.planetSizePreset()].atmosphereHeight,
  );

  private readonly atmosphereRef = viewChild(TakramAtmosphereComponent);
  private readonly cloudsRef = viewChild(TakramCloudsComponent);
  private readonly aerialRef = viewChild(TakramAerialPerspectiveComponent);
  private readonly orbitControlsRef = viewChild(OrbitControlsComponent);

  private readonly engine = inject(EngineService);

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color(0x000006);
    destroyRef.onDestroy(() => {
      this.engine.scene.background = previousBackground;
    });
    this.controls.altitude.set(CLOUD_ALTITUDE);
    this.controls.height.set(CLOUD_HEIGHT);
    this.controls.densityScale.set(0.3);
    this.controls.temporalUpscale.set(false);
    this.controls.cameraFar.set(50_000_000);
    const centre = new Vector3();
    this.engine.postTick$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
      centre.set(...this.planetCentre());
      const altitude = Math.max(
        0,
        this.engine.camera.position.distanceTo(centre) - this.planetRadius(),
      );
      if (Math.abs(altitude - this.cameraAltitude()) > 1) {
        this.cameraAltitude.set(altitude);
      }
    });
  }

  /** Transient button-label feedback after a clipboard copy attempt. */
  readonly dumpStatus = signal<'idle' | 'copied' | 'failed'>('idle');
  readonly diagnosticStatus = signal<
    'idle' | 'running' | 'copied' | 'failed'
  >('idle');

  /** Restore the size-appropriate surface framing after free orbiting. */
  recenterOnSurface(): void {
    const component = this.orbitControlsRef();
    const orbit = component?.orbitControls();
    if (!component || !orbit) return;

    component.internalCamera.position.set(...this.cameraHomePosition());
    orbit.target.set(...this.surfaceTarget);
    orbit.update();
  }

  /**
   * Phase 0 diagnostic: copies a compact, single-line-per-section snapshot
   * of live uniform/effect state to the clipboard so it's cheap to paste
   * into chat. See docs/runbook/003_takram_mini_planet_fix_plan.md Phase 0.
   */
  dumpState(): void {
    const atmosphereState = this.atmosphereRef()?.state;
    const clouds = this.cloudsRef()?.effect;
    const aerial = this.aerialRef()?.effect;

    const lines: string[] = [
      `preset=${this.planetSizePreset()} r=${this.planetRadius()} atmH=${this.atmosphereHeight()}`,
    ];

    if (atmosphereState) {
      const a = atmosphereState.atmosphere;
      const e = atmosphereState.ellipsoid.radii;
      lines.push(
        `atm b=${r(a.bottomRadius)} t=${r(a.topRadius)} ell=${vec3(e)} ecefTx=${r(atmosphereState.worldToECEFMatrix.elements[12])}`,
        `ray w=${r(a.rayleighDensity[1].width)} es=${sig(a.rayleighDensity[1].expScale)}`,
        `mie w=${r(a.mieDensity[1].width)} es=${sig(a.mieDensity[1].expScale)}`,
        `abs w=${r(a.absorptionDensity[0].width)} lt=${sig(a.absorptionDensity[0].linearTerm)} ct=${sig(a.absorptionDensity[0].constantTerm)}`,
      );
    } else {
      lines.push('atm=unmounted');
    }

    if (clouds) {
      lines.push(
        `clouds corrAlt=${clouds.correctAltitude} lwRep=${vec2(clouds.localWeatherRepeat)} shRep=${vec2(clouds.shapeRepeat)} sdRep=${vec2(clouds.shapeDetailRepeat)} turbRep=${vec2(clouds.turbulenceRepeat)}`,
        `march min=${r(clouds.clouds.minStepSize)} max=${r(clouds.clouds.maxStepSize)} dist=${r(clouds.clouds.maxRayDistance)} iter=${clouds.clouds.maxIterationCount}`,
        `shadow min=${r(clouds.shadow.minStepSize)} max=${r(clouds.shadow.maxStepSize)} iter=${clouds.shadow.maxIterationCount} casc=${clouds.shadow.cascadeCount} map=${clouds.shadow.mapSize} far=${r(clouds.shadow.maxFar)}`,
      );
    } else {
      lines.push('clouds=unmounted');
    }

    if (aerial) {
      const e = aerial.ellipsoid.radii;
      lines.push(
        `aerial corrAlt=${aerial.correctAltitude} ell=${vec3(e)} ecefTx=${r(aerial.worldToECEFMatrix.elements[12])} overlay=${aerial.overlay != null} shadow=${aerial.shadow != null} shadowLen=${aerial.shadowLength != null}`,
      );
    } else {
      lines.push('aerial=unmounted');
    }

    const text = lines.join('\n');
    console.log(text);
    navigator.clipboard.writeText(text).then(
      () => this.setDumpStatus('copied'),
      () => this.setDumpStatus('failed'),
    );
  }

  /**
   * Runs controlled post-lighting comparisons and copies the measurements as
   * JSON. The scene and camera settings are restored even if capture fails.
   */
  async runPostLightingDiagnostics(): Promise<void> {
    if (this.diagnosticStatus() === 'running') return;
    this.diagnosticStatus.set('running');

    const camera = this.engine.camera;
    const saved = {
      clouds: this.diagClouds(),
      aerial: this.diagAerial(),
      sky: this.diagAerialSky(),
      inscatter: this.diagAerialInscatter(),
      transmittance: this.diagAerialTransmittance(),
      ground: this.diagAerialGround(),
      postLighting: this.diagAerialPostLighting(),
      geometricCorrection: this.diagAerialGeometricCorrection(),
      planet: this.diagPlanet(),
      shell: this.diagShell(),
      near: this.controls.cameraNear(),
      far: this.controls.cameraFar(),
    };

    let testedAerial:
      | {
          normalBuffer: Texture | null;
          reconstructNormal: boolean;
        }
      | undefined;
    try {
      // Match the user's isolating test: globe + aerial post-lighting only.
      this.diagClouds.set(false);
      this.diagShell.set(false);
      this.diagPlanet.set(true);
      this.diagAerial.set(true);
      this.diagAerialSky.set(false);
      this.diagAerialInscatter.set(false);
      this.diagAerialTransmittance.set(false);
      this.diagAerialGround.set(false);
      this.diagAerialPostLighting.set(true);
      this.diagAerialGeometricCorrection.set(true);
      await this.waitForFrames(4);

      const aerial = this.aerialRef()?.effect;
      if (!aerial) throw new Error('Aerial perspective effect is not mounted.');
      const originalNormalBuffer = aerial.normalBuffer;
      const originalReconstructNormal = aerial.reconstructNormal;
      testedAerial = {
        normalBuffer: originalNormalBuffer,
        reconstructNormal: originalReconstructNormal,
      };

      const variants: DiagnosticCapture[] = [];
      variants.push(await this.captureDiagnostic('baseline-normal-buffer'));

      this.diagAerialPostLighting.set(false);
      await this.waitForFrames(3);
      variants.push(await this.captureDiagnostic('post-lighting-off-control'));

      this.diagAerialPostLighting.set(true);
      this.diagAerialGeometricCorrection.set(false);
      await this.waitForFrames(3);
      variants.push(await this.captureDiagnostic('geometric-correction-off'));

      this.diagAerialGeometricCorrection.set(true);
      aerial.normalBuffer = null;
      aerial.reconstructNormal = true;
      await this.waitForFrames(3);
      variants.push(await this.captureDiagnostic('depth-reconstructed-normals'));

      aerial.reconstructNormal = originalReconstructNormal;
      aerial.normalBuffer = originalNormalBuffer;
      const centre = new Vector3(...this.planetCentre());
      const distance = camera.position.distanceTo(centre);
      const margin = this.planetRadius() * 1.1;
      this.controls.cameraNear.set(Math.max(1, distance - margin));
      this.controls.cameraFar.set(distance + margin);
      await this.waitForFrames(3);
      variants.push(await this.captureDiagnostic('tight-camera-frustum'));

      if (variants.every((variant) => variant.meanLuminance === 0)) {
        throw new Error(
          'All diagnostic captures were empty; no report was copied.',
        );
      }

      const atmosphere = this.atmosphereRef()?.state;
      const report = {
        diagnostic: 'takram-mini-planet-post-lighting',
        generatedAt: new Date().toISOString(),
        preset: this.planetSizePreset(),
        radius: this.planetRadius(),
        atmosphereHeight: this.atmosphereHeight(),
        camera: {
          position: camera.position.toArray(),
          originalNear: saved.near,
          originalFar: saved.far,
          tightNear: this.controls.cameraNear(),
          tightFar: this.controls.cameraFar(),
        },
        atmosphere: atmosphere
          ? {
              bottomRadius: atmosphere.atmosphere.bottomRadius,
              topRadius: atmosphere.atmosphere.topRadius,
              ellipsoidRadii: atmosphere.ellipsoid.radii.toArray(),
              worldToECEF: atmosphere.worldToECEFMatrix.toArray(),
            }
          : null,
        variants,
        interpretation:
          'Compare radialAdjacentDifference and centreLineAdjacentDifference with the post-lighting-off control. Reconstructed-normal improvement implicates the normal-buffer path; tight-frustum improvement implicates depth precision.',
      };
      const text = JSON.stringify(report, null, 2);
      console.log(text);
      await navigator.clipboard.writeText(text);
      this.diagnosticStatus.set('copied');
    } catch (error) {
      console.error('Post-lighting diagnostics failed.', error);
      this.diagnosticStatus.set('failed');
    } finally {
      const aerial = this.aerialRef()?.effect;
      if (aerial && testedAerial) {
        aerial.reconstructNormal = testedAerial.reconstructNormal;
        aerial.normalBuffer = testedAerial.normalBuffer;
      }
      this.diagClouds.set(saved.clouds);
      this.diagAerial.set(saved.aerial);
      this.diagAerialSky.set(saved.sky);
      this.diagAerialInscatter.set(saved.inscatter);
      this.diagAerialTransmittance.set(saved.transmittance);
      this.diagAerialGround.set(saved.ground);
      this.diagAerialPostLighting.set(saved.postLighting);
      this.diagAerialGeometricCorrection.set(saved.geometricCorrection);
      this.diagPlanet.set(saved.planet);
      this.diagShell.set(saved.shell);
      this.controls.cameraNear.set(saved.near);
      this.controls.cameraFar.set(saved.far);
      setTimeout(() => this.diagnosticStatus.set('idle'), 3000);
    }
  }

  private async captureDiagnostic(name: string): Promise<DiagnosticCapture> {
    await this.waitForFrames(2);
    const source = this.engine.renderer.domElement;
    const width = Math.min(320, source.width);
    const height = Math.max(1, Math.round((source.height / source.width) * width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create diagnostic canvas.');
    context.drawImage(source, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    return measureDiagnosticImage(name, pixels, width, height);
  }

  private waitForFrames(count: number): Promise<void> {
    return new Promise((resolve) => {
      let remaining = count;
      const subscription = this.engine.postTick$.subscribe(() => {
        remaining--;
        if (remaining <= 0) {
          subscription.unsubscribe();
          requestAnimationFrame(() => resolve());
        }
      });
    });
  }

  private setDumpStatus(status: 'copied' | 'failed'): void {
    this.dumpStatus.set(status);
    setTimeout(() => this.dumpStatus.set('idle'), 2000);
  }
}

interface DiagnosticCapture {
  name: string;
  width: number;
  height: number;
  meanLuminance: number;
  luminanceStdDev: number;
  radialAdjacentDifference: number;
  centreLineAdjacentDifference: number;
}

function measureDiagnosticImage(
  name: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): DiagnosticCapture {
  const luminance = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0; i < luminance.length; i++) {
    const offset = i * 4;
    const value =
      pixels[offset] * 0.2126 +
      pixels[offset + 1] * 0.7152 +
      pixels[offset + 2] * 0.0722;
    luminance[i] = value;
    sum += value;
  }
  const mean = sum / luminance.length;
  let variance = 0;
  for (const value of luminance) variance += (value - mean) ** 2;

  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const binCount = Math.max(8, Math.floor(Math.min(width, height) / 2));
  const radialSum = new Float64Array(binCount);
  const radialCount = new Uint32Array(binCount);
  const maxRadius = Math.hypot(cx, cy);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bin = Math.min(
        binCount - 1,
        Math.floor((Math.hypot(x - cx, y - cy) / maxRadius) * binCount),
      );
      radialSum[bin] += luminance[y * width + x];
      radialCount[bin]++;
    }
  }
  let radialDifference = 0;
  for (let i = 1; i < binCount; i++) {
    radialDifference += Math.abs(
      radialSum[i] / radialCount[i] - radialSum[i - 1] / radialCount[i - 1],
    );
  }
  let centreLineDifference = 0;
  const centreY = Math.floor(cy);
  for (let x = 1; x < width; x++) {
    centreLineDifference += Math.abs(
      luminance[centreY * width + x] - luminance[centreY * width + x - 1],
    );
  }
  return {
    name,
    width,
    height,
    meanLuminance: r(mean)!,
    luminanceStdDev: r(Math.sqrt(variance / luminance.length))!,
    radialAdjacentDifference: r(radialDifference / (binCount - 1))!,
    centreLineAdjacentDifference: r(centreLineDifference / (width - 1))!,
  };
}

function smoothstep(min: number, max: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

/** Rounds to 2 decimal places for compact diagnostic dumps. */
function r(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100;
}

/** Formats tiny/large magnitudes (e.g. expScale) compactly. */
function sig(n: number): string {
  return n.toExponential(3);
}

function vec2(v: { x: number; y: number }): string {
  return `[${r(v.x)},${r(v.y)}]`;
}

function vec3(v: { x: number; y: number; z: number }): string {
  return `[${r(v.x)},${r(v.y)},${r(v.z)}]`;
}
