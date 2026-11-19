import { Box3, Vector3 } from 'three';
import { buildPigtailSandboxWalker } from './pigtail-sandbox-walker';

describe('Orange Pigtails sandbox walk', () => {
  let walker: ReturnType<typeof buildPigtailSandboxWalker>;

  beforeEach(() => { walker = buildPigtailSandboxWalker(); });
  afterEach(() => { walker.dispose(); });

  it('holds the grounded boot in world space while alternating steps and returning to the approved pose', () => {
    const boots = ['left', 'right'].map(side => walker.root.getObjectByName(`pigtail-boot-${side}`)!);
    const rest = boots.map(boot => boot.position.clone());
    const previous = boots.map(boot => boot.getWorldPosition(new Vector3()));
    const restHeight = previous.map(foot => foot.y);
    const lift = [0, 0];
    let plantedSamples = 0;
    const target = new Vector3(1.8, 0, 2.4);
    expect(walker.walkTo(target)).toBeTrue();
    // Align the initial samples with the walking heading.
    boots.forEach((boot, index) => boot.getWorldPosition(previous[index]));

    for (let frame = 0; frame < 300 && walker.walking; frame++) {
      walker.update(1 / 90);
      const feet = boots.map(boot => boot.getWorldPosition(new Vector3()));
      const heights = feet.map((foot, index) => foot.y - restHeight[index]);
      expect(Math.min(...heights)).toBeCloseTo(0, 6);
      feet.forEach((foot, index) => {
        lift[index] = Math.max(lift[index], heights[index]);
        if (heights[index] < 1e-7 && previous[index].y - restHeight[index] < 1e-7) {
          expect(foot.distanceTo(previous[index])).toBeLessThan(.0001);
          plantedSamples++;
        }
        previous[index].copy(foot);
      });
    }

    expect(plantedSamples).toBeGreaterThan(90);
    lift.forEach(height => expect(height).toBeGreaterThan(.07));
    expect(walker.walking).toBeFalse();
    expect(walker.root.position).toEqual(target);
    boots.forEach((boot, index) => {
      expect(boot.position).toEqual(rest[index]);
      expect(new Box3().setFromObject(boot, true).min.y).toBeCloseTo(0, 6);
    });
  });

  it('finishes the straight walk before starting the most recently queued destination', () => {
    const first = new Vector3(0, 0, 1);
    const last = new Vector3(-1, 0, 1);
    expect(walker.walkTo(walker.root.position)).toBeFalse();
    walker.walkTo(first);
    walker.update(.1);
    walker.walkTo(new Vector3(1, 0, 1));
    walker.walkTo(last);

    walker.update(2);
    expect(walker.root.position).toEqual(first);
    expect(walker.walking).toBeTrue();
    walker.update(2);
    expect(walker.root.position).toEqual(last);
    expect(walker.walking).toBeFalse();
  });
});
