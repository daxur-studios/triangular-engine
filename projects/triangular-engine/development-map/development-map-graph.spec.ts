import { buildDevelopmentMapExampleGraph } from './development-map-graph';
import type { DevelopmentMapExample } from './development-map.types';

describe('buildDevelopmentMapExampleGraph', () => {
  it('renders Plan 066 phase state, open-item targets and authored document relations', () => {
    const example: DevelopmentMapExample = {
      id: 'development-map',
      title: 'Development Map',
      href: '/development-map',
      documents: [
        {
          id: 'plan-066',
          number: 66,
          title: 'Engineering Records and Development Map',
          sourceHref: '#plan-066',
          readiness: 'needs-resolution',
          progress: { done: 3, total: 5, percent: 60 },
          phases: [
            { id: 'm1', title: 'Format', state: 'done', readiness: 'ready' },
            { id: 'm2', title: 'Tools', state: 'done', readiness: 'ready' },
            { id: 'm3', title: 'Viewer', state: 'done', readiness: 'ready' },
            {
              id: 'm4',
              title: 'Adoption',
              state: 'planned',
              readiness: 'needs-resolution',
            },
            {
              id: 'm5',
              title: 'Mermaid cards',
              state: 'in_progress',
              readiness: 'open-items',
            },
          ],
          concerns: [
            {
              id: 'Q3',
              title: 'Path inventory',
              kind: 'investigation',
              state: 'open',
              blocks: true,
              appliesTo: ['m4'],
              blockingPhases: ['m4'],
              body: 'Inventory old loaders and routes.',
            },
            {
              id: 'Q4',
              title: 'Attention summary',
              kind: 'intent',
              state: 'open',
              blocks: false,
              appliesTo: ['m5'],
              blockingPhases: [],
              body: 'Refine the review summary later.',
            },
          ],
          relations: [
            {
              type: 'builds-on',
              title: 'Test Results and Thumbnails',
              href: '/plans/058',
            },
          ],
        },
      ],
      evidence: [],
    };

    const result = buildDevelopmentMapExampleGraph(example);
    const edges = result.graph.transitions ?? [];
    const phaseEdge = (phase: string, concern: string) =>
      edges.find(
        (edge) =>
          edge.from === `phase-plan-066-${phase}` &&
          edge.to === `concern-plan-066-${concern}`,
      );

    expect(result.progress).toBe(60);
    expect(result.readiness).toBe('needs-resolution');
    expect(result.status).toBe('failed');
    expect(phaseEdge('m4', 'Q3')?.label).toBe('blocked by');
    expect(phaseEdge('m5', 'Q4')?.label).toBe('open item');
    expect(
      edges.some(
        (edge) =>
          edge.from === 'phase-plan-066-m4' && edge.to === 'phase-plan-066-m5',
      ),
    ).toBeFalse();
    expect(edges.some((edge) => edge.label === 'builds-on')).toBeTrue();
    expect(
      result.graph.nodes.find((node) => node.id === 'phase-plan-066-m4')
        ?.status,
    ).toBe('failed');
    expect(result.nodeKinds['example page'].icon).toContain('<svg');
    expect(result.nodeKinds['plan or record'].icon).toContain('<svg');
    expect(result.nodeKinds['investigation'].icon).toContain('<svg');
    expect(
      result.graph.nodes.find((node) => node.id === 'phase-plan-066-m4')
        ?.detail,
    ).toContain('State: planned');
    expect(
      result.graph.nodes.find((node) => node.id === 'concern-plan-066-Q3')
        ?.detail,
    ).toContain('Blocks: m4');
  });
});
