import {
  Component,
  effect,
  inject,
  input,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import { PositionalAudio } from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d/object-3d.component';
import { AudioService } from '../../services/audio.service';
import {
  AudioBusName,
  AudioDistanceModel,
} from './audio.model';

/**
 * Declarative 3D Positional Audio component.
 *
 * Attaches to any parent 3D object (e.g. mesh, player, vehicle, particle emitter)
 * and spatializes sound in 3D relative to the active `<audioListener>`.
 *
 * Example:
 * ```html
 * <mesh [position]="[10, 0, 5]">
 *   <boxGeometry />
 *   <meshStandardMaterial />
 *   <positionalAudio
 *     [src]="'assets/audio/fire.mp3'"
 *     [loop]="true"
 *     [autoplay]="true"
 *     [refDistance]="5"
 *     [maxDistance]="50"
 *     [rolloffFactor]="1.5"
 *     bus="ambient"
 *   />
 * </mesh>
 * ```
 */
@Component({
  selector: 'positionalAudio',
  template: `<ng-content></ng-content>`,
  imports: [],
  providers: [provideObject3DComponent(PositionalAudioComponent)],
})
export class PositionalAudioComponent
  extends Object3DComponent
  implements OnDestroy
{
  public override emoji = '🔊';

  readonly audioService = inject(AudioService);

  readonly sound: PositionalAudio;
  override readonly object3D: ReturnType<typeof signal<PositionalAudio>>;

  /** Path to audio file. Automatically loaded and cached. */
  readonly src = input<string | undefined>(undefined);

  /** Preloaded or decoded AudioBuffer (takes precedence over src). */
  readonly buffer = input<AudioBuffer | undefined>(undefined);

  /** Audio mixing bus channel (default 'sfx'). */
  readonly bus = input<AudioBusName>('sfx');

  /** Base volume multiplier (0 to 1+, default 1). */
  readonly volume = input<number>(1);

  /** Whether the audio loops continuously. */
  readonly loop = input<boolean>(false);

  /** Whether playback begins automatically once buffer is loaded. */
  readonly autoplay = input<boolean>(false);

  /** Playback speed rate multiplier (default 1). */
  readonly playbackRate = input<number>(1);

  /** Pitch detune in cents (+/- 100 is semitone, default 0). */
  readonly detune = input<number>(0);

  /** Distance at which volume reduction begins (default 1). */
  readonly refDistance = input<number>(1);

  /** Distance beyond which volume no longer drops (default 1000). */
  readonly maxDistance = input<number>(1000);

  /** How rapidly volume attenuates with distance (default 1). */
  readonly rolloffFactor = input<number>(1);

  /** Distance attenuation model algorithm (default 'inverse'). */
  readonly distanceModel = input<AudioDistanceModel>('inverse');

  /** Directional cone inner angle in degrees (default 360). */
  readonly coneInnerAngle = input<number>(360);

  /** Directional cone outer angle in degrees (default 360). */
  readonly coneOuterAngle = input<number>(360);

  /** Volume reduction multiplier outside the outer cone (default 0). */
  readonly coneOuterGain = input<number>(0);

  /** Emitted when the audio buffer finishes loading. */
  readonly loaded = output<AudioBuffer>();

  /** Emitted when playback reaches the end of the buffer. */
  readonly ended = output<void>();

  /** Emitted when playback status starts or stops. */
  readonly isPlayingChange = output<boolean>();

  private currentBuffer: AudioBuffer | undefined;

  constructor() {
    super();

    const listener = this.audioService.getOrCreateListener();
    this.sound = new PositionalAudio(listener);
    this.object3D = signal(this.sound);

    this.#initEndedCallback();
    this.#initBufferLoading();
    this.#initVolumeSync();
    this.#initPannerSettingsSync();
    this.#initPlaybackSettingsSync();
  }

  get isPlaying(): boolean {
    return this.sound.isPlaying;
  }

  get positionalAudio(): PositionalAudio {
    return this.sound;
  }

  /** Starts or resumes audio playback. */
  play(delay = 0): void {
    if (!this.sound.buffer) return;
    this.audioService.resumeContext();
    if (!this.sound.isPlaying) {
      this.sound.play(delay);
      this.isPlayingChange.emit(true);
    }
  }

  /** Pauses audio playback. */
  pause(): void {
    if (this.sound.isPlaying) {
      this.sound.pause();
      this.isPlayingChange.emit(false);
    }
  }

  /** Stops audio playback and resets to beginning. */
  stop(): void {
    if (this.sound.isPlaying) {
      this.sound.stop();
      this.isPlayingChange.emit(false);
    }
  }

  #initEndedCallback(): void {
    const originalOnEnded = this.sound.onEnded.bind(this.sound);
    this.sound.onEnded = () => {
      originalOnEnded();
      this.isPlayingChange.emit(false);
      this.ended.emit();
    };
  }

  #initBufferLoading(): void {
    effect(async () => {
      const buf = this.buffer();
      const path = this.src();

      if (buf) {
        this.#applyBuffer(buf);
      } else if (path) {
        try {
          const loadedBuffer = await this.audioService.loadAudio(path);
          this.#applyBuffer(loadedBuffer);
        } catch (err) {
          console.error(`[PositionalAudio] Failed to load '${path}':`, err);
        }
      }
    });
  }

  #applyBuffer(buffer: AudioBuffer): void {
    this.currentBuffer = buffer;
    const wasPlaying = this.sound.isPlaying;
    if (wasPlaying) {
      this.sound.stop();
    }
    this.sound.setBuffer(buffer);
    this.loaded.emit(buffer);

    if (this.autoplay() || wasPlaying) {
      this.play();
    }
  }

  #initVolumeSync(): void {
    effect(() => {
      // Subscribe to bus state changes
      this.audioService.busStateVersion();
      const bus = this.bus();
      const vol = this.volume();
      const effective = this.audioService.getEffectiveVolume(bus, vol);
      this.sound.setVolume(effective);
      this.sound.gain.gain.value = effective;
    });
  }

  #initPannerSettingsSync(): void {
    effect(() => {
      this.sound.setRefDistance(this.refDistance());
    });
    effect(() => {
      this.sound.setMaxDistance(this.maxDistance());
    });
    effect(() => {
      this.sound.setRolloffFactor(this.rolloffFactor());
    });
    effect(() => {
      this.sound.setDistanceModel(this.distanceModel());
    });
    effect(() => {
      this.sound.setDirectionalCone(
        this.coneInnerAngle(),
        this.coneOuterAngle(),
        this.coneOuterGain(),
      );
    });
  }

  #initPlaybackSettingsSync(): void {
    effect(() => {
      this.sound.setLoop(this.loop());
    });
    effect(() => {
      this.sound.setPlaybackRate(this.playbackRate());
    });
    effect(() => {
      this.sound.setDetune(this.detune());
    });
  }

  override ngOnDestroy(): void {
    if (this.sound.isPlaying) {
      this.sound.stop();
    }
    this.sound.disconnect();
    super.ngOnDestroy();
  }
}
