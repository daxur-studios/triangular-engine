import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  TextureLoader,
  Vector3,
  Vector3Tuple,
} from 'three';
import { Object3DComponent, provideObject3DComponent } from '../object-3d/object-3d.component';
import {
  ParticleBlending,
  ParticleEmitterConfig,
  ParticleEmitterShape,
  ParticlePreset,
  RangeValue,
} from './particle.model';
import { PARTICLE_PRESETS } from './particle-presets';
import { createParticleMaterial } from './particle-shader';
import { ParticlePool } from './particle-pool';
import { ParticleTextureUtil } from './particle-texture.util';

/**
 * High-performance GPU-instanced particle emitter component.
 *
 * Renders particles as camera-facing billboards in a single GPU draw call
 * using an instanced quad shader. Supports built-in presets (fire, smoke, sparks,
 * explosion, magic, snow, rain) and fully customizable physics and appearance curves.
 *
 * Example:
 * ```html
 * <particleEmitter
 *   preset="fire"
 *   [rate]="100"
 *   [speed]="[1.5, 3.0]"
 *   [spread]="30"
 * />
 * ```
 */
@Component({
  selector: 'particleEmitter',
  template: `<ng-content></ng-content>`,
  imports: [],
  providers: [provideObject3DComponent(ParticleEmitterComponent)],
})
export class ParticleEmitterComponent extends Object3DComponent implements OnDestroy {
  public override emoji = '✨';

  // #region Inputs
  /** Base preset to inherit defaults from (default: 'fire'). */
  readonly preset = input<ParticlePreset | undefined>('fire');

  /** Maximum simultaneous particles allocated in the GPU buffer. */
  readonly maxParticles = input<number | undefined>();

  /** Continuous emission rate in particles per second. */
  readonly rate = input<number | undefined>();

  /** Initial burst count emitted on start or trigger. */
  readonly burst = input<number | undefined>();

  /** Whether continuous emission loops indefinitely. */
  readonly loop = input<boolean | undefined>();

  /** Whether emission begins automatically upon creation (default: true). */
  readonly autoplay = input<boolean>(true);

  /** Duration in seconds to emit before stopping (0 = infinite). */
  readonly duration = input<number | undefined>();

  /** Particle lifetime in seconds ([min, max] or constant). */
  readonly lifetime = input<RangeValue | undefined>();

  /** Initial ejection speed ([min, max] or constant). */
  readonly speed = input<RangeValue | undefined>();

  /** Primary ejection direction vector [x, y, z]. */
  readonly direction = input<Vector3Tuple | undefined>();

  /** Cone spread angle in degrees (0 = straight line, 180 = hemisphere, 360 = sphere). */
  readonly spread = input<number | undefined>();

  /** Constant acceleration vector [gx, gy, gz] applied to particles (e.g. gravity). */
  readonly gravity = input<Vector3Tuple | undefined>();

  /** Velocity damping / friction factor per second (0 to 1). */
  readonly damping = input<number | undefined>();

  /** Particle size evolution [startSize, endSize] or constant number. */
  readonly size = input<[start: number, end: number] | number | undefined>();

  /** Color gradient ramp over lifetime: single color or array of hex/rgb strings. */
  readonly color = input<string | string[] | undefined>();

  /** Opacity evolution [startOpacity, endOpacity] or constant number (0 to 1). */
  readonly opacity = input<[start: number, end: number] | number | undefined>();

  /** Sprite angular rotation speed in radians/sec ([min, max] or constant). */
  readonly rotationSpeed = input<RangeValue | undefined>();

  /** WebGL blending mode ('additive' or 'normal'). */
  readonly blending = input<ParticleBlending | undefined>();

  /** Emission volume shape ('point', 'sphere', 'box', 'ring'). */
  readonly shape = input<ParticleEmitterShape | undefined>();

  /** Dimensions of the emission shape (radius for sphere/ring, [w, h, d] for box). */
  readonly shapeSize = input<Vector3Tuple | number | undefined>();

  /** Custom texture URL or THREE.Texture instance. */
  readonly texture = input<string | Texture | undefined>();
  // #endregion

  // #region Outputs
  /** Emits when a non-looping emitter finishes all active particles. */
  readonly finished = output<void>();

  /** Emits the count of active particles currently alive. */
  readonly activeCountChange = output<number>();
  // #endregion

