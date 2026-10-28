import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Placeholder for the demo routes that used the Takram integration. The engine
 * no longer ships `triangular-engine/takram`; the original pages live in
 * `projects/demo-app/deprecated/`, outside the compiled sources.
 */
@Component({
  selector: 'app-deprecated-takram-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="deprecated-page">
      <h1>Deprecated demo</h1>
      <p>
        This demo used the Takram atmosphere and cloud integration, which has
        been removed from <code>triangular-engine</code>. Its code is kept in
        <code>projects/demo-app/deprecated/</code> and is not compiled.
      </p>
      <a routerLink="/">Back to the demo index</a>
    </main>
  `,
  styles: `
    .deprecated-page {
      max-width: 40rem;
      margin: 3rem auto;
      padding: 0 1rem;
    }
  `,
})
export class DeprecatedTakramPageComponent {}
