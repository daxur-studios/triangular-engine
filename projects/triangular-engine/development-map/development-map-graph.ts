import { MermaidRuntime } from '@daxur-studios/mermaid-runtime';
import type { DevelopmentMapExample } from './development-map.types';

export interface DevelopmentMapExampleGraph {
  readonly graph: MermaidRuntime.Graph;
  readonly progress: number | null;
  readonly readiness: string | null;
  readonly status: string | null;
}

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
          detail: concern.body,
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
        detail: relation.href,
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
