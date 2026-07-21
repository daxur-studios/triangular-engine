import { Component, effect, input, OnDestroy } from '@angular/core';
import { Effect, EffectAttribute } from 'postprocessing';
import {
  Matrix4,
  Uniform,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type Camera,
} from 'three';
import { PostprocessingEffectComponent } from 'triangular-engine/postprocessing';

const fragmentShader = /* glsl */ `
uniform mat4 inverseProjectionMatrix;
uniform mat4 cameraWorldMatrix;
uniform vec3 cameraPosition;
uniform vec3 sunDirection;
uniform float cylinderRadius;
uniform float cylinderHalfLength;
uniform float density;
uniform float scaleHeight;
uniform float intensity;

vec2 intersectCylinder(vec3 origin, vec3 direction) {
  vec2 o = origin.yz;
  vec2 d = direction.yz;
  float a = dot(d, d);
  if (a < 1e-8) return vec2(-1.0);
  float b = dot(o, d);
  float c = dot(o, o) - cylinderRadius * cylinderRadius;
  float discriminant = b * b - a * c;
  if (discriminant < 0.0) return vec2(-1.0);
  float root = sqrt(discriminant);
  return vec2((-b - root) / a, (-b + root) / a);
}

vec2 intersectSlab(float origin, float direction) {
  if (abs(direction) < 1e-8) {
    return abs(origin) <= cylinderHalfLength ? vec2(-1e20, 1e20) : vec2(1.0, -1.0);
  }
  vec2 hit = (vec2(-cylinderHalfLength, cylinderHalfLength) - origin) / direction;
  return vec2(min(hit.x, hit.y), max(hit.x, hit.y));
}

void mainImage(const vec4 inputColor, const vec2 uv, out vec4 outputColor) {
  vec4 view = inverseProjectionMatrix * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rayDirection = normalize((cameraWorldMatrix * vec4(view.xyz / view.w, 0.0)).xyz);
  vec2 radialHit = intersectCylinder(cameraPosition, rayDirection);
  vec2 axialHit = intersectSlab(cameraPosition.x, rayDirection.x);
  float rayNear = max(0.0, max(radialHit.x, axialHit.x));
  float rayFar = min(radialHit.y, axialHit.y);

  if (rayFar <= rayNear) {
    outputColor = inputColor;
    return;
  }

  const int SAMPLE_COUNT = 16;
  float stepSize = (rayFar - rayNear) / float(SAMPLE_COUNT);
  float opticalDepth = 0.0;
  float weightedHeight = 0.0;
  for (int i = 0; i < SAMPLE_COUNT; ++i) {
    float distance = rayNear + (float(i) + 0.5) * stepSize;
    vec3 position = cameraPosition + rayDirection * distance;
    float height = max(0.0, cylinderRadius - length(position.yz));
    float localDensity = density * exp(-height / max(1.0, scaleHeight));
    opticalDepth += localDensity * stepSize;
    weightedHeight += localDensity * height;
  }

  float extinction = 1.0 - exp(-opticalDepth);
  vec3 inwardUp = normalize(vec3(0.0, -cameraPosition.y, -cameraPosition.z));
  float viewUp = dot(rayDirection, inwardUp);
  float horizon = pow(1.0 - abs(viewUp), 2.0);
  float mu = dot(rayDirection, normalize(sunDirection));
  float rayleighPhase = 0.75 * (1.0 + mu * mu);
  float forwardMie = pow(max(0.0, mu), 12.0);
  vec3 zenithColor = vec3(0.10, 0.32, 0.78);
  vec3 horizonColor = vec3(0.34, 0.63, 1.0);
  vec3 sunColor = vec3(1.0, 0.55, 0.22);
  vec3 scatterColor = mix(zenithColor, horizonColor, horizon);
  scatterColor *= rayleighPhase;
  scatterColor += sunColor * forwardMie * 0.7;
  scatterColor *= intensity;

  outputColor.rgb = inputColor.rgb * (1.0 - extinction) + scatterColor * extinction;
  outputColor.a = inputColor.a;
}
`;

