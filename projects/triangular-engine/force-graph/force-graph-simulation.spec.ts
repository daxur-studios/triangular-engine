import { ForceGraphSimulation, estimatePillSize } from './force-graph-simulation';
import type { ForceGraphLink, ForceGraphNode } from './force-graph.types';

describe('ForceGraphSimulation', () => {
  it('separates wide text pill nodes without AABB overlap', () => {
    const sim = new ForceGraphSimulation({ nodePadding: 16 });
    const nodes: ForceGraphNode[] = [
      {
        id: 'repo:brunos-space-program',
        label: 'brunos-space-program',
        metric: '42',
        variant: 'repo',
        state: 'active',
        accentColor: '#7cb7ff',
        width: 240,
        height: 48,
        x: 0,
        y: 0,
      },
      {
        id: 'repo:triangular-engine',
        label: 'triangular-engine',
        metric: '19',
        variant: 'repo',
        state: 'active',
        accentColor: '#7cb7ff',
        width: 220,
        height: 48,
        x: 10,
        y: 4,
      },
      {
        id: 'repo:mycelia',
        label: 'mycelia',
        metric: '11',
        variant: 'repo',
        state: 'active',
        accentColor: '#7cb7ff',
        width: 200,
        height: 48,
        x: -10,
        y: -4,
      },
    ];

    sim.syncGraph(nodes, []);
    for (let i = 0; i < 60; i += 1) sim.step(1);

    const placed = sim.getNodes();
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!;
        const b = placed[j]!;
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        const overlapX = (a.width + b.width) * 0.5 - dx;
        const overlapY = (a.height + b.height) * 0.5 - dy;
        expect(overlapX > 0 && overlapY > 0).toBeFalse();
      }
    }
  });

  it('positions a shared bridge repo between two outer repo clusters', () => {
    const sim = new ForceGraphSimulation({ linkGap: 60, nodePadding: 18 });
    const nodes: ForceGraphNode[] = [
      { id: 'repo:bsp', label: 'brunos-space-program', variant: 'repo', state: 'active', accentColor: '#7cb7ff', x: -320, y: 0 },
      { id: 'repo:tri', label: 'triangular-engine', variant: 'repo', state: 'active', accentColor: '#7cb7ff', x: 0, y: 0 },
      { id: 'repo:mycelia', label: 'mycelia', variant: 'repo', state: 'active', accentColor: '#7cb7ff', x: 320, y: 0 },
      { id: 'sess:1', label: 'Orbit rig', subtitle: '12 msgs · 40 tools', variant: 'session', state: 'active', accentColor: '#efb288' },
      { id: 'sess:2', label: 'Hyphae pass', subtitle: '9 msgs · 31 tools', variant: 'session', state: 'active', accentColor: '#8ce1c1' },
    ];
    const links: ForceGraphLink[] = [
      { id: 'l1', source: 'sess:1', target: 'repo:bsp', weight: 6, state: 'active' },
      { id: 'l2', source: 'sess:1', target: 'repo:tri', weight: 4, state: 'active' },
      { id: 'l3', source: 'sess:2', target: 'repo:mycelia', weight: 6, state: 'active' },
      { id: 'l4', source: 'sess:2', target: 'repo:tri', weight: 4, state: 'active' },
    ];

    sim.syncGraph(nodes, links);
    for (let i = 0; i < 120; i += 1) sim.step(1);

    const bsp = sim.getNode('repo:bsp')!;
    const tri = sim.getNode('repo:tri')!;
    const myc = sim.getNode('repo:mycelia')!;

    expect(Number.isFinite(tri.x)).toBeTrue();
    const distBspTri = Math.hypot(bsp.x - tri.x, bsp.y - tri.y);
    const distMycTri = Math.hypot(myc.x - tri.x, myc.y - tri.y);
    const distOuter = Math.hypot(bsp.x - myc.x, bsp.y - myc.y);
    expect(distBspTri).toBeLessThan(distOuter);
    expect(distMycTri).toBeLessThan(distOuter);
  });

  it('retains existing coordinates across syncGraph and hit-tests pill width accurately', () => {
    const sim = new ForceGraphSimulation();
    const repo: ForceGraphNode = {
      id: 'repo:ae',
      label: 'brunos-iae',
      variant: 'repo',
      state: 'active',
      accentColor: '#7cb7ff',
      width: 200,
      height: 50,
      x: 120,
      y: -40,
    };
    sim.syncGraph([repo], []);
    const before = sim.getNode('repo:ae')!;
    expect(before.x).toBe(120);
    expect(before.y).toBe(-40);

    const session: ForceGraphNode = {
      id: 'sess:new',
      label: 'Replay UI',
      subtitle: '4 msgs · 12 tools',
      variant: 'session',
      state: 'active',
      accentColor: '#8bbcff',
    };
    sim.syncGraph([repo, session], [{ id: 'l', source: 'sess:new', target: 'repo:ae', weight: 2, state: 'active' }]);

    const after = sim.getNode('repo:ae')!;
    expect(after.x).toBe(120);
    expect(after.y).toBe(-40);

    expect(sim.getNodeAt(215, -40)?.id).toBe('repo:ae');
    expect(sim.getNodeAt(230, -40)).toBeNull();
    expect(estimatePillSize(session).width).toBeGreaterThanOrEqual(154);
  });
});
