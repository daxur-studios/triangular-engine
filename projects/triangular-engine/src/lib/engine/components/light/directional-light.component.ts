import {
  Component,
  computed,
  effect,
  input,
  model,
  signal,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { takeUntil } from 'rxjs';
import {
  DirectionalLight,
  Object3D,
  OrthographicCamera,
  Vector3,
  Vector3Tuple,
} from 'three';
import { provideObject3DComponent } from '../object-3d/object-3d.component';
import { LightComponent, LightShadowParams } from './light.component';

/**
 * Shadow configuration applied when `castShadow` is on and the corresponding
 * key is absent from the `shadow` input. The 1000 m half-extent covers a 2 km
 * square at ~1 m/texel with the default map size — fine for a fixed mid-size
 * scene, far too coarse for a small subject; pair `shadowFollow` with a tight
 * `cameraHalfExtent` (tens of meters) to get sharp subject shadows instead.
 */
export const DIRECTIONAL_LIGHT_SHADOW_DEFAULTS: Required<LightShadowParams> = {
  mapSize: [2048, 2048],
  cameraHalfExtent: 1000,
  cameraNear: 0.5,
  cameraFar: 5000, // long enough for low sun angles
  bias: -0.0005,
  normalBias: 0.5, // 0.2–1.0 typical
};

/** Scratch vector for the per-tick follow update — never held across ticks. */
const FOLLOW_WORLD_POSITION = new Vector3();

/**
 * Component Inputs:
 * | Property     | Description                                              | Source                    |
 * |--------------|----------------------------------------------------------|---------------------------|
 * | color        | The color of the light.                                  | LightComponent            |
 * | intensity    | The intensity of the light.                              | LightComponent            |
 * | shadow       | Shadow overrides (map size, frustum, bias).              | LightComponent            |
 * | castShadow   | Whether the light casts shadows.                         | DirectionalLightComponent |
 * | shadowFollow | Object the shadow frustum tracks each tick.              | DirectionalLightComponent |
 */
@Component({
  selector: 'directionalLight',
  template: `<ng-content></ng-content>`,
  imports: [],
  providers: [provideObject3DComponent(DirectionalLightComponent)],
})
export class DirectionalLightComponent extends LightComponent {
  public override emoji = '💡';

  override readonly position = model<Vector3Tuple>([0, 10, 10]);

  override readonly object3D = signal(new DirectionalLight());
  override get light() {
    return this.object3D;
  }

  readonly castShadow = input<boolean>(true);
  readonly castShadow$ = toObservable(this.castShadow);

  /**
   * When set, the light and its shadow frustum track this object every tick:
   * the light sits at `followed world position + position` (the `position`
   * input becomes a relative sun-direction offset instead of an absolute
   * placement) and `light.target` sits on the followed object. This is what
   * makes a tight `cameraHalfExtent` usable on subjects that travel far from
   * the origin — a fixed frustum stops covering them, a following one never
   * does. Positions are written in the light's parent space, so keep the
   * light under an untransformed parent (scene root) when using this.
   */
  readonly shadowFollow = input<Object3D | undefined>();

  public readonly normalizedPosition = computed(() => {
    const position = this.light().position;
    this.position();

    return position.clone().normalize();
  });

  constructor() {
    super();

    effect(() => {
      const castShadow = this.castShadow();

      const directionalLight = this.light();
      directionalLight.castShadow = castShadow;

      if (castShadow) {
        // Any key the `shadow` input provides wins over the defaults; the
        // base LightComponent applies the same provided values, so the two
        // effects agree regardless of execution order.
        const params: Required<LightShadowParams> = {
          ...DIRECTIONAL_LIGHT_SHADOW_DEFAULTS,
          ...this.shadow(),
        };

        directionalLight.shadow.mapSize.set(...params.mapSize);

        const cam = directionalLight.shadow.camera as OrthographicCamera;
        cam.left = -params.cameraHalfExtent;
        cam.right = params.cameraHalfExtent;
        cam.top = params.cameraHalfExtent;
        cam.bottom = -params.cameraHalfExtent;
        cam.near = params.cameraNear;
        cam.far = params.cameraFar;
        cam.updateProjectionMatrix();
        directionalLight.shadow.bias = params.bias;
        directionalLight.shadow.normalBias = params.normalBias;
      }
    });

    effect(() => {
      this.light().color.set(this.color());
    });

    effect(() => {
      this.light().intensity = this.intensity();
    });

    this.#initShadowFollow();
  }

  #initShadowFollow() {
    this.engineService.tick$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        const followed = this.shadowFollow();
        if (!followed) return;

        const light = this.light();
        followed.getWorldPosition(FOLLOW_WORLD_POSITION);

        const [offsetX, offsetY, offsetZ] = this.position();
        light.position.set(
          FOLLOW_WORLD_POSITION.x + offsetX,
          FOLLOW_WORLD_POSITION.y + offsetY,
          FOLLOW_WORLD_POSITION.z + offsetZ,
        );

        // `light.target` is not in the scene graph, so Three never updates
        // its matrixWorld for us — without this the shadow keeps aiming at
        // the target's stale position.
        light.target.position.copy(FOLLOW_WORLD_POSITION);
        light.target.updateMatrixWorld();
      });
  }
}
