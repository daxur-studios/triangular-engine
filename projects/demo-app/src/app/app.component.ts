import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CatalogCaptureComponent } from './shared/catalog-thumbnails/catalog-capture.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CatalogCaptureComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  host: {
    class: 'flex-page',
  },
})
export class AppComponent {}
