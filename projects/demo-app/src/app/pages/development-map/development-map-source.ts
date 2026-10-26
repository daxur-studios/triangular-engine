import {
  DEFAULT_TEST_SINK_PATH,
  imageUrl,
  runTime,
  type TestRunIndexEntry,
} from 'triangular-engine/testing';
import type {
  DevelopmentMapDocument,
  DevelopmentMapEvidence,
  DevelopmentMapExample,
  DevelopmentMapPhase,
  DevelopmentMapProject,
  DevelopmentMapScope,
  DevelopmentMapTimelineEvent,
} from 'triangular-engine/development-map';

export interface EngineeringRecordsManifest {
  readonly schemaVersion: number;
  readonly currentFingerprint?: string;
  readonly documents: readonly EngineeringManifestDocument[];
  readonly diagnostics?: readonly string[];
}

export interface EngineeringManifestDocument {
  readonly id: string;
  readonly number?: number | null;
  readonly title: string;
  readonly outcome?: string;
  readonly plan: string;
  readonly record?: string | null;
  readonly mapped: boolean;
  readonly review?: {
    readonly state: 'reviewed' | 'unassessed';
    readonly items?: readonly {
      readonly id: string;
      readonly kind: 'intent' | 'assumption' | 'investigation';
      readonly state: 'open' | 'deferred' | 'resolved';
      readonly appliesTo: readonly string[];
      readonly blocks: readonly string[];
      readonly body: string;
    }[];
  };
  readonly phases?: readonly {
    readonly id: string;
    readonly title: string;
    readonly progress: 'planned' | 'in_progress' | 'blocked' | 'done';
    readonly acceptance?: string;
    readonly readiness: {
      readonly state: DevelopmentMapPhase['readiness'];
      readonly open: number;
      readonly blockers: number;
    };
  }[];
  readonly progress?: {
    readonly done: number;
    readonly total: number;
    readonly percent: number;
  } | null;
  readonly relations?: readonly {
    readonly type: DevelopmentMapDocument['relations'][number]['type'];
    readonly title: string;
    readonly href: string;
    readonly path?: string;
  }[];
  readonly scopeHistory?: {
    readonly baseline: {
      readonly state: 'confirmed' | 'unconfirmed';
      readonly goals?: readonly { readonly id: string }[];
    };
    readonly changes: readonly {
      readonly id: string;
      readonly date: string;
      readonly kind: 'addition' | 'removal' | 'change';
      readonly origin: 'requested' | 'discovered' | 'unplanned';
      readonly disposition: 'proposed' | 'accepted' | 'deferred' | 'rejected';
      readonly scopeIds: readonly string[];
      readonly summary: string;
      readonly reason: string;
      readonly impact: string;
    }[];
  };
}

export interface MapExampleSource {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly description?: string;
  readonly thumbnailUrl?: string;
  readonly documentIds?: readonly string[];
  readonly evidence?: readonly {
    readonly suite: string;
    readonly version?: number;
    readonly scenarios?: readonly string[];
    readonly metrics?: readonly string[];
  }[];
}

export interface MapBranchSource {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly examples: readonly MapExampleSource[];
}

/** App-specific labels and links; the generic package consumes only the resulting project model. */
export interface MapProjectSource {
  readonly title: string;
  readonly description?: string;
  readonly branches: readonly MapBranchSource[];
  readonly diagnostics?: readonly string[];
}

function mapAnchor(id: string): string {
  return `/development-map#${id}`;
}

function currentScopeProgress(document: EngineeringManifestDocument) {
  return (
    document.progress ?? {
      done: 0,
      total: document.phases?.length ?? 0,
      percent: 0,
    }
  );
}

