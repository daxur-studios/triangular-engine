import { MermaidRuntime } from '@daxur-studios/mermaid-runtime';
import type { DevelopmentMapExample } from './development-map.types';

export interface DevelopmentMapExampleGraph {
  readonly graph: MermaidRuntime.Graph;
  readonly nodeKinds: Record<string, MermaidRuntime.NodeKindStyle>;
  readonly progress: number | null;
  readonly readiness: string | null;
  readonly status: string | null;
}

const NODE_KINDS: Record<string, MermaidRuntime.NodeKindStyle> = {
  'example page': {
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h5"/></svg>',
    chip: 'page',
    tone: 'teal',
  },
  'plan or record': {
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v6h5M9 13h7M9 17h7"/></svg>',
    chip: 'document',
    tone: 'violet',
  },
  phase: {
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>',
    chip: 'phase',
    tone: 'accent',
  },
  intent: {
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.8 20h18.4z"/><path d="M12 9v5M12 17h.01"/></svg>',
    chip: 'intent',
    tone: 'amber',
  },
  assumption: {
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.2.8-1.5 1.2-1.5 2.5M12 17h.01"/></svg>',
    chip: 'assumption',
    tone: 'amber',
  },
  investigation: {
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M8 10h5M10.5 7.5v5"/></svg>',
    chip: 'investigation',
    tone: 'rose',
  },
  'related document': {
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/></svg>',
    chip: 'related',
    tone: 'slate',
  },
};

/** Build a compact graph from explicit example, plan, phase, concern and document links. */
export function buildDevelopmentMapExampleGraph(
  example: DevelopmentMapExample,
): DevelopmentMapExampleGraph {
  const nodes: MermaidRuntime.Node[] = [];
  const transitions: MermaidRuntime.Transition[] = [];
  const nodeIds = new Set<string>();
  const addNode = (node: MermaidRuntime.Node): void => {
    if (nodeIds.has(node.id)) return;
    nodes.push(node);
    nodeIds.add(node.id);
  };

  const pageId = `page-${example.id}`;
  addNode({
    id: pageId,
    title: example.title,
    status: 'undone',
    type: 'example page',
    detail: [example.description, `Page: ${example.href}`]
      .filter(Boolean)
      .join('\n'),
  });

  let done = 0;
  let total = 0;
  const readiness = example.documents.some(
    (document) => document.readiness === 'needs-resolution',
  )
    ? 'needs-resolution'
    : example.documents.some((document) => document.readiness === 'open-items')
      ? 'open-items'
      : example.documents.length > 0 &&
          example.documents.every((document) => document.readiness === 'ready')
        ? 'ready'
        : example.documents.length > 0 &&
            example.documents.every(
              (document) => document.readiness === 'unassessed',
            )
          ? 'unassessed'
          : null;

  for (const document of example.documents) {
    const documentId = `document-${document.id}`;
    const number =
      document.number === undefined
        ? ''
        : String(document.number).padStart(3, '0');
    const label = number
      ? `${document.id.startsWith('plan-') ? 'Plan' : 'ER'} ${number}`
      : document.title;
    const status =
      document.readiness === 'needs-resolution'
        ? 'failed'
        : document.readiness === 'open-items'
          ? 'running'
          : document.readiness === 'ready'
            ? 'complete'
            : 'undone';
    addNode({
      id: documentId,
      title: label,
      subtitle: document.title,
      status,
      type: 'plan or record',
      detail: [
        `Readiness: ${document.readiness}`,
        document.progress
          ? `Progress: ${document.progress.done}/${document.progress.total} goals (${document.progress.percent}%)`
          : null,
        document.sourceHref ? `Source: ${document.sourceHref}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    });
    transitions.push({ from: pageId, to: documentId, label: 'tracked by' });

    if (document.progress && document.progress.total > 0) {
      done += document.progress.done;
      total += document.progress.total;
    }

    for (const phase of document.phases) {
      const phaseNodeId = `phase-${document.id}-${phase.id}`;
      const phaseStatus =
        phase.readiness === 'needs-resolution' || phase.state === 'blocked'
          ? 'failed'
          : phase.state === 'done'
            ? 'complete'
            : phase.state === 'in_progress'
              ? 'running'
              : 'undone';
      addNode({
        id: phaseNodeId,
        title: phase.id.toUpperCase(),
        subtitle: phase.title,
        status: phaseStatus,
        type: 'phase',
        detail: [
          `State: ${phase.state}`,
          `Readiness: ${phase.readiness}`,
          phase.acceptance ? `Acceptance: ${phase.acceptance}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      });
      transitions.push({ from: documentId, to: phaseNodeId, label: 'phase' });

      for (const concern of document.concerns) {
        if (
          concern.state === 'resolved' ||
          !concern.appliesTo?.includes(phase.id)
        )
          continue;
        const concernNodeId = `concern-${document.id}-${concern.id}`;
        addNode({
          id: concernNodeId,
          title: `${concern.id} · ${concern.state}`,
          subtitle: concern.title,
          status:
            concern.state === 'deferred'
              ? 'skipped'
              : concern.blockingPhases?.includes(phase.id)
                ? 'failed'
                : 'undone',
          type: concern.kind,
          detail: [
            concern.body,
            `State: ${concern.state}`,
            concern.appliesTo?.length
              ? `Applies to: ${concern.appliesTo.join(', ')}`
              : null,
            concern.blockingPhases?.length
              ? `Blocks: ${concern.blockingPhases.join(', ')}`
              : null,
            concern.sourceHref
              ? `Source: ${concern.sourceHref}`
              : null,
          ]
            .filter(Boolean)
            .join('\n'),
        });
        transitions.push({
          from: phaseNodeId,
          to: concernNodeId,
          label: concern.blockingPhases?.includes(phase.id)
            ? 'blocked by'
            : concern.state === 'deferred'
              ? 'deferred item'
              : 'open item',
        });
      }
    }

    for (const relation of document.relations) {
      const targetId = `relation-${document.id}-${relation.type}-${relation.href}`;
      addNode({
        id: targetId,
        title: relation.title,
        status: 'undone',
        type: 'related document',
        detail: `Relationship: ${relation.type}\nSource: ${relation.href}`,
      });
      transitions.push({
        from: documentId,
        to: targetId,
        label: relation.type,
      });
    }
  }

  return {
    graph: { nodes, transitions },
    nodeKinds: NODE_KINDS,
    progress: total > 0 ? Math.round((done / total) * 100) : null,
    readiness,
    status:
      readiness === 'needs-resolution'
        ? 'failed'
        : readiness === 'open-items'
          ? 'running'
          : readiness === 'ready'
            ? 'complete'
            : readiness === 'unassessed'
              ? 'idle'
              : null,
  };
}
