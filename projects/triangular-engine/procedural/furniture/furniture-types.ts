import type { Group, Matrix4 } from 'three';
import type {
  CharacterDoorAffordance,
  CharacterReachAffordance,
  CharacterSitAffordance,
} from 'triangular-engine/characters';

export type ProceduralChairStyle = 'dining' | 'stool' | 'armchair';
export type ProceduralDoorKnobStyle = 'round' | 'lever';
export type ProceduralDoorHingeSide = 'left' | 'right';

export interface IProceduralChairOptions {
  /** Width of the chair seat in meters (default: 0.46m). */
  readonly seatWidthM?: number;
  /** Depth of the chair seat in meters (default: 0.44m). */
  readonly seatDepthM?: number;
  /** Height of the seat surface above ground in meters (default: 0.45m). */
  readonly seatHeightM?: number;
  /** Height of the backrest above the seat in meters (default: 0.45m; 0 for stool). */
  readonly backrestHeightM?: number;
  /** Visual chair style. Defaults to 'dining'. */
  readonly style?: ProceduralChairStyle;
  /** Color of legs and wooden/metal framing (hex string, e.g. '#6b4423'). */
  readonly frameColorHex?: string;
  /** Color of seat cushion / back upholstery (hex string, e.g. '#3b82f6'). */
  readonly cushionColorHex?: string;
  /** Cast shadow flag on created meshes. Defaults to true. */
  readonly castShadow?: boolean;
  /** Receive shadow flag on created meshes. Defaults to true. */
  readonly receiveShadow?: boolean;
}

export interface IProceduralChairResult {
  /** The root Three.js Group holding the chair geometry. */
  readonly group: Group;
  /** Sit affordance in local coordinates (origin at chair base center). */
  readonly sitAffordance: CharacterSitAffordance;
  /**
   * Computes the world-space CharacterSitAffordance.
   * If a worldMatrix is not passed, it uses group.matrixWorld (updating it if needed).
   */
  getSitAffordance(worldMatrix?: Matrix4): CharacterSitAffordance;
  /** Disposes geometries and materials created for the chair. */
  dispose(): void;
}

export interface IProceduralDoorOptions {
  /** Total frame opening width in meters (default: 0.92m). */
  readonly frameWidthM?: number;
  /** Total frame opening height in meters (default: 2.10m). */
  readonly frameHeightM?: number;
  /** Depth of the door frame jamb in meters (default: 0.10m). */
  readonly frameDepthM?: number;
  /** Thickness of the door leaf panel in meters (default: 0.04m). */
  readonly doorThicknessM?: number;
  /** Height of the knob/handle from the ground in meters (default: 0.98m). */
  readonly knobHeightM?: number;
  /** Style of the door handle. Defaults to 'round'. */
  readonly knobStyle?: ProceduralDoorKnobStyle;
  /** Side where the hinge is mounted. Defaults to 'left'. */
  readonly hingeSide?: ProceduralDoorHingeSide;
  /** Frame color hex string (default: '#334155'). */
  readonly frameColorHex?: string;
  /** Door leaf panel color hex string (default: '#854d0e'). */
  readonly doorColorHex?: string;
  /** Door knob / handle color hex string (default: '#e2e8f0'). */
  readonly knobColorHex?: string;
  /** Cast shadow flag on created meshes. Defaults to true. */
  readonly castShadow?: boolean;
  /** Receive shadow flag on created meshes. Defaults to true. */
  readonly receiveShadow?: boolean;
}

export interface IProceduralDoorResult {
  /** The root Three.js Group holding the door frame and child hinge group. */
  readonly group: Group;
  /** The hinge pivot Group containing the swinging door leaf and knob. */
  readonly hingeGroup: Group;
  /** Initial door affordance in local coordinates. */
  readonly doorAffordance: CharacterDoorAffordance;
  /** Initial knob reach affordance in local coordinates. */
  readonly knobReachAffordance: CharacterReachAffordance;
  /** Sets the swing angle of the door around its vertical hinge in radians (0 = closed). */
  setOpenAngle(angleRad: number): void;
  /** Returns the current swing angle in radians. */
  getOpenAngle(): number;
  /**
   * Computes the world-space CharacterDoorAffordance reflecting current hinge rotation and placement.
   */
  getDoorAffordance(worldMatrix?: Matrix4): CharacterDoorAffordance;
  /**
   * Computes the world-space CharacterReachAffordance for the knob reflecting current hinge rotation and placement.
   */
  getKnobReachAffordance(worldMatrix?: Matrix4): CharacterReachAffordance;
  /** Disposes geometries and materials created for the door. */
  dispose(): void;
}
