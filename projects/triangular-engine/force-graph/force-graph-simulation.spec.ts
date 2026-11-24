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

  it('settles jammed 6-node star cluster without perpetual orbiting or AABB overlap', () => {
    const sim = new ForceGraphSimulation();
    const nodes: ForceGraphNode[] = [
      { id: 'repo:ribcage', label: 'ribcage', metric: '30', variant: 'repo', state: 'active', accentColor: '#7cb7ff' },
      { id: 'sess:1', label: 'Start phase 9.2 meshes', subtitle: '4 msgs · 10 tools', variant: 'session', state: 'active', accentColor: '#efb288' },
      { id: 'sess:2', label: 'Start phase 9.3 particles', subtitle: '3 msgs · 6 tools', variant: 'session', state: 'active', accentColor: '#efb288' },
      { id: 'sess:3', label: 'Orchestrate scene graph', subtitle: '5 msgs · 8 tools', variant: 'session', state: 'active', accentColor: '#efb288' },
      { id: 'sess:4', label: 'Background session worker', subtitle: '2 msgs · 3 tools', variant: 'session', state: 'active', accentColor: '#efb288' },
      { id: 'sess:5', label: 'Linked sessions status check', subtitle: '2 msgs · 3 tools', variant: 'session', state: 'active', accentColor: '#efb288' },
    ];
    const links: ForceGraphLink[] = [
      { id: 'l1', source: 'sess:1', target: 'repo:ribcage', weight: 10, state: 'active' },
      { id: 'l2', source: 'sess:2', target: 'repo:ribcage', weight: 6, state: 'active' },
      { id: 'l3', source: 'sess:3', target: 'repo:ribcage', weight: 8, state: 'active' },
      { id: 'l4', source: 'sess:4', target: 'repo:ribcage', weight: 3, state: 'active' },
      { id: 'l5', source: 'sess:5', target: 'repo:ribcage', weight: 3, state: 'active' },
    ];

    sim.syncGraph(nodes, links);
    for (let i = 0; i < 450; i += 1) sim.step(1);

    expect(sim.isSettled()).toBeTrue();

    const startPos = new Map(sim.getNodes().map((n) => [n.id, { x: n.x, y: n.y }]));
    for (let i = 0; i < 120; i += 1) sim.step(1);

    const placed = sim.getNodes();
    for (const node of placed) {
      const prev = startPos.get(node.id)!;
      expect(Math.hypot(node.x - prev.x, node.y - prev.y)).toBeLessThan(0.5);
    }

    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!;
        const b = placed[j]!;
        const overlapX = (a.width + b.width) * 0.5 - Math.abs(a.x - b.x);
        const overlapY = (a.height + b.height) * 0.5 - Math.abs(a.y - b.y);
        expect(overlapX > 0 && overlapY > 0).toBeFalse();
      }
    }
  });

  it('settles crowded 3-repo 60-session hub graph smoothly without Euler blowup', () => {
    const sim = new ForceGraphSimulation();
    const nodes: ForceGraphNode[] = [
      { id: 'repo:a', label: 'brunos-iae', metric: '90', variant: 'repo', state: 'active', accentColor: '#7cb7ff' },
      { id: 'repo:b', label: 'triangular-workspace', metric: '45', variant: 'repo', state: 'active', accentColor: '#7cb7ff' },
      { id: 'repo:c', label: 'ribcage', metric: '35', variant: 'repo', state: 'active', accentColor: '#7cb7ff' },
    ];
    const links: ForceGraphLink[] = [];
    for (let i = 0; i < 60; i += 1) {
      const id = `sess:${i}`;
      nodes.push({
        id,
        label: `Session work item ${i}`,
        subtitle: '12 msgs · 45 tools',
        variant: 'session',
        state: 'active',
        accentColor: '#8ce1c1',
      });
      links.push({ id: `${id}->repo:a`, source: id, target: 'repo:a', weight: 30, state: 'active' });
      if (i % 3 === 0) links.push({ id: `${id}->repo:b`, source: id, target: 'repo:b', weight: 20, state: 'active' });
      if (i % 5 === 0) links.push({ id: `${id}->repo:c`, source: id, target: 'repo:c', weight: 15, state: 'active' });
    }

    sim.syncGraph(nodes, links);
    for (let i = 0; i < 550; i += 1) sim.step(1);

    expect(sim.isSettled()).toBeTrue();

    const startPos = new Map(sim.getNodes().map((n) => [n.id, { x: n.x, y: n.y }]));
    for (let i = 0; i < 120; i += 1) sim.step(1);

    for (const node of sim.getNodes()) {
      expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBeTrue();
      const prev = startPos.get(node.id)!;
      expect(Math.hypot(node.x - prev.x, node.y - prev.y)).toBeLessThan(0.5);
    }
  });

  it('skips reheating on counter updates and reheats when topology or pins change', () => {
    const sim = new ForceGraphSimulation();
    const baseNodes: ForceGraphNode[] = [
      { id: 'repo:ae', label: 'brunos-iae', width: 180, height: 50, variant: 'repo', state: 'active', accentColor: '#7cb7ff' },
      { id: 'sess:1', label: 'Replay polish', subtitle: '2 msgs · 5 tools', width: 170, height: 48, variant: 'session', state: 'active', accentColor: '#efb288' },
    ];
    const baseLinks: ForceGraphLink[] = [
      { id: 'sess:1->repo:ae', source: 'sess:1', target: 'repo:ae', weight: 5, state: 'active' },
    ];

    sim.syncGraph(baseNodes, baseLinks);
    for (let i = 0; i < 450; i += 1) sim.step(1);
    expect(sim.isSettled()).toBeTrue();

    // Counter/text/weight-only update should keep simulation settled.
    sim.syncGraph(
      [
        { ...baseNodes[0]!, metric: '12' },
        { ...baseNodes[1]!, subtitle: '3 msgs · 8 tools' },
      ],
      [{ ...baseLinks[0]!, weight: 8 }],
    );
    expect(sim.isSettled()).toBeTrue();

    // Adding a node should reheat and then settle again.
    sim.syncGraph(
      [
        ...baseNodes,
        { id: 'sess:2', label: 'Follow-up pass', subtitle: '1 msgs · 2 tools', width: 170, height: 48, variant: 'session', state: 'active', accentColor: '#8ce1c1' },
      ],
      [
        ...baseLinks,
        { id: 'sess:2->repo:ae', source: 'sess:2', target: 'repo:ae', weight: 2, state: 'active' },
      ],
    );
    expect(sim.getAlpha()).toBeGreaterThan(0.2);
    for (let i = 0; i < 450; i += 1) sim.step(1);
    expect(sim.isSettled()).toBeTrue();

    // Moving via pinNode should reheat.
    const pos = sim.getNode('sess:1')!;
    sim.pinNode('sess:1', pos.x + 25, pos.y - 10);
    expect(sim.getAlpha()).toBeGreaterThan(0.2);
    sim.unpinNode('sess:1');
    expect(sim.getAlpha()).toBeGreaterThan(0.2);
  });
});
