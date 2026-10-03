import { DecimalPipe, TitleCasePipe, UpperCasePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AmbientLight,
  Color,
  DirectionalLight,
  GridHelper,
  Mesh,
  MeshStandardMaterial,
  RingGeometry,
  Vector3Tuple,
} from 'three';
import {
  AudioService,
  EngineModule,
  EngineService,
  ParticleBlending,
  ParticleEmitterShape,
  ParticlePreset,
  VfxService,
} from 'triangular-engine';

@Component({
  selector: 'app-vfx-lab-page',
  standalone: true,
  imports: [RouterLink, EngineModule, DecimalPipe, UpperCasePipe, TitleCasePipe],
  templateUrl: './vfx-lab-page.component.html',
  styleUrl: './vfx-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class VfxLabPageComponent {
  private readonly engine = inject(EngineService);
  private readonly vfx = inject(VfxService);
  private readonly audioService = inject(AudioService);
  private readonly destroyRef = inject(DestroyRef);

  // Active Main Emitter Configuration (Controlled via HUD)
  readonly activePreset = signal<ParticlePreset>('fire');
  readonly emissionRate = signal(90);
  readonly maxParticles = signal(500);
  readonly spreadAngle = signal(30);
  readonly speedMin = signal(1.5);
  readonly speedMax = signal(3.5);
  readonly gravityY = signal(1.2);
  readonly blendingMode = signal<ParticleBlending>('additive');
  readonly emitterShape = signal<ParticleEmitterShape>('sphere');

  // Station Toggles
  readonly campfireActive = signal(true);
  readonly sparksActive = signal(true);
  readonly portalActive = signal(true);
  readonly weatherActive = signal(false);
  readonly weatherMode = signal<'snow' | 'rain'>('snow');

  // Real-time particle counter
  readonly mainEmitterActiveCount = signal(0);
  readonly totalExplosionsSpawned = signal(0);

  constructor() {
    this.#setupSceneEnvironment();
  }

  #setupSceneEnvironment(): void {
    const prevBg = this.engine.scene.background;
    this.engine.scene.background = new Color('#070913');

    const ambientLight = new AmbientLight('#ffffff', 0.5);
    const dirLight = new DirectionalLight('#ffffff', 1.2);
    dirLight.position.set(12, 20, 10);
    this.engine.scene.add(ambientLight, dirLight);

    // Grid floor
    const grid = new GridHelper(30, 30, '#3f51b5', '#1a237e');
    grid.position.y = -0.01;
    this.engine.scene.add(grid);

    // Decorative ring around the interactive showcase pedestal
    const ringMat = new MeshStandardMaterial({
      color: '#3949ab',
      roughness: 0.4,
      metalness: 0.6,
    });
    const ring = new Mesh(new RingGeometry(1.8, 2.0, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    this.engine.scene.add(ring);

    this.engine.onDestroy$.subscribe(() => {
      this.engine.scene.background = prevBg;
      this.engine.scene.remove(ambientLight, dirLight, grid, ring);
      ringMat.dispose();
    });
  }

  // #region HUD Handlers
  selectPreset(preset: ParticlePreset): void {
    this.activePreset.set(preset);
    // Apply preset defaults to tuner controls
    switch (preset) {
      case 'fire':
        this.emissionRate.set(90);
        this.spreadAngle.set(28);
        this.speedMin.set(1.5);
        this.speedMax.set(3.5);
        this.gravityY.set(1.2);
        this.blendingMode.set('additive');
        this.emitterShape.set('sphere');
        break;
      case 'smoke':
        this.emissionRate.set(30);
        this.spreadAngle.set(35);
        this.speedMin.set(0.8);
        this.speedMax.set(1.8);
        this.gravityY.set(0.8);
        this.blendingMode.set('normal');
        this.emitterShape.set('sphere');
        break;
      case 'sparks':
        this.emissionRate.set(70);
        this.spreadAngle.set(75);
        this.speedMin.set(4.0);
        this.speedMax.set(9.0);
        this.gravityY.set(-12.0);
        this.blendingMode.set('additive');
        this.emitterShape.set('point');
        break;
      case 'magic':
        this.emissionRate.set(50);
        this.spreadAngle.set(120);
        this.speedMin.set(0.8);
        this.speedMax.set(2.0);
        this.gravityY.set(0.3);
        this.blendingMode.set('additive');
        this.emitterShape.set('ring');
        break;
      case 'snow':
        this.emissionRate.set(120);
        this.spreadAngle.set(40);
        this.speedMin.set(0.8);
        this.speedMax.set(1.8);
        this.gravityY.set(-0.5);
        this.blendingMode.set('normal');
        this.emitterShape.set('box');
        break;
      case 'rain':
        this.emissionRate.set(220);
        this.spreadAngle.set(5);
        this.speedMin.set(12.0);
        this.speedMax.set(18.0);
        this.gravityY.set(-18.0);
        this.blendingMode.set('normal');
        this.emitterShape.set('box');
        break;
      default:
        break;
    }
  }

  toggleBlending(): void {
    this.blendingMode.update((b) => (b === 'additive' ? 'normal' : 'additive'));
  }

  toggleWeather(): void {
    this.weatherActive.update((w) => !w);
  }

  toggleWeatherType(): void {
    this.weatherMode.update((m) => (m === 'snow' ? 'rain' : 'snow'));
  }
  // #endregion

  // #region One-Shot Spawning
  triggerCenterExplosion(): void {
    const pos: Vector3Tuple = [0, 1.2, 0];
    this.vfx.spawnExplosion(pos, 1.3, 160);
    this.vfx.spawnSparks(pos, [0, 1, 0], 50);
    this.totalExplosionsSpawned.update((n) => n + 1);

    // Audio cue
    this.#playExplosionSound(pos);
  }

  triggerSparksSpray(): void {
    const pos: Vector3Tuple = [-5, 2.5, 0];
    this.vfx.spawnSparks(pos, [0.5, 1, 0.2], 60);

    // Audio cue
    const ctx = this.audioService.getOrCreateListener().context;
    if (ctx && ctx.state === 'running') {
      const buf = ctx.createBuffer(1, 4000, 44100);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 800);
      }
      this.audioService.playPositionalOneShot(buf, pos, { bus: 'sfx', volume: 0.6 });
    }
  }

  triggerMagicNova(): void {
    const pos: Vector3Tuple = [5, 1.5, 0];
    this.vfx.spawnMagicBurst(pos, 90);
  }

  triggerFireworksSalvo(): void {
    const targets: Vector3Tuple[] = [
      [-3, 6, -4],
      [0, 8, -6],
      [3, 7, -3],
    ];

    targets.forEach((pos, idx) => {
      setTimeout(() => {
        this.vfx.spawnExplosion(pos, 1.2, 140);
        this.vfx.spawnSparks(pos, [0, -1, 0], 40);
        this.#playExplosionSound(pos);
        this.totalExplosionsSpawned.update((n) => n + 1);
      }, idx * 280);
    });
  }

  #playExplosionSound(pos: Vector3Tuple): void {
    const ctx = this.audioService.getOrCreateListener().context;
    if (ctx && ctx.state === 'running') {
      const sampleRate = 44100;
      const duration = 1.0;
      const buf = ctx.createBuffer(1, sampleRate * duration, sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 5.0);
        const boom = Math.sin(2.0 * Math.PI * (70 - t * 45) * t);
        const noise = (Math.random() * 2 - 1) * 0.4;
        data[i] = (boom + noise) * env;
      }
      this.audioService.playPositionalOneShot(buf, pos, {
        bus: 'sfx',
        volume: 0.9,
        refDistance: 4,
        maxDistance: 60,
      });
    }
  }
  // #endregion
}