function scopeFor(document: EngineeringManifestDocument): DevelopmentMapScope {
  const history = document.scopeHistory;
  const changes = history?.changes ?? [];
  const current = currentScopeProgress(document);
  const baselineIds =
    history?.baseline.state === 'confirmed'
      ? (history.baseline.goals?.map((goal) => goal.id) ?? [])
      : [];
  const byPhase = new Map(
    (document.phases ?? []).map((phase) => [phase.id, phase]),
  );
  const hasBaseline = history?.baseline.state === 'confirmed';
  const baselineMatches =
    hasBaseline &&
    baselineIds.length > 0 &&
    baselineIds.every((id) => byPhase.has(id));
  const baselineDone = baselineMatches
    ? baselineIds.filter((id) => byPhase.get(id)?.progress === 'done').length
    : 0;
  const added = new Set<string>();
  const removed = new Set<string>();
  if (hasBaseline)
    for (const change of changes) {
      if (change.disposition !== 'accepted') continue;
      if (change.kind === 'addition')
        for (const id of change.scopeIds)
          if (!baselineIds.includes(id)) added.add(id);
      if (change.kind === 'removal')
        for (const id of change.scopeIds) removed.add(id);
    }
  const acceptedGrowth = hasBaseline
    ? added.size -
      [...removed].filter((id) => added.has(id) || baselineIds.includes(id))
        .length
    : undefined;
  return {
    baselineState: hasBaseline ? 'confirmed' : 'unconfirmed',
    ...(baselineMatches
      ? {
          baseline: {
            done: baselineDone,
            total: baselineIds.length,
            percent: Math.round((baselineDone / baselineIds.length) * 100),
          },
        }
      : {}),
    current,
    ...(acceptedGrowth !== undefined ? { acceptedGrowth } : {}),
    changes: changes.map((change) => ({ ...change })),
  };
}

function documentFor(
  source: EngineeringManifestDocument,
  allDocuments: readonly EngineeringManifestDocument[],
): DevelopmentMapDocument {
  const phases: DevelopmentMapPhase[] = (source.phases ?? []).map((phase) => ({
    id: phase.id,
    title: phase.title,
    acceptance: phase.acceptance,
    state: phase.progress,
    readiness: phase.readiness.state,
  }));
  const readiness =
    !source.mapped || source.review?.state !== 'reviewed'
      ? 'unassessed'
      : phases.some((phase) => phase.readiness === 'needs-resolution')
        ? 'needs-resolution'
        : phases.some((phase) => phase.readiness === 'open-items')
          ? 'open-items'
          : 'ready';
  const documentsByPath = new Map(
    allDocuments.map((item) => [item.plan, item]),
  );
  return {
    id: source.id,
    ...(source.number ? { number: source.number } : {}),
    title: source.title,
    sourceHref: mapAnchor(source.id),
    readiness,
    ...(source.progress ? { progress: { ...source.progress } } : {}),
    phases,
    concerns: (source.review?.items ?? []).map((item) => {
      const firstLine = /^- \[[ xX]\]\s+(.+)$/m.exec(item.body)?.[1] ?? item.id;
      return {
        id: item.id,
        title: firstLine,
        kind: item.kind,
        state: item.state,
        blocks: !item.blocks.includes('none') && item.blocks.length > 0,
        appliesTo: item.appliesTo,
        blockingPhases: item.blocks.filter((phaseId) => phaseId !== 'none'),
        body: item.body,
        sourceHref: mapAnchor(`${source.id}-${item.id}`),
        sourceLabel: `Source item in Plan ${source.number ?? source.id}`,
      };
    }),
    relations: (source.relations ?? []).map((relation) => {
      const target = documentsByPath.get(relation.path ?? relation.href);
      return {
        type: relation.type,
        title: relation.title,
        href: target ? mapAnchor(target.id) : relation.href,
      };
    }),
    ...(source.scopeHistory ? { scope: scopeFor(source) } : {}),
  };
}

