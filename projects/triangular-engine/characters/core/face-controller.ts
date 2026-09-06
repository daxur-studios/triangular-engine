/**
 * Facial animation controller and layered composition engine.
 *
 * Combines expressions, manual channel overrides, procedural/triggered blinking,
 * speech viseme articulation, and gaze targeting into a coherent per-frame state.
 *
 * This module is framework-free and uses standard SI units:
 * - Time: seconds
 * - Angles: radians
 * - Channel weights: normalized [0, 1]
 */

import type { BlendShapeWeights } from './blend-shapes';
import type { CharacterVector3 } from './character-vector';
import {
  EXPRESSION_PRESETS,
  FACE_SEMANTIC_CHANNEL_NAMES,
  clamp01,
  expandSemanticChannels,
  semanticChannelsToBlendShapes,
  type ExtendedEmotionName,
  type FaceCommand,
  type FaceSemanticChannelName,
  type FaceSemanticChannelValues,
} from './face-semantic-channels';
import type { LookAtAngles } from './look-at';
import {
  sampleVisemeTrack,
  visemeToBlendShapes,
  type Viseme,
  type VisemeKeyframe,
} from './visemes';

/** Eye gaze physiological rotation limits (radians). */
export const EYE_GAZE_LIMITS = {
  /** Maximum horizontal gaze deviation (±30°). */
  yawLimit: 0.52,
  /** Maximum downward pitch (+20°). */
  pitchDownLimit: 0.35,
  /** Maximum upward pitch (−20°). */
  pitchUpLimit: 0.35,
} as const;

export interface EyeGazeState {
  readonly left: LookAtAngles;
  readonly right: LookAtAngles;
}

export interface FacialFrameState {
  /** Fully evaluated semantic channels in [0, 1]. */
  readonly channels: Record<FaceSemanticChannelName, number>;
  /** Evaluated ARKit 52 blendshape weights for 3D/2D presentation. */
  readonly blendShapes: BlendShapeWeights;
  /** Clamped eye gaze angles in radians. */
  readonly gaze: EyeGazeState;
  readonly isSpeaking: boolean;
  readonly isBlinking: boolean;
  readonly currentEmotion: ExtendedEmotionName;
}

export interface FacialControllerOptions {
  /** Enable automatic periodic natural blinking. Default: false. */
  readonly autoBlink?: boolean;
  /** Average interval between auto-blinks in seconds. Default: 4.0. */
  readonly autoBlinkInterval?: number;
  /** Default duration of a blink in seconds. Default: 0.18. */
  readonly blinkDuration?: number;
  /** Default transition time when switching expressions in seconds. Default: 0.25. */
  readonly defaultTransitionSeconds?: number;
}

interface BlinkTracker {
  active: boolean;
  elapsed: number;
  duration: number;
}

interface ChannelTransition {
  current: number;
  target: number;
  remaining: number;
  duration: number;
}

/**
 * Procedural facial animation controller that coordinates layered facial intentions.
 */
export class FacialAnimationController {
  private currentEmotion: ExtendedEmotionName = 'neutral';
  private emotionIntensity = 1.0;
  private emotionChannels: Record<FaceSemanticChannelName, number> = expandSemanticChannels({});
  private emotionTransition?: {
    from: Record<FaceSemanticChannelName, number>;
    to: Record<FaceSemanticChannelName, number>;
    elapsed: number;
    duration: number;
  };

  private readonly channelOverrides = new Map<FaceSemanticChannelName, ChannelTransition>();

  private readonly leftBlink: BlinkTracker = { active: false, elapsed: 0, duration: 0.18 };
  private readonly rightBlink: BlinkTracker = { active: false, elapsed: 0, duration: 0.18 };
  private autoBlinkTimer = 0;

  // Speech / Viseme layer
  private activeVisemes: readonly VisemeKeyframe[] = [];
  private speechElapsed = 0;
  private speechTotalDuration = 0;
  private speechMouthDamping: Record<string, number> = {};

  // Gaze layer
  private targetGaze: LookAtAngles = { yaw: 0, pitch: 0 };
  private currentGaze: LookAtAngles = { yaw: 0, pitch: 0 };
  private gazeTransitionRemaining = 0;
  private gazeTransitionDuration = 0.15;
  private gazeFrom: LookAtAngles = { yaw: 0, pitch: 0 };

  private readonly options: Required<FacialControllerOptions>;

  constructor(options: FacialControllerOptions = {}) {
    this.options = {
      autoBlink: options.autoBlink ?? false,
      autoBlinkInterval: options.autoBlinkInterval ?? 4.0,
      blinkDuration: options.blinkDuration ?? 0.18,
      defaultTransitionSeconds: options.defaultTransitionSeconds ?? 0.25,
    };
    this.autoBlinkTimer = this.options.autoBlinkInterval * (0.8 + Math.random() * 0.4);
  }

