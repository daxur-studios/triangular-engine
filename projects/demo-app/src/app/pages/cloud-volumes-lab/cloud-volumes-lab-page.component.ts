import { Component, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, SphereGeometry, Vector3 } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { CloudVolume, CloudVolumeScreenPass } from 'triangular-engine/cloud-volumes';
import { GpuTimer } from './gpu-timer';

/**
 * Plan 051 Phases 0-1: the cloud-volumes test bench on a plain sphere planet (no atmosphere yet).
 *
 * One 128^3 noise CloudVolume floats above the planet. The page reads GPU milliseconds from timestamp queries
 * (never frame rate: a monitor cap hides headroom), with the clouds on or off, at five camera presets.
 * `?forceWebGL` runs the same renderer on its WebGL2 fallback. Drag to look, W A S D Q E to fly (Shift = fast).
 */
const query = new URLSearchParams(globalThis.location?.search ?? '');
const FORCE_WEBGL = query.has('forceWebGL') || query.get('backend') === 'webgl2';

const PLANET_RADIUS = 2000;
const VOLUME_CENTER = new Vector3(0, PLANET_RADIUS + 250, 0);
const VOLUME_SIZE = new Vector3(600, 200, 600);

type CloudMode = 'mesh' | 'pass' | 'pass-full';

interface CameraPreset {
  readonly label: string;
  /** Offset from the volume centre. */
  readonly offset?: readonly [number, number, number];
  /** Look-at point, offset from the volume centre. */
  readonly target?: readonly [number, number, number];
  /** Alternative to offset/target: a point on the great circle the extra volumes sit on, looking along it. */
  readonly arc?: { readonly s: number; readonly altitude: number; readonly pitchDeg: number };
}

const PRESETS: readonly CameraPreset[] = [
  { label: 'outside', offset: [0, 120, 1300], target: [0, 0, 0] },
  { label: 'edge', offset: [0, 0, 330], target: [0, 0, 0] },
  { label: 'inside', offset: [60, 0, 40], target: [-120, 10, -300] },
  { label: 'above', offset: [0, 450, 60], target: [0, 0, 0] },
  { label: 'below', offset: [0, -170, 0], target: [0, 100, 0] },
  // Arc length s in metres along the great circle through the main volume; looking ahead along it.
  { label: 'horizon', arc: { s: -1500, altitude: 200, pitchDeg: -3 } },
  { label: 'ground', arc: { s: -450, altitude: 45, pitchDeg: 1 } },
];
const UP = new Vector3(0, 1, 0);
/** Position and heading on the great circle (the y-z plane) at arc length `s` metres from the main volume. */
function arcPose(s: number, altitude: number): { position: Vector3; pitch: number } {
  const a = s / (PLANET_RADIUS + 250);
  const r = PLANET_RADIUS + altitude;
  return { position: new Vector3(0, Math.cos(a) * r, Math.sin(a) * r), pitch: -a };
}

interface Recording {
  readonly preset: string;
  readonly clouds: string;
  readonly backend: string;
  readonly render: string;
  readonly compute: string;
}

