import { signal } from '@angular/core';
import { BehaviorSubject, takeUntil } from 'rxjs';
import { IEngine } from './engine.model';
import { Vector2 } from 'three';

/**
 * Cursor x and y position in pixels relative to the canvas
 */
export class Cursor {
  private previousX = 0;
  private previousY = 0;

  /**
   * Normalized x and y position in the range of -1 to 1
   */
  x = signal(0);
  y = signal(0);

  readonly position$ = new BehaviorSubject<Vector2>(new Vector2());

  axisX = signal(0);
  axisY = signal(0);

  event: MouseEvent | undefined;

  normalizedPosition$ = new BehaviorSubject<Cursor>(this);

  constructor(private readonly engine: IEngine) {
    this.engine.mousemove$
      .pipe(takeUntil(this.engine.onDestroy$))
      .subscribe((event) => this.updatePosition(event));
  }

  updatePosition = (e: MouseEvent | null) => {
    if (!e) return;
    // x and y are in the range -1 to 1
    const x = (e.offsetX / (this.engine.width || 0)) * 2 - 1;
    const y = -((e.offsetY / (this.engine.height || 0)) * 2 - 1);

    this.x.set(x);
    this.y.set(y);
    this.position$.next(this.position$.value.set(x, y));

    this.event = e;

    this.normalizedPosition$.next(this);

    this.axisX.set(this.x() - this.previousX);
    this.axisY.set(this.y() - this.previousY);

    this.previousX = this.x();
    this.previousY = this.y();
  };
}
