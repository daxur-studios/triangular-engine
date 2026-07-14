import { Component } from '@angular/core';
import { NoToneMapping } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { PostprocessingModule } from 'triangular-engine/postprocessing';
import { TakramModule } from 'triangular-engine/takram';
import { TakramCloudControlsComponent } from '../../shared/takram-cloud-controls/takram-cloud-controls.component';

@Component({
  selector: 'app-takram-clouds-page',
  imports: [EngineModule, PostprocessingModule, TakramModule, TakramCloudControlsComponent],
  templateUrl: './takram-clouds-page.component.html',
  styleUrl: './takram-clouds-page.component.scss',
  providers: [
    EngineService.provide({
      showFPS: true,
      pixelRatio: 1,
      toneMapping: NoToneMapping,
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
