import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CameraActionTag } from '../../../models';

export interface ISparklineBar {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly slotWidth: number;
  readonly value: number;
  readonly status: 'good' | 'warning' | 'critical';
  readonly motionTag: CameraActionTag;
  readonly motionSymbol: string;
  readonly motionColor: string;
}

/**
 * Reusable, lightweight SVG sparkline for rendering real-time telemetry timelines.
 * Displays FPS bars with color thresholding and synchronized camera motion markers.
 */
@Component({
  selector: 'telemetry-sparkline',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './telemetry-sparkline.component.html',
  styleUrl: './telemetry-sparkline.component.scss',
})
export class TelemetrySparklineComponent {
  /** Telemetry values to display (e.g. rolling 60 seconds of FPS). */
  readonly values = input<readonly number[]>([]);

  /** Camera motion action tags matching each telemetry sample. */
  readonly motionTags = input<readonly CameraActionTag[]>([]);

  /** Target performance baseline (default: 60 FPS). */
  readonly targetValue = input<number>(60);

  /** Warning threshold floor (default: 55 FPS). Values below this are amber. */
  readonly warningFloor = input<number>(55);

  /** Critical threshold floor (default: 30 FPS). Values below this are red. */
  readonly criticalFloor = input<number>(30);

  /** Height in pixels of the SVG sparkline area (default: 32). */
  readonly height = input<number>(32);

  /** Width in pixels of the SVG sparkline area (default: 150). */
  readonly width = input<number>(150);

  /** Whether to render the camera motion indicator strip beneath the graph. */
  readonly showMotionTrack = input<boolean>(true);

  /** Whether to render horizontal baseline guideline dashes. */
  readonly showGuideLines = input<boolean>(true);

  readonly viewBox = computed(() => `0 0 ${this.width()} ${this.height()}`);

  private readonly maxCeiling = computed(() => {
    const vals = this.values();
    const highestVal = vals.length > 0 ? Math.max(...vals) : 60;
    return Math.max(this.targetValue(), highestVal, 1);
  });

  readonly targetY = computed(() => {
    const h = this.height();
    const ceiling = this.maxCeiling();
    return Math.max(2, h - (this.targetValue() / ceiling) * (h - 4));
  });

  readonly critY = computed(() => {
    const h = this.height();
    const ceiling = this.maxCeiling();
    return Math.max(2, h - (this.criticalFloor() / ceiling) * (h - 4));
  });

  readonly bars = computed<readonly ISparklineBar[]>(() => {
    const vals = this.values();
    const motions = this.motionTags();
    const w = this.width();
    const h = this.height();
    const ceiling = this.maxCeiling();
    const warnFloor = this.warningFloor();
    const critFloor = this.criticalFloor();

    if (vals.length === 0) {
      return [];
    }

    const n = vals.length;
    const slotW = w / n;
    const barW = Math.max(1, slotW - 1);

    return vals.map((v, i) => {
      const barH = Math.max(2, (v / ceiling) * (h - 4));
      const x = i * slotW;
      const y = h - barH;

      let status: 'good' | 'warning' | 'critical' = 'good';
      if (v < critFloor) {
        status = 'critical';
      } else if (v < warnFloor) {
        status = 'warning';
      }

      const motionTag = motions[i] ?? 'idle';
      const { symbol, color } = this.resolveMotionMeta(motionTag);

      return {
        x,
        y,
        width: barW,
        height: barH,
        slotWidth: slotW,
        value: v,
        status,
        motionTag,
        motionSymbol: symbol,
        motionColor: color,
      };
    });
  });

  private resolveMotionMeta(tag: CameraActionTag): { symbol: string; color: string } {
    switch (tag) {
      case 'rot':
        return { symbol: 'R', color: '#38bdf8' }; // Sky blue
      case 'zoom':
        return { symbol: 'Z', color: '#c084fc' }; // Purple
      case 'move':
        return { symbol: 'M', color: '#34d399' }; // Emerald
      case 'rot+zoom':
        return { symbol: 'RZ', color: '#f472b6' }; // Pink
      case 'move+rot':
        return { symbol: 'MR', color: '#a3e635' };
      case 'move+zoom':
        return { symbol: 'MZ', color: '#2dd4bf' };
      case 'orbit':
        return { symbol: 'O', color: '#60a5fa' };
      case 'orbit+zoom':
        return { symbol: 'OZ', color: '#818cf8' };
      case 'multi':
        return { symbol: '⚡', color: '#fbbf24' }; // Amber
      case 'idle':
      default:
        return { symbol: '·', color: 'rgba(255, 255, 255, 0.2)' };
    }
  }
}
