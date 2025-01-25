import { signal } from '@angular/core';
import { takeUntil } from 'rxjs';

import { IEngine } from './engine.model';

/** Frames per second */
export class FPSController {
  lastRenderTime = -1;
  fpsLimitInterval: number = 0;

  previousSecond: number = performance.now();

  /** The number of frames, reset to 0 on every new second */
  frameCount: number = 0;
  displayCount = signal(this.frameCount);

  graph: number[] = [];

  constructor(public readonly engineService: IEngine) {
    this.tick();
  }

  tick() {
    this.engineService.tick$
      .pipe(takeUntil(this.engineService.onDestroy$))
      .subscribe((delta) => {
        const now = performance.now();
        /**Do Not Change This */
        const OneSecond = 1000;

        if (now - this.previousSecond >= OneSecond) {
          this.previousSecond = now;

          this.displayCount.set(this.frameCount);

          //#region Graph
          this.graph.push(this.frameCount);
          if (this.graph.length > 60) {
            this.graph.shift();
          }
          //#endregion

          this.frameCount = 0;
        }

        this.frameCount++;
      });
  }
}