function evidenceFor(
  bindings: NonNullable<MapExampleSource['evidence']>,
  runs: readonly TestRunIndexEntry[],
  fingerprint?: string,
): DevelopmentMapEvidence[] {
  const evidence: DevelopmentMapEvidence[] = [];
  for (const binding of bindings) {
    const matching = runs.filter(
      (run) =>
        run.suite === binding.suite &&
        (binding.version === undefined || run.version === binding.version) &&
        (!binding.scenarios?.length ||
          binding.scenarios.some((id) => run.cases[id])),
    );
    const version =
      binding.version ?? Math.max(0, ...matching.map((run) => run.version));
    const history = matching
      .filter((run) => run.version === version)
      .sort((a, b) => runTime(b) - runTime(a))
      .slice(0, 2);
    for (const run of history) {
      const caseIds = binding.scenarios?.length
        ? binding.scenarios.filter((id) => run.cases[id])
        : Object.keys(run.cases).slice(0, 1);
      const metrics = caseIds.flatMap((caseId) =>
        Object.entries(run.cases[caseId]?.metrics ?? {})
          .filter(
            ([name, metric]) =>
              metric.group === undefined &&
              (!binding.metrics?.length || binding.metrics.includes(name)),
          )
          .slice(0, 3)
          .map(([name, metric]) => ({
            name: `${caseId} · ${/^(.*) \(([^()]*)\)$/.exec(name)?.[1] ?? name}`,
            median: metric.med,
            p95: metric.p95,
            unit: / \(([^()]*)\)$/.exec(name)?.[1] ?? '',
            samples: metric.n,
          })),
      );
      const firstCase = run.cases[caseIds[0]];
      const thumbnail = firstCase?.thumbnails?.[0];
      evidence.push({
        id: `${run.runId}-${binding.suite}`,
        suite: run.suite,
        version: run.version,
        savedAt: run.startedAt ?? run.savedAt,
        profile: run.profile,
        mode: run.mode ?? 'standard',
        automatedVerdict: run.automatedVerdict,
        performanceVerdict: run.performanceVerdict,
        visualReview: run.visualReview,
        ...(fingerprint ? { stale: run.fingerprint !== fingerprint } : {}),
        ...(run.gpu
          ? { gpu: `${run.gpu}${run.gpuBackend ? ` / ${run.gpuBackend}` : ''}` }
          : {}),
        warnings: [...(run.machine?.warnings ?? []), ...(run.errors ?? [])],
        metrics,
        ...(thumbnail
          ? { thumbnailUrl: imageUrl(DEFAULT_TEST_SINK_PATH, thumbnail) }
          : {}),
        href: '/tests',
      });
    }
  }
  return evidence.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}

/** Convert a repository manifest and app-owned catalog/result data into the package viewer contract. */
export function buildDevelopmentMapProject(
  source: MapProjectSource,
  manifest: EngineeringRecordsManifest,
  runs: readonly TestRunIndexEntry[],
): DevelopmentMapProject {
  const allDocuments = manifest.documents;
  const docs = new Map(allDocuments.map((document) => [document.id, document]));
  const timeline = new Map<string, DevelopmentMapTimelineEvent>();
  const diagnostics = [
    ...(source.diagnostics ?? []),
    ...(manifest.diagnostics ?? []),
  ];

  const branches = source.branches.map((branch) => ({
    id: branch.id,
    title: branch.title,
    ...(branch.description ? { description: branch.description } : {}),
    examples: branch.examples.map((example): DevelopmentMapExample => {
      const documents = (example.documentIds ?? []).flatMap((id) => {
        const document = docs.get(id);
        if (!document) {
          diagnostics.push(
            `${example.title}: linked document ${id} is missing from the manifest.`,
          );
          return [];
        }
        const mapped = documentFor(document, allDocuments);
        for (const change of mapped.scope?.changes ?? [])
          timeline.set(change.id, {
            id: change.id,
            date: change.date,
            kind: 'scope',
            title: change.summary,
            detail: `${change.reason} Impact: ${change.impact}`,
            disposition: change.disposition,
            href: mapped.sourceHref,
          });
        return [mapped];
      });
      const evidence = evidenceFor(
        example.evidence ?? [],
        runs,
        manifest.currentFingerprint,
      );
      for (const result of evidence)
        timeline.set(`evidence-${result.id}`, {
          id: `evidence-${result.id}`,
          date: result.savedAt,
          kind: 'evidence',
          title: `${result.suite} v${result.version}`,
          detail: `${result.automatedVerdict}; performance ${result.performanceVerdict}; ${result.profile}/${result.mode}${result.gpu ? ` · ${result.gpu}` : ''}${result.stale ? ' · stale' : ''}`,
          href: result.href,
        });
      return {
        id: example.id,
        title: example.title,
        href: example.href,
        ...(example.description ? { description: example.description } : {}),
        ...(example.thumbnailUrl ? { thumbnailUrl: example.thumbnailUrl } : {}),
        documents,
        evidence,
      };
    }),
  }));

  return {
    title: source.title,
    ...(source.description ? { description: source.description } : {}),
    branches,
    timeline: [...timeline.values()],
    diagnostics: [...new Set(diagnostics)],
  };
}