@Component({
  standalone: true,
  selector: 'app-cloud-volumes-lab-page',
  imports: [EngineModule, RouterLink],
  providers: EngineService.provide({
    showFPS: true,
    preferredRenderer: 'webgpu',
    webGpuRendererParameters: {
      forceWebGL: FORCE_WEBGL,
      antialias: false,
      trackTimestamp: true,
    },
  }),
  host: {
    class: 'flex-page',
    '(pointermove)': 'onPointerMove($event)',
  },
  template: `
    <scene />

    <aside class="panel" (pointermove)="$event.stopPropagation()">
      <a routerLink="/">← Examples</a>
      <h2>Cloud volumes lab · Plan 051 Phases 0-1</h2>
      <p class="row">
        <button (click)="switchBackend(false)" [disabled]="!forceWebGL">WebGPU</button>
        <button (click)="switchBackend(true)" [disabled]="forceWebGL">forceWebGL</button>
      </p>

      <p class="label">Camera preset</p>
      <p class="row">
        @for (preset of presets; track preset.label) {
          <button (click)="applyPreset(preset)" [class.active]="presetLabel() === preset.label">
            {{ preset.label }}
          </button>
        }
      </p>

      <p class="label">Clouds</p>
      <p class="row">
        <button (click)="setClouds(true)" [class.active]="cloudsOn()">on</button>
        <button (click)="setClouds(false)" [class.active]="!cloudsOn()">off</button>
        <button (click)="toggleRebake()" [class.active]="rebakeEveryFrame()">
          light rebake every frame: {{ rebakeEveryFrame() ? 'on' : 'off' }}
        </button>
      </p>

      <label
        >sun elevation {{ sunElevation().toFixed(1) }}°
        <input type="range" min="-10" max="90" step="0.1" [value]="sunElevation()" (input)="setSunElevation($event)" />
      </label>
      <label
        >sun azimuth {{ sunAzimuth().toFixed(0) }}°
        <input type="range" min="-180" max="180" step="1" [value]="sunAzimuth()" (input)="setSunAzimuth($event)" />
      </label>
      <p class="row">
        <button (click)="toggleSunAnimation()" [class.active]="animateSun()">
          {{ animateSun() ? 'stop sun' : 'animate sun' }}
        </button>
      </p>
      <label
        >extinction {{ extinction().toFixed(3) }} /m
        <input type="range" min="0.005" max="0.08" step="0.001" [value]="extinction()" (input)="setExtinction($event)" />
      </label>
      <label
        >march steps {{ steps() }}
        <input type="range" min="8" max="128" step="8" [value]="steps()" (input)="setSteps($event)" />
      </label>
      <p class="row">
        render scale
        <button (click)="setScale(1)" [class.active]="renderScale() === 1">1x</button>
        <button (click)="setScale(0.5)" [class.active]="renderScale() === 0.5">0.5x</button>
        <button (click)="toggleJitter()" [class.active]="!jitterOn()">jitter off</button>
        <button (click)="toggleTemporal()" [class.active]="temporalOn()">temporal reuse: {{ temporalOn() ? 'on' : 'off' }}</button>
        <button (click)="toggleFetch()" [class.active]="!fetchOn()">no fetch</button>
      </p>
      <p class="row">
        volumes
        @for (n of volumeCounts; track n) {
          <button (click)="setVolumeCount(n)" [class.active]="volumeCount() === n">{{ n }}</button>
        }
        <button (click)="runFlyby()" [disabled]="matrixStatus() !== ''">fly-by test (2 x 20 s)</button>
      </p>
      <p class="row">
        <button (click)="runQuick()" [disabled]="matrixStatus() !== ''">
          {{ matrixStatus() || 'quick re-test: screen pass, 24 steps, 1/4/12 volumes (about 2 min)' }}
        </button>
      </p>
      <p class="row">
        <button (click)="runAll()" [disabled]="matrixStatus() !== ''">
          {{ matrixStatus() || 'run everything: 1/4/12 volumes, fly-bys at 24 + 64 steps, matrices (about 15 min)' }}
        </button>
      </p>
      <p class="row">
        clouds drawn as
        <button (click)="setCloudMode('mesh')" [class.active]="cloudMode() === 'mesh'">box mesh</button>
        <button (click)="setCloudMode('pass')" [class.active]="cloudMode() === 'pass'">screen pass x0.5</button>
        <button (click)="setCloudMode('pass-full')" [class.active]="cloudMode() === 'pass-full'">screen pass x1</button>
      </p>
      <label
        >fly speed {{ speed().toFixed(0) }} m/s
        <input type="range" min="10" max="600" step="10" [value]="speed()" (input)="speed.set(num($event))" />
      </label>

      <p class="gpu">
        GPU render {{ renderMs() }}<br />
        GPU compute {{ computeMs() }}
      </p>
      <p class="note">
        {{ backendLabel }} · density bakes {{ densityBakes() }} · light bakes {{ lightBakes() }} · camera
        {{ presetLabel() }} · clouds {{ cloudsOn() ? 'on' : 'off' }}
      </p>
      <p class="row">
        <button (click)="runMatrix()" [disabled]="matrixStatus() !== ''">
          {{ matrixStatus() || 'run all scenarios (about 1-2 min, keep tab visible)' }}
        </button>
      </p>
      @if (matrixText()) {
        <textarea class="out" readonly rows="9" [value]="matrixText()"></textarea>
        <p class="row"><button (click)="copyMatrix()">{{ copied() ? 'copied' : 'copy results' }}</button></p>
      }
      <p class="row">
        <button (click)="record()">record this reading</button>
        <button (click)="recordings.set([])">clear</button>
      </p>
      @if (recordings().length) {
        <table class="rec">
          <tr><th>camera</th><th>clouds</th><th>backend</th><th>render</th><th>compute</th></tr>
          @for (r of recordings(); track $index) {
            <tr><td>{{ r.preset }}</td><td>{{ r.clouds }}</td><td>{{ r.backend }}</td><td>{{ r.render }}</td><td>{{ r.compute }}</td></tr>
          }
        </table>
      }
      <p class="note">drag = look · W A S D = move · Q E = down/up · Shift = fast</p>
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
      max-width: 360px;
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
    .gpu {
      margin: 0.6rem 0 0;
      font: 600 14px/1.5 ui-monospace, monospace;
    }
    .rec {
      width: 100%;
      font-size: 12px;
      border-collapse: collapse;
    }
    .rec td,
    .rec th {
      padding: 1px 4px;
      text-align: left;
    }
    .out {
      width: 100%;
      font: 11px/1.3 ui-monospace, monospace;
      background: #05080c;
      color: #cfe;
    }
    button.active {
      outline: 2px solid #6cf;
    }
  `,
})
export class CloudVolumesLabPageComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly forceWebGL = FORCE_WEBGL;
  readonly backendLabel = FORCE_WEBGL ? 'forceWebGL' : 'WebGPU';
  readonly presets = PRESETS;
  readonly volumeCounts = [1, 4, 12];

  readonly presetLabel = signal('outside');
  readonly cloudsOn = signal(true);
  readonly rebakeEveryFrame = signal(false);
  readonly sunElevation = signal(35);
  readonly sunAzimuth = signal(40);
  readonly animateSun = signal(false);
  readonly extinction = signal(0.02);
  readonly speed = signal(120);
  readonly steps = signal(64);
  readonly renderScale = signal(1);
  readonly jitterOn = signal(true);
  readonly temporalOn = signal(false);
  readonly fetchOn = signal(true);
  readonly cloudMode = signal<CloudMode>('mesh');
  readonly volumeCount = signal(1);
  readonly matrixStatus = signal('');
  readonly matrixText = signal('');
  readonly copied = signal(false);
  readonly renderMs = signal('n/a');
  readonly computeMs = signal('n/a');
  readonly densityBakes = signal(0);
  readonly lightBakes = signal(0);
  readonly recordings = signal<readonly Recording[]>([]);

  private readonly volume = new CloudVolume({ size: VOLUME_SIZE, densitySize: 128 });
  private readonly planet: Mesh;
  private readonly sun = new DirectionalLight(0xffffff, 3);
  private readonly hemi = new HemisphereLight(0x8fb4ff, 0x203040, 0.6);
  private readonly timer = new GpuTimer(10, 12);
  private readonly keys = new Set<string>();
  private readonly position = new Vector3();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly move = new Vector3();
  private readonly extras: CloudVolume[] = [];
  private flyby: { t0: number; duration: number; samples: number[]; done: () => void } | undefined;
  private screenPass: CloudVolumeScreenPass | undefined;
  private screenPipeline: ReturnType<CloudVolumeScreenPass['asEngineRenderPipeline']> | undefined;
  private readonly passVolumes: CloudVolume[] = [];
  private yaw = 0;
  private pitch = 0;

  constructor() {
    this.planet = new Mesh(
      new SphereGeometry(PLANET_RADIUS, 128, 64),
      new MeshStandardMaterial({ color: new Color(0x4a7a52), roughness: 1 }),
    );
    this.volume.mesh.position.copy(VOLUME_CENTER);
    this.engine.scene.add(this.planet, this.volume.mesh, this.sun, this.hemi);
    this.applySun();

    const camera = this.engine.camera;
    if (camera instanceof PerspectiveCamera) {
      camera.fov = 70;
      camera.near = 1;
      camera.far = 20000;
      camera.updateProjectionMatrix();
    }
    this.applyPreset(PRESETS[0]);

    const tick = this.engine.tick$.subscribe((delta) => {
      if (this.animateSun()) {
        this.sunElevation.update((e) => (e + delta * 6 > 90 ? -10 : e + delta * 6));
        this.applySun();
      }
      this.stepFlyby();
      this.updateCamera(delta);
      const renderer: any = this.engine.renderer;
      if (!renderer?.initialized) return;
      for (const volume of this.activeVolumes()) volume.update(renderer);
      this.densityBakes.set(this.volume.densityBakes);
      this.lightBakes.set(this.volume.lightBakes);
    });
    // Read the timestamps after the frame's main render, so the sample covers the bakes and the march of one frame.
    const rendered = this.engine.renderComplete$.subscribe(() => {
      const renderer: any = this.engine.renderer;
      this.timer.tick(renderer, () => {
        const last = this.timer.render.last;
        if (this.flyby && last !== undefined) this.flyby.samples.push(last);
        this.renderMs.set(this.format(this.timer.render));
        this.computeMs.set(this.format(this.timer.compute));
      });
    });
    this.destroyRef.onDestroy(() => {
      tick.unsubscribe();
      rendered.unsubscribe();
      this.applyScale(1);
      this.setCloudMode('mesh');
      for (const volume of this.allVolumes()) this.engine.scene.remove(volume.mesh);
      this.engine.scene.remove(this.planet, this.sun, this.hemi);
      this.planet.geometry.dispose();
      (this.planet.material as MeshStandardMaterial).dispose();
      for (const volume of this.allVolumes()) volume.dispose();
    });
  }

  private format(reading: { last: number | undefined; average: number | undefined }): string {
    if (reading.average === undefined || reading.last === undefined) return 'n/a (no timestamp query)';
    return `${reading.average.toFixed(2)} ms avg (last ${reading.last.toFixed(2)})`;
  }

  applyPreset(preset: CameraPreset): void {
    this.presetLabel.set(preset.label);
    if (preset.arc) {
      const pose = arcPose(preset.arc.s, preset.arc.altitude);
      this.position.copy(pose.position);
      this.yaw = 0;
      this.pitch = pose.pitch + (preset.arc.pitchDeg * Math.PI) / 180;
    } else {
      this.position.copy(VOLUME_CENTER).add(new Vector3(...preset.offset!));
      const target = VOLUME_CENTER.clone().add(new Vector3(...preset.target!));
      const dir = target.sub(this.position).normalize();
      this.yaw = Math.atan2(dir.x, dir.z);
      this.pitch = Math.asin(dir.y);
    }
    this.timer.reset();
    this.renderMs.set('n/a');
    this.computeMs.set('n/a');
  }

  setClouds(on: boolean): void {
    this.cloudsOn.set(on);
    this.syncVolumes();
  }

  private allVolumes(): CloudVolume[] {
    return [this.volume, ...this.extras];
  }

  private activeVolumes(): CloudVolume[] {
    return this.allVolumes().slice(0, this.volumeCount());
  }

  /** 1, 4 or 12 volumes along the great circle through the main one, at alternating heights (the low ones cross the ground). */
  setVolumeCount(n: number): void {
    while (this.extras.length < n - 1) this.createExtra(this.extras.length + 1);
    this.volumeCount.set(n);
    this.syncVolumes();
  }

  private createExtra(k: number): void {
    const volume = new CloudVolume({ size: VOLUME_SIZE, densitySize: 128 });
    volume.uNoiseSeed.value = k * 3.7;
    volume.uExtinction.value = this.extinction();
    volume.uMarchSteps.value = this.steps();
    volume.uJitter.value = this.jitterOn() ? 1 : 0;
    volume.alwaysRebakeLight = this.rebakeEveryFrame();
    volume.setFetchEnabled(this.fetchOn());
    const side = k % 2 ? 1 : -1;
    const pose = arcPose(side * Math.ceil(k / 2) * 700, k % 2 ? 250 : 60);
    const radial = pose.position.clone().normalize();
    volume.mesh.position.copy(pose.position);
    volume.mesh.position.x = ((k % 3) - 1) * 260;
    volume.mesh.quaternion.setFromUnitVectors(UP, radial);
    this.extras.push(volume);
    this.applySun();
  }

  /** Puts the active volumes where the current mode draws them (scene meshes, or the screen pass's list). */
  private syncVolumes(): void {
    const active = this.activeVolumes();
    for (const volume of this.allVolumes()) this.engine.scene.remove(volume.mesh);
    if (this.cloudMode() === 'mesh') {
      for (const volume of active) {
        volume.mesh.visible = this.cloudsOn();
        this.engine.scene.add(volume.mesh);
      }
    }
    this.passVolumes.length = 0;
    if (this.cloudsOn() && this.cloudMode() !== 'mesh') this.passVolumes.push(...active);
    this.screenPass?.rebuild();
    this.timer.reset();
  }

  /** Box-proxy mesh in the scene, or the half-resolution (x0.5) or full-resolution screen pass owning the frame's render. */
  setCloudMode(mode: CloudMode): void {
    const renderer: any = this.engine.renderer;
    if (mode === this.cloudMode() && (mode === 'mesh' || this.screenPass)) return;
    if (this.screenPass) {
      if (this.screenPipeline) this.engine.unregisterRenderPipeline(this.screenPipeline);
      this.screenPass.dispose();
      this.screenPass = undefined;
      this.screenPipeline = undefined;
    }
    this.cloudMode.set(mode);
    this.syncVolumes();
    if (mode !== 'mesh' && renderer?.initialized) {
      this.screenPass = new CloudVolumeScreenPass(renderer, this.engine.scene, this.engine.camera, this.passVolumes, {
        scale: mode === 'pass' ? 0.5 : 1,
        temporal: this.temporalOn(),
      });
      this.screenPipeline = this.screenPass.asEngineRenderPipeline();
      this.engine.registerRenderPipeline(this.screenPipeline);
    }
  }

  toggleRebake(): void {
    this.rebakeEveryFrame.update((v) => !v);
    for (const volume of this.allVolumes()) volume.alwaysRebakeLight = this.rebakeEveryFrame();
    this.timer.reset();
  }

  setSunElevation(event: Event): void {
    this.sunElevation.set(this.num(event));
    this.applySun();
  }

  setSunAzimuth(event: Event): void {
    this.sunAzimuth.set(this.num(event));
    this.applySun();
  }

  toggleSunAnimation(): void {
    this.animateSun.update((on) => !on);
  }

  setExtinction(event: Event): void {
    this.extinction.set(this.num(event));
    for (const volume of this.allVolumes()) {
      volume.uExtinction.value = this.extinction();
      volume.invalidateDensity();
    }
  }

  setSteps(event: Event): void {
    this.applySteps(this.num(event));
  }

  private applySteps(n: number): void {
    this.steps.set(n);
    for (const volume of this.allVolumes()) volume.uMarchSteps.value = n;
    this.timer.reset();
  }

  setScale(scale: number): void {
    this.applyScale(scale);
  }

  /** Render scale per axis: the renderer pixel ratio is the engine's ratio times `scale` (0.5 = a quarter of the pixels). */
  private applyScale(scale: number): void {
    this.renderScale.set(scale);
    const renderer: any = this.engine.renderer;
    renderer?.setPixelRatio?.(this.engine.pixelRatio * scale);
    this.timer.reset();
  }

  toggleJitter(): void {
    this.jitterOn.update((v) => !v);
    for (const volume of this.allVolumes()) volume.uJitter.value = this.jitterOn() ? 1 : 0;
    this.timer.reset();
  }

  toggleTemporal(): void {
    this.temporalOn.update((v) => !v);
    this.screenPass?.setTemporal(this.temporalOn());
    this.timer.reset();
  }

  toggleFetch(): void {
    this.fetchOn.update((v) => !v);
    for (const volume of this.allVolumes()) volume.setFetchEnabled(this.fetchOn());
    this.timer.reset();
  }

  private async settle(): Promise<string> {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    await sleep(800);
    this.timer.reset();
    for (let waited = 0; this.timer.sampleCount < 6 && waited < 20000; waited += 100) await sleep(100);
    const avg = this.timer.render.average;
    return avg === undefined ? 'n/a' : avg.toFixed(2);
  }

  /**
   * Plan 051, Phase 2a probe. For render scale 1 and 0.5 and every camera preset it times clouds off and clouds on
   * at 16 / 24 / 32 steps, then three extra runs at inside s32 scale 1 (jitter off, no fetch, light rebaked every
   * frame). Writes one compact table. Cloud columns are the cost over "off" at the same scale and camera.
   */
  async runMatrix(publish = true, quick = false): Promise<string> {
    const stepList = quick ? [24] : [16, 24, 32];
    const presets = quick ? PRESETS.filter((p) => ['inside', 'above', 'horizon', 'ground'].includes(p.label)) : PRESETS;
    const saved = {
      preset: PRESETS.find((p) => p.label === this.presetLabel()) ?? PRESETS[0],
      clouds: this.cloudsOn(),
      steps: this.steps(),
      scale: this.renderScale(),
      mode: this.cloudMode(),
      jitter: this.jitterOn(),
      fetch: this.fetchOn(),
      rebake: this.rebakeEveryFrame(),
    };
    const setJitter = (on: boolean) => {
      this.jitterOn.set(on);
      for (const volume of this.allVolumes()) volume.uJitter.value = on ? 1 : 0;
    };
    const setFetch = (on: boolean) => {
      this.fetchOn.set(on);
      for (const volume of this.allVolumes()) volume.setFetchEnabled(on);
    };
    setJitter(true);
    setFetch(true);
    for (const volume of this.allVolumes()) volume.alwaysRebakeLight = false;
    const lines: string[] = [];
    const allRuns: { label: string; mode: CloudMode; scale: number }[] = [
      { label: 'box mesh, canvas x1', mode: 'mesh', scale: 1 },
      { label: 'box mesh, canvas x0.5', mode: 'mesh', scale: 0.5 },
      { label: 'screen pass x0.5, canvas x1', mode: 'pass', scale: 1 },
    ];
    const runs = quick ? allRuns.slice(2) : allRuns;
    const total = runs.length * presets.length * (stepList.length + 1) + (quick ? 0 : 3);
    let done = 0;
    const status = (what: string) => this.matrixStatus.set(`${this.statusPrefix}running ${++done}/${total}: ${what}`);
    const net = (ms: string, base: string) => (ms === 'n/a' || base === 'n/a' ? 'n/a' : (+ms - +base).toFixed(2));
    let canvasSize = '';
    let goValue = 'n/a';
    for (const run of runs) {
      const scale = run.scale;
      this.setCloudMode(run.mode);
      this.applyScale(scale);
      const canvas = document.querySelector('canvas');
      canvasSize += `${run.mode}@${scale}:${canvas?.width}x${canvas?.height} `;
      lines.push(run.label, `${'camera'.padEnd(8)}${['off', ...stepList.map((s) => 'net' + s)].map((c) => c.padStart(7)).join('')}`);
      for (const preset of presets) {
        this.applyPreset(preset);
        this.applySteps(32);
        this.setClouds(false);
        status(`${preset.label} off ${run.label}`);
        const off = await this.settle();
        const cells = [off];
        this.setClouds(true);
        for (const s of stepList) {
          this.applySteps(s);
          status(`${preset.label} s${s} ${run.label}`);
          const ms = await this.settle();
          cells.push(net(ms, off));
          if (run.mode === 'mesh' && scale === 0.5 && s === 24 && preset.label === 'inside') goValue = net(ms, off);
        }
        lines.push(`${preset.label.padEnd(8)}${cells.map((c) => c.padStart(7)).join('')}`);
      }
    }

    if (!quick) {
    // Single-factor runs at the heavy view: inside, 32 steps, box mesh, full scale.
    this.setCloudMode('mesh');
    this.applyScale(1);
    this.applyPreset(PRESETS[2]);
    this.setClouds(true);
    this.applySteps(32);
    status('inside s32 baseline');
    const base = await this.settle();
    setJitter(false);
    status('inside s32 jitter off');
    const noJitter = await this.settle();
    setJitter(true);
    setFetch(false);
    status('inside s32 no fetch');
    const noFetch = await this.settle();
    setFetch(true);
    for (const volume of this.allVolumes()) volume.alwaysRebakeLight = true;
    status('inside s32 rebake every frame');
    const rebake = await this.settle();
    lines.push(
      `inside s32 x1 total ms: base ${base}, jitter off ${noJitter}, no fetch ${noFetch}, rebake every frame ${rebake}`,
    );
    const g = parseFloat(goValue);
    const verdict = Number.isNaN(g) ? 'n/a' : g <= 8 ? 'GO (<= 8)' : g <= 12 ? 'PACK FIRST (8-12)' : 'NO-GO (> 12)';
    lines.push(`go line: net cloud cost at x0.5 s24 inside = ${goValue} ms -> ${verdict}`);
    }

    for (const volume of this.allVolumes()) volume.alwaysRebakeLight = saved.rebake;
    setJitter(saved.jitter);
    setFetch(saved.fetch);
    this.setCloudMode(saved.mode);
    this.applyScale(saved.scale);
    this.applyPreset(saved.preset);
    this.setClouds(saved.clouds);
    this.applySteps(saved.steps);
    const text = [
      `cloud-volumes-lab ${this.backendLabel} dpr ${devicePixelRatio} canvas ${canvasSize.trim()} density 128 light 64 volumes ${this.volumeCount()} temporal ${this.temporalOn() ? 'on' : 'off'}`,
      'GPU render ms avg, read after the main render. off = clouds hidden; netNN = (clouds with NN steps) - off',
      ...lines,
    ].join('\n');
    if (publish) await this.publish(text);
    return text;
  }

  private statusPrefix = '';

  private async publish(text: string): Promise<void> {
    this.matrixText.set(text);
    this.matrixStatus.set('');
    await this.copyMatrix();
  }

  /** About two minutes: screen pass only, 24 steps, 1 / 4 / 12 volumes, a 12 s fly-by and four camera spots each. For re-tests. */
  async runQuick(): Promise<void> {
    const saved = { count: this.volumeCount(), steps: this.steps() };
    const parts: string[] = [];
    this.applySteps(24);
    for (const count of this.volumeCounts) {
      this.setVolumeCount(count);
      this.statusPrefix = `quick (${count} volumes): `;
      parts.push(await this.runFlyby(false, true));
      parts.push(await this.runMatrix(false, true));
    }
    this.statusPrefix = '';
    this.setVolumeCount(saved.count);
    this.applySteps(saved.steps);
    await this.publish(parts.join('\n\n'));
  }

  /**
   * Everything in one go: for 1, 4 and 12 volumes, the fly-by at 24 and 64 steps and then the full matrix (about 15 min).
   * Prefer {@link runQuick} for re-tests.
   */
  async runAll(): Promise<void> {
    const saved = { count: this.volumeCount(), steps: this.steps() };
    const parts: string[] = [];
    const stepsList = [24, 64];
    const total = this.volumeCounts.length * (stepsList.length + 1);
    let n = 0;
    for (const count of this.volumeCounts) {
      this.setVolumeCount(count);
      for (const steps of stepsList) {
        this.statusPrefix = `all ${++n}/${total} (${count} volumes, ${steps} steps): `;
        this.applySteps(steps);
        parts.push(await this.runFlyby(false));
      }
      this.statusPrefix = `all ${++n}/${total} (${count} volumes, matrix): `;
      parts.push(await this.runMatrix(false));
    }
    this.statusPrefix = '';
    this.setVolumeCount(saved.count);
    this.applySteps(saved.steps);
    await this.publish(parts.join('\n\n'));
  }

  /** One scripted pass along the great circle at 250 m altitude, 2.4 km in `seconds`; resolves with the GPU ms samples. */
  private flybyOnce(seconds: number): Promise<number[]> {
    this.timer.reset();
    return new Promise((resolve) => {
      const flyby = { t0: performance.now(), duration: seconds * 1000, samples: [] as number[], done: () => resolve(flyby.samples) };
      this.flyby = flyby;
    });
  }

  private stepFlyby(): void {
    const flyby = this.flyby;
    if (!flyby) return;
    const fraction = (performance.now() - flyby.t0) / flyby.duration;
    if (fraction >= 1) {
      this.flyby = undefined;
      flyby.done();
      return;
    }
    const pose = arcPose(-1200 + 2400 * fraction, 250);
    this.position.copy(pose.position);
    this.yaw = 0;
    this.pitch = pose.pitch;
  }

  /**
   * The same scripted fly-by with the box meshes and with the half-resolution screen pass, for the current volume count,
   * sun and settings. Reports GPU ms over the pass (average, 95th percentile, worst sample), so motion cost and spikes show up.
   */
  async runFlyby(publish = true, quick = false): Promise<string> {
    const saved = { mode: this.cloudMode(), preset: PRESETS.find((p) => p.label === this.presetLabel()) ?? PRESETS[0] };
    const lines: string[] = [];
    const modes: [CloudMode, string][] = quick ? [['pass', 'screen pass x0.5']] : [['mesh', 'box mesh'], ['pass', 'screen pass x0.5']];
    for (const [mode, label] of modes) {
      this.setCloudMode(mode);
      this.matrixStatus.set(`${this.statusPrefix}fly-by ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const samples = (await this.flybyOnce(quick ? 12 : 20)).sort((a, b) => a - b);
      const at = (q: number) => samples[Math.floor(q * (samples.length - 1))]?.toFixed(2) ?? 'n/a';
      const avg = samples.length ? (samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2) : 'n/a';
      lines.push(`fly-by ${label}: avg ${avg}, p95 ${at(0.95)}, max ${at(1)} ms over ${samples.length} samples`);
    }
    this.setCloudMode(saved.mode);
    this.applyPreset(saved.preset);
    const text = [
      `cloud-volumes-lab ${this.backendLabel} dpr ${devicePixelRatio} volumes ${this.volumeCount()} steps ${this.steps()} temporal ${this.temporalOn() ? 'on' : 'off'}, 2.4 km at 120 m/s, 250 m altitude`,
      'GPU render ms, one sample per 10 frames, whole frame (clouds on, nothing subtracted)',
      ...lines,
    ].join('\n');
    if (publish) await this.publish(text);
    return text;
  }

  async copyMatrix(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.matrixText());
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }

  record(): void {
    this.recordings.update((list) => [
      ...list,
      {
        preset: this.presetLabel(),
        clouds: this.cloudsOn() ? 'on' : 'off',
        backend: this.backendLabel,
        render: this.renderMs().replace(/ \(last.*$/, ''),
        compute: this.computeMs().replace(/ \(last.*$/, ''),
      },
    ]);
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    this.keys.add(event.code);
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    this.keys.delete(event.code);
  }

  onPointerMove(event: PointerEvent): void {
    if (!(event.buttons & 1)) return;
    this.yaw -= event.movementX * 0.004;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - event.movementY * 0.004));
  }

  num(event: Event): number {
    return Number((event.target as HTMLInputElement).value);
  }

  switchBackend(forceWebGL: boolean): void {
    const url = new URL(globalThis.location.href);
    if (forceWebGL) url.searchParams.set('forceWebGL', '');
    else url.searchParams.delete('forceWebGL');
    url.searchParams.delete('backend');
    globalThis.location.href = url.toString();
  }

  private applySun(): void {
    const el = (this.sunElevation() * Math.PI) / 180;
    const az = (this.sunAzimuth() * Math.PI) / 180;
    const x = Math.cos(el) * Math.sin(az);
    const y = Math.sin(el);
    const z = Math.cos(el) * Math.cos(az);
    for (const volume of this.allVolumes()) volume.setSunDirection(x, y, z);
    this.sun.position.set(x, y, z).multiplyScalar(PLANET_RADIUS * 3).add(VOLUME_CENTER);
    this.sun.target.position.copy(VOLUME_CENTER);
    this.sun.target.updateMatrixWorld();
  }

  private updateCamera(delta: number): void {
    const camera = this.engine.camera;
    const cosPitch = Math.cos(this.pitch);
    this.forward.set(cosPitch * Math.sin(this.yaw), Math.sin(this.pitch), cosPitch * Math.cos(this.yaw));
    this.right.crossVectors(this.forward, camera.up.set(0, 1, 0)).normalize().negate();
    this.move.set(0, 0, 0);
    if (this.keys.has('KeyW')) this.move.add(this.forward);
    if (this.keys.has('KeyS')) this.move.sub(this.forward);
    if (this.keys.has('KeyD')) this.move.add(this.right);
    if (this.keys.has('KeyA')) this.move.sub(this.right);
    if (this.keys.has('KeyE')) this.move.y += 1;
    if (this.keys.has('KeyQ')) this.move.y -= 1;
    if (this.move.lengthSq() > 0) {
      const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1;
      this.position.addScaledVector(this.move.normalize(), this.speed() * fast * delta);
    }
    camera.position.copy(this.position);
    camera.lookAt(this.position.clone().add(this.forward));
    camera.updateMatrixWorld();
  }
}
