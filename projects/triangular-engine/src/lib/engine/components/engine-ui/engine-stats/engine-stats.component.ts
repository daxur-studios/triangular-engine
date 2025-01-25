import { Component } from '@angular/core';
import { EngineService } from '../../../services';

@Component({
  selector: 'engine-stats',
  standalone: true,
  imports: [],
  templateUrl: './engine-stats.component.html',
  styleUrl: './engine-stats.component.scss',
})
export class EngineStatsComponent {
  constructor(readonly engineService: EngineService) {}
}
