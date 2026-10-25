import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { DevelopmentMapProject } from './development-map.types';

/** Renders a normalized project roadmap with examples, readiness, scope history and saved evidence. */
@Component({
  selector: 'tri-development-map',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './development-map.component.html',
  styleUrl: './development-map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevelopmentMapComponent {
  /** Project-specific document, example-page and test data, normalized by the host app. */
  readonly project = input.required<DevelopmentMapProject>();

  /** Events from all branches, newest first, with invalid dates kept at the end. */
  readonly timeline = computed(() => [...this.project().timeline].sort((a, b) => {
    const left = Date.parse(a.date) || 0;
    const right = Date.parse(b.date) || 0;
    return right - left;
  }));

  readonly exampleCount = computed(() => this.project().branches.reduce((total, branch) => total + branch.examples.length, 0));
  readonly unlinkedExampleCount = computed(() => this.project().branches.reduce((total, branch) => total + branch.examples.filter((example) => example.documents.length === 0).length, 0));
  readonly concernCount = computed(() => this.project().branches.reduce((total, branch) => total + branch.examples.reduce(
    (count, example) => count + example.documents.reduce((documentCount, document) => documentCount + document.concerns.filter((item) => item.state !== 'resolved').length, 0), 0), 0));
}
