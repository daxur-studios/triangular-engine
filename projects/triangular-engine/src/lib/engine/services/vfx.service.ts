import { inject, Injectable } from '@angular/core';
import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  Vector3Tuple,
} from 'three';
import { EngineService } from './engine.service';
import {
  ParticleBurstOptions,
  ParticleEmitterConfig,
  ParticlePreset,
} from '../components/particle/particle.model';
import { PARTICLE_PRESETS } from '../components/particle/particle-presets';
import { ParticlePool } from '../components/particle/particle-pool';
import { createParticleMaterial } from '../components/particle/particle-shader';

interface ActiveVfxBurst {
  mesh: Mesh;
  pool: ParticlePool;
  geometry: InstancedBufferGeometry;
  material: ShaderMaterial;
  attrOffset: InstancedBufferAttribute;
  attrScale: InstancedBufferAttribute;
  attrColor: InstancedBufferAttribute;
  attrRotation: InstancedBufferAttribute;
  config: ParticleEmitterConfig;
  elapsed: number;
}

/**
 * High-performance VFX service for spawning imperative particle bursts,
 * explosion blasts, impact sparks, and temporary visual effects on the fly.
 * Automatically cleans up all Three.js meshes and GPU buffers once effects conclude.
 */
@Injectable({
  providedIn: 'root',
})
export class VfxService {
  private readonly injectedEngineService = inject(EngineService, { optional: true });
  private get engineService() {
    return this.injectedEngineService ?? EngineService.activeInstance;
  }

  private readonly activeBursts: ActiveVfxBurst[] = [];
  private readonly quadGeometry = new PlaneGeometry(1, 1);
  private tickSubscribed = false;

  constructor() {
    this.#initTickLoop();
  }

  /**
   * Spawns a custom or preset-based particle burst at a 3D world position.
   * Auto-destroys and removes itself from the scene after all particles expire.
   */
  spawnBurst(preset: ParticlePreset = 'explosion', options?: ParticleBurstOptions): Mesh | undefined {
    const scene = this.engineService?.scene;
    if (!scene) return undefined;

    const baseConfig = PARTICLE_PRESETS[preset] ?? PARTICLE_PRESETS.explosion;
    const count = options?.burst ?? baseConfig.burst ?? 100;
    const maxParticles = Math.max(count, options?.maxParticles ?? count);

    const mergedConfig: ParticleEmitterConfig = {
      ...baseConfig,
      ...options,
      maxParticles,
      burst: count,
      loop: false,
      autoplay: true,
    };

    // 1. Setup instanced geometry
    const geo = new InstancedBufferGeometry();
    geo.index = this.quadGeometry.index;
    geo.attributes['position'] = this.quadGeometry.attributes['position'];
    geo.attributes['uv'] = this.quadGeometry.attributes['uv'];

    // 2. Setup particle pool
    const pool = new ParticlePool(maxParticles);
    pool.setColorRamp(mergedConfig.color);

    const attrOffset = new InstancedBufferAttribute(pool.aOffset, 3);
    const attrScale = new InstancedBufferAttribute(pool.aScale, 1);
    const attrColor = new InstancedBufferAttribute(pool.aColor, 4);
    const attrRotation = new InstancedBufferAttribute(pool.aRotation, 1);

    geo.setAttribute('aOffset', attrOffset);
    geo.setAttribute('aScale', attrScale);
    geo.setAttribute('aColor', attrColor);
    geo.setAttribute('aRotation', attrRotation);

    // 3. Setup material & mesh
    const mat = createParticleMaterial(
      mergedConfig.texture instanceof Object ? (mergedConfig.texture as any) : undefined,
      mergedConfig.blending ?? 'additive',
    );
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;

    // Apply spawn position
    const pos = options?.position ?? [0, 0, 0];
    mesh.position.set(pos[0], pos[1], pos[2]);

    scene.add(mesh);

    // 4. Emit burst particles
    for (let i = 0; i < count; i++) {
      pool.spawn(mergedConfig);
    }
    geo.instanceCount = pool.activeCount;
    attrOffset.needsUpdate = true;
    attrScale.needsUpdate = true;
    attrColor.needsUpdate = true;
    attrRotation.needsUpdate = true;

    // 5. Track for update & cleanup
    this.activeBursts.push({
      mesh,
      pool,
      geometry: geo,
      material: mat,
      attrOffset,
      attrScale,
      attrColor,
      attrRotation,
      config: mergedConfig,
      elapsed: 0,
    });

    this.#initTickLoop();
    return mesh;
  }

  /**
   * Spawns an instant spherical explosion blast with fire flash and shockwave debris.
   */
  spawnExplosion(
    position: Vector3Tuple = [0, 0, 0],
    scaleMultiplier = 1.0,
    count = 160,
  ): Mesh | undefined {
    return this.spawnBurst('explosion', {
      position,
      burst: count,
      speed: [7.0 * scaleMultiplier, 15.0 * scaleMultiplier],
      size: [1.2 * scaleMultiplier, 0.05 * scaleMultiplier],
    });
  }

  /**
   * Spawns high-velocity sparks spraying along a surface normal or ejection vector.
   */
  spawnSparks(
    position: Vector3Tuple = [0, 0, 0],
    direction: Vector3Tuple = [0, 1, 0],
    count = 45,
  ): Mesh | undefined {
    return this.spawnBurst('sparks', {
      position,
      direction,
      burst: count,
      speed: [5.0, 11.0],
      spread: 60,
    });
  }

  /**
   * Spawns a burst of magical arcane particles.
   */
  spawnMagicBurst(
    position: Vector3Tuple = [0, 0, 0],
    count = 70,
  ): Mesh | undefined {
    return this.spawnBurst('magic', {
      position,
      burst: count,
      speed: [1.5, 4.0],
      spread: 360,
      lifetime: [1.0, 2.2],
    });
  }

  #initTickLoop(): void {
    if (this.tickSubscribed || !this.engineService?.tick$) return;
    this.tickSubscribed = true;

    this.engineService.tick$.subscribe((delta) => {
      if (!delta || delta <= 0 || this.activeBursts.length === 0) return;

      for (let i = this.activeBursts.length - 1; i >= 0; i--) {
        const burst = this.activeBursts[i];
        burst.elapsed += delta;

        burst.pool.update(delta, burst.config);
        const alive = burst.pool.activeCount;
        burst.geometry.instanceCount = alive;

        if (alive > 0) {
          burst.attrOffset.needsUpdate = true;
          burst.attrScale.needsUpdate = true;
          burst.attrColor.needsUpdate = true;
          burst.attrRotation.needsUpdate = true;
        } else {
          // Effect completed - clean up GPU resources and scene node
          burst.mesh.removeFromParent();
          burst.geometry.dispose();
          burst.material.dispose();
          burst.pool.clear();
          this.activeBursts.splice(i, 1);
        }
      }
    });
  }
}