  // #region State & Three.js Objects
  readonly isPlaying = signal<boolean>(true);

  private readonly pool = new ParticlePool();
  private readonly baseGeometry = new PlaneGeometry(1, 1);
  private readonly instancedGeo = new InstancedBufferGeometry();
  private material!: ShaderMaterial;
  private readonly mesh: Mesh;

  override readonly object3D: ReturnType<typeof signal<Mesh>>;

  private attrOffset!: InstancedBufferAttribute;
  private attrScale!: InstancedBufferAttribute;
  private attrColor!: InstancedBufferAttribute;
  private attrRotation!: InstancedBufferAttribute;

  private emissionAccumulator = 0;
  private elapsedTime = 0;
  private hasEmittedInitialBurst = false;
  private loadedTexture: Texture | undefined;
  // #endregion

  /** Consolidated active configuration computed from preset + user input overrides. */
  readonly resolvedConfig = computed<ParticleEmitterConfig>(() => {
    const p = this.preset() ?? 'custom';
    const base = PARTICLE_PRESETS[p] ?? PARTICLE_PRESETS.custom;

    return {
      maxParticles: this.maxParticles() ?? base.maxParticles ?? 500,
      rate: this.rate() ?? base.rate ?? 50,
      burst: this.burst() ?? base.burst ?? 0,
      loop: this.loop() ?? base.loop ?? true,
      autoplay: this.autoplay(),
      duration: this.duration() ?? base.duration ?? 0,
      lifetime: this.lifetime() ?? base.lifetime ?? [1, 2],
      speed: this.speed() ?? base.speed ?? [1, 3],
      direction: this.direction() ?? base.direction ?? [0, 1, 0],
      spread: this.spread() ?? base.spread ?? 45,
      gravity: this.gravity() ?? base.gravity ?? [0, 0, 0],
      damping: this.damping() ?? base.damping ?? 1.0,
      size: this.size() ?? base.size ?? [0.3, 0.1],
      color: this.color() ?? base.color ?? ['#ffffff'],
      opacity: this.opacity() ?? base.opacity ?? [1, 0],
      rotationSpeed: this.rotationSpeed() ?? base.rotationSpeed ?? [-1, 1],
      blending: this.blending() ?? base.blending ?? 'additive',
      shape: this.shape() ?? base.shape ?? 'point',
      shapeSize: this.shapeSize() ?? base.shapeSize ?? 0,
      texture: this.texture() ?? base.texture,
    };
  });

  constructor() {
    super();

    // 1. Initialize instanced geometry from quad base
    this.instancedGeo.index = this.baseGeometry.index;
    this.instancedGeo.attributes['position'] = this.baseGeometry.attributes['position'];
    this.instancedGeo.attributes['uv'] = this.baseGeometry.attributes['uv'];

    // 2. Setup material and mesh
    this.material = createParticleMaterial(undefined, 'additive');
    this.mesh = new Mesh(this.instancedGeo, this.material);
    this.mesh.frustumCulled = false; // Prevent culling as particles expand away from origin
    this.object3D = signal(this.mesh);

    // 3. Reactive synchronization
    this.#initBufferAllocation();
    this.#initMaterialSync();
    this.#initTextureSync();
    this.#initTickSimulation();
  }

  // #region Public Controls
  get activeCount(): number {
    return this.pool.activeCount;
  }

  play(): void {
    this.isPlaying.set(true);
  }

  pause(): void {
    this.isPlaying.set(false);
  }

  stop(): void {
    this.isPlaying.set(false);
    this.pool.clear();
    this.instancedGeo.instanceCount = 0;
    this.elapsedTime = 0;
    this.emissionAccumulator = 0;
    this.activeCountChange.emit(0);
  }

  emitBurst(count?: number): void {
    const config = this.resolvedConfig();
    const burstCount = count ?? config.burst ?? 20;
    const prev = this.pool.activeCount;
    for (let i = 0; i < burstCount; i++) {
      if (!this.pool.spawn(config)) break;
    }
    this.instancedGeo.instanceCount = this.pool.activeCount;
    if (this.pool.activeCount !== prev) {
      this.activeCountChange.emit(this.pool.activeCount);
    }
  }
  // #endregion

