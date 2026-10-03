import {
  AdditiveBlending,
  Color,
  CustomBlending,
  DoubleSide,
  NormalBlending,
  ShaderMaterial,
  Texture,
} from 'three';
import { ParticleBlending } from './particle.model';

export const PARTICLE_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aOffset;
  attribute float aScale;
  attribute vec4 aColor;
  attribute float aRotation;

  varying vec2 vUv;
  varying vec4 vColor;

  void main() {
    vUv = uv;
    vColor = aColor;

    // 2D Rotation of quad vertex in billboard plane
    float c = cos(aRotation);
    float s = sin(aRotation);
    vec2 rotated = vec2(
      position.x * c - position.y * s,
      position.x * s + position.y * c
    ) * aScale;

    // Transform instance center offset to view/camera space
    vec4 mvPosition = modelViewMatrix * vec4(aOffset, 1.0);

    // Offset quad vertices directly in camera XY plane (guarantees true billboard facing)
    mvPosition.xy += rotated;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform float uHasTexture;

  varying vec2 vUv;
  varying vec4 vColor;

  void main() {
    vec4 texColor = vec4(1.0);

    if (uHasTexture > 0.5) {
      texColor = texture2D(map, vUv);
    } else {
      // Fallback smooth circular gradient if no texture bound
      float dist = length(vUv - vec2(0.5));
      float alpha = smoothstep(0.5, 0.0, dist);
      texColor = vec4(1.0, 1.0, 1.0, alpha);
    }

    vec4 finalColor = texColor * vColor;
    if (finalColor.a <= 0.001) {
      discard;
    }

    gl_FragColor = finalColor;
  }
`;

export function createParticleMaterial(
  texture?: Texture,
  blending: ParticleBlending = 'additive',
): ShaderMaterial {
  const isAdditive = blending === 'additive';

  return new ShaderMaterial({
    uniforms: {
      map: { value: texture ?? null },
      uHasTexture: { value: texture ? 1.0 : 0.0 },
    },
    vertexShader: PARTICLE_VERTEX_SHADER,
    fragmentShader: PARTICLE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    blending: isAdditive ? AdditiveBlending : NormalBlending,
  });
}
