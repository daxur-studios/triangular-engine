import {
  inject,
  Injectable,
  signal,
  WritableSignal,
} from '@angular/core';
import {
  Audio,
  AudioListener,
  PositionalAudio,
  Vector3,
  Vector3Tuple,
} from 'three';
import {
  AudioBusName,
  PlayOneShotOptions,
  PlayPositionalOneShotOptions,
} from '../components/audio/audio.model';
import { AudioCacheService } from './audio-cache.service';
import { EngineService } from './engine.service';
import { LoaderService } from './loader.service';

interface BusState {
  volume: WritableSignal<number>;
  muted: WritableSignal<boolean>;
}

@Injectable({
  providedIn: 'root',
})
export class AudioService {
  private readonly injectedEngineService = inject(EngineService, {
    optional: true,
  });
  private get engineService() {
    return this.injectedEngineService ?? EngineService.activeInstance;
  }

  readonly #loaderService = inject(LoaderService);
  readonly #audioCacheService = inject(AudioCacheService);

  readonly #buses = new Map<string, BusState>();

  /** Canonical AudioListener managed by the engine. */
  readonly #listener = new AudioListener();

  /** Public getter for the canonical AudioListener instance. */
  get listener(): AudioListener {
    return this.#listener;
  }

  /** Signal incremented whenever any bus volume or mute changes. */
  readonly busStateVersion = signal(0);

  /** The currently registered active AudioListener in the scene. */
  readonly activeListener = signal<AudioListener | undefined>(undefined);

  /**
   * Whether the canonical listener should automatically attach to the active engine camera.
   * Controlled by AudioListenerComponent (default true).
   */
  public shouldAutoAttachToCamera = true;

  /** True once autoplay unlock listeners have been initialized. */
  private unlockListenersAttached = false;

  constructor() {
    // Initialize standard game engine audio buses
    const defaultBuses: AudioBusName[] = [
      'master',
      'music',
      'sfx',
      'ambient',
      'voice',
      'ui',
    ];
    for (const bus of defaultBuses) {
      this.#getOrCreateBus(bus);
    }

    this.#initAutoplayUnlock();
    this.#initCameraTracking();
  }

  #initCameraTracking(): void {
    const engine = this.engineService;
    if (!engine?.camera$) return;

    engine.camera$.subscribe((camera) => {
      if (this.shouldAutoAttachToCamera && camera) {
        camera.add(this.#listener);
        this.#listener.position.set(0, 0, 0);
        this.#listener.quaternion.identity();
      }
    });
  }

  // #region Audio Buses

