import { NavigationQuery, TraversalProfile } from './navigation-types';
import { NavigationRequestQueue } from './navigation-request-queue';

const profile: TraversalProfile = { id: 'rover', domains: ['ground'], radius: 1, height: 1 };

function query(id: string): NavigationQuery {
  return {
    id,
    start: { frameId: 'world', position: { x: 0, y: 0, z: 0 } },
    goal: { kind: 'point', location: { frameId: 'world', position: { x: 1, y: 0, z: 1 } } },
    profile,
  };
}

describe('NavigationRequestQueue', () => {
  it('takes requests by priority and preserves enqueue order for tied priorities', () => {
    const queue = new NavigationRequestQueue();
    queue.enqueue(query('later'), 5);
    queue.enqueue(query('first'), 1);
    queue.enqueue(query('second'), 1);

    expect(queue.take(2).map((entry) => entry.query.id)).toEqual(['first', 'second']);
    expect(queue.take(1).map((entry) => entry.query.id)).toEqual(['later']);
  });

  it('omits cancelled requests without changing remaining order', () => {
    const queue = new NavigationRequestQueue();
    const cancelled = queue.enqueue(query('cancelled'));
    queue.enqueue(query('kept'));

    cancelled.cancel();
    expect(queue.take(1).map((entry) => entry.query.id)).toEqual(['kept']);
    expect(queue.size).toBe(0);
  });
});
