import { Component, effect, input, signal } from '@angular/core';
import { CurveComponent } from './curve.component';
import { EllipseCurve } from 'three';
import { provideObject3DComponent } from '../object-3d';

export interface EllipseCurveParamsMap {
  aX: number;
  aY: number;
  xRadius: number;
  yRadius: number;
  aStartAngle: number;
  aEndAngle: number;
  aClockwise: boolean;
  aRotation: number;
}

@Component({
    selector: 'ellipseCurve',
    imports: [],
    template: `<ng-content></ng-content>`
})
export class EllipseCurveComponent extends CurveComponent {
  /**
 * @param aX — The X center of the ellipse. Expects a Float. Default is 0.

@param aY — The Y center of the ellipse. Expects a Float. Default is 0.

@param xRadius — The radius of the ellipse in the x direction. Expects a Float. Default is 1.

@param yRadius — The radius of the ellipse in the y direction. Expects a Float. Default is 1.

@param aStartAngle — The start angle of the curve in radians starting from the positive X axis. Default is 0.

@param aEndAngle — The end angle of the curve in radians starting from the positive X axis. Default is 2 x Math.PI.

@param aClockwise — Whether the ellipse is drawn clockwise. Default is false.

@param aRotation — The rotation angle of the ellipse in radians, counterclockwise from the positive X axis. Default is 0.
 */
  readonly params = input.required<EllipseCurveParamsMap>();

  override readonly curve = signal(new EllipseCurve());

  constructor() {
    super();

    this.#initParams();
  }

  #initParams() {
    effect(
      () => {
        const params = this.params();
        const curve = this.curve();

        curve.aX = params.aX;
        curve.aY = params.aY;
        curve.xRadius = params.xRadius;
        curve.yRadius = params.yRadius;
        curve.aStartAngle = params.aStartAngle;
        curve.aEndAngle = params.aEndAngle;
        curve.aClockwise = params.aClockwise;
        curve.aRotation = params.aRotation;

        curve.updateArcLengths();
        this.curveUpdatedTrigger.update((count) => count + 1);
      },
      { allowSignalWrites: true },
    );
  }
}