  #getOrCreateBus(bus: AudioBusName): BusState {
    let state = this.#buses.get(bus);
    if (!state) {
      state = {
        volume: signal(1),
        muted: signal(false),
      };
      this.#buses.set(bus, state);
    }
    return state;
  }

  /** Gets the volume multiplier for a specific bus (0 to 1+). */
  getBusVolume(bus: AudioBusName): number {
    return this.#getOrCreateBus(bus).volume();
  }

  /** Gets the WritableSignal for a specific bus volume. */
  getBusVolumeSignal(bus: AudioBusName): WritableSignal<number> {
    return this.#getOrCreateBus(bus).volume;
  }

  /** Sets the volume multiplier for a specific bus. */
  setBusVolume(bus: AudioBusName, volume: number): void {
    const clamped = Math.max(0, volume);
    this.#getOrCreateBus(bus).volume.set(clamped);
    this.busStateVersion.update((v) => v + 1);

    // If master volume changed, sync listener volume
    if (bus === 'master') {
      const listener = this.getOrCreateListener();
      if (listener) {
        const isMuted = this.isBusMuted('master');
        const target = isMuted ? 0 : clamped;
        listener.setMasterVolume(target);
        listener.gain.gain.value = target;
      }
    }
  }

  /** Checks if a specific bus is muted. */
  isBusMuted(bus: AudioBusName): boolean {
    return this.#getOrCreateBus(bus).muted();
  }

  /** Gets the WritableSignal for a specific bus mute state. */
  getBusMutedSignal(bus: AudioBusName): WritableSignal<boolean> {
    return this.#getOrCreateBus(bus).muted;
  }

  /** Sets the mute state for a specific bus. */
  setBusMuted(bus: AudioBusName, muted: boolean): void {
    this.#getOrCreateBus(bus).muted.set(muted);
    this.busStateVersion.update((v) => v + 1);

    if (bus === 'master') {
      const listener = this.getOrCreateListener();
      if (listener) {
        const masterVol = this.getBusVolume('master');
        const target = muted ? 0 : masterVol;
        listener.setMasterVolume(target);
        listener.gain.gain.value = target;
      }
    }
  }

  /**
   * Calculates the combined effective volume for a sound on a given bus:
   * Effective Volume = Base Volume * Bus Volume * Master Volume (0 if either is muted).
   */
  getEffectiveVolume(bus: AudioBusName, baseVolume = 1): number {
    if (this.isBusMuted('master')) return 0;
    const masterVol = this.getBusVolume('master');

    if (bus === 'master') {
      return Math.max(0, baseVolume * masterVol);
    }

    if (this.isBusMuted(bus)) return 0;
    const busVol = this.getBusVolume(bus);
    return Math.max(0, baseVolume * busVol * masterVol);
  }

  // #endregion

  // #region Listener Management

  /** Register an active AudioListener (typically from `<audioListener>`). */
  registerListener(listener: AudioListener): void {
    this.activeListener.set(listener);
    const masterVol = this.getBusVolume('master');
    const isMuted = this.isBusMuted('master');
    const target = isMuted ? 0 : masterVol;
    listener.setMasterVolume(target);
    listener.gain.gain.value = target;
  }

  /** Unregister an AudioListener when its component is destroyed. */
  unregisterListener(listener: AudioListener): void {
    if (this.activeListener() === listener) {
      this.activeListener.set(undefined);
    }
  }

  /**
   * Returns the registered active AudioListener, or the canonical engine listener
   * so audio playback works immediately without requiring declarative setup.
   */
  getOrCreateListener(): AudioListener {
    return this.activeListener() ?? this.#listener;
  }

  // #endregion

  // #region Autoplay Policy & AudioContext Resume

  /** Resumes the Web Audio Context if it is suspended by the browser. Non-blocking. */
  resumeContext(): void {
    const listener = this.getOrCreateListener();
    const context = listener?.context;
    if (context && context.state === 'suspended') {
      try {
        context.resume().catch(() => {});
      } catch (err) {
        console.warn('Failed to resume AudioContext:', err);
      }
    }
  }

  #initAutoplayUnlock(): void {
    if (this.unlockListenersAttached || typeof window === 'undefined') return;
    this.unlockListenersAttached = true;

    const unlock = () => {
      this.resumeContext();
      const listener = this.getOrCreateListener();
      if (listener?.context?.state === 'running') {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('touchstart', unlock);
      }
    };

    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
  }

  // #endregion

  // #region Asset Loading & Caching

  /**
   * Loads an audio file and caches its decoded AudioBuffer.
   */
  async loadAudio(src: string): Promise<AudioBuffer> {
    // Check signal cache first
    const cacheSignal = this.#audioCacheService.getAudioCache(src);
    const existing = cacheSignal();
    if (existing) return existing;

    const buffer = await this.#loaderService.loadAndCacheAudio(src);
    this.#audioCacheService.setAudioCache(src, buffer);
    return buffer;
  }

  // #endregion

  // #region One-Shot Playback

  /**
   * Plays a non-positional 2D sound effect once (e.g. UI click, ambient sting).
   * Automatically cleans up and disposes nodes when finished.
   */
  async playOneShot(
    srcOrBuffer: string | AudioBuffer,
    options?: PlayOneShotOptions,
  ): Promise<Audio | undefined> {
    const listener = this.getOrCreateListener();
    this.resumeContext();

    let buffer: AudioBuffer;
    if (typeof srcOrBuffer === 'string') {
      try {
        buffer = await this.loadAudio(srcOrBuffer);
      } catch (error) {
        console.error(`[AudioService] Failed to load audio '${srcOrBuffer}':`, error);
        return undefined;
      }
    } else {
      buffer = srcOrBuffer;
    }

    const audio = new Audio(listener);
    audio.setBuffer(buffer);

    const bus = options?.bus ?? 'sfx';
    const volume = options?.volume ?? 1;
    const effective = this.getEffectiveVolume(bus, volume);
    audio.setVolume(effective);
    audio.gain.gain.value = effective;

    if (options?.playbackRate !== undefined) {
      audio.setPlaybackRate(options.playbackRate);
    }
    if (options?.detune !== undefined) {
      audio.setDetune(options.detune);
    }
    audio.setLoop(options?.loop ?? false);

    // Auto-cleanup on end
    const prevOnEnded = audio.onEnded.bind(audio);
    audio.onEnded = () => {
      prevOnEnded();
      if (!audio.loop) {
        audio.disconnect();
      }
    };

    audio.play();
    return audio;
  }

  /**
   * Plays a 3D positional sound effect once at a given position in space
   * (e.g. explosion, weapon shot, footstep).
   * Automatically attaches to the scene/parent and cleans up when finished.
   */
  async playPositionalOneShot(
    srcOrBuffer: string | AudioBuffer,
    position: Vector3Tuple | Vector3,
    options?: PlayPositionalOneShotOptions,
  ): Promise<PositionalAudio | undefined> {
    const listener = this.getOrCreateListener();
    this.resumeContext();

    let buffer: AudioBuffer;
    if (typeof srcOrBuffer === 'string') {
      try {
        buffer = await this.loadAudio(srcOrBuffer);
      } catch (error) {
        console.error(`[AudioService] Failed to load positional audio '${srcOrBuffer}':`, error);
        return undefined;
      }
    } else {
      buffer = srcOrBuffer;
    }

    const sound = new PositionalAudio(listener);
    sound.setBuffer(buffer);

    if (Array.isArray(position)) {
      sound.position.set(...position);
    } else {
      sound.position.copy(position);
    }

    const bus = options?.bus ?? 'sfx';
    const volume = options?.volume ?? 1;
    const effective = this.getEffectiveVolume(bus, volume);
    sound.setVolume(effective);
    sound.gain.gain.value = effective;

    if (options?.refDistance !== undefined) {
      sound.setRefDistance(options.refDistance);
    }
    if (options?.maxDistance !== undefined) {
      sound.setMaxDistance(options.maxDistance);
    }
    if (options?.rolloffFactor !== undefined) {
      sound.setRolloffFactor(options.rolloffFactor);
    }
    if (options?.distanceModel !== undefined) {
      sound.setDistanceModel(options.distanceModel);
    }
    if (options?.cone) {
      sound.setDirectionalCone(
        options.cone.innerAngle ?? 360,
        options.cone.outerAngle ?? 360,
        options.cone.outerGain ?? 0,
      );
    }
    if (options?.playbackRate !== undefined) {
      sound.setPlaybackRate(options.playbackRate);
    }
    if (options?.detune !== undefined) {
      sound.setDetune(options.detune);
    }
    sound.setLoop(options?.loop ?? false);

    // Attach to parent or current scene
    const parent = options?.parent ?? this.engineService?.scene;
    if (parent) {
      parent.add(sound);
    }

    // Auto-cleanup on end
    const prevOnEnded = sound.onEnded.bind(sound);
    sound.onEnded = () => {
      prevOnEnded();
      if (!sound.loop) {
        if (parent) {
          parent.remove(sound);
        }
        sound.disconnect();
      }
    };

    sound.play();
    return sound;
  }

  // #endregion
}
