import {
  Component,
  effect,
  inject,
  input,
  model,
  OnDestroy,
  signal,
  WritableSignal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AudioListener } from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d/object-3d.component';
import { AudioService } from '../../services/audio.service';

/**
 * Declarative component for Three.js AudioListener.
 *
 * Typically placed in the scene, inside `<camera>`, or alongside `<orbitControls>`.
 * By default, automatically binds to the engine's active camera (`engineService.camera$`),
 * so spatial sounds attenuate on zoom in/out and pan in stereo as the camera orbits.
 *
 * To attach to a character entity instead (e.g. 3rd-person avatar), set `[attachToActiveCamera]="false"`
 * inside any `<mesh>` or `Object3DComponent`.
 *
 * Example:
 * ```html
 * <orbitControls [cameraPosition]="[0, 5, 12]" [target]="[0, 1, 0]" />
 * <audioListener [(masterVolume)]="masterVolume" />
 * ```
 */
@Component({
  selector: 'audioListener',
  template: `<ng-content></ng-content>`,
  imports: [],
  providers: [provideObject3DComponent(AudioListenerComponent)],
})
export class AudioListenerComponent
  extends Object3DComponent
  implements OnDestroy
{
  public override emoji = '🎧';

  readonly audioService = inject(AudioService);

  readonly listener: AudioListener;
  override readonly object3D: WritableSignal<AudioListener>;

  /**
   * Whether to automatically attach and track the active engine camera (`engineService.camera$`).
   * Default: `true`.
   * When true, zooming in/out and orbiting the camera in 3D automatically scales volume
   * and pans stereo channels based on the camera viewpoint.
   * When false, the listener attaches to its declarative parent Object3D (e.g. character mesh).
   */
  readonly attachToActiveCamera = input<boolean>(true);

  /** Master volume multiplier (0 to 1+). */
  readonly masterVolume = model<number>(1);

  /** Optional custom BiquadFilterNode for audio effects (e.g. low-pass filter when underwater). */
  readonly filter = input<BiquadFilterNode | undefined>(undefined);

  constructor() {
    super();

    this.listener = this.audioService.getOrCreateListener();
    this.object3D = signal(this.listener);

    this.audioService.registerListener(this.listener);

    this.#initMasterVolumeSync();
    this.#initFilterSync();
    this.#initCameraAttachment();
  }

  #initMasterVolumeSync(): void {
    effect(() => {
      const vol = this.masterVolume();
      this.listener.setMasterVolume(vol);
      this.listener.gain.gain.value = vol;
      this.audioService.setBusVolume('master', vol);
    });
  }

  #initFilterSync(): void {
    effect(() => {
      const f = this.filter();
      if (f !== undefined) {
        this.listener.setFilter(f);
      } else {
        this.listener.removeFilter();
      }
    });
  }

  #initCameraAttachment(): void {
    toObservable(this.attachToActiveCamera)
      .pipe(
        switchMap((attach) => {
          this.audioService.shouldAutoAttachToCamera = attach;
          if (!attach) {
            // Restore attachment to parent Object3D or scene
            if (this.parent && this.parent.engineService.scene === this.engineService.scene) {
              this.parent.object3D().add(this.listener);
            } else {
              this.engineService.scene.add(this.listener);
            }
            return of(null);
          }
          return this.engineService.camera$ ?? of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((camera) => {
        if (camera) {
          camera.add(this.listener);
          this.listener.position.set(0, 0, 0);
          this.listener.quaternion.identity();
        }
      });
  }

  override ngOnDestroy(): void {
    this.audioService.shouldAutoAttachToCamera = true;
    this.audioService.unregisterListener(this.listener);
    this.listener.removeFromParent();
    super.ngOnDestroy();
  }
}
