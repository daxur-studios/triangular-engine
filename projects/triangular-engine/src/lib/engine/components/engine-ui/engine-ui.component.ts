import { Component, TemplateRef, input } from '@angular/core';

import { EngineService } from '../../services';

import { CommonModule } from '@angular/common';
import { EngineStatsComponent } from './engine-stats/engine-stats.component';
import { IUserInterfaceOptions } from '../../models';

@Component({
  selector: 'engine-ui',
  standalone: true,
  imports: [CommonModule, EngineStatsComponent],
  templateUrl: './engine-ui.component.html',
  styleUrl: './engine-ui.component.scss',
})
export class EngineUiComponent {
  readonly userInterface = input<IUserInterfaceOptions>({});
  //

  constructor(readonly engineService: EngineService) {}
}
