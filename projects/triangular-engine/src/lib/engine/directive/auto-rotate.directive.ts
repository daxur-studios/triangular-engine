import {
  DestroyRef,
  Directive,
  inject,
  input,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { takeUntil, tap } from 'rxjs';
import { Vector3Tuple } from 'three';
import { Object3DComponent } from '../components/object-3d/object-3d.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EngineService } from '../services/engine.service';

/**
 * Directive to automatically rotate Object3D components.
 * Can be applied to any Object3DComponent or its subclasses.
 *
 * Usage:
 * ```html
 * <!-- Rotate on all axes at 10 RPM -->
 * <mesh autoRotate></mesh>
 *
 * <!-- Rotate only on Y axis at 30 RPM -->
 * <mesh autoRotate [autoRotateAxes]="[0, 1, 0]" [autoRotateRpm]="30"></mesh>
 *
 * <!-- Rotate on X and Z axes at 5 RPM -->
 * <mesh autoRotate [autoRotateAxes]="[1, 0, 1]" [autoRotateRpm]="5"></mesh>
 * ```
 *
 * Use autoRotateAxes to specify which axes to rotate: [x, y, z]
 * Values should be 1 (rotate) or 0 (don't rotate).
 * Use autoRotateRpm to control rotation speed in revolutions per minute.
 */
@Directive({
  selector: '[autoRotate]',
  standalone: true,
})
export class AutoRotateDirective implements OnInit {
  readonly hostComponent = inject(Object3DComponent);

  readonly destroyRef = inject(DestroyRef);
  readonly engineService = inject(EngineService);

  /**
   * Specify which axes to rotate: [x, y, z]
   * Default rotates all axes: [1, 1, 1]
   * Use [1, 0, 0] for X-axis only, [0, 1, 0] for Y-axis only, etc.
   */
  readonly autoRotateAxes = input<Vector3Tuple>([1, 1, 1]);

  /**
   * Rotation speed in revolutions per minute (RPM). Default is 10 RPM.
   * This provides a more intuitive speed control than raw angular velocity.
   */
  readonly autoRotateRpm = input<number>(10);

  ngOnInit(): void {
    // Subscribe to the engine's tick$ to update rotation each frame
    this.engineService.tick$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        tap((deltaTime) => this.updateRotation(deltaTime)),
      )
      .subscribe();
  }

  private updateRotation(deltaTime: number): void {
    const object3D = this.hostComponent.object3D();
    if (!object3D) return;

    const axes = this.autoRotateAxes();
    const rpm = this.autoRotateRpm();

    // Convert RPM to radians per second
    const radiansPerSecond = (rpm / 60) * 2 * Math.PI;

    // Update rotation based on delta time and specified axes
    object3D.rotation.x += axes[0] * radiansPerSecond * deltaTime;
    object3D.rotation.y += axes[1] * radiansPerSecond * deltaTime;
    object3D.rotation.z += axes[2] * radiansPerSecond * deltaTime;
  }
}