  #initBufferAllocation(): void {
    effect(() => {
      const config = this.resolvedConfig();
      const max = Math.max(10, config.maxParticles ?? 500);

      this.pool.allocate(max);
      this.pool.setColorRamp(config.color);

      // Create or rebind InstancedBufferAttributes
      this.attrOffset = new InstancedBufferAttribute(this.pool.aOffset, 3);
      this.attrScale = new InstancedBufferAttribute(this.pool.aScale, 1);
      this.attrColor = new InstancedBufferAttribute(this.pool.aColor, 4);
      this.attrRotation = new InstancedBufferAttribute(this.pool.aRotation, 1);

      this.instancedGeo.setAttribute('aOffset', this.attrOffset);
      this.instancedGeo.setAttribute('aScale', this.attrScale);
      this.instancedGeo.setAttribute('aColor', this.attrColor);
      this.instancedGeo.setAttribute('aRotation', this.attrRotation);
      this.instancedGeo.instanceCount = this.pool.activeCount;
    });
  }

  #initMaterialSync(): void {
    effect(() => {
      const config = this.resolvedConfig();
      const blending = config.blending ?? 'additive';
      const tex = this.loadedTexture ?? (config.texture instanceof Texture ? config.texture : undefined);

      this.material.dispose();
      this.material = createParticleMaterial(tex, blending);
      this.mesh.material = this.material;
    });
  }

  #initTextureSync(): void {
    effect(() => {
      const config = this.resolvedConfig();
      const texInput = config.texture;

      if (!texInput) {
        this.loadedTexture = ParticleTextureUtil.getRadialGlowTexture();
        this.#updateMaterialTexture(this.loadedTexture);
      } else if (texInput instanceof Texture) {
        this.loadedTexture = texInput;
        this.#updateMaterialTexture(texInput);
      } else if (typeof texInput === 'string') {
        const loader = new TextureLoader();
        loader.load(
          texInput,
          (t) => {
            this.loadedTexture = t;
            this.#updateMaterialTexture(t);
          },
          undefined,
          (err) => console.warn(`[ParticleEmitter] Failed to load texture '${texInput}':`, err),
        );
      }
    });
  }

  #updateMaterialTexture(tex: Texture): void {
    if (this.material && this.material.uniforms) {
      this.material.uniforms['map'].value = tex;
      this.material.uniforms['uHasTexture'].value = 1.0;
      this.material.needsUpdate = true;
    }
  }

  #initTickSimulation(): void {
    this.engineService.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((delta) => {
        if (!delta || delta <= 0) return;

        const config = this.resolvedConfig();
        const playing = this.isPlaying() && (config.autoplay ?? true);

        // Initial burst on start
        if (playing && !this.hasEmittedInitialBurst) {
          this.hasEmittedInitialBurst = true;
          if (config.burst && config.burst > 0) {
            this.emitBurst(config.burst);
          }
        }

        const prevCount = this.pool.activeCount;

        if (playing) {
          this.elapsedTime += delta;
          const isWithinDuration = !config.duration || this.elapsedTime < config.duration;
          const shouldEmit = isWithinDuration && (config.loop ?? true);

          // Continuous emission
          if (shouldEmit && config.rate && config.rate > 0) {
            this.emissionAccumulator += config.rate * delta;
            while (this.emissionAccumulator >= 1.0) {
              if (this.pool.spawn(config)) {
                this.emissionAccumulator -= 1.0;
              } else {
                this.emissionAccumulator = 0;
                break;
              }
            }
          }
        }

        // Advance simulation
        this.pool.update(delta, config);
        const currentCount = this.pool.activeCount;

        if (prevCount !== currentCount) {
          this.activeCountChange.emit(currentCount);
        }

        // Notify if all particles finished in non-looping mode
        if (
          playing &&
          !(config.loop ?? true) &&
          this.hasEmittedInitialBurst &&
          currentCount === 0 &&
          prevCount > 0
        ) {
          this.finished.emit();
        }

        // Update GPU instanced attributes
        this.instancedGeo.instanceCount = currentCount;
        if (currentCount > 0) {
          this.attrOffset.needsUpdate = true;
          this.attrScale.needsUpdate = true;
          this.attrColor.needsUpdate = true;
          this.attrRotation.needsUpdate = true;
        }
      });
  }

  override ngOnDestroy(): void {
    this.pool.clear();
    this.material.dispose();
    this.instancedGeo.dispose();
    this.baseGeometry.dispose();
    super.ngOnDestroy();
  }
}
