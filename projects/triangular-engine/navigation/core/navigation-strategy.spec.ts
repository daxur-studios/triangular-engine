import { createNavigationQueueYieldStrategy, NavigationRecoveryObservation } from './navigation-strategy';

describe('navigation recovery strategies', () => {
  const observe = (overrides: Partial<NavigationRecoveryObservation> = {}): NavigationRecoveryObservation => ({
    agentId: 'agent-1',
    priority: 1,
    routeStatus: 'complete',
    progressDistance: 0,
    noProgressSeconds: 1,
    blockedSeconds: 1,
    retryCount: 0,
    hasBlockingAgent: true,
    hasRightOfWay: false,
    canWait: true,
    canYield: true,
    ...overrides,
  });

  it('queues a lower-priority agent behind right of way traffic', () => {
    const decision = createNavigationQueueYieldStrategy().decide(observe());
    expect(decision.action).toBe('yield');
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('staggers retry timing by stable agent identity', () => {
    const strategy = createNavigationQueueYieldStrategy();
    const first = strategy.decide(observe({ agentId: 'a' }));
    const second = strategy.decide(observe({ agentId: 'b' }));
    expect(first.retryAfterSeconds).not.toBe(second.retryAfterSeconds);
    expect(strategy.decide(observe({ agentId: 'a' })).retryAfterSeconds).toBe(first.retryAfterSeconds);
  });

  it('continues when the agent has right of way', () => {
    expect(createNavigationQueueYieldStrategy().decide(observe({ hasRightOfWay: true })).action).toBe('continue');
  });

  it('uses an alternative or retreat after the wait budget', () => {
    const strategy = createNavigationQueueYieldStrategy({ maxWaitSeconds: 2 });
    expect(strategy.decide(observe({ blockedSeconds: 3, recoveryCandidates: [{ kind: 'alternative-route' }] })).action)
      .toBe('alternative-route');
    expect(strategy.decide(observe({ blockedSeconds: 3, recoveryCandidates: [{ kind: 'retreat' }] })).action)
      .toBe('retreat');
  });

  it('reports blocked when there is no legal recovery action', () => {
    expect(createNavigationQueueYieldStrategy().decide(observe({ blockedSeconds: 6, canWait: false })).action).toBe('blocked');
  });
});
