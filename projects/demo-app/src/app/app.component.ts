import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import {
  EngineModule,
  EngineService,
  provideEngineOptions,
} from 'triangular-engine';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterModule, EngineModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  providers: [
    EngineService,
    provideEngineOptions({
      showFPS: true,
    }),
  ],
  host: {
    class: 'flex-page',
  },
})
export class AppComponent {
  readonly engineService = inject(EngineService);
}
