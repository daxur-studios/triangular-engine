export type Point = readonly [number, number, number];

/** Torso-local coordinates in metres, +Y up and +Z forward. */
export const joinedLegs = [
  { name: 'capsule-cat-front-left-leg', ankle: [-.178, -.375, .329], hipHeight: .24 },
  { name: 'capsule-cat-front-right-leg', ankle: [.178, -.375, .329], hipHeight: .24 },
  { name: 'capsule-cat-back-left-leg', ankle: [-.178, -.375, -.324], hipHeight: .24 },
  { name: 'capsule-cat-back-right-leg', ankle: [.178, -.375, -.324], hipHeight: .24 },
] as const;

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
