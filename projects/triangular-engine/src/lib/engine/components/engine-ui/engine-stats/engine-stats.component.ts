import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { EngineService } from '../../../services';
import { IPerformanceThresholds } from '../../../models';
import { TelemetrySparklineComponent } from '../telemetry-sparkline/telemetry-sparkline.component';

/**
 * Overlay component displaying real-time engine rendering statistics and performance warnings.
 */
@Component({
  selector: 'engine-stats',
  imports: [CommonModule, DecimalPipe, TelemetrySparklineComponent],
  templateUrl: './engine-stats.component.html',
  styleUrl: './engine-stats.component.scss'
})
export class EngineStatsComponent implements OnDestroy {
  readonly expanded = signal(false);
  readonly copyState = signal<'idle' | 'copied' | 'failed'>('idle');
  private copyTimeoutId: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly engineService: EngineService) {}

  toggleExpanded() {
    this.expanded.set(!this.expanded());
  }

  async copyTelemetryForAgent(event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    const telemetry = this.engineService.fpsController.formatTelemetryForAgent();
    const ok = await this.writeToClipboard(telemetry);
    this.copyState.set(ok ? 'copied' : 'failed');
    clearTimeout(this.copyTimeoutId);
    this.copyTimeoutId = setTimeout(() => this.copyState.set('idle'), 1500);
  }

  ngOnDestroy(): void {
    clearTimeout(this.copyTimeoutId);
  }

  private async writeToClipboard(text: string): Promise<boolean> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn('Clipboard API failed, trying fallback', err);
    }
    return this.legacyCopy(text);
  }

  /** Fallback for insecure contexts / denied permissions where the async Clipboard API is unavailable. */
  private legacyCopy(text: string): boolean {
    if (typeof document === 'undefined') {
      return false;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      textarea.remove();
    }
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
