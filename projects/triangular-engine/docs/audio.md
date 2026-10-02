# Audio System

Triangular Engine includes a declarative, Three.js-powered 3D spatial audio system and multi-bus audio mixer.

Audio components and services are included in the core package and exported by `EngineModule`.

---

## Quick Start

### 1. Add an Audio Listener (`<audioListener>`)

The `<audioListener>` component represents the virtual microphone/ears in the scene. By default, it automatically binds to the engine's active camera (`engineService.camera$`):

```html
<scene>
  <orbitControls [cameraPosition]="[0, 5, 12]" [target]="[0, 1, 0]" />
  <audioListener [(masterVolume)]="masterVolume" />
</scene>
```

#### Camera-Based Spatialization & Zoom
- **Automatic Camera Tracking**: With `[attachToActiveCamera]="true"` (default), the listener tracks the active camera across `<orbitControls>`, `<raycastOrbitControls>`, `<camera>`, and runtime camera transitions (`engineService.switchCamera()`).
- **Distance Attenuation on Zoom**: As you zoom in (closer to positional sources), sounds get louder; as you zoom out (further away), sounds fade according to the emitter's `distanceModel` and `rolloffFactor`.
- **Stereo Panning on Orbit**: Orbiting the camera around emitters pans audio realistically between left and right ears.
- **3rd-Person Character Ears**: To anchor the listener to a player model instead of the orbiting camera, set `[attachToActiveCamera]="false"` inside the character mesh:
  ```html
  <mesh [position]="playerPos">
    <audioListener [attachToActiveCamera]="false" />
  </mesh>
  ```
- **Zero-Boilerplate Fallback**: Even if `<audioListener>` is omitted completely, `AudioService` creates and binds a canonical listener to the active camera automatically so audio playback works immediately.

---

### 2. 3D Positional Audio (`<positionalAudio>`)

Attach `<positionalAudio>` to any 3D entity (mesh, player, vehicle, bonfire, etc.) to spatialize sound in 3D:

```html
<mesh [position]="[10, 0, 5]">
  <boxGeometry />
  <meshStandardMaterial />

  <positionalAudio
    [src]="'assets/audio/campfire.mp3'"
    [loop]="true"
    [autoplay]="true"
    [refDistance]="3"
    [maxDistance]="50"
    [rolloffFactor]="1.5"
    bus="ambient"
  />
</mesh>
```

#### Inputs:
- `src`: Path to the audio file. Loaded and cached automatically.
- `buffer`: Optional pre-loaded `AudioBuffer` (takes precedence over `src`).
- `bus`: Audio channel name (`'sfx'`, `'music'`, `'ambient'`, `'voice'`, `'ui'`). Default `'sfx'`.
- `volume`: Base volume multiplier (default `1`).
- `loop`: Whether playback loops continuously (default `false`).
- `autoplay`: Whether playback begins immediately upon load (default `false`).
- `refDistance`: Distance at which volume reduction starts taking effect (default `1`).
- `maxDistance`: Maximum distance for attenuation (default `1000`).
- `rolloffFactor`: How rapidly sound fades with distance (default `1`).
- `distanceModel`: `'inverse' | 'linear' | 'exponential'` (default `'inverse'`).
- `coneInnerAngle`, `coneOuterAngle`, `coneOuterGain`: Optional directional audio cone.
- `playbackRate`: Playback speed multiplier (default `1`).
- `detune`: Pitch detune in cents (default `0`).

#### Methods & Outputs:
- `play(delay?: number)`, `pause()`, `stop()`.
- `(loaded)`: Emits loaded `AudioBuffer`.
- `(ended)`: Emits when non-looping playback completes.
- `(isPlayingChange)`: Emits boolean playback state changes.

---

### 3. Non-Positional 2D Audio (`<ambientAudio>` or `<audioSource>`)

For background music (BGM), UI audio, narration, or flat environmental score:

```html
<ambientAudio
  [src]="'assets/audio/theme.mp3'"
  [loop]="true"
  [autoplay]="true"
  [volume]="0.8"
  bus="music"
/>
```

---

### 4. Audio Mixing Buses (`AudioService`)

`AudioService` provides centralized volume and mute control across named audio channels:

```ts
import { inject } from '@angular/core';
import { AudioService } from 'triangular-engine';

export class SettingsComponent {
  readonly audioService = inject(AudioService);

  onMusicVolumeChange(event: Event): void {
    const volume = Number((event.target as HTMLInputElement).value);
    this.audioService.setBusVolume('music', volume);
  }

  toggleSfxMute(): void {
    const isMuted = this.audioService.isBusMuted('sfx');
    this.audioService.setBusMuted('sfx', !isMuted);
  }
}
```

#### Standard Channels:
- `'master'`: Scales all audio in the engine.
- `'music'`: Background music tracks.
- `'sfx'`: Sound effects (weapons, impacts, footsteps).
- `'ambient'`: Environmental ambience (wind, water, wildlife).
- `'voice'`: Dialogue and vocal cues.
- `'ui'`: User interface clicks and notifications.

Every audio component recalculates its effective volume reactively when its bus volume or mute state changes:
$$\text{Effective Volume} = \text{Base Volume} \times \text{Bus Volume} \times \text{Master Volume}$$

---

### 5. One-Shot Playback API

Play transient sounds without declaring components in templates:

```ts
import { inject } from '@angular/core';
import { AudioService } from 'triangular-engine';

export class GameComponent {
  readonly audioService = inject(AudioService);

  // Play a 2D UI sound
  playClickSound(): void {
    this.audioService.playOneShot('assets/audio/click.mp3', {
      bus: 'ui',
      volume: 0.5,
    });
  }

  // Play a 3D explosion in world space
  spawnExplosion(position: [number, number, number]): void {
    this.audioService.playPositionalOneShot('assets/audio/explosion.mp3', position, {
      bus: 'sfx',
      refDistance: 5,
      maxDistance: 100,
      rolloffFactor: 1.2,
    });
  }
}
```

One-shot sounds automatically detach, disconnect, and clean up their Web Audio nodes when playback finishes.
