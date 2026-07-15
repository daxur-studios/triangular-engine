import { Component, effect, inject, input, signal } from '@angular/core';
import { SkyLightProbe } from '@takram/three-atmosphere';
import { takeUntil } from 'rxjs';
import { Object3DComponent, provideObject3DComponent } from 'triangular-engine';
import { TakramAtmosphereService } from './takram-atmosphere.service';

/** Atmosphere-aware indirect skylight for ordinary Three.js materials. */
@Component({
  standalone: true,
  selector: 'takram-sky-light',
  template: '',
  providers: [provideObject3DComponent(TakramSkyLightComponent)],
})
export class TakramSkyLightComponent extends Object3DComponent {
  private readonly atmosphere = inject(TakramAtmosphereService);

  readonly intensity = input(1);
  readonly correctAltitude = input(true);

  override readonly object3D = signal(
    new SkyLightProbe({}, this.atmosphere.atmosphere),
  );

  constructor() {
    super();
    effect(() => {
      this.atmosphere.ready();
      const light = this.object3D();
      const textures = this.atmosphere.textures;
      light.irradianceTexture = textures.irradianceTexture;
      light.sunDirection.copy(this.atmosphere.sunDirection);
      light.worldToECEFMatrix.copy(this.atmosphere.worldToECEFMatrix);
      light.intensity = this.intensity();
      light.correctAltitude = this.correctAltitude();
      light.update();
    });
    this.engineService.postTick$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.object3D().update());
  }
}
