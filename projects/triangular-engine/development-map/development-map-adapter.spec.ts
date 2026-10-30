import type { TestRunIndexEntry } from 'triangular-engine/testing';
import {
  buildDevelopmentMapProject,
  type EngineeringRecordsManifest,
  type MapProjectSource,
} from './development-map-adapter';

const sampleManifest: EngineeringRecordsManifest = {
  schemaVersion: 1,
  currentFingerprint: 'current-fp',
  documents: [
    {
      id: 'plan-1',
      number: 1,
      initiativeId: 'habitat-core',
      title: 'Habitat Structure',
      branch: 'Habitats & Bases',
      example: {
        id: 'habitat-studio',
        title: 'Habitat Studio POC',
        href: '/examples/habitat-studio',
      },
      evidenceSuites: ['habitat-tests'],
      plan: '/docs/plans/001_habitat.md',
      record: '/docs/runbook/001_habitat.md',
      mapped: true,
      review: {
        state: 'reviewed',
        items: [
          {
            id: 'Q1',
            kind: 'investigation',
            state: 'open',
            appliesTo: ['shell'],
            blocks: ['shell'],
            body: '- [ ] Shell structural thickness\n  - Why: stability\n  - Next: test',
          },
        ],
      },
      phases: [
        {
          id: 'shell',
          title: 'Outer shell',
          progress: 'done',
          readiness: { state: 'needs-resolution', open: 1, blockers: 1 },
        },
      ],
      progress: { done: 1, total: 1, percent: 100 },
      scopeHistory: {
        baseline: { state: 'confirmed', goals: [{ id: 'shell' }] },
        changes: [],
      },
    },
    {
      id: 'plan-2',
      number: 2,
      initiativeId: 'orbital-docking',
      title: 'Orbital Docking Ports',
      plan: '/docs/plans/002_docking.md',
      record: '/docs/runbook/002_docking.md',
      mapped: true,
      phases: [
        {
          id: 'port',
          title: 'Port alignment',
          progress: 'planned',
          readiness: { state: 'ready', open: 0, blockers: 0 },
        },
      ],
    },
  ],
};

const sampleRuns: readonly TestRunIndexEntry[] = [
  {
    savedAt: '2026-10-30T12:00:00Z',
    startedAt: '2026-10-30T11:59:00Z',
    suite: 'habitat-tests',
    version: 1,
    profile: 'headless',
    mode: 'standard',
    repetitions: 1,
    runId: 'run-101',
    fingerprint: 'current-fp',
    head: 'main',
    status: 'completed',
    automatedVerdict: 'pass',
    performanceVerdict: 'pass',
    visualReview: 'approved',
    file: 'run-101.json',
    errors: [],
    cases: {
      shellTest: {
        metrics: {
          'frameInterval (ms)': { n: 10, min: 4, med: 5, p95: 6, max: 7 },
        },
        failed: [],
        invalid: [],
        thumbnails: ['habitat/shell.webp'],
      },
    },
  },
];

describe('buildDevelopmentMapProject', () => {
  it('automatically derives branches, examples and evidence in zero-config mode', () => {
    const project = buildDevelopmentMapProject(sampleManifest, {
      projectTitle: "Bruno's Space Program Map",
      runs: sampleRuns,
    });

    expect(project.title).toBe("Bruno's Space Program Map");
    expect(project.branches.length).toBe(2);

    // Branch 1: Explicit branch "Habitats & Bases"
    const habitatBranch = project.branches.find((b) => b.title === 'Habitats & Bases');
    expect(habitatBranch).toBeDefined();
    const studioExample = habitatBranch!.examples[0];
    expect(studioExample.id).toBe('habitat-studio');
    expect(studioExample.title).toBe('Habitat Studio POC');
    expect(studioExample.href).toBe('/examples/habitat-studio');
    expect(studioExample.documents.length).toBe(1);
    expect(studioExample.documents[0].id).toBe('plan-1');
    expect(studioExample.documents[0].sourceHref).toBe('/development-map#plan-1');
    expect(studioExample.evidence.length).toBe(1);
    expect(studioExample.evidence[0].suite).toBe('habitat-tests');

    // Branch 2: Auto-derived from initiative "orbital-docking" -> "Orbital Docking"
    const orbitalBranch = project.branches.find((b) => b.id === 'orbital-docking');
    expect(orbitalBranch).toBeDefined();
    expect(orbitalBranch!.title).toBe('Orbital Docking');
    const dockingExample = orbitalBranch!.examples[0];
    expect(dockingExample.id).toBe('orbital-docking');
    expect(dockingExample.title).toBe('Orbital Docking Ports');
    expect(dockingExample.href).toBe('/development-map#plan-2');
    expect(dockingExample.documents[0].id).toBe('plan-2');
  });

  it('supports custom anchorBase and testsHref options', () => {
    const project = buildDevelopmentMapProject(sampleManifest, {
      anchorBase: '/custom-map',
      testsHref: '/custom-tests',
      runs: sampleRuns,
    });

    const habitatBranch = project.branches.find((b) => b.title === 'Habitats & Bases');
    const doc = habitatBranch!.examples[0].documents[0];
    expect(doc.sourceHref).toBe('/custom-map#plan-1');
    expect(doc.concerns[0].sourceHref).toBe('/custom-map#plan-1-Q1');
    expect(habitatBranch!.examples[0].evidence[0].href).toBe('/custom-tests');
  });

  it('supports explicit source definition for backwards compatibility', () => {
    const explicitSource: MapProjectSource = {
      title: 'Custom Title',
      branches: [
        {
          id: 'manual-branch',
          title: 'Manual Branch',
          examples: [
            {
              id: 'manual-example',
              title: 'Manual Example',
              href: '/manual',
              documentIds: ['plan-1'],
            },
          ],
        },
      ],
    };

    const project = buildDevelopmentMapProject(explicitSource, sampleManifest, sampleRuns);
    expect(project.title).toBe('Custom Title');
    expect(project.branches.length).toBe(1);
    expect(project.branches[0].id).toBe('manual-branch');
    expect(project.branches[0].examples[0].id).toBe('manual-example');
    expect(project.branches[0].examples[0].documents[0].id).toBe('plan-1');
  });
});
