import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  GraphCardComponent,
  TaskGraphComponent,
} from '@daxur-studios/mermaid-runtime';
import type {
  DevelopmentMapExample,
  DevelopmentMapProject,
} from './development-map.types';
import {
  buildDevelopmentMapExampleGraph,
  type DevelopmentMapExampleGraph,
} from './development-map-graph';

/** Renders a normalized project roadmap with examples, readiness, scope history and saved evidence. */
@Component({
  selector: 'tri-development-map',
  standalone: true,
  imports: [DatePipe, GraphCardComponent, TaskGraphComponent],
  templateUrl: './development-map.component.html',
  styleUrl: './development-map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevelopmentMapComponent {
  /** Project-specific document, example-page and test data, normalized by the host app. */
  readonly project = input.required<DevelopmentMapProject>();
  /** The selected example whose relationship graph is open in the full viewer. */
  readonly activeGraph = signal<{
    example: DevelopmentMapExample;
    branchTitle: string;
    card: DevelopmentMapExampleGraph;
  } | null>(null);

  private readonly graphDialog = viewChild<ElementRef<HTMLDialogElement>>('graphDialog');

  /** Events from all branches, newest first, with invalid dates kept at the end. */
  readonly timeline = computed(() =>
    [...this.project().timeline].sort((a, b) => {
      const left = Date.parse(a.date) || 0;
      const right = Date.parse(b.date) || 0;
      return right - left;
    }),
  );

  readonly exampleCount = computed(() =>
    this.project().branches.reduce(
      (total, branch) => total + branch.examples.length,
      0,
    ),
  );
  readonly unlinkedExampleCount = computed(() =>
    this.project().branches.reduce(
      (total, branch) =>
        total +
        branch.examples.filter((example) => example.documents.length === 0)
          .length,
      0,
    ),
  );
  readonly concernCount = computed(() =>
    this.project().branches.reduce(
      (total, branch) =>
        total +
        branch.examples.reduce(
          (count, example) =>
            count +
            example.documents.reduce(
              (documentCount, document) =>
                documentCount +
                document.concerns.filter((item) => item.state !== 'resolved')
                  .length,
              0,
            ),
          0,
        ),
      0,
    ),
  );

  private readonly exampleCards = computed(
    () =>
      new Map<string, DevelopmentMapExampleGraph>(
        this.project().branches.flatMap((branch) =>
          branch.examples.map(
            (example) =>
              [example.id, buildDevelopmentMapExampleGraph(example)] as const,
          ),
        ),
      ),
  );

  cardFor(exampleId: string): DevelopmentMapExampleGraph {
    return (
      this.exampleCards().get(exampleId) ?? {
        graph: { nodes: [] },
        nodeKinds: {},
        progress: null,
        readiness: null,
        status: null,
      }
    );
  }

  /** Open the compact card graph in Mermaid Runtime's pan/zoom viewer. */
  openGraph(example: DevelopmentMapExample, branchTitle: string): void {
    const card = buildDevelopmentMapExampleGraph(example);
    if (card.graph.nodes.length < 2) return;

    this.activeGraph.set({ example, branchTitle, card });
    const dialog = this.graphDialog()?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
  }

  closeGraph(): void {
    const dialog = this.graphDialog()?.nativeElement;
    if (dialog?.open) dialog.close();
    this.activeGraph.set(null);
  }

  onGraphDialogClose(): void {
    this.activeGraph.set(null);
  }

  onGraphDialogBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeGraph();
  }
}
