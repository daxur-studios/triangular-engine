import { BehaviorSubject, Subject } from 'rxjs';
import { Color, PerspectiveCamera, Vector3 } from 'three';
import type {
  WaterCrossingEvent,
  WaterTrackedState,
  WaterTracker,
} from 'triangular-engine/water';
import {
  WATER_UNDERWATER_FRAGMENT_SHADER,
  WaterUnderwaterEffect,
} from './water-underwater-effect.component';

describe('WaterUnderwaterEffect', () => {
  it('passes through above water and activates below water', () => {
    const state$ = new BehaviorSubject<WaterTrackedState>({
      sample: null,
      underwater: false,
    });
    const tracker: WaterTracker = {
      state$,
      crossings$: new Subject<WaterCrossingEvent>(),
      dispose: () => undefined,
    };
    const camera = new PerspectiveCamera(50, 1, 0.25, 500);
    const effect = new WaterUnderwaterEffect(tracker, camera, () => ({
      color: new Color('#126678'),
      density: 0.04,
      distortion: 0.003,
      fadeDistance: 2,
    }));

    effect.update(null as never, null as never, 0.5);
    expect(effect.getUniforms().get('waterActive')?.value).toBe(0);

    state$.next({
      underwater: true,
      sample: {
        body: {} as never,
        position: new Vector3(),
        normal: new Vector3(0, 1, 0),
        flow: new Vector3(),
        signedDistance: -1,
        depth: 1,
      },
    });
    effect.update(null as never, null as never, 0.5);

    expect(effect.getUniforms().get('waterActive')?.value).toBe(1);
    expect(effect.getUniforms().get('waterImmersion')?.value).toBe(0.5);
    expect(effect.getUniforms().get('waterCameraNear')?.value).toBe(0.25);
    expect(effect.getUniforms().get('waterCameraFar')?.value).toBe(500);
  });

  it('declares depth fog, tint and distortion shader stages', () => {
    expect(WATER_UNDERWATER_FRAGMENT_SHADER).toContain('waterLinearDepth');
    expect(WATER_UNDERWATER_FRAGMENT_SHADER).toContain('void mainUv');
    expect(WATER_UNDERWATER_FRAGMENT_SHADER).toContain('void mainImage');
    expect(WATER_UNDERWATER_FRAGMENT_SHADER).toContain(
      'const in float depth',
    );
    expect(WATER_UNDERWATER_FRAGMENT_SHADER).toContain(
      'waterLinearDepth(depth)',
    );
  });
});
