/** CAD space is millimetres, Z-up. Lab coordinates convert to [x, -z, y]. */
export const tower = {
  height: 80_000,
  mastCenterX: -8_000,
  guideX: -5_100,
  guideY: 2_800,
  carriageX: -4_200,
  armRootX: -2_800,
  padCenterX: 6_500,
  padInset: 500,
  padTop: 750,
  padWidth: 1_000,
  padLength: 11_000,
  nominalRailHeight: 35_750,
  minSocketHeight: 5_000,
  maxSocketHeight: 75_000,
  socketAboveRail: 150,
  openPadCenter: 6_000,
  closedPadCenter: 1_600,
  slideLimit: 5_500,
  slideSpeed: 12_000,
  liftSpeed: 3_000,
  // Visual hinge travel within the engine archetype's 0.55 rad range.
  hingeTravel: Math.PI * 28 / 180,
};

export const booster = {
  centerX: 6_000,
  diameter: 1_000,
  tankLength: 1_400,
  pinSpan: 4_400,
  pinWidth: 250,
  pinHeight: 300,
};

export const metres = (mm: number) => mm / 1_000;

// The lab calls the +Z arm left. In CAD that is the -Y (mirrored) arm.
export const armSides = { left: -1, right: 1 } as const;

export function armPose(side: 1 | -1, openness: number, mode: 'slide' | 'hinge') {
  const { openPadCenter, closedPadCenter, padInset, hingeTravel } = tower;
  const slide = mode === 'slide' ? (openPadCenter - closedPadCenter) * openness : 0;
  return {
    y: side * (closedPadCenter + padInset + slide),
    yaw: mode === 'hinge' ? side * hingeTravel * openness : 0,
  };
}
