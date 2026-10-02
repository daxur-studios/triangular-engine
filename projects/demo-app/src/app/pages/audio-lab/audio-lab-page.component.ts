import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  AmbientLight,
  Color,
  DirectionalLight,
  GridHelper,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from 'three';
import {
  AudioBusName,
  AudioService,
  EngineModule,
  EngineService,
} from 'triangular-engine';
import {
  createAmbientPadBuffer,
  createBeaconLoopBuffer,
  createDroneLoopBuffer,
  createOneShotPingBuffer,
} from './sound-synthesizer.util';

@Component({
  selector: 'app-audio-lab-page',
  standalone: true,
  imports: [RouterLink, EngineModule, DecimalPipe],
  templateUrl: './audio-lab-page.component.html',
  styleUrl: './audio-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class AudioLabPageComponent {
  private readonly engine = inject(EngineService);
  readonly audioService = inject(AudioService);
  private readonly destroyRef = inject(DestroyRef);

  // Audio Context State
  readonly audioContextState = signal<AudioContextState>('suspended');

  // Bus Volumes & Mutes
  readonly masterVolume = signal(1.0);
  readonly musicVolume = signal(0.6);
  readonly sfxVolume = signal(1.0);
  readonly ambientVolume = signal(0.8);

  readonly masterMuted = signal(false);
  readonly musicMuted = signal(false);
  readonly sfxMuted = signal(false);
  readonly ambientMuted = signal(false);

  // Playback toggles
  readonly ambientPlaying = signal(true);
  readonly beaconPlaying = signal(true);
  readonly orbPlaying = signal(true);

  // 3D Spatial parameters
  readonly orbSpeed = signal(1.2);
  readonly orbRefDistance = signal(3.5);
  readonly orbPosition = signal<[number, number, number]>([6, 1.5, 0]);

  // Procedural audio buffers
  readonly ambientBuffer = signal<AudioBuffer | undefined>(undefined);
  readonly beaconBuffer = signal<AudioBuffer | undefined>(undefined);
  readonly droneBuffer = signal<AudioBuffer | undefined>(undefined);

  private pingBuffer: AudioBuffer | undefined;
  private orbAngle = 0;

  constructor() {
    this.#setupSceneLightingAndDecorations();
    this.#generateProceduralBuffers();
    this.#initTickLoop();
  }

  #setupSceneLightingAndDecorations(): void {
    const prevBg = this.engine.scene.background;
    this.engine.scene.background = new Color('#0a0c16');

    const ambientLight = new AmbientLight('#ffffff', 0.4);
    const dirLight = new DirectionalLight('#ffffff', 1.0);
    dirLight.position.set(10, 15, 8);
    dirLight.castShadow = true;
    this.engine.scene.add(ambientLight, dirLight);

    // Grid floor
    const grid = new GridHelper(30, 30, '#3a4b7c', '#1b233d');
    grid.position.y = -0.01;
    this.engine.scene.add(grid);

    // Glowing attenuation rings on floor
    const ringMat = new MeshBasicMaterial({
      color: '#4fc3f7',
      transparent: true,
      opacity: 0.25,
      wireframe: true,
    });
    const ring1 = new Mesh(new RingGeometry(3.45, 3.55, 64), ringMat);
    ring1.rotation.x = -Math.PI / 2;
    this.engine.scene.add(ring1);

    this.engine.onDestroy$.subscribe(() => {
      this.engine.scene.background = prevBg;
      this.engine.scene.remove(grid, ring1, ambientLight, dirLight);
      ringMat.dispose();
    });
  }

  #generateProceduralBuffers(): void {
    const listener = this.audioService.getOrCreateListener();
    const ctx = listener.context;

    this.ambientBuffer.set(createAmbientPadBuffer(ctx));
    this.beaconBuffer.set(createBeaconLoopBuffer(ctx));
    this.droneBuffer.set(createDroneLoopBuffer(ctx));
    this.pingBuffer = createOneShotPingBuffer(ctx);

    this.audioContextState.set(ctx.state);
  }

  #initTickLoop(): void {
    const radius = 6.0;

    this.engine.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((delta) => {
        // Animate revolving sound orb
        if (this.orbPlaying()) {
          this.orbAngle += delta * this.orbSpeed();
          const x = radius * Math.cos(this.orbAngle);
          const z = radius * Math.sin(this.orbAngle);
          const y = 1.5 + 0.6 * Math.sin(this.orbAngle * 2);
          this.orbPosition.set([x, y, z]);
        }

        // Check audio context status
        const ctx = this.audioService.getOrCreateListener().context;
        if (ctx && ctx.state !== this.audioContextState()) {
          this.audioContextState.set(ctx.state);
        }
      });
  }

  // #region Volume & Mute Handlers

  updateMasterVolume(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    this.masterVolume.set(val);
    this.audioService.setBusVolume('master', val);
  }

  updateMusicVolume(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    this.musicVolume.set(val);
    this.audioService.setBusVolume('music', val);
  }

  updateSfxVolume(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    this.sfxVolume.set(val);
    this.audioService.setBusVolume('sfx', val);
  }

  updateAmbientVolume(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    this.ambientVolume.set(val);
    this.audioService.setBusVolume('ambient', val);
  }

  toggleMute(bus: AudioBusName): void {
    const isMuted = this.audioService.isBusMuted(bus);
    const next = !isMuted;
    this.audioService.setBusMuted(bus, next);

    if (bus === 'master') this.masterMuted.set(next);
    if (bus === 'music') this.musicMuted.set(next);
    if (bus === 'sfx') this.sfxMuted.set(next);
    if (bus === 'ambient') this.ambientMuted.set(next);
  }

  // #endregion

  // #region Playback Controls

  toggleOrbPlayback(): void {
    this.orbPlaying.update((v) => !v);
  }

  toggleBeaconPlayback(): void {
    this.beaconPlaying.update((v) => !v);
  }

  toggleAmbientPlayback(): void {
    this.ambientPlaying.update((v) => !v);
  }

  updateOrbSpeed(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    this.orbSpeed.set(val);
  }

  updateOrbRefDistance(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    this.orbRefDistance.set(val);
  }

  // #endregion

  // #region One-Shot SFX Triggers

  async unlockAudio(): Promise<void> {
    this.audioService.resumeContext();
    const ctx = this.audioService.getOrCreateListener().context;
    this.audioContextState.set(ctx.state);
  }

  async trigger2DOneShot(): Promise<void> {
    const ctx = this.audioService.getOrCreateListener().context;
    const buf = this.pingBuffer ?? createOneShotPingBuffer(ctx, 1046.5); // High C6
    await this.audioService.playOneShot(buf, {
      bus: 'ui',
      volume: 0.7,
      playbackRate: 1.0,
    });
  }

  async triggerOrbOneShot(): Promise<void> {
    const ctx = this.audioService.getOrCreateListener().context;
    const buf = createOneShotPingBuffer(ctx, 440, 1.2); // A4 laser chime
    const pos = this.orbPosition();
    await this.audioService.playPositionalOneShot(buf, pos, {
      bus: 'sfx',
      refDistance: 2.0,
      maxDistance: 40.0,
      rolloffFactor: 1.5,
    });
  }

  async triggerCenterOneShot(): Promise<void> {
    const ctx = this.audioService.getOrCreateListener().context;
    const buf = createOneShotPingBuffer(ctx, 261.63, 1.5); // Deep C4 bell
    await this.audioService.playPositionalOneShot(buf, [0, 2, 0], {
      bus: 'sfx',
      refDistance: 4.0,
      maxDistance: 60.0,
      rolloffFactor: 1.0,
    });
  }

  // #endregion
}
