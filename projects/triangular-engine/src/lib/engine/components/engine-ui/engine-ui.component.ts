import { Component, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { EngineService } from '../../services';
import { EngineStatsComponent } from './engine-stats/engine-stats.component';
import { ENGINE_SCENE_TREE_COMPONENT, IUserInterfaceOptions } from '../../models';
import { PortalOutletComponent, PortalTargetDirective } from '@daxur-studios/portal-layout';

@Component({
  selector: 'engine-ui',
  imports: [CommonModule, EngineStatsComponent, PortalOutletComponent, PortalTargetDirective],
  templateUrl: './engine-ui.component.html',
  styleUrl: './engine-ui.component.scss'
})
export class EngineUiComponent {
  readonly userInterface = input<IUserInterfaceOptions>({});
  readonly sceneTreeComponent = inject(ENGINE_SCENE_TREE_COMPONENT, { optional: true });

  constructor(readonly engineService: EngineService) {}
}
