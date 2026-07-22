import { Component, DestroyRef, effect, inject, input } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { ProceduralTexture } from '@takram/three-clouds';
import {
  CylinderGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Texture,
  Uniform,
  Vector2,
} from 'three';
import { EngineService } from 'triangular-engine';

/**
 * Cheap, distant representation of a cylindrical Takram cloud layer.
 *
 * The shell samples the same local-weather map as the volumetric effect and
 * fades in with camera distance. It intentionally does not imitate Takram's
 * 3D shape/detail noise; it preserves the broad cloud footprint while the
 * expensive volume is no longer visually reliable.
 */
@Component({
  standalone: true,
  selector: 'takram-cylinder-cloud-shell',
  template: '',
})
export class TakramCylinderCloudShellComponent {
  readonly weatherTexture = input<Texture | ProceduralTexture | null>();
  readonly radius = input.required<number>();
  readonly length = input.required<number>();
  readonly altitude = input(450);
  readonly height = input(1_400);
  /** 0 = cloud base nearest the habitat wall, 1 = cloud top toward the axis. */
  readonly layerPosition = input(0.3);
  readonly coverage = input(0.5);
  /** Slow coverage variation that keeps the distant shell from feeling static. */
  readonly evolutionAmount = input(0.025);
  /** Multiplier for the phase-driven weather-map evolution. */
  readonly evolutionSpeed = input(4);
  readonly opacity = input(0.82);
  readonly weatherRepeat = input<readonly [number, number]>([2, 2]);
  /** Takram's mutable accumulated weather offset; share the same instance. */
  readonly weatherOffset = input<Vector2 | null>();
  readonly weatherVelocity = input<readonly [number, number]>([0, 0]);
  readonly fadeStart = input(8_000);
  readonly fadeEnd = input(18_000);
  readonly enabled = input(true);

  private readonly engine = inject(EngineService);
  private readonly uniforms = {
    weatherTexture: new Uniform<Texture | null>(null),
    weatherRepeat: new Uniform(new Vector2(2, 2)),
    weatherOffset: new Uniform(new Vector2()),
    coverage: new Uniform(0.5),
    evolutionAmount: new Uniform(0.025),
    evolutionSpeed: new Uniform(4),
    opacity: new Uniform(0.82),
    fadeStart: new Uniform(8_000),
    fadeEnd: new Uniform(18_000),
    cylinderRadius: new Uniform(10_000),
    evolutionTime: new Uniform(0),
  };
  private readonly fallbackOffset = new Vector2();
  private readonly material = new ShaderMaterial({
    uniforms: this.uniforms,
    vertexShader: /* glsl */ `
varying vec3 vCloudShellWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vCloudShellWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`,
    fragmentShader: /* glsl */ `
uniform sampler2D weatherTexture;
uniform vec2 weatherRepeat;
uniform vec2 weatherOffset;
uniform float coverage;
uniform float evolutionAmount;
uniform float evolutionSpeed;
uniform float opacity;
uniform float fadeStart;
uniform float fadeEnd;
uniform float cylinderRadius;
uniform float evolutionTime;
varying vec3 vCloudShellWorldPosition;

void main() {
  const float RECIPROCAL_PI2 = 0.15915494309189535;
  float angle = atan(vCloudShellWorldPosition.z, vCloudShellWorldPosition.y);
  vec2 cylinderUv = vec2(
    angle * RECIPROCAL_PI2 + 0.5,
    vCloudShellWorldPosition.x / (cylinderRadius * 6.283185307179586)
  );
  vec2 weatherUv = cylinderUv * weatherRepeat + weatherOffset;
  float phaseTime = evolutionTime * evolutionSpeed;
  vec2 evolution = vec2(
    sin(phaseTime * 0.017),
    cos(phaseTime * 0.013)
  ) * 0.035;
  float broad = texture2D(weatherTexture, weatherUv).r;
  float evolvingA = texture2D(weatherTexture, weatherUv * 1.73 + evolution).r;
  float evolvingB = texture2D(weatherTexture, weatherUv * 0.61 - evolution * 0.7).r;
  float weather = broad * 0.68 + evolvingA * 0.20 + evolvingB * 0.12;
  float coverageDrift = (
    sin(phaseTime * 0.061) * 0.65 +
    sin(phaseTime * 0.023 + 1.7) * 0.35
  ) * evolutionAmount;
  float animatedCoverage = clamp(coverage + coverageDrift, 0.0, 1.0);
  float threshold = 1.0 - animatedCoverage;
  float footprint = smoothstep(threshold - 0.2, threshold + 0.08, weather);
  float distanceFade = smoothstep(
    min(fadeStart, fadeEnd),
    max(fadeStart, fadeEnd),
    distance(cameraPosition, vCloudShellWorldPosition)
  );
  float cloudAlpha = footprint * distanceFade * opacity;
  if (cloudAlpha < 0.003) discard;
  vec3 shadowColor = vec3(0.31, 0.38, 0.47);
  vec3 lightColor = vec3(0.82, 0.87, 0.92);
  gl_FragColor = vec4(mix(shadowColor, lightColor, weather), cloudAlpha);
}
`,
    transparent: true,
    depthWrite: false,
    // This scene uses a logarithmic depth buffer. The shell's injected shader
    // has not produced compatible depth values reliably, causing the entire
    // shell to fail its depth test. Keep the last known-visible behavior until
    // occlusion is implemented explicitly for the finite cylinder.
    depthTest: false,
    side: DoubleSide,
  });
  private readonly mesh = new Mesh(new CylinderGeometry(), this.material);