  /**
   * Execute a serializable command.
   */
  public execute(command: FaceCommand): void {
    switch (command.type) {
      case 'lookAt':
        this.lookAt(command.target, command.transitionSeconds);
        break;
      case 'setExpression':
        this.setExpression(command.expression, command.intensity, command.transitionSeconds);
        break;
      case 'setChannel':
        this.setFaceChannel(command.channel, command.value, command.transitionSeconds);
        break;
      case 'blink':
        this.blink(command.eye, command.durationSeconds);
        break;
      case 'playVisemes':
        this.playVisemes(command.sequence);
        break;
      case 'reset':
        this.resetToNeutral(command.transitionSeconds);
        break;
    }
  }

  /**
   * Direct gaze towards a spatial target or explicit yaw/pitch angles.
   * Angles are clamped to physiological limits (yaw: ±30°, pitch: ±20°).
   */
  public lookAt(
    target: { readonly x: number; readonly y: number; readonly z: number } | { readonly yaw: number; readonly pitch: number },
    transitionSeconds = 0.15,
  ): void {
    let rawYaw = 0;
    let rawPitch = 0;

    if ('yaw' in target && 'pitch' in target) {
      rawYaw = target.yaw;
      rawPitch = target.pitch;
    } else {
      // Spatial target relative to head (assuming head forward is +Z)
      const dx = target.x;
      const dy = target.y;
      const dz = target.z;
      const horizontal = Math.hypot(dx, dz);
      rawYaw = Math.atan2(dx, dz);
      rawPitch = -Math.atan2(dy, Math.max(0.001, horizontal));
    }

    // Clamp to physiological eye limits
    const clampedYaw = Math.min(
      EYE_GAZE_LIMITS.yawLimit,
      Math.max(-EYE_GAZE_LIMITS.yawLimit, rawYaw),
    );
    const clampedPitch = Math.min(
      EYE_GAZE_LIMITS.pitchDownLimit,
      Math.max(-EYE_GAZE_LIMITS.pitchUpLimit, rawPitch),
    );

    this.gazeFrom = { ...this.currentGaze };
    this.targetGaze = { yaw: clampedYaw, pitch: clampedPitch };
    this.gazeTransitionDuration = Math.max(0.01, transitionSeconds);
    this.gazeTransitionRemaining = this.gazeTransitionDuration;
  }

  /**
   * Set the facial expression preset with smooth transition.
   */
  public setExpression(
    expression: ExtendedEmotionName,
    intensity = 1.0,
    transitionSeconds?: number,
  ): void {
    const duration = transitionSeconds ?? this.options.defaultTransitionSeconds;
    const clampedIntensity = clamp01(intensity);
    const preset = EXPRESSION_PRESETS[expression] ?? EXPRESSION_PRESETS.neutral;

    // Scale preset channels by intensity
    const scaledChannels: Partial<Record<FaceSemanticChannelName, number>> = {};
    for (const [key, val] of Object.entries(preset)) {
      if (val !== undefined) {
        scaledChannels[key as FaceSemanticChannelName] = val * clampedIntensity;
      }
    }
    const targetExpanded = expandSemanticChannels(scaledChannels);

    if (duration <= 0.001) {
      this.currentEmotion = expression;
      this.emotionIntensity = clampedIntensity;
      this.emotionChannels = targetExpanded;
      this.emotionTransition = undefined;
    } else {
      this.emotionTransition = {
        from: { ...this.emotionChannels },
        to: targetExpanded,
        elapsed: 0,
        duration,
      };
      this.currentEmotion = expression;
      this.emotionIntensity = clampedIntensity;
    }
  }

  /**
   * Override an individual semantic facial channel with an explicit value and smooth transition.
   */
  public setFaceChannel(
    channel: FaceSemanticChannelName,
    value: number,
    transitionSeconds = 0.15,
  ): void {
    const clampedVal = clamp01(value);
    const currentVal = this.channelOverrides.get(channel)?.current ?? this.emotionChannels[channel] ?? 0;
    const duration = Math.max(0.001, transitionSeconds);

    this.channelOverrides.set(channel, {
      current: currentVal,
      target: clampedVal,
      remaining: duration,
      duration,
    });
  }

  /**
   * Trigger an eyelid blink for left, right, or both eyes.
   */
  public blink(eye: 'both' | 'left' | 'right' = 'both', durationSeconds?: number): void {
    const dur = durationSeconds ?? this.options.blinkDuration;
    if (eye === 'both' || eye === 'left') {
      this.leftBlink.active = true;
      this.leftBlink.elapsed = 0;
      this.leftBlink.duration = dur;
    }
    if (eye === 'both' || eye === 'right') {
      this.rightBlink.active = true;
      this.rightBlink.elapsed = 0;
      this.rightBlink.duration = dur;
    }
  }

