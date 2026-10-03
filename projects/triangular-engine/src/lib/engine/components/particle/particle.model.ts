import { Texture, Vector3Tuple } from 'three';

/** Built-in particle effect presets. */
export type ParticlePreset =
  | 'fire'
  | 'smoke'
  | 'sparks'
  | 'explosion'
  | 'magic'
  | 'snow'
  | 'rain'
  | 'custom';

/** Particle blending mode for WebGL rendering. */
export type ParticleBlending = 'additive' | 'normal';

/** Shape of the emission source volume. */
export type ParticleEmitterShape = 'point' | 'sphere' | 'box' | 'ring';

/** A scalar or min/max range tuple: [min, max] or a single constant number. */
export type RangeValue = [min: number, max: number] | number;

/** Internal state representation for a single active particle. */
export interface IParticle {
  position: Vector3Tuple;
  velocity: Vector3Tuple;
  life: number;
  maxLife?: number;
  scale?: number;
  rotation?: number;
  rotationSpeed?: number;
}

/** Full configuration definition for a particle emitter or preset. */
export interface ParticleEmitterConfig {
  /** Maximum number of active particles allocated in the GPU buffer. */
  maxParticles?: number;
  /** Continuous emission rate in particles per second. */
  rate?: number;
  /** Instantaneous particle burst count emitted on start or trigger. */
  burst?: number;
  /** Whether continuous emission loops indefinitely. */
  loop?: boolean;
  /** Whether emission begins automatically upon creation. */
  autoplay?: boolean;
  /** Duration in seconds to emit before stopping (0 = infinite). */
  duration?: number;
  /** Particle lifetime in seconds ([min, max] or constant). */
  lifetime?: RangeValue;
  /** Initial ejection speed ([min, max] or constant). */
  speed?: RangeValue;
  /** Primary ejection direction vector [x, y, z]. */
  direction?: Vector3Tuple;
  /** Cone spread angle in degrees (0 = straight line, 180 = hemisphere, 360 = sphere). */
  spread?: number;
  /** Constant acceleration vector [gx, gy, gz] applied to particles (e.g. gravity). */
  gravity?: Vector3Tuple;
  /** Velocity damping / air resistance factor per second (0 to 1, e.g. 0.98). */
  damping?: number;
  /** Particle size evolution [startSize, endSize] or constant number. */
  size?: [start: number, end: number] | number;
  /** Color gradient ramp over lifetime: single color or array of hex/rgb strings. */
  color?: string | string[];
  /** Opacity evolution [startOpacity, endOpacity] or constant number (0 to 1). */
  opacity?: [start: number, end: number] | number;
  /** Sprite angular rotation speed in radians/sec ([min, max] or constant). */
  rotationSpeed?: RangeValue;
  /** WebGL blending mode ('additive' for glowing fire/sparks/magic, 'normal' for smoke/dust). */
  blending?: ParticleBlending;
  /** Emission volume shape. */
  shape?: ParticleEmitterShape;
  /** Dimensions of the emission shape (radius for sphere/ring, [w, h, d] for box). */
  shapeSize?: Vector3Tuple | number;
  /** Custom texture URL or THREE.Texture instance. Defaults to procedural soft glow. */
  texture?: string | Texture;
}

/** Options for spawning a one-shot VFX burst via VfxService. */
export interface ParticleBurstOptions extends Partial<ParticleEmitterConfig> {
  /** Position in 3D space to spawn the effect. */
  position?: Vector3Tuple;
  /** Scale multiplier applied to all particle sizes and speeds in this burst. */
  scaleMultiplier?: number;
  /** Auto-destroy delay in seconds after all particles expire. */
  autoDestroyDelay?: number;
}
