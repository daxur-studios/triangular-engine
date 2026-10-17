import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CatalogCaptureComponent } from './shared/catalog-thumbnails/catalog-capture.component';
import { ThemeService } from './theme/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CatalogCaptureComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  host: {
    class: 'flex-page',
  },
})
export class AppComponent {
  /** Injected so the theme is applied once at startup, before any routed page reads it. */
  private readonly themeService = inject(ThemeService);
}