  /**
   * Play a timed sequence of speech visemes.
   */
  public playVisemes(sequence: readonly VisemeKeyframe[]): void {
    this.activeVisemes = sequence;
    this.speechElapsed = 0;
    let maxTime = 0;
    for (const kf of sequence) {
      const end = kf.time + kf.duration;
      if (end > maxTime) maxTime = end;
    }
    this.speechTotalDuration = maxTime;
  }

  /**
   * Smoothly reset all expressions, channel overrides, speech, and gaze back to neutral rest.
   */
  public resetToNeutral(transitionSeconds = 0.25): void {
    this.setExpression('neutral', 1.0, transitionSeconds);
    this.activeVisemes = [];
    this.speechElapsed = 0;
    this.speechTotalDuration = 0;
    this.lookAt({ yaw: 0, pitch: 0 }, transitionSeconds);

    for (const channel of this.channelOverrides.keys()) {
      this.setFaceChannel(channel, 0, transitionSeconds);
    }
  }

  /**
   * Evaluate facial state for the current frame.
   */
  public update(deltaTimeSeconds: number): FacialFrameState {
    const dt = Math.max(0, deltaTimeSeconds);

    // 1. Update Gaze
    if (this.gazeTransitionRemaining > 0) {
      this.gazeTransitionRemaining = Math.max(0, this.gazeTransitionRemaining - dt);
      const t = 1 - this.gazeTransitionRemaining / this.gazeTransitionDuration;
      const smoothT = t * t * (3 - 2 * t); // smoothstep
      this.currentGaze = {
        yaw: this.gazeFrom.yaw + (this.targetGaze.yaw - this.gazeFrom.yaw) * smoothT,
        pitch: this.gazeFrom.pitch + (this.targetGaze.pitch - this.gazeFrom.pitch) * smoothT,
      };
    } else {
      this.currentGaze = { ...this.targetGaze };
    }

    // 2. Update Expression Transition
    if (this.emotionTransition) {
      this.emotionTransition.elapsed += dt;
      const progress = Math.min(1, this.emotionTransition.elapsed / this.emotionTransition.duration);
      const smoothProgress = progress * progress * (3 - 2 * progress);

      for (const name of FACE_SEMANTIC_CHANNEL_NAMES) {
        const fromVal = this.emotionTransition.from[name] ?? 0;
        const toVal = this.emotionTransition.to[name] ?? 0;
        this.emotionChannels[name] = fromVal + (toVal - fromVal) * smoothProgress;
      }

      if (progress >= 1) {
        this.emotionChannels = { ...this.emotionTransition.to };
        this.emotionTransition = undefined;
      }
    }

    // Base working channels initialized from expression
    const evaluated: Record<FaceSemanticChannelName, number> = { ...this.emotionChannels };

    // 3. Update Channel Overrides
    for (const [name, trans] of this.channelOverrides.entries()) {
      if (trans.remaining > 0) {
        trans.remaining = Math.max(0, trans.remaining - dt);
        const t = 1 - trans.remaining / trans.duration;
        const smoothT = t * t * (3 - 2 * t);
        trans.current = trans.current + (trans.target - trans.current) * smoothT;
      } else {
        trans.current = trans.target;
      }
      evaluated[name] = trans.current;
    }

    // 4. Update Blinking Envelope
    const sampleBlinkEnvelope = (tracker: BlinkTracker): number => {
      if (!tracker.active) return 0;
      tracker.elapsed += dt;
      if (tracker.elapsed >= tracker.duration) {
        tracker.active = false;
        return 0;
      }
      const p = tracker.elapsed / tracker.duration;
      // 0..0.35: close (attack), 0.35..0.50: held closed, 0.50..1.0: reopen (release)
      if (p < 0.35) {
        return Math.sin((p / 0.35) * (Math.PI / 2));
      } else if (p < 0.5) {
        return 1.0;
      } else {
        const rel = (p - 0.5) / 0.5;
        return Math.cos(rel * (Math.PI / 2));
      }
    };

    const leftBlinkVal = sampleBlinkEnvelope(this.leftBlink);
    const rightBlinkVal = sampleBlinkEnvelope(this.rightBlink);

    // Auto-blink logic if enabled
    if (this.options.autoBlink) {
      this.autoBlinkTimer -= dt;
      if (this.autoBlinkTimer <= 0) {
        this.blink('both');
        this.autoBlinkTimer = this.options.autoBlinkInterval * (0.7 + Math.random() * 0.6);
      }
    }

    evaluated['eye.blink.left'] = Math.max(evaluated['eye.blink.left'] ?? 0, leftBlinkVal);
    evaluated['eye.blink.right'] = Math.max(evaluated['eye.blink.right'] ?? 0, rightBlinkVal);

    // 5. Update Speech Viseme Articulation
    let isSpeaking = false;
    if (this.activeVisemes.length > 0 && this.speechElapsed <= this.speechTotalDuration + 0.25) {
      this.speechElapsed += dt;
      isSpeaking = this.speechElapsed <= this.speechTotalDuration;
      const activeViseme: Viseme = sampleVisemeTrack(this.activeVisemes, this.speechElapsed);
      const visemeWeights = visemeToBlendShapes(activeViseme);

      // Smooth mouth shape damping to prevent harsh popping
      const damp = (key: string, targetVal: number, speed: number) => {
        const current = this.speechMouthDamping[key] ?? 0;
        const next = current + (targetVal - current) * Math.min(1, dt * speed);
        this.speechMouthDamping[key] = next;
        return next;
      };

      const speechJaw = damp('jawOpen', visemeWeights.jawOpen ?? 0, 18);
      const speechCloseTarget = Math.max(
        visemeWeights.mouthClose ?? 0,
        visemeWeights.mouthPressLeft ?? 0,
        visemeWeights.mouthPressRight ?? 0,
      );
      const speechClose = damp('mouthClose', speechCloseTarget, 22);
      const speechPucker = damp('mouthPucker', visemeWeights.mouthPucker ?? 0, 18);
      const speechFunnel = damp('mouthFunnel', visemeWeights.mouthFunnel ?? 0, 18);
      const speechWiden = damp(
        'mouthStretch',
        Math.max(visemeWeights.mouthStretchLeft ?? 0, visemeWeights.mouthStretchRight ?? 0),
        18,
      );

      // Layer speech on top of expression:
      // Smile corners remain lifted; speech jaw and rounding modulate mouth opening.
      // If lip closure is high (e.g. M/B/P bilabial sounds), lipClose seals the mouth.
      evaluated['mouth.jawOpen'] = Math.max(evaluated['mouth.jawOpen'] ?? 0, speechJaw);
      evaluated['mouth.lipClose'] = Math.max(evaluated['mouth.lipClose'] ?? 0, speechClose);
      evaluated['mouth.pucker'] = Math.max(evaluated['mouth.pucker'] ?? 0, speechPucker);
      evaluated['mouth.funnel'] = Math.max(evaluated['mouth.funnel'] ?? 0, speechFunnel);
      evaluated['mouth.widen'] = Math.max(evaluated['mouth.widen'] ?? 0, speechWiden);

      // If lipClose is strongly active, suppress wide/round to form clean bilabial seal
      if (speechClose > 0.4) {
        evaluated['mouth.jawOpen'] *= 1 - speechClose * 0.7;
      }
    } else {
      // Decay speech articulators to zero at rest
      for (const key of Object.keys(this.speechMouthDamping)) {
        this.speechMouthDamping[key] = Math.max(
          0,
          this.speechMouthDamping[key] - dt * 6,
        );
      }
    }

    // 6. Convert fully layered semantic channels to ARKit 52 blendshape weights
    const blendShapes = semanticChannelsToBlendShapes(evaluated);

    return {
      channels: evaluated,
      blendShapes,
      gaze: {
        left: { ...this.currentGaze },
        right: { ...this.currentGaze },
      },
      isSpeaking,
      isBlinking: this.leftBlink.active || this.rightBlink.active,
      currentEmotion: this.currentEmotion,
    };
  }

  /**
   * Creates a deterministic, repeatable viseme playback sequence fixture
   * to prove distinct mouth silhouettes (closed-lip, open jaw, rounded, wide).
   */
  public static createArticulationFixture(): readonly VisemeKeyframe[] {
    return [
      { time: 0.0, viseme: 'sil', duration: 0.15 },
      // 'M' - Bilabial closed-lip contact
      { time: 0.15, viseme: 'M', duration: 0.25 },
      // 'A' - Open jaw
      { time: 0.4, viseme: 'A', duration: 0.3 },
      // 'O' - Rounded funnel
      { time: 0.7, viseme: 'O', duration: 0.25 },
      // 'U' - Tight pucker
      { time: 0.95, viseme: 'U', duration: 0.25 },
      // 'E' - Wide smile / stretch
      { time: 1.2, viseme: 'E', duration: 0.3 },
      // Return to rest
      { time: 1.5, viseme: 'sil', duration: 0.2 },
    ];
  }
}
