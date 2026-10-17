import { Component, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, SphereGeometry, Vector3 } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { CloudVolume } from 'triangular-engine/cloud-volumes';
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

interface CameraPreset {
  readonly label: string;
  /** Offset from the volume centre. */
  readonly offset: readonly [number, number, number];
  /** Look-at point, offset from the volume centre. */
  readonly target: readonly [number, number, number];
}

const PRESETS: readonly CameraPreset[] = [
  { label: 'outside', offset: [0, 120, 1300], target: [0, 0, 0] },
  { label: 'edge', offset: [0, 0, 330], target: [0, 0, 0] },
  { label: 'inside', offset: [60, 0, 40], target: [-120, 10, -300] },
  { label: 'above', offset: [0, 450, 60], target: [0, 0, 0] },
  { label: 'below', offset: [0, -170, 0], target: [0, 100, 0] },
];

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
        <button (click)="toggleFetch()" [class.active]="!fetchOn()">no fetch</button>
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
  readonly fetchOn = signal(true);
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
      this.updateCamera(delta);
      const renderer: any = this.engine.renderer;
      if (!renderer?.initialized) return;
      this.volume.update(renderer);
      this.densityBakes.set(this.volume.densityBakes);
      this.lightBakes.set(this.volume.lightBakes);
    });
    // Read the timestamps after the frame's main render, so the sample covers the bakes and the march of one frame.
    const rendered = this.engine.renderComplete$.subscribe(() => {
      const renderer: any = this.engine.renderer;
      this.timer.tick(renderer, () => {
        this.renderMs.set(this.format(this.timer.render));
        this.computeMs.set(this.format(this.timer.compute));
      });
    });
    this.destroyRef.onDestroy(() => {
      tick.unsubscribe();
      rendered.unsubscribe();
      this.applyScale(1);
      this.engine.scene.remove(this.planet, this.volume.mesh, this.sun, this.hemi);
      this.planet.geometry.dispose();
      (this.planet.material as MeshStandardMaterial).dispose();
      this.volume.dispose();
    });
  }

  private format(reading: { last: number | undefined; average: number | undefined }): string {
    if (reading.average === undefined || reading.last === undefined) return 'n/a (no timestamp query)';
    return `${reading.average.toFixed(2)} ms avg (last ${reading.last.toFixed(2)})`;
  }

  applyPreset(preset: CameraPreset): void {
    this.presetLabel.set(preset.label);
    this.position.copy(VOLUME_CENTER).add(new Vector3(...preset.offset));
    const target = VOLUME_CENTER.clone().add(new Vector3(...preset.target));
    const dir = target.sub(this.position).normalize();
    this.yaw = Math.atan2(dir.x, dir.z);
    this.pitch = Math.asin(dir.y);
    this.timer.reset();
    this.renderMs.set('n/a');
    this.computeMs.set('n/a');
  }

  setClouds(on: boolean): void {
    this.cloudsOn.set(on);
    this.volume.mesh.visible = on;
    this.timer.reset();
  }

  toggleRebake(): void {
    this.rebakeEveryFrame.update((v) => !v);
    this.volume.alwaysRebakeLight = this.rebakeEveryFrame();
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
    this.volume.uExtinction.value = this.extinction();
    this.volume.invalidateDensity();
  }

  setSteps(event: Event): void {
    this.applySteps(this.num(event));
  }

  private applySteps(n: number): void {
    this.steps.set(n);
    this.volume.uMarchSteps.value = n;
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
    this.volume.uJitter.value = this.jitterOn() ? 1 : 0;
    this.timer.reset();
  }

  toggleFetch(): void {
    this.fetchOn.update((v) => !v);
    this.volume.setFetchEnabled(this.fetchOn());
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
  async runMatrix(): Promise<void> {
    const stepList = [16, 24, 32];
    const saved = {
      preset: PRESETS.find((p) => p.label === this.presetLabel()) ?? PRESETS[0],
      clouds: this.cloudsOn(),
      steps: this.steps(),
      scale: this.renderScale(),
      jitter: this.jitterOn(),
      fetch: this.fetchOn(),
      rebake: this.rebakeEveryFrame(),
    };
    const setJitter = (on: boolean) => {
      this.jitterOn.set(on);
      this.volume.uJitter.value = on ? 1 : 0;
    };
    const setFetch = (on: boolean) => {
      this.fetchOn.set(on);
      this.volume.setFetchEnabled(on);
    };
    setJitter(true);
    setFetch(true);
    this.volume.alwaysRebakeLight = false;
    const lines: string[] = [];
    const total = 2 * PRESETS.length * (stepList.length + 1) + 3;
    let done = 0;
    const status = (what: string) => this.matrixStatus.set(`running ${++done}/${total}: ${what}`);
    const net = (ms: string, base: string) => (ms === 'n/a' || base === 'n/a' ? 'n/a' : (+ms - +base).toFixed(2));
    let canvasSize = '';
    let goValue = 'n/a';
    for (const scale of [1, 0.5]) {
      this.applyScale(scale);
      const canvas = document.querySelector('canvas');
      canvasSize += `${scale}:${canvas?.width}x${canvas?.height} `;
      lines.push(`scale ${scale}`, `${'camera'.padEnd(8)}${['off', ...stepList.map((s) => 'net' + s)].map((c) => c.padStart(7)).join('')}`);
      for (const preset of PRESETS) {
        this.applyPreset(preset);
        this.applySteps(32);
        this.setClouds(false);
        status(`${preset.label} off x${scale}`);
        const off = await this.settle();
        const cells = [off];
        this.setClouds(true);
        for (const s of stepList) {
          this.applySteps(s);
          status(`${preset.label} s${s} x${scale}`);
          const ms = await this.settle();
          cells.push(net(ms, off));
          if (scale === 0.5 && s === 24 && preset.label === 'inside') goValue = net(ms, off);
        }
        lines.push(`${preset.label.padEnd(8)}${cells.map((c) => c.padStart(7)).join('')}`);
      }
    }

    // Single-factor runs at the heavy view: inside, 32 steps, full scale.
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
    this.volume.alwaysRebakeLight = true;
    status('inside s32 rebake every frame');
    const rebake = await this.settle();
    lines.push(
      `inside s32 x1 total ms: base ${base}, jitter off ${noJitter}, no fetch ${noFetch}, rebake every frame ${rebake}`,
    );
    const g = parseFloat(goValue);
    const verdict = Number.isNaN(g) ? 'n/a' : g <= 8 ? 'GO (<= 8)' : g <= 12 ? 'PACK FIRST (8-12)' : 'NO-GO (> 12)';
    lines.push(`go line: net cloud cost at x0.5 s24 inside = ${goValue} ms -> ${verdict}`);

    this.volume.alwaysRebakeLight = saved.rebake;
    setJitter(saved.jitter);
    setFetch(saved.fetch);
    this.applyScale(saved.scale);
    this.applyPreset(saved.preset);
    this.setClouds(saved.clouds);
    this.applySteps(saved.steps);
    this.matrixText.set(
      [
        `cloud-volumes-lab ${this.backendLabel} dpr ${devicePixelRatio} canvas ${canvasSize.trim()} density 128 light 64`,
        'GPU render ms avg, read after the main render. off = clouds hidden; netNN = (clouds with NN steps) - off',
        ...lines,
      ].join('\n'),
    );
    this.matrixStatus.set('');
    await this.copyMatrix();
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
    this.volume.setSunDirection(x, y, z);
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
