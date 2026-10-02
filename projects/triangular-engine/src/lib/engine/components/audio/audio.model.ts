import { Object3D, Vector3, Vector3Tuple } from 'three';

export type AudioBusName =
  | 'master'
  | 'music'
  | 'sfx'
  | 'ambient'
  | 'voice'
  | 'ui'
  | (string & {});

export type AudioDistanceModel = 'linear' | 'inverse' | 'exponential';

export interface AudioConeOptions {
  /** Inner angle of the directional cone in degrees (default 360). */
  innerAngle?: number;
  /** Outer angle of the directional cone in degrees (default 360). */
  outerAngle?: number;
  /** Volume multiplier outside the outer cone (0-1, default 0). */
  outerGain?: number;
}

export interface PlayOneShotOptions {
  /** Base volume for playback (0-1+, default 1). */
  volume?: number;
  /** Audio bus channel to route through (default 'sfx'). */
  bus?: AudioBusName;
  /** Playback speed multiplier (default 1). */
  playbackRate?: number;
  /** Pitch detune in cents (default 0). */
  detune?: number;
  /** Whether to loop the playback (default false). */
  loop?: boolean;
}

export interface PlayPositionalOneShotOptions extends PlayOneShotOptions {
  /** Distance at which volume attenuation begins (default 1). */
  refDistance?: number;
  /** Distance beyond which volume no longer attenuates (default 1000). */
  maxDistance?: number;
  /** How quickly volume drops with distance (default 1). */
  rolloffFactor?: number;
  /** Distance attenuation model algorithm (default 'inverse'). */
  distanceModel?: AudioDistanceModel;
  /** Optional directional cone settings. */
  cone?: AudioConeOptions;
  /** Optional parent Object3D to attach the sound to instead of scene root. */
  parent?: Object3D;
}
