import { Mesh } from 'three';
import type { ExtendedEmotionName } from 'triangular-engine/characters';
import { createCharacterStudioContributions } from './character-studio-contributions';
import { EXPERIMENTAL_PIGTAIL_HEAD_ID } from './experimental-pigtail-head';

describe('Character Studio experimental pigtail preset', () => {
  const createContributions = () => createCharacterStudioContributions();
  let studio: ReturnType<typeof createContributions>;

  beforeEach(() => { studio = createContributions(); });
  afterEach(() => { Object.values(studio).forEach(contribution => contribution.dispose()); });

  it('uses the Studio expression controller to widen the smile and open the surprised mouth', () => {
    const human = studio.human;
    human.selectPreset(EXPERIMENTAL_PIGTAIL_HEAD_ID);
    const mouth = human.root.getObjectByName('pigtail-mouth') as Mesh;
    const setExpression = (expression: ExtendedEmotionName) => {
      human.setExpression(expression);
      for (let frame = 0; frame < 30; frame++) human.update(1 / 60);
      return mouth.geometry.boundingBox!.clone();
    };

    const neutral = setExpression('neutral');
    const happy = setExpression('happy');
    const surprised = setExpression('surprised');

    expect(happy.max.x).toBeGreaterThan(neutral.max.x);
    expect(surprised.max.x).toBeLessThan(neutral.max.x);
    expect(surprised.max.y - surprised.min.y).toBeGreaterThan(2 * (happy.max.y - happy.min.y));
  });

  it('frames the experimental head and restores the existing actor and controls when switching presets', () => {
    const human = studio.human;
    const original = human.root.children[0];
    human.selectPreset(EXPERIMENTAL_PIGTAIL_HEAD_ID);

    expect(original.visible).toBeFalse();
    expect(human.controlGroups()).toEqual([]);
    expect(human.motions).toEqual([]);
    const fit = human.resolveFocusFraming('human-head-hair', { azimuthRadians: -Math.PI / 4 });
    expect(fit.inFrame).toBeTrue();
    expect(fit.cameraPosition[0] - fit.cameraTarget[0]).toBeCloseTo(-(fit.cameraPosition[2] - fit.cameraTarget[2]), 2);

    human.selectPreset(human.defaultPresetId);
    expect(original.visible).toBeTrue();
    expect(human.root.getObjectByName(EXPERIMENTAL_PIGTAIL_HEAD_ID)?.visible).toBeFalse();
    expect(human.controlGroups().length).toBeGreaterThan(0);
    expect(human.motions.length).toBeGreaterThan(0);
  });
});
