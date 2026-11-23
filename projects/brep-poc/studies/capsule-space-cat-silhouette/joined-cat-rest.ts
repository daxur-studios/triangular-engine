export type Point = readonly [number, number, number];

/** Original paw stations in torso-local metres, +Y up and +Z forward. */
export const originalLegs = [
  { name: 'capsule-cat-front-left-leg', ankle: [-.178, -.395, .329], hipHeight: .265 },
  { name: 'capsule-cat-front-right-leg', ankle: [.178, -.395, .329], hipHeight: .265 },
  { name: 'capsule-cat-back-left-leg', ankle: [-.178, -.395, -.324], hipHeight: .265 },
  { name: 'capsule-cat-back-right-leg', ankle: [.178, -.395, -.324], hipHeight: .265 },
] as const;

const joinedLegs = originalLegs.map(leg => {
  const [x, , z] = leg.ankle;
  return { ...leg, ankle: [x, -.375, z] as Point, hipHeight: .24 };
});

export const joinedTail: readonly [Point, Point, Point, Point] = [
  [0, .095, -.337],
  [0, .198, -.666],
  [0, .582, -.334],
  [0, .531, -.567],
];

export const conceptBodyLength = 780;
export const conceptRearExtension = (conceptBodyLength - 900) / 1000;

export function joinedCatRest(compact: boolean) {
  if (!compact) return { legs: joinedLegs, tail: joinedTail };
  const legs = joinedLegs.map(leg => {
    const [x, y, z] = leg.ankle;
    const ankle: Point = [x, y + .035, z > 0 ? z : z - conceptRearExtension];
    return { ...leg, ankle, hipHeight: .215 };
  });
  const tail: typeof joinedTail = [
    [0, .090, -.217],
    [0, .145, -.503],
    [0, .474, -.455],
    [0, .427, -.624],
  ];
  return { legs, tail };
}
