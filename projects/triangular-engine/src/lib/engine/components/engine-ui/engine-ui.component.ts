import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { EngineService } from '../../services';
import { EngineStatsComponent } from './engine-stats/engine-stats.component';
import { IUserInterfaceOptions } from '../../models';
import { SceneTreeComponent } from '../../features/scene-tree/scene-tree.component';
import { EnginePortalOutletComponent } from './engine-portal-outlet.component';

@Component({
  selector: 'engine-ui',
  imports: [CommonModule, EngineStatsComponent, SceneTreeComponent, EnginePortalOutletComponent],
  templateUrl: './engine-ui.component.html',
  styleUrl: './engine-ui.component.scss'
})
export class EngineUiComponent {
  readonly userInterface = input<IUserInterfaceOptions>({});

  constructor(readonly engineService: EngineService) {}
}
