import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DevelopmentMapComponent } from './development-map.component';
import type { DevelopmentMapProject } from './development-map.types';

const gardenProject: DevelopmentMapProject = {
  title: 'Garden Game',
  description: 'A consumer project with its own docs and routes.',
  branches: [{
    id: 'water',
    title: 'Water',
    examples: [{
      id: 'tide-pool',
      title: 'Tide Pool',
      href: '/labs/tide-pool',
      thumbnailUrl: '/images/tide-pool.webp',
      documents: [{
        id: 'plan-1',
        number: 1,
        title: 'Tide Pool Simulation',
        readiness: 'open-items',
        progress: { done: 1, total: 2, percent: 50 },
        phases: [{ id: 'm1', title: 'Build shore water', state: 'done', readiness: 'ready' }],
        concerns: [{
          id: 'Q1',
          title: 'Should foam use a separate pass?',
          kind: 'investigation',
          state: 'open',
          blocks: true,
          body: 'Why it matters: this changes the rendering cost.\nNext action: compare two small scenes.',
          sourceHref: '#plan-1',
          sourceLabel: 'View source plan',
        }],
        relations: [{ type: 'alternative-to', title: 'Shore raymarch', href: '/plans/2' }],
        scope: {
          baselineState: 'confirmed',
          baseline: { done: 1, total: 2, percent: 50 },
          current: { done: 1, total: 3, percent: 33 },
          acceptedGrowth: 1,
          changes: [{
            id: 'SC1', date: '2026-10-24', kind: 'addition', origin: 'discovered',
            disposition: 'accepted', scopeIds: ['m3'], summary: 'Add foam controls',
            reason: 'The test exposed a missing tuning control.', impact: 'Adds one accepted goal.',
          }],
        },
      }],
      evidence: [{
        id: 'water-cost-v1-run-1', suite: 'water-cost', version: 1, savedAt: '2026-10-24T10:00:00Z',
        profile: 'visible-browser', mode: 'standard', automatedVerdict: 'pass', performanceVerdict: 'unassessed',
        visualReview: 'not-required', stale: true, gpu: 'NVIDIA / WebGPU', warnings: ['other-app-measuring'],
        metrics: [{ name: 'frameInterval', median: 6.2, p95: 8.1, unit: 'ms' }], href: '/tests',
      }],
    }],
  }],
  timeline: [{ id: 'scope-SC1', date: '2026-10-24', kind: 'scope', title: 'Add foam controls', detail: 'Added after investigation.', disposition: 'accepted' }],
};

describe('DevelopmentMapComponent', () => {
  let fixture: ComponentFixture<DevelopmentMapComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DevelopmentMapComponent] }).compileComponents();
    fixture = TestBed.createComponent(DevelopmentMapComponent);
  });

  it('renders consumer supplied branches, concern sources, scope history and test evidence', () => {
    fixture.componentRef.setInput('project', gardenProject);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.textContent).toContain('Garden Game');
    expect(page.textContent).toContain('Tide Pool');
    expect(page.textContent).toContain('Should foam use a separate pass?');
    expect(page.textContent).toContain('Baseline 1/2 · Current 1/3');
    expect(page.textContent).toContain('+1 accepted scope items');
    expect(page.textContent).toContain('NVIDIA / WebGPU');
    expect(page.textContent).toContain('performance unassessed');
    expect(page.textContent).toContain('med 6.2 ms · p95 8.1 ms');
    expect(page.textContent).toContain('stale');
    expect(page.querySelector<HTMLAnchorElement>('a[href="/labs/tide-pool"]')).not.toBeNull();
    expect(page.querySelector<HTMLAnchorElement>('a[href="#plan-1"]')?.textContent).toContain('View source plan');
  });

  it('renders a different project model without relying on demo-app data', () => {
    fixture.componentRef.setInput('project', {
      title: 'Forest Builder',
      branches: [{
        id: 'scatter', title: 'Scatter', examples: [{
          id: 'oak-study', title: 'Oak Study', href: '/experiments/oak', documents: [], evidence: [],
        }],
      }],
      timeline: [],
    });
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.textContent).toContain('Forest Builder');
    expect(page.textContent).toContain('Oak Study');
    expect(page.textContent).toContain('1 without a linked document');
    expect(page.textContent).toContain('No plan or Engineering Record linked to this map card yet.');
    expect(page.textContent).not.toContain('Garden Game');
    expect(page.querySelector<HTMLAnchorElement>('a[href="/experiments/oak"]')).not.toBeNull();
  });
});
