import { Component } from '@angular/core';

import { EngineModule, EngineService } from 'triangular-engine';
import { PostprocessingModule } from 'triangular-engine/postprocessing';

@Component({
  selector: 'app-engine-demo',
  imports: [EngineModule, PostprocessingModule],
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
