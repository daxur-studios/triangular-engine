import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, isDevMode, signal, viewChildren } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { EngineModule, EngineService } from 'triangular-engine';
import { JoltPhysicsModule, JoltSoftBodyComponent } from 'triangular-engine/jolt';
import { TestRunnerComponent, waitRenderedFrames, type TestContext, type TestProgress, type TestSetting } from 'triangular-engine/testing';
import { clothDropSpheres, createClothMesh, createSoftSphereMesh, meshRestShape } from './soft-body-example-meshes';
import { sampleSoftBody, type SoftBodySample } from './soft-body-metrics';
import {
  createSoftBodyLabTestAdapter,
  type SoftBodyLabAggregate,
  type SoftBodyLabSnapshot,
  type SoftBodyLabTestHost,
} from './soft-body-lab-test-adapter';
import { SOFT_BODY_LAB_TEST_HISTORY, type SoftBodyExampleId, type SoftBodyLabSettings } from './soft-body-lab-tests';

const CLOTH = createClothMesh(40, 0.5);
const CLOTH_REST = meshRestShape(CLOTH.vertices, CLOTH.faces);
const SPHERE = createSoftSphereMesh(2, 10, 20);
const SPHERE_REST = meshRestShape(SPHERE.vertices, SPHERE.faces);

/** `SoftBodyCreator.CreateSphere(2.0)` compliance values, as the official pressure page uses them. */
const SPHERE_EDGE_COMPLIANCE = 1e-4;
const SPHERE_SHEAR_COMPLIANCE = 1e-4;
const SPHERE_BEND_COMPLIANCE = 1e-3;
/** The official cloth page's edge and shear compliance. */
const CLOTH_COMPLIANCE = 1e-5;

const PRESSURE_COUNT = 11;
const PRESSURE_VALUES = Array.from({ length: PRESSURE_COUNT }, (_, index) => 1000 * index);
const PRESSURE_POSITIONS = PRESSURE_VALUES.map((_, index): [number, number, number] => [-40 + index * 8, 10, 0]);

function pressureColor(index: number): number {
  const linear = 25 * index;
  const red = ((10 - index) * 25) << 16;
  return (linear | 0x00aa00 | red) & 0xffffff;
}

/**
 * Reproduces the two official Jolt.js soft-body pages with the declarative `<joltSoftBody>`
 * wrapper: `soft/soft_body.html` (cloth + ten 100 kg spheres) and
 * `soft/soft_sphere_pressure.html` (eleven spheres, pressure 0 .. 10 000).
 */
