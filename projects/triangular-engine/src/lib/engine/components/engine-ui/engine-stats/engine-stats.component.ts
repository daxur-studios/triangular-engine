import { Component, signal } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { EngineService } from '../../../services';
import { IPerformanceThresholds } from '../../../models';

/**
 * Overlay component displaying real-time engine rendering statistics and performance warnings.
 */
@Component({
  selector: 'engine-stats',
  imports: [CommonModule, DecimalPipe],
  templateUrl: './engine-stats.component.html',
  styleUrl: './engine-stats.component.scss'
})
export class EngineStatsComponent {
  readonly expanded = signal(false);

  constructor(readonly engineService: EngineService) {}

  toggleExpanded() {
    this.expanded.set(!this.expanded());
  }

  getThresholds(): Required<IPerformanceThresholds> {
    const thresholds = this.engineService.options.performanceThresholds || {};
    return {
      maxFrameTimeWarning: thresholds.maxFrameTimeWarning ?? 16.6,
      maxFrameTimeCritical: thresholds.maxFrameTimeCritical ?? 33.3,
      maxDrawCallsWarning: thresholds.maxDrawCallsWarning ?? 150,
      maxDrawCallsCritical: thresholds.maxDrawCallsCritical ?? 300,
      maxTrianglesWarning: thresholds.maxTrianglesWarning ?? 1000000,
      maxTrianglesCritical: thresholds.maxTrianglesCritical ?? 2000000,
    };
  }

  formatNumber(value: number): string {
    if (value >= 1_000_000) {
      return (value / 1_000_000).toFixed(2).replace(/\.00$/, '') + 'M';
    }
    if (value >= 1_000) {
      return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return value.toString();
  }
}
