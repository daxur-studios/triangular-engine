/**
 * Parameters for the bracket shown in the POC. All lengths are millimetres,
 * matching the units brepjs and OpenCascade work in.
 */
export interface PartParameters {
  /** Overall plate width along X. */
  readonly width: number;
  /** Overall plate depth along Y. */
  readonly depth: number;
  /** Plate thickness, also the flange thickness. */
  readonly thickness: number;
  /** Height of the vertical flange above the plate. */
  readonly flangeHeight: number;
  /** Mounting hole diameter, drilled through the plate. */
  readonly holeDiameter: number;
  /** Fillet radius on the vertical edges. */
  readonly filletRadius: number;
}

/** One slider row in the panel: label, key, limits and step. */
export interface PartParameterControl {
  readonly key: keyof PartParameters;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** Distance from the plate edge to the centre of a mounting hole. */
export const HOLE_INSET_MM = 18;

/** Slider definitions, in panel order. */
export const PART_PARAMETER_CONTROLS: readonly PartParameterControl[] = [
  { key: 'width', label: 'Width', min: 60, max: 200, step: 1 },
  { key: 'depth', label: 'Depth', min: 40, max: 160, step: 1 },
  { key: 'thickness', label: 'Thickness', min: 4, max: 20, step: 0.5 },
  { key: 'flangeHeight', label: 'Flange', min: 0, max: 100, step: 1 },
  { key: 'holeDiameter', label: 'Hole dia', min: 3, max: 20, step: 0.5 },
  { key: 'filletRadius', label: 'Fillet', min: 0, max: 10, step: 0.5 },
];

/** Starting values; a plausible small mounting bracket. */
export const DEFAULT_PART_PARAMETERS: PartParameters = {
  width: 120,
  depth: 80,
  thickness: 8,
  flangeHeight: 40,
  holeDiameter: 9,
  filletRadius: 4,
};
