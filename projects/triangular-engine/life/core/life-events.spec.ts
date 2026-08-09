import { LifeEventLog } from './life-events';

describe('LifeEventLog', () => {
  it('reconstructs active disturbances at arbitrary universal time', () => {
    const log = new LifeEventLog();
    log.recordDisturbance({ id: 'vessel-1', center: { x: 2, y: 0, z: 3 }, startTimeSeconds: 10, durationSeconds: 20, radius: 5, strength: 4 });
    expect(log.activeDisturbancesAt(5)).toHaveSize(0);
    expect(log.activeDisturbancesAt(15)).toHaveSize(1);
    expect(log.activeDisturbancesAt(31)).toHaveSize(0);
    expect(log.activeDisturbancesAt(15)).toEqual(log.activeDisturbancesAt(15));
  });

  it('keeps an ordered serializable snapshot', () => {
    const log = new LifeEventLog();
    log.recordDisturbance({ id: 'late', center: { x: 0, y: 0, z: 0 }, startTimeSeconds: 20, durationSeconds: 1, radius: 1, strength: 1 });
    log.recordDisturbance({ id: 'early', center: { x: 0, y: 0, z: 0 }, startTimeSeconds: 2, durationSeconds: 1, radius: 1, strength: 1 });
    expect(log.snapshot().map((event) => event.id)).toEqual(['early', 'late']);
  });

  it('replays predation outcomes by universal time', () => {
    const log = new LifeEventLog();
    log.recordPredation({
      id: 'hunt-1',
      predatorId: 'wolf-1',
      preyId: 'deer-4',
      timeSeconds: 12,
      position: { x: 1, y: 0, z: 2 },
    });
    expect(log.predationsThrough(11)).toHaveSize(0);
    expect(log.predationsThrough(12)).toEqual([{
      id: 'hunt-1', kind: 'predation', predatorId: 'wolf-1', preyId: 'deer-4',
      timeSeconds: 12, position: { x: 1, y: 0, z: 2 },
    }]);
  });
});
