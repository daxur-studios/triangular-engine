# Facial Animation & Semantic Character Controls

The `triangular-engine/characters` sub-library provides framework-free semantic facial animation controls and a layered composition engine (`FacialAnimationController`). The controls are decoupled from mesh geometry, allowing 3D procedural faces, skinned meshes, and 2D styles to share identical semantic commands.

## Architecture

```text
Semantic Commands (AI Agent / Game Script)
  │
  ├── lookAt(target)
  ├── setExpression("happy", intensity, transition)
  ├── setFaceChannel("brow.right.raise", value, transition)
  ├── blink("left" | "right" | "both", duration)
  └── playVisemes(sequence)
  │
  ▼
FacialAnimationController (Framework-free Core)
  │
  ├── Layer 1: Base Expression (smooth transition between emotion presets)
  ├── Layer 2: Semantic Channel Overrides (independent brow, squint, etc.)
  ├── Layer 3: Procedural / Triggered Blinks (attack/hold/release envelope)
  ├── Layer 4: Speech Visemes (articulatory mouth shapes + rest return)
  └── Layer 5: Eye Gaze Solver (physiological clamp: yaw ±30°, pitch ±20°)
  │
  ▼
FacialFrameState (Per-frame evaluated state)
  ├── channels: Record<FaceSemanticChannelName, number>  [0, 1]
  ├── blendShapes: BlendShapeWeights (ARKit 52)          [0, 1]
  └── gaze: { left: LookAtAngles, right: LookAtAngles }  (radians)
  │
  ▼
Presentation Adapter
  ├── Reference Face Mesh (buildReferenceFaceMesh in triangular-engine/procedural)
  └── SkinnedMesh / Vector Face Canvas (applyCharacterFacePose)
```

## Conventions

- **Time units**: Seconds (`transitionSeconds`, `durationSeconds`).
- **Channel values**: Normalized `0.0` to `1.0`.
- **Coordinate & Angle conventions**:
  - Radians for all angles.
  - Head forward is `+Z`, up is `+Y`, right is `+X`.
  - Yaw: positive turns left (+Y axis rotation), negative turns right.
  - Pitch: positive pitches down (+X axis rotation), negative pitches up.
  - Gaze limits: Yaw clamped to `±0.52` rad (±30°), Pitch clamped to `−0.35` rad (up 20°) / `+0.35` rad (down 20°).

## Supported Capabilities

| Capability | Semantic Channels | ARKit 52 Mapping |
| --- | --- | --- |
| **Eyebrows** | `brow.left.raise`, `brow.right.raise`, `brow.left.lower`, `brow.right.lower` | `browOuterUpLeft`, `browOuterUpRight`, `browInnerUp`, `browDownLeft`, `browDownRight` |
| **Eyelids** | `eye.blink.left`, `eye.blink.right`, `eye.squint`, `eye.wide` | `eyeBlinkLeft`, `eyeBlinkRight`, `eyeSquintLeft/Right`, `eyeWideLeft/Right` |
| **Mouth Expressions** | `mouth.smile`, `mouth.frown`, `mouth.widen` | `mouthSmileLeft/Right`, `mouthFrownLeft/Right`, `mouthStretchLeft/Right` |
| **Mouth Speech** | `mouth.jawOpen`, `mouth.lipClose`, `mouth.round`, `mouth.funnel` | `jawOpen`, `mouthClose`, `mouthPucker`, `mouthFunnel` |
| **Cheeks** | `cheek.puff`, `cheek.squint.left`, `cheek.squint.right` | `cheekPuff`, `cheekSquintLeft`, `cheekSquintRight` |

### Independent Eyebrow Control
The right eyebrow can be raised alone while the left stays neutral or lowered (for skeptical or inquisitive looks):
```ts
controller.setFaceChannel('brow.right.raise', 0.9, 0.15);
controller.setFaceChannel('brow.left.lower', 0.25, 0.15);
```

### Layered Control Combination
Overlapping controls combine without overwriting each other:
1. **Expression + Speech**: If the character is smiling (`mouth.smile` = 0.7) and speaks an open vowel `A` (`mouth.jawOpen` = 0.6), the smile corners remain pulled up into the cheeks while the jaw opens cleanly.
2. **Speech Lip Closure**: For bilabial sounds (`M`, `B`, `P`), `mouth.lipClose` activates and seals the lips together at the horizontal seam, even if the character is smiling.
3. **Blinking + Squint**: Procedural blinks modulate the eyelid position using `Math.max(expressionBlink, blinkEnvelope)`, preventing sudden pops.
4. **Speech Completion**: When a speech viseme track finishes, articulators decay smoothly back to zero, returning the mouth cleanly to the expression baseline.

## Proving Ground Demo

Open `/characters-lab` in the demo application:
- **Face Studio Mode**: Close-up portrait camera with front, 3/4, and profile view angles, and three-point portrait lighting.
- **Interactive Gaze Reticle**: Directs eye pupils within anatomical limits.
- **Individual Channel Sliders**: Test fine controls for brows, eyelids, and mouth.
- **Articulation Fixture**: Play a deterministic sequence demonstrating `M` (closed), `A` (open), `O` (round), and `E` (wide).
- **Combined Performance**: Test smiling while speaking, looking around, and blinking simultaneously.
- **Reset**: Smoothly returns to neutral.