class CylinderAtmosphereEffect extends Effect {
  private readonly inverseProjection: Matrix4;
  private readonly cameraWorld: Matrix4;
  private readonly cameraPositionValue: Vector3;
  private readonly camera: Camera;

  constructor(
    camera: Camera,
    radius: number,
    halfLength: number,
    density: number,
    scaleHeight: number,
    intensity: number,
    sunDirection: Vector3,
  ) {
    const inverseProjection = new Matrix4();
    const cameraWorld = new Matrix4();
    const cameraPositionValue = new Vector3();
    const uniforms = new Map<string, Uniform<unknown>>([
      ['inverseProjectionMatrix', new Uniform(inverseProjection)],
      ['cameraWorldMatrix', new Uniform(cameraWorld)],
      ['cameraPosition', new Uniform(cameraPositionValue)],
      ['sunDirection', new Uniform(sunDirection.clone().normalize())],
      ['cylinderRadius', new Uniform(radius)],
      ['cylinderHalfLength', new Uniform(halfLength)],
      ['density', new Uniform(density)],
      ['scaleHeight', new Uniform(scaleHeight)],
      ['intensity', new Uniform(intensity)],
    ]);
    super('CylinderAtmosphereEffect', fragmentShader, {
      attributes: EffectAttribute.NONE,
      uniforms,
    });
    this.camera = camera;
    this.inverseProjection = inverseProjection;
    this.cameraWorld = cameraWorld;
    this.cameraPositionValue = cameraPositionValue;
  }

  setParameters(
    radius: number,
    halfLength: number,
    density: number,
    scaleHeight: number,
    intensity: number,
    sunDirection: Vector3,
  ): void {
    this.uniforms.get('cylinderRadius')!.value = radius;
    this.uniforms.get('cylinderHalfLength')!.value = halfLength;
    this.uniforms.get('density')!.value = density;
    this.uniforms.get('scaleHeight')!.value = scaleHeight;
    this.uniforms.get('intensity')!.value = intensity;
    (this.uniforms.get('sunDirection')!.value as Vector3).copy(sunDirection).normalize();
  }

  override update(
    _renderer: WebGLRenderer,
    _inputBuffer: WebGLRenderTarget,
    _deltaTime?: number,
  ): void {
    this.camera.updateMatrixWorld();
    this.inverseProjection.copy(this.camera.projectionMatrixInverse);
    this.cameraWorld.copy(this.camera.matrixWorld);
    this.camera.getWorldPosition(this.cameraPositionValue);
  }
}

/** Lightweight finite-cylinder atmosphere, independent of Takram's spherical LUT geometry. */
@Component({
  standalone: true,
  selector: 'takram-cylinder-atmosphere',
  template: '',
  providers: [
    {
      provide: PostprocessingEffectComponent,
      useExisting: TakramCylinderAtmosphereComponent,
    },
  ],
})
export class TakramCylinderAtmosphereComponent
  extends PostprocessingEffectComponent
  implements OnDestroy
{
  readonly radius = input.required<number>();
  readonly halfLength = input.required<number>();
  readonly density = input(0.00008);
  readonly scaleHeight = input(2_000);
  readonly intensity = input(1);
  readonly sunDirection = input(new Vector3(0, 1, 0));

  private cylinderEffect?: CylinderAtmosphereEffect;

  constructor() {
    super();
    effect(() => {
      const values = this.parameters();
      this.cylinderEffect?.setParameters(...values);
    });
  }

  override createEffect(camera: Camera): Effect {
    this.cylinderEffect?.dispose();
    this.cylinderEffect = new CylinderAtmosphereEffect(camera, ...this.parameters());
    return this.cylinderEffect;
  }

  ngOnDestroy(): void {
    this.cylinderEffect?.dispose();
    this.cylinderEffect = undefined;
  }

  private parameters(): [number, number, number, number, number, Vector3] {
    return [
      this.radius(),
      this.halfLength(),
      this.density(),
      this.scaleHeight(),
      this.intensity(),
      this.sunDirection(),
    ];
  }
}