  constructor() {
    this.mesh.name = 'Takram cylinder cloud distance shell';
    this.mesh.rotation.z = Math.PI / 2;
    this.mesh.renderOrder = 1;
    this.engine.scene.add(this.mesh);

    effect(() => {
      const shellRadius = Math.max(
        0.001,
        this.radius() -
          this.altitude() -
          this.height() * Math.min(1, Math.max(0, this.layerPosition())),
      );
      const geometry = new CylinderGeometry(
        shellRadius,
        shellRadius,
        Math.max(0.001, this.length()),
        192,
        1,
        true,
      );
      const previous = this.mesh.geometry;
      this.mesh.geometry = geometry;
      previous.dispose();
    });

    effect(() => {
      const weather = this.weatherTexture();
      this.uniforms.weatherTexture.value = resolveTexture(weather);
      this.uniforms.weatherRepeat.value.set(...this.weatherRepeat());
      this.uniforms.weatherOffset.value =
        this.weatherOffset() ?? this.fallbackOffset;
      this.uniforms.coverage.value = this.coverage();
      this.uniforms.evolutionAmount.value = Math.max(0, this.evolutionAmount());
      this.uniforms.evolutionSpeed.value = Math.max(0, this.evolutionSpeed());
      this.uniforms.opacity.value = this.opacity();
      this.uniforms.fadeStart.value = this.fadeStart();
      this.uniforms.fadeEnd.value = this.fadeEnd();
      this.uniforms.cylinderRadius.value = this.radius();
      this.mesh.visible = this.enabled() && weather != null;
    });

    const destroyRef = inject(DestroyRef);
    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((delta) => {
        this.uniforms.evolutionTime.value += delta;
        if (this.weatherOffset() == null) {
          const [x, y] = this.weatherVelocity();
          this.fallbackOffset.x += x * delta;
          this.fallbackOffset.y += y * delta;
        }
      });

    destroyRef.onDestroy(() => {
      this.engine.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.material.dispose();
    });
  }
}

function resolveTexture(
  weather: Texture | ProceduralTexture | null | undefined,
): Texture | null {
  if (weather == null) return null;
  return weather instanceof Texture ? weather : weather.texture;
}
