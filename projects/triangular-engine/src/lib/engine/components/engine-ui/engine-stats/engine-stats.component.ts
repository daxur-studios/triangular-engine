import { Component } from '@angular/core';
import { EngineService } from '../../../services';

@Component({
    selector: 'engine-stats',
    imports: [],
    templateUrl: './engine-stats.component.html',
    styleUrl: './engine-stats.component.scss'
})
export class EngineStatsComponent {
  constructor(readonly engineService: EngineService) {}
}
