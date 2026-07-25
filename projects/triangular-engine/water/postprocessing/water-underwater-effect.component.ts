import { Component, inject, input, OnDestroy } from '@angular/core';
import {
  BlendFunction,
  Effect,
  EffectAttribute,
  type Effect as PostprocessingEffect,
} from 'postprocessing';
import {
  Color,
  OrthographicCamera,
  PerspectiveCamera,
  Uniform,
  Vector3,
  Vector4,
  type Camera,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { PostprocessingEffectComponent } from 'triangular-engine/postprocessing';
import { WaterService, type WaterTracker } from 'triangular-engine/water';

export interface WaterUnderwaterEffectOptions {
  readonly color?: Color;
  readonly density?: number;
  readonly distortion?: number;
  readonly fadeDistance?: number;
  readonly waterlineColor?: Color;
  readonly waterlineWidth?: number;
  readonly waterlineOpacity?: number;
}

/**
 * Framework-free postprocessing effect driven by a WaterService camera sample.
 */
export class WaterUnderwaterEffect extends Effect {
  private elapsedSeconds = 0;

  constructor(
    private readonly tracker: WaterTracker,
    private readonly camera: Camera,
    private readonly options: () => Required<WaterUnderwaterEffectOptions>,
  ) {
    super('WaterUnderwaterEffect', WATER_UNDERWATER_FRAGMENT_SHADER, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['waterActive', new Uniform(0)],
        ['waterSurfacePresent', new Uniform(0)],
        ['waterImmersion', new Uniform(0)],
        ['waterColor', new Uniform(new Color())],
        ['waterDensity', new Uniform(0)],
        ['waterDistortion', new Uniform(0)],
        ['waterTime', new Uniform(0)],
        ['waterCameraNear', new Uniform(0.1)],
        ['waterCameraFar', new Uniform(1000)],
        ['waterOrthographic', new Uniform(0)],
        ['waterCameraAspect', new Uniform(1)],
        ['waterCameraTanHalfFov', new Uniform(1)],
        ['waterOrthoBounds', new Uniform(new Vector4())],
        ['waterSurfaceSignedDistance', new Uniform(1)],
        ['waterSurfaceViewNormal', new Uniform(new Vector3(0, 1, 0))],
        ['waterlineColor', new Uniform(new Color())],
        ['waterlineWidth', new Uniform(1)],
        ['waterlineOpacity', new Uniform(0.7)],
      ]),
    });
  }

  override update(
    _renderer: WebGLRenderer,
    _inputBuffer: WebGLRenderTarget,
    deltaTime = 0,
  ): void {
    this.elapsedSeconds += deltaTime;
    const state = this.tracker.state$.value;
    const options = this.options();
    const cameraSubmerged =
      !!state.sample && state.sample.signedDistance < 0;
    const immersion =
      cameraSubmerged && state.sample
        ? Math.min(1, Math.max(0.15, state.sample.depth / options.fadeDistance))
        : 0;

    this.uniform('waterActive').value = cameraSubmerged ? 1 : 0;
    this.uniform('waterSurfacePresent').value = state.sample ? 1 : 0;
    this.uniform('waterImmersion').value = immersion;
    this.uniform('waterColor').value.copy(options.color);
    this.uniform('waterDensity').value = Math.max(0, options.density);
    this.uniform('waterDistortion').value = Math.max(0, options.distortion);
    this.uniform('waterTime').value = this.elapsedSeconds;
    this.uniform('waterCameraNear').value =
      'near' in this.camera ? this.camera.near : 0.1;
    this.uniform('waterCameraFar').value =
      'far' in this.camera ? this.camera.far : 1000;
    this.uniform('waterOrthographic').value =
      this.camera instanceof OrthographicCamera ? 1 : 0;
    if (this.camera instanceof PerspectiveCamera) {
      this.uniform('waterCameraAspect').value = this.camera.aspect;
      this.uniform('waterCameraTanHalfFov').value = Math.tan(
        (this.camera.fov * Math.PI) / 360,
      );
    } else if (this.camera instanceof OrthographicCamera) {
      this.uniform('waterOrthoBounds').value.set(
        this.camera.left,
        this.camera.right,
        this.camera.bottom,
        this.camera.top,
      );
    }
    if (state.sample) {
      this.uniform('waterSurfaceSignedDistance').value =
        state.sample.signedDistance;
      this.uniform('waterSurfaceViewNormal')
        .value.copy(state.sample.normal)
        .transformDirection(this.camera.matrixWorldInverse);
    }
    this.uniform('waterlineColor').value.copy(options.waterlineColor);
    this.uniform('waterlineWidth').value = Math.max(
      0.0001,
      options.waterlineWidth,
    );
    this.uniform('waterlineOpacity').value = Math.min(
      1,
      Math.max(0, options.waterlineOpacity),
    );
  }

  private uniform(name: string): Uniform {
    const uniform = this.uniforms.get(name);
    if (!uniform) throw new Error(`Missing underwater uniform "${name}".`);
    return uniform;
  }
}

/**
 * Underwater tint, depth fog and subtle refraction for the active camera.
 *
 * Place this inside `<postprocessing-composer>`. The camera is tracked against
 * every body registered with WaterService and the effect activates only after
 * crossing the configured hysteresis band.
 */
