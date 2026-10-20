import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TestResultsComponent } from 'triangular-engine/testing';

/**
 * Plan 058: browse the runs the local result receiver saved (`ng serve` starts it through `proxy.conf.cjs`, or run
 * `npm run test:receiver`), with a small picture of what each case looked at. The component is the library's
 * `triangular-engine/testing` one; this page only hosts it and maps the demo theme onto its `--ui-*` variables.
 */
@Component({
  standalone: true,
  selector: 'app-test-results-page',
  imports: [RouterLink, TestResultsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex-page' },
  template: `
    <main>
      <a routerLink="/">← Examples</a>
      <p class="intro">Runs saved by the dev result receiver. Pick one for its cases, thumbnails and the change from a baseline, or tick two to compare them.</p>
      <tri-test-results />
    </main>
  `,
  styles: `
    :host {
      --ui-surface: var(--mat-sys-surface-container);
      --ui-surface-raised: var(--mat-sys-surface-container-high);
      --ui-border: var(--mat-sys-outline-variant);
      --ui-text: var(--mat-sys-on-surface);
      --ui-muted: var(--mat-sys-on-surface-variant);
      --ui-accent: var(--mat-sys-primary);
      --ui-warning: light-dark(#8a5a00, #ffd479);
      --ui-danger: var(--mat-sys-error);
      --ui-success: light-dark(#1b7a45, #8fe0b2);
      color: var(--mat-sys-on-surface);
      background: var(--mat-sys-surface);
    }
    main { box-sizing: border-box; width: min(72rem, 100%); margin: 0 auto; padding: 1rem; }
    .intro { margin: 0.5rem 0 1rem; color: var(--mat-sys-on-surface-variant); }
    a { color: var(--mat-sys-primary); }
  `,
})
export class TestResultsPageComponent {}
