import {
  NavigationEncounterObservation,
  resolveNavigationEncounter,
} from './navigation-encounter';

describe('decentralised navigation encounters', () => {
  const observe = (overrides: Partial<NavigationEncounterObservation> = {}): NavigationEncounterObservation => ({
    nowSeconds: 10,
    agentId: 'agent-b',
    priority: 1,
    canRetreat: true,
    blockedSeconds: 0.5,
    ...overrides,
  });

  it('breaks a symmetric opposing conflict by stable agent identity', () => {
    const second = resolveNavigationEncounter(observe({
      opponents: [{ agentId: 'agent-a', priority: 1 }],
    }));
    const first = resolveNavigationEncounter(observe({
      agentId: 'agent-a',
      opponents: [{ agentId: 'agent-b', priority: 1 }],
    }));

    expect(first.intent).toBe('advance');
    expect(second.intent).toBe('retreat');
    expect(second.yieldToAgentId).toBe('agent-a');
  });

  it('propagates retreat through an agent obstructing the escape path', () => {
    const initial = resolveNavigationEncounter(observe({
      opponents: [{ agentId: 'agent-a', priority: 0 }],
    }));
    const follower = resolveNavigationEncounter(observe({
      agentId: 'agent-c',
      retreatSignals: [initial.retreatSignal!],
    }));

    expect(follower.intent).toBe('retreat');
    expect(follower.yieldToAgentId).toBe('agent-a');
    expect(follower.retreatSignal?.encounterId).toBe(initial.retreatSignal?.encounterId);
    expect(follower.retreatSignal?.hopCount).toBe(1);
    expect(follower.retreatSignal?.sourceAgentId).toBe('agent-c');
  });

  it('carries one retreat decision through a full local blocker chain', () => {
    let signal = resolveNavigationEncounter(observe({
      opponents: [{ agentId: 'agent-a', priority: 0 }],
    })).retreatSignal!;

    for (const agentId of ['agent-c', 'agent-d', 'agent-e']) {
      const decision = resolveNavigationEncounter(observe({ agentId, retreatSignals: [signal] }));
      expect(decision.intent).toBe('retreat');
      signal = decision.retreatSignal!;
    }

    expect(signal.hopCount).toBe(3);
    expect(signal.sourceAgentId).toBe('agent-e');
    expect(signal.winnerAgentId).toBe('agent-a');
  });

  it('lets a newly arriving agent respect an existing retreat wave', () => {
    const decision = resolveNavigationEncounter(observe({
      agentId: 'new-arrival',
      retreatSignals: [{
        encounterId: 'encounter:west:east',
        winnerAgentId: 'west',
        sourceAgentId: 'reversing-car',
        priority: 1,
        hopCount: 3,
        expiresAtSeconds: 12,
      }],
    }));

    expect(decision.intent).toBe('retreat');
    expect(decision.retreatSignal?.hopCount).toBe(4);
  });

  it('inherits transferable urgency without accumulating it', () => {
    const decision = resolveNavigationEncounter(observe({
      priority: 10,
      prioritySignals: [
        { originAgentId: 'ambulance', sourceAgentId: 'car-2', priority: 0, hopCount: 2, expiresAtSeconds: 12 },
        { originAgentId: 'ambulance', sourceAgentId: 'car-3', priority: 0, hopCount: 3, expiresAtSeconds: 12 },
      ],
      opponents: [{ agentId: 'police-car', priority: 2 }],
    }));

    expect(decision.effectivePriority).toBe(0);
    expect(decision.intent).toBe('advance');
    expect(decision.prioritySignal.originAgentId).toBe('ambulance');
    expect(decision.prioritySignal.hopCount).toBe(3);
  });

  it('ignores expired signals rather than preserving stale dead zones', () => {
    const decision = resolveNavigationEncounter(observe({
      retreatSignals: [{
        encounterId: 'old',
        winnerAgentId: 'gone',
        sourceAgentId: 'gone',
        priority: 0,
        hopCount: 1,
        expiresAtSeconds: 10,
      }],
    }));

    expect(decision.intent).toBe('advance');
  });

  it('reports explicit blockage after bounded unsuccessful retreat', () => {
    const decision = resolveNavigationEncounter(observe({
      blockedSeconds: 5,
      opponents: [{ agentId: 'agent-a', priority: 0 }],
    }));

    expect(decision.intent).toBe('blocked');
  });

  it('stops a retreat wave at its configured propagation bound', () => {
    const decision = resolveNavigationEncounter(observe({
      retreatSignals: [{
        encounterId: 'bounded-wave',
        winnerAgentId: 'agent-a',
        sourceAgentId: 'agent-x',
        priority: 0,
        hopCount: 2,
        expiresAtSeconds: 12,
      }],
    }), { maxPropagationHops: 2 });

    expect(decision.intent).toBe('blocked');
    expect(decision.retreatSignal).toBeUndefined();
  });

  it('waits when retreat is prohibited, then reports blockage', () => {
    const waiting = resolveNavigationEncounter(observe({
      canRetreat: false,
      opponents: [{ agentId: 'agent-a', priority: 0 }],
    }));
    const blocked = resolveNavigationEncounter(observe({
      canRetreat: false,
      blockedSeconds: 6,
      opponents: [{ agentId: 'agent-a', priority: 0 }],
    }));

    expect(waiting.intent).toBe('wait');
    expect(blocked.intent).toBe('blocked');
  });
});
