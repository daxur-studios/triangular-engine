import { Component } from '@angular/core';
import { EngineModule, EngineService } from 'triangular-engine';
import { PostprocessingModule } from 'triangular-engine/postprocessing';
import { TakramModule } from 'triangular-engine/takram';

@Component({
  selector: 'app-takram-clouds-page',
  imports: [EngineModule, PostprocessingModule, TakramModule],
  templateUrl: './takram-clouds-page.component.html',
  styleUrl: './takram-clouds-page.component.scss',
  providers: [
    EngineService.provide({
      showFPS: true,
      pixelRatio: 1,
      webGLRendererParameters: {
        antialias: false,
        logarithmicDepthBuffer: false,
      },
    }),
  ],
  host: {
    class: 'flex-page',
  },
})
export class TakramCloudsPageComponent {}