@Component({
  selector: 'app-soft-body-lab-page',
  imports: [DecimalPipe, RouterLink, EngineModule, JoltPhysicsModule, JoltSoftBodyComponent, TestRunnerComponent],
  templateUrl: './soft-body-lab-page.component.html',
  styleUrl: './soft-body-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class SoftBodyLabPageComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly example = signal<SoftBodyExampleId>('cloth');
  readonly seed = signal(1337);
  readonly bodyVisible = signal(true);
  readonly liveSample = signal<SoftBodyLabAggregate | null>(null);

  readonly cloth = CLOTH;
  readonly sphere = SPHERE;
  readonly clothCompliance = CLOTH_COMPLIANCE;
  readonly sphereEdgeCompliance = SPHERE_EDGE_COMPLIANCE;
  readonly sphereShearCompliance = SPHERE_SHEAR_COMPLIANCE;
  readonly sphereBendCompliance = SPHERE_BEND_COMPLIANCE;
  readonly pressureValues = PRESSURE_VALUES;
  readonly pressurePositions = PRESSURE_POSITIONS;
  readonly pressureColor = pressureColor;
  readonly clothColor = 0xffffff;

  readonly clothSpheres = computed(() => clothDropSpheres(this.seed()));
  readonly cameraPosition = computed<[number, number, number]>(() =>
    this.example() === 'cloth' ? [0, 15, 30] : [0, 15, 70]);
  readonly cameraTarget: [number, number, number] = [0, 0, 0];

  readonly softBodies = viewChildren(JoltSoftBodyComponent);

  readonly testHistory = SOFT_BODY_LAB_TEST_HISTORY;
  readonly allowTestAutoStart = isDevMode();
  readonly testBusy = signal(false);
  readonly testStatus = signal('');
  private readonly firstFrameRendered = signal(false);
  readonly testAvailable = computed(() => this.firstFrameRendered());
  private testError = '';
  private stopErrorWatch?: () => void;
  private displayedFrames = 0;

  private readonly testHost: SoftBodyLabTestHost = {
    engine: this.engine,
    read: () => this.readTestSnapshot(),
    apply: (settings) => this.applyTestSettings(settings),
    restore: (snapshot) => this.applyTestSettings(snapshot),
    waitReady: (context, settings) => this.waitForReady(context, settings),
    sample: () => this.readAggregate(),
    onRenderComplete: (callback) => {
      const subscription = this.engine.renderComplete$.subscribe(() => callback());
      return () => subscription.unsubscribe();
    },
    errors: () => this.testError,
    resetErrors: () => { this.testError = ''; },
    captureThumbnail: (signal) => this.captureThumbnail(signal),
    environment: () => this.testEnvironment(),
  };

  readonly testAdapter = createSoftBodyLabTestAdapter(this.testHost);

  constructor() {
    const frames = this.engine.renderComplete$.subscribe(() => {
      if (!this.firstFrameRendered()) this.firstFrameRendered.set(true);
      if (++this.displayedFrames % 20 === 0) this.liveSample.set(this.readAggregate());
    });
    this.destroyRef.onDestroy(() => {
      frames.unsubscribe();
      this.stopErrorWatch?.();
    });
  }

  setExample(value: string): void {
    this.example.set(value as SoftBodyExampleId);
    this.reset();
  }

  setSeed(event: Event): void {
    this.seed.set(Number((event.target as HTMLInputElement).value) || 0);
    this.reset();
  }

  reset(): void {
    this.bodyVisible.set(false);
    this.liveSample.set(null);
    window.setTimeout(() => this.bodyVisible.set(true), 0);
  }

  private readTestSnapshot(): SoftBodyLabSnapshot {
    return { example: this.example(), seed: this.seed() };
  }

  private applyTestSettings(settings: SoftBodyLabSettings): void {
    this.example.set(settings.example);
    this.seed.set(settings.seed);
    this.reset();
  }

  private async waitForReady(
    context: TestContext,
    settings: SoftBodyLabSettings,
  ): Promise<void> {
    await waitRenderedFrames(this.testHost, context, 2);
    const expected = settings.example === 'cloth' ? 1 : PRESSURE_COUNT;
    const started = performance.now();
    while (this.readAggregate().softBodies < expected) {
      context.signal.throwIfAborted();
      if (performance.now() - started > 20_000) {
        throw new Error(`Expected ${expected} soft bodies, found ${this.readAggregate().softBodies}`);
      }
      await context.wait(50);
    }
    await waitRenderedFrames(this.testHost, context, 2);
    const error = this.testError;
    if (error) throw new Error(error);
  }

  /** Aggregate over the soft bodies of the current example; mismatched meshes are ignored mid-swap. */
  private readAggregate(): SoftBodyLabAggregate {
    const isCloth = this.example() === 'cloth';
    const mesh = isCloth ? CLOTH : SPHERE;
    const rest = isCloth ? CLOTH_REST : SPHERE_REST;
    let softBodies = 0;
    let vertices = 0;
    let shapeErrorRms = 0;
    let shapeErrorP95 = 0;
    let maxVolumeRatio = 0;
    let minVolumeRatio = Number.POSITIVE_INFINITY;
    const volumeRatios: number[] = [];
    let maxPressure = 0;
    let minWorldY = Number.POSITIVE_INFINITY;
    let nonFiniteVertices = 0;
    for (const component of this.softBodies()) {
      const body = component.body();
      if (!body) continue;
      // A component can still be listed for the frame it is destroyed in; its body is gone.
      let sample: SoftBodySample | undefined;
      try {
        sample = sampleSoftBody(body, rest, mesh.faces);
      } catch {
        continue;
      }
      if (!sample || sample.vertexCount !== mesh.vertices.length) continue;
      softBodies++;
      vertices += sample.vertexCount;
      shapeErrorRms = Math.max(shapeErrorRms, sample.shapeErrorRms);
      shapeErrorP95 = Math.max(shapeErrorP95, sample.shapeErrorP95);
      maxVolumeRatio = Math.max(maxVolumeRatio, sample.volumeRatio);
      minVolumeRatio = Math.min(minVolumeRatio, sample.volumeRatio);
      volumeRatios.push(sample.volumeRatio);
      maxPressure = Math.max(maxPressure, sample.pressure);
      minWorldY = Math.min(minWorldY, sample.minWorldY);
      nonFiniteVertices += sample.nonFiniteVertices;
    }
    return {
      softBodies,
      vertices,
      shapeErrorRms,
      shapeErrorP95,
      maxVolumeRatio,
      minVolumeRatio: Number.isFinite(minVolumeRatio) ? minVolumeRatio : 0,
      volumeRatios,
      maxPressure,
      minWorldY: Number.isFinite(minWorldY) ? minWorldY : Number.NaN,
      nonFiniteVertices,
    };
  }

  onTestProgress(progress: TestProgress | null): void {
    const busy = progress !== null;
    if (busy !== this.testBusy()) {
      this.testBusy.set(busy);
      if (busy) this.watchTestErrors();
      else this.stopErrorWatch?.();
    }
    this.testStatus.set(progress
      ? `${progress.phase} ${progress.completed}/${progress.total} Ã‚Â· repetition ${progress.repetition}${progress.label ? ` Ã‚Â· ${progress.label}` : ''}`
      : '');
  }

  private watchTestErrors(): void {
    const note = (message: string) => { if (!this.testError) this.testError = message; };
    const onError = (event: ErrorEvent) => note(event.message || 'window error');
    const onRejection = (event: PromiseRejectionEvent) => note(`Unhandled rejection: ${String(event.reason)}`);
    const original = console.error;
    console.error = (...args: unknown[]) => {
      note(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ').slice(0, 300));
      original.apply(console, args);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    this.stopErrorWatch = () => {
      console.error = original;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      this.stopErrorWatch = undefined;
    };
  }

  private async captureThumbnail(signal: AbortSignal): Promise<Blob> {
    const canvas = this.engine.canvas;
    this.engine.render(this.engine.fpsController.lastRenderTime, true);
    const width = Math.min(240, canvas.width);
    const small = document.createElement('canvas');
    small.width = width;
    small.height = Math.max(1, Math.round((canvas.height * width) / canvas.width));
    small.getContext('2d')?.drawImage(canvas, 0, 0, small.width, small.height);
    if (signal.aborted) throw signal.reason;
    return new Promise<Blob>((resolve, reject) =>
      small.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the thumbnail'))), 'image/webp', 0.6));
  }

  private testEnvironment(): Record<string, TestSetting> {
    return {
      page: 'soft-body-lab',
      physics: 'jolt-physics/wasm-compat',
      physicsStepHz: 240,
      clothParticles: CLOTH.vertices.length,
      sphereParticles: SPHERE.vertices.length,
      pressureSpheres: PRESSURE_COUNT,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    };
  }
}





