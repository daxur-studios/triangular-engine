import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AerialPerspectiveEffect } from '@takram/three-atmosphere';
import type { CloudsEffect } from '@takram/three-clouds';
import { TakramAerialPerspectiveComponent } from '../takram/atmosphere/takram-aerial-perspective.component';
import {
  routeTakramCloudBuffers,
  TakramAtmosphereService,
} from '../takram/atmosphere/takram-atmosphere.service';
import { TakramCloudLayerComponent } from '../takram/clouds/takram-cloud-layer.component';

describe('Takram adapter contracts', () => {
  describe('cloud-layer mapping', () => {
    let fixture: ComponentFixture<TakramCloudLayerComponent>;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [TakramCloudLayerComponent],
      }).compileComponents();
      fixture = TestBed.createComponent(TakramCloudLayerComponent);
    });

    it('maps Angular inputs to Takram cloud-layer values', () => {
      fixture.componentRef.setInput('channel', 'g');
      fixture.componentRef.setInput('altitude', 1200);
      fixture.componentRef.setInput('height', 800);
      fixture.componentRef.setInput('densityScale', 0.35);
      fixture.componentRef.setInput('shadow', true);
      fixture.detectChanges();

      expect(fixture.componentInstance.toCloudLayer()).toEqual(
        jasmine.objectContaining({
          channel: 'g',
          altitude: 1200,
          height: 800,
          densityScale: 0.35,
          shadow: true,
        }),
      );
    });
  });

  describe('buffer routing', () => {
    it('always routes overlay and independently disables shadow buffers', () => {
      const overlay = {} as NonNullable<CloudsEffect['atmosphereOverlay']>;
      const shadow = {} as NonNullable<CloudsEffect['atmosphereShadow']>;
      const shadowLength = {} as NonNullable<
        CloudsEffect['atmosphereShadowLength']
      >;
      const clouds = {
        atmosphereOverlay: overlay,
        atmosphereShadow: shadow,
        atmosphereShadowLength: shadowLength,
      } as Pick<
        CloudsEffect,
        'atmosphereOverlay' | 'atmosphereShadow' | 'atmosphereShadowLength'
      >;
      const aerial = {
        overlay: null,
        shadow: null,
        shadowLength: null,
      } as Pick<AerialPerspectiveEffect, 'overlay' | 'shadow' | 'shadowLength'>;

      routeTakramCloudBuffers(aerial, clouds, true);
      expect(aerial.overlay).toBe(overlay);
      expect(aerial.shadow).toBe(shadow);
      expect(aerial.shadowLength).toBe(shadowLength);

      routeTakramCloudBuffers(aerial, clouds, false);
      expect(aerial.overlay).toBe(overlay);
      expect(aerial.shadow).toBeNull();
      expect(aerial.shadowLength).toBeNull();
    });
  });

  describe('effect lifecycle', () => {
    it('unregisters and disposes aerial perspective on destroy', () => {
      const effect = { dispose: jasmine.createSpy('dispose') };
      const atmosphere = {
        unregisterAerialPerspective: jasmine.createSpy(
          'unregisterAerialPerspective',
        ),
      };
      const component = Object.create(
        TakramAerialPerspectiveComponent.prototype,
      ) as TakramAerialPerspectiveComponent;
      Object.assign(component as object, {
        atmosphere: atmosphere as unknown as TakramAtmosphereService,
        aerialPerspective: effect,
      });

      component.ngOnDestroy();

      expect(atmosphere.unregisterAerialPerspective).toHaveBeenCalledWith(
        effect,
      );
      expect(effect.dispose).toHaveBeenCalled();
      expect(component.effect).toBeUndefined();
    });
  });
});
