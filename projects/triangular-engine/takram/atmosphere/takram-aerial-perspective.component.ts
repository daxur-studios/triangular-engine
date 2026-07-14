import { Component, effect, input, OnDestroy } from '@angular/core';
import { AerialPerspectiveEffect } from '@takram/three-atmosphere';
import type { Camera } from 'three';
import { PostprocessingEffectComponent } from 'triangular-engine/postprocessing';
import { TakramAtmosphereService } from './takram-atmosphere.service';

/** Declarative Takram aerial-perspective and sky composition effect. */
@Component({
  standalone: true,
  selector: 'takram-aerial-perspective',
  template: '',
  providers: [
    {
      provide: PostprocessingEffectComponent,
      useExisting: TakramAerialPerspectiveComponent,
    },
  ],
})
export class TakramAerialPerspectiveComponent
  extends PostprocessingEffectComponent
  implements OnDestroy
{
  readonly sky = input(true);
  readonly sun = input(true);
  readonly moon = input(true);
  readonly ground = input(true);
  readonly sunLight = input(false);
  readonly skyLight = input(false);
  readonly transmittance = input(true);
  readonly inscatter = input(true);
  /** Compose cloud shadow and light-shaft buffers into aerial perspective. */
  readonly cloudShadows = input(true);

  private aerialPerspective: AerialPerspectiveEffect | undefined;

  constructor(private readonly atmosphere: TakramAtmosphereService) {
    super();
    effect(() => {
      const settings = this.settings();
      this.atmosphere.setCloudShadowsEnabled(this.cloudShadows());
      if (this.aerialPerspective) {
        Object.assign(this.aerialPerspective, settings);
      }
    });
  }

  override createEffect(camera: Camera): AerialPerspectiveEffect {
    if (this.aerialPerspective) {
      this.atmosphere.unregisterAerialPerspective(this.aerialPerspective);
    }
    const effect = new AerialPerspectiveEffect(
      camera,
      this.settings(),
      this.atmosphere.atmosphere,
    );
    this.aerialPerspective = effect;
    this.atmosphere.registerAerialPerspective(effect);
    return effect;
  }

  ngOnDestroy(): void {
    if (this.aerialPerspective) {
      this.atmosphere.unregisterAerialPerspective(this.aerialPerspective);
      this.aerialPerspective.dispose();
      this.aerialPerspective = undefined;
    }
  }

  get effect(): AerialPerspectiveEffect | undefined {
    return this.aerialPerspective;
  }

  private settings() {
    return {
      sky: this.sky(),
      sun: this.sun(),
      moon: this.moon(),
      ground: this.ground(),
      sunLight: this.sunLight(),
      skyLight: this.skyLight(),
      transmittance: this.transmittance(),
      inscatter: this.inscatter(),
    };
  }
}
