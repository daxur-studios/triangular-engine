import { applyAnimalGroupEvents } from './animal-group-events';
import { handoffAnimalGroupResidency } from './animal-group-residency';
import { AnimalGroupTimeline, sampleAnimalGroupTimeline } from './animal-group-timeline';
import { selectAnimalPerch } from './animal-perch';
import { ArrivalState, stepArrival } from './flock-arrival';
import { stepFlock } from './flock-step';

describe('planetary animal group local interaction', () => {
  it('reconstructs, flees an aircraft, chooses a perch, and lands without changing persistent history', () => {
    const timeline: AnimalGroupTimeline = {
      key: {
        worldId: 'world', planetId: 'planet', cellId: 'cell',
        speciesId: 'birds', groupId: 'flock', seed: 17,
      },
      destinations: [
        { id: 'feed', position: { x: 0, y: 8, z: 0 }, activity: 'feed', dwellDuration: 30 },
        { id: 'trees', position: { x: 30, y: 8, z: 0 }, activity: 'rest', dwellDuration: 30 },
      ],
      travelSpeed: 3,
      memberCount: 2,
    };
    const groupId = sampleAnimalGroupTimeline(timeline, 0).id;
    const events = [{
      id: 'future-loss', type: 'member-loss' as const,
      targetGroupId: groupId, effectiveTime: 1000, memberCountLoss: 1,
    }];
    const baseline = sampleAnimalGroupTimeline(timeline, 5);
    const effective = applyAnimalGroupEvents(baseline, events);
    const residency = handoffAnimalGroupResidency({
      snapshot: effective,
      observer: { position: { x: 10000, y: 0, z: 0 }, radius: 0 },
      interacting: true,
      materialization: {
        spacing: 2, speed: 4, cullDistance: 20, hysteresis: 2,
        travelDirection: { x: 0, y: 0, z: 1 },
      },
    });
    expect(residency.mode).toBe('interacting');

    const terrain = {
      sample: () => ({ height: 0, normal: { x: 0, y: 1, z: 0 } }),
    };
    const aircraft = {
      id: 'aircraft', position: { ...residency.members[0].position },
      velocity: { x: 0, y: 0, z: 20 }, radius: 15, strength: 4,
    };
    const disturbed = stepFlock(residency.members, 1 / 30, 4, terrain, aircraft);
    expect(disturbed.some((member) => member.activity === 'flee')).toBeTrue();

    const chosen = selectAnimalPerch(disturbed[0].position, [
      { id: 'tree-far', position: { x: 20, y: 9, z: 8 } },
      { id: 'tree-near', position: { x: 6, y: 9, z: 3 } },
    ])!;
    expect(chosen.id).toBe('tree-near');

    let arrival: ArrivalState = {
      id: disturbed[0].id,
      position: disturbed[0].position,
      velocity: disturbed[0].velocity,
      activity: 'seek',
    };
    for (let step = 0; step < 900 && arrival.activity !== 'landed'; step += 1) {
      arrival = stepArrival(arrival, chosen.position, 1 / 30, {
        speed: 4, steeringAcceleration: 8, turnRate: 3,
        arrivalRadiusM: 4, landingDistanceM: 0.15,
      });
    }
    expect(arrival.activity).toBe('landed');
    expect(arrival.position).toEqual(chosen.position);
    expect(events).toEqual([{
      id: 'future-loss', type: 'member-loss', targetGroupId: baseline.id,
      effectiveTime: 1000, memberCountLoss: 1,
    }]);
    expect(baseline.memberCount).toBe(2);
  });
});
