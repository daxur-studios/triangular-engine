import { Component, effect, inject, input, signal } from '@angular/core';
import { SunDirectionalLight } from '@takram/three-atmosphere';
import { takeUntil } from 'rxjs';
import { provideObject3DComponent } from 'triangular-engine';
import { Object3DComponent } from 'triangular-engine';
import { TakramAtmosphereService } from './takram-atmosphere.service';

/** Atmosphere-aware direct sunlight for ordinary Three.js materials. */
@Component({
  standalone: true,
  selector: 'takram-sun-light',
  template: '',
  providers: [provideObject3DComponent(TakramSunLightComponent)],
})
export class TakramSunLightComponent extends Object3DComponent {
  private readonly atmosphere = inject(TakramAtmosphereService);

  readonly intensity = input(1);
  readonly distance = input(10000);
  readonly correctAltitude = input(true);
  readonly castShadow = input(false);

  override readonly object3D = signal(
    new SunDirectionalLight({}, this.atmosphere.atmosphere),
  );

  constructor() {
    super();
    effect(() => {
      this.atmosphere.ready();
      const light = this.object3D();
      const textures = this.atmosphere.textures;
      light.transmittanceTexture = textures.transmittanceTexture;
      light.sunDirection.copy(this.atmosphere.sunDirection);
      light.worldToECEFMatrix.copy(this.atmosphere.worldToECEFMatrix);
      light.intensity = this.intensity();
      light.distance = this.distance();
      light.correctAltitude = this.correctAltitude();
      light.castShadow = this.castShadow();
      light.update();
    });
    this.engineService.postTick$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.object3D().update());
  }
}
