import { Component } from '@angular/core';

import { EngineModule, EngineService } from 'triangular-engine';

@Component({
  selector: 'app-engine-demo',
  imports: [EngineModule],
  templateUrl: './engine-demo.component.html',
  providers: [
    EngineService.provide({
      showFPS: true,
    }),
  ],
  host: {
    class: 'flex-page',
  },
})
export class EngineDemoComponent {}
