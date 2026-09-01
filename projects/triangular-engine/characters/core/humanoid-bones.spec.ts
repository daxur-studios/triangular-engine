import {
  HUMAN_BONE_NAMES,
  HUMAN_BONE_NAMES_ARRAY,
  HUMAN_BONE_PARENT,
  type HumanoidBoneName,
} from './humanoid-bones';

describe('HUMAN_BONE_PARENT', () => {
  it('roots at hips and reaches every bone without cycles', () => {
    for (const name of HUMAN_BONE_NAMES_ARRAY) {
      const visited = new Set<HumanoidBoneName>();
      let current: HumanoidBoneName | null = name;
      let steps = 0;
      while (current !== null && steps <= HUMAN_BONE_NAMES_ARRAY.length) {
        expect(visited.has(current)).toBe(false);
        visited.add(current);
        current = HUMAN_BONE_PARENT[current];
        steps++;
      }
      expect(current).toBeNull();
    }
  });

  it('defines the expected spine chain', () => {
    expect(HUMAN_BONE_PARENT[HUMAN_BONE_NAMES.spine]).toBe(HUMAN_BONE_NAMES.hips);
    expect(HUMAN_BONE_PARENT[HUMAN_BONE_NAMES.chest]).toBe(HUMAN_BONE_NAMES.spine);
    expect(HUMAN_BONE_PARENT[HUMAN_BONE_NAMES.neck]).toBe(HUMAN_BONE_NAMES.chest);
    expect(HUMAN_BONE_PARENT[HUMAN_BONE_NAMES.head]).toBe(HUMAN_BONE_NAMES.neck);
  });

  it('attaches arms through shoulders and legs through hips', () => {
    expect(HUMAN_BONE_PARENT[HUMAN_BONE_NAMES.leftShoulder]).toBe(HUMAN_BONE_NAMES.chest);
    expect(HUMAN_BONE_PARENT[HUMAN_BONE_NAMES.leftUpperArm]).toBe(HUMAN_BONE_NAMES.leftShoulder);
    expect(HUMAN_BONE_PARENT[HUMAN_BONE_NAMES.leftLowerArm]).toBe(HUMAN_BONE_NAMES.leftUpperArm);
    expect(HUMAN_BONE_PARENT[HUMAN_BONE_NAMES.leftUpperLeg]).toBe(HUMAN_BONE_NAMES.hips);
    expect(HUMAN_BONE_PARENT[HUMAN_BONE_PARENT[HUMAN_BONE_NAMES.leftLowerLeg]!]!).toBe(
      HUMAN_BONE_NAMES.hips,
    );
  });
});