@Component({
  standalone: true,
  selector: 'waterUnderwaterEffect',
  template: '',
  providers: [
    {
      provide: PostprocessingEffectComponent,
      useExisting: WaterUnderwaterEffectComponent,
    },
  ],
})
export class WaterUnderwaterEffectComponent
  extends PostprocessingEffectComponent
  implements OnDestroy
{
  private readonly water = inject(WaterService);
  private tracker: WaterTracker | undefined;

  readonly color = input('#0b6270');
  readonly density = input(0.035);
  readonly distortion = input(0.0025);
  readonly fadeDistance = input(2);
  readonly hysteresis = input(0.1);
  readonly waterlineColor = input('#b7f5ef');
  /** Approximate total meniscus thickness in screen pixels. */
  readonly waterlineWidth = input(1);
  readonly waterlineOpacity = input(0.7);

  override createEffect(camera: Camera): PostprocessingEffect {
    this.tracker?.dispose();
    this.tracker = this.water.track(camera, {
      hysteresis: this.hysteresis(),
    });
    return new WaterUnderwaterEffect(this.tracker, camera, () => ({
      color: new Color(this.color()),
      density: this.density(),
      distortion: this.distortion(),
      fadeDistance: Math.max(0.0001, this.fadeDistance()),
      waterlineColor: new Color(this.waterlineColor()),
      waterlineWidth: this.waterlineWidth(),
      waterlineOpacity: this.waterlineOpacity(),
    }));
  }

  ngOnDestroy(): void {
    this.tracker?.dispose();
    this.tracker = undefined;
  }
}

export const WATER_UNDERWATER_FRAGMENT_SHADER = /* glsl */ `
uniform float waterActive;
uniform float waterImmersion;
uniform vec3 waterColor;
uniform float waterDensity;
uniform float waterDistortion;
uniform float waterTime;
uniform float waterCameraNear;
uniform float waterCameraFar;
uniform float waterOrthographic;
uniform float waterSurfacePresent;
uniform float waterCameraAspect;
uniform float waterCameraTanHalfFov;
uniform vec4 waterOrthoBounds;
uniform float waterSurfaceSignedDistance;
uniform vec3 waterSurfaceViewNormal;
uniform vec3 waterlineColor;
uniform float waterlineWidth;
uniform float waterlineOpacity;

float waterNearPlaneSignedDistance(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  vec3 nearPoint;
  if (waterOrthographic > 0.5) {
    nearPoint = vec3(
      mix(waterOrthoBounds.x, waterOrthoBounds.y, uv.x),
      mix(waterOrthoBounds.z, waterOrthoBounds.w, uv.y),
      -waterCameraNear
    );
  } else {
    nearPoint = vec3(
      ndc.x * waterCameraNear * waterCameraTanHalfFov * waterCameraAspect,
      ndc.y * waterCameraNear * waterCameraTanHalfFov,
      -waterCameraNear
    );
  }
  return waterSurfaceSignedDistance + dot(nearPoint, waterSurfaceViewNormal);
}

float waterLinearDepth(float rawDepth) {
  if (waterOrthographic > 0.5) {
    return rawDepth;
  }
  float viewZ =
    (waterCameraNear * waterCameraFar) /
    ((waterCameraFar - waterCameraNear) * rawDepth - waterCameraFar);
  return (viewZ + waterCameraNear) / (waterCameraNear - waterCameraFar);
}

void mainUv(inout vec2 uv) {
  if (
    waterSurfacePresent > 0.5 &&
    waterNearPlaneSignedDistance(uv) < 0.0 &&
    waterDistortion > 0.0
  ) {
    vec2 wave = vec2(
      sin(uv.y * 31.0 + waterTime * 1.7),
      cos(uv.x * 27.0 - waterTime * 1.3)
    );
    uv += wave * waterDistortion * waterImmersion;
  }
}

void mainImage(
  const in vec4 inputColor,
  const in vec2 uv,
  const in float depth,
  out vec4 outputColor
) {
  if (waterSurfacePresent < 0.5) {
    outputColor = inputColor;
    return;
  }
  float signedDistance = waterNearPlaneSignedDistance(uv);
  float pixelDistance = max(fwidth(signedDistance), 0.00001);
  float submerged = 1.0 - smoothstep(
    -pixelDistance,
    pixelDistance,
    signedDistance
  );
  float sceneDepth = waterLinearDepth(depth);
  float fog = 1.0 - exp(-sceneDepth * waterCameraFar * waterDensity);
  // Optical attenuation depends on the distance travelled through water,
  // not how far the camera happens to sit below the nearby wave crest.
  fog = clamp(fog * submerged, 0.0, 0.94);
  vec3 tinted = mix(inputColor.rgb, waterColor, fog);
  float meniscusHalfWidth = max(0.5, waterlineWidth * 0.5);
  float meniscus = 1.0 - smoothstep(
    pixelDistance * max(0.0, meniscusHalfWidth - 1.0),
    pixelDistance * meniscusHalfWidth,
    abs(signedDistance)
  );
  tinted = mix(tinted, waterlineColor, meniscus * waterlineOpacity);
  outputColor = vec4(tinted, inputColor.a);
}
`;
