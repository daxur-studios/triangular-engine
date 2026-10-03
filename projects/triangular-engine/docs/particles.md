# Particle & VFX System

Triangular Engine includes a high-performance GPU-instanced 3D particle and visual effects system.

Particle emitters render thousands of camera-facing billboard particles in a single draw call via `THREE.InstancedBufferGeometry` and an instanced vertex shader, maintaining 60+ FPS performance even on mobile devices.

All components and services are included in the core package and exported by `EngineModule`.

---

## Quick Start

### 1. Declarative Emitter (`<particleEmitter>`)

Add `<particleEmitter>` to any 3D entity or directly inside `<scene>`:

```html
<scene>
  <!-- Fire effect on a torch or campfire -->
  <mesh [position]="[0, 1.5, 0]">
    <particleEmitter preset="fire" [rate]="80" [speed]="[1.5, 3.0]" />
    <particleEmitter preset="smoke" [rate]="25" [gravity]="[0, 0.8, 0]" />
  </mesh>
</scene>
```

---

## Built-In Presets

The engine includes battle-tested presets for common gameplay VFX:

| Preset | Description | Blending | Default Shape |
|---|---|---|---|
| `fire` | Upward flame tongue with yellow-to-red color ramp | Additive | Sphere |
| `smoke` | Rising, expanding billowy puffs that fade to dark ash | Normal | Sphere |
| `sparks` | High-velocity welding/ricochet sparks with gravity drop | Additive | Point |
| `explosion` | Instant spherical blast burst with flame flash and smoke | Additive | Sphere |
| `magic` | Swirling, floating arcane embers with soft pulses | Additive | Ring |
| `snow` | Gentle falling, drifting environmental flakes | Normal | Box |
| `rain` | Rapid vertical downward streaks with velocity stretch | Normal | Box |
| `custom` | Clean slate for bespoke configurations | Additive | Point |

---

## Component Inputs & Customization

Every preset can be customized with explicit input properties:

```html
<particleEmitter
  preset="fire"
  [maxParticles]="500"
  [rate]="120"
  [burst]="30"
  [loop]="true"
  [lifetime]="[0.8, 1.8]"
  [speed]="[2.0, 4.5]"
  [direction]="[0, 1, 0]"
  [spread]="35"
  [gravity]="[0, 1.5, 0]"
  [damping]="0.98"
  [size]="[0.5, 0.1]"
  [color]="['#ffffff', '#ffeb3b', '#f44336', '#3e2723']"
  [opacity]="[1.0, 0.0]"
  [rotationSpeed]="[-2.0, 2.0]"
  blending="additive"
  shape="sphere"
  [shapeSize]="0.3"
  (finished)="onEmitterFinished()"
  (activeCountChange)="onCountChange($event)"
/>
```

### Properties Reference
- `preset`: Base preset to inherit defaults from (`'fire'`, `'smoke'`, `'sparks'`, etc.).
- `maxParticles`: Maximum allocated particle buffer size (default: 500).
- `rate`: Continuous emission rate in particles per second.
- `burst`: Instantaneous particle count emitted on start or via `emitBurst()`.
- `loop`: Whether continuous emission loops indefinitely (default: true).
- `autoplay`: Whether playback begins immediately upon creation (default: true).
- `duration`: Emission run-time in seconds before stopping (0 = infinite).
- `lifetime`: `[min, max]` or scalar lifetime in seconds.
- `speed`: `[min, max]` or scalar ejection speed.
- `direction`: Primary ejection vector `[x, y, z]` (default: `[0, 1, 0]`).
- `spread`: Cone spread angle in degrees ($0^\circ$ = line, $180^\circ$ = hemisphere, $360^\circ$ = sphere).
- `gravity`: Constant acceleration vector `[gx, gy, gz]` (e.g. `[0, -9.8, 0]` for sparks).
- `damping`: Velocity friction multiplier per second (e.g. `0.98`).
- `size`: `[startSize, endSize]` scale evolution over lifetime.
- `color`: Hex/RGB string or array of strings forming a multi-stop color ramp.
- `opacity`: `[startOpacity, endOpacity]` (0 to 1).
- `rotationSpeed`: Sprite angular roll speed in radians/sec.
- `blending`: `'additive'` (fire, energy, magic) or `'normal'` (smoke, dust, precipitation).
- `shape`: Emission volume (`'point'`, `'sphere'`, `'box'`, `'ring'`).
- `shapeSize`: Dimensions (radius for sphere/ring, `[w, h, d]` for box).
- `texture`: Optional custom URL string or `THREE.Texture`. Defaults to high-quality procedural soft discs, stars, or cloud puffs.

### Methods
- `play()`: Resumes emission.
- `pause()`: Suspends new emissions while allowing active particles to finish.
- `stop()`: Halts emission and immediately clears all active particles.
- `emitBurst(count?: number)`: Emits an instantaneous cluster of particles.

---

## Imperative VFX Service (`VfxService`)

For triggering one-shot particle effects dynamically from code (e.g. projectile impacts, weapon fire, destruction, or audio cues):

```ts
import { Component, inject } from '@angular/core';
import { VfxService } from 'triangular-engine';

@Component({ ... })
export class CombatComponent {
  private readonly vfx = inject(VfxService);

  onHit(hitPoint: [number, number, number], normal: [number, number, number]): void {
    // 1. Spawn impact sparks
    this.vfx.spawnSparks(hitPoint, normal, 40);

    // 2. Spawn an explosion
    this.vfx.spawnExplosion(hitPoint, 1.2, 120);

    // 3. Or trigger a custom burst
    this.vfx.spawnBurst('magic', {
      position: hitPoint,
      burst: 60,
      speed: [2, 5],
      color: ['#00e5ff', '#7c4dff'],
    });
  }
}
```
*Note: `VfxService` automatically removes all meshes, instanced geometries, and materials from the scene once a burst completes.*
